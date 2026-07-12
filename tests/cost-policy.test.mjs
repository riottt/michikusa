import assert from "node:assert/strict";
import test from "node:test";

import { createClient } from "@libsql/client";

import {
  costLimitFor,
  dailyBucketStart,
  reserveBurstQuota,
  reserveDailyQuota,
} from "../src/lib/cost-policy.ts";
import { readBoundedJson } from "../src/lib/request-json.ts";

async function memoryDatabase() {
  const db = createClient({ url: "file::memory:" });
  await db.execute(`CREATE TABLE costly_request_counters (
    bucket_key TEXT PRIMARY KEY,
    request_count INTEGER NOT NULL,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`);
  return db;
}

test("daily quota is atomic and persists across callers", async () => {
  const db = await memoryDatabase();
  const now = new Date("2026-07-12T14:59:59+09:00");

  const results = await Promise.all(
    Array.from({ length: 8 }, () => reserveDailyQuota(db, "plan", now, 3)),
  );

  assert.equal(results.filter(Boolean).length, 3);
  assert.equal(await reserveDailyQuota(db, "plan", now, 3), false);
  await db.close();
});

test("daily bucket resets at midnight in Asia/Tokyo", () => {
  assert.equal(
    dailyBucketStart(new Date("2026-07-12T14:59:59Z")),
    "2026-07-12",
  );
  assert.equal(
    dailyBucketStart(new Date("2026-07-12T15:00:00Z")),
    "2026-07-13",
  );
});

test("environment limits are bounded and have conservative defaults", () => {
  assert.equal(costLimitFor("plan", {}), 40);
  assert.equal(costLimitFor("plan", { COST_GUARD_DAILY_PLAN_LIMIT: "24" }), 24);
  assert.equal(costLimitFor("plan", { COST_GUARD_DAILY_PLAN_LIMIT: "0" }), 1);
  assert.equal(costLimitFor("plan", { COST_GUARD_DAILY_PLAN_LIMIT: "999999" }), 500);
  assert.equal(costLimitFor("plan", { COST_GUARD_DAILY_PLAN_LIMIT: "invalid" }), 40);
});

test("ten-minute quota is shared globally", async () => {
  const db = await memoryDatabase();
  const now = new Date("2026-07-12T12:04:00Z");
  assert.equal(await reserveBurstQuota(db, "plan", now, 1), true);
  assert.equal(await reserveBurstQuota(db, "plan", now, 1), false);
  assert.equal(await reserveBurstQuota(db, "plan", new Date("2026-07-12T12:10:00Z"), 1), true);
  await db.close();
});

test("bounded JSON rejects non-JSON and oversized bodies without parsing", async () => {
  const wrongType = await readBoundedJson(new Request("https://example.test", {
    method: "POST",
    headers: { "content-type": "text/plain" },
    body: "{}",
  }));
  assert.equal(wrongType.ok, false);
  assert.equal(wrongType.response.status, 415);

  const oversized = await readBoundedJson(new Request("https://example.test", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ value: "x".repeat(128) }),
  }), 32);
  assert.equal(oversized.ok, false);
  assert.equal(oversized.response.status, 413);
});
