export const CALENDAR_CONNECTION_REQUIRED = "Googleカレンダーを接続してください。";

export async function validateCalendarCommitResponse(response, { expectedEventCount, requireLive }) {
  const text = await response.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    throw new Error(`Calendar returned invalid JSON: ${response.status} ${text}`);
  }

  if (
    requireLive &&
    response.status === 409 &&
    body?.error === CALENDAR_CONNECTION_REQUIRED
  ) {
    return { kind: "disconnected", body };
  }

  if (!response.ok) {
    throw new Error(`Calendar failed: ${response.status} ${text}`);
  }
  if (body?.event_ids?.length !== expectedEventCount) {
    throw new Error("Calendar event count mismatch");
  }
  return { kind: "committed", body };
}
