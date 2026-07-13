import assert from "node:assert/strict";
import test from "node:test";

import {
  CALENDAR_CONNECTION_REQUIRED,
  validateCalendarCommitResponse
} from "../scripts/smoke-contracts.mjs";

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

test("live smoke accepts the explicit Calendar-disconnected 409 contract", async () => {
  const result = await validateCalendarCommitResponse(
    jsonResponse({ error: CALENDAR_CONNECTION_REQUIRED }, 409),
    { expectedEventCount: 5, requireLive: true }
  );

  assert.equal(result.kind, "disconnected");
  assert.equal(result.body.error, CALENDAR_CONNECTION_REQUIRED);
});

test("Calendar-disconnected 409 is not accepted outside the live smoke mode", async () => {
  await assert.rejects(
    validateCalendarCommitResponse(
      jsonResponse({ error: CALENDAR_CONNECTION_REQUIRED }, 409),
      { expectedEventCount: 5, requireLive: false }
    ),
    /Calendar failed: 409/
  );
});

test("live smoke rejects an unexpected Calendar 409 body", async () => {
  await assert.rejects(
    validateCalendarCommitResponse(
      jsonResponse({ error: "予期しないエラー" }, 409),
      { expectedEventCount: 5, requireLive: true }
    ),
    /Calendar failed: 409/
  );
});

test("successful Calendar commit still requires one event id per draft event", async () => {
  const result = await validateCalendarCommitResponse(
    jsonResponse({ event_ids: ["event-1", "event-2"], created: 2, demo: true }),
    { expectedEventCount: 2, requireLive: true }
  );
  assert.equal(result.kind, "committed");

  await assert.rejects(
    validateCalendarCommitResponse(
      jsonResponse({ event_ids: ["event-1"], created: 1, demo: false }),
      { expectedEventCount: 2, requireLive: true }
    ),
    /Calendar event count mismatch/
  );
});
