import process from "node:process";

const base = process.env.SMOKE_BASE_URL || "http://127.0.0.1:3000";
let cookie = "";

async function request(path, init = {}) {
  const headers = new Headers(init.headers || {});
  if (cookie) headers.set("Cookie", cookie);
  const response = await fetch(`${base}${path}`, { ...init, headers });
  const setCookie = response.headers.get("set-cookie");
  if (setCookie) cookie = setCookie.split(";", 1)[0];
  return response;
}

const home = await request("/");
if (!home.ok) throw new Error(`Home failed: ${home.status}`);
console.log("Home:", home.status);

const health = await request("/api/health");
if (!health.ok) throw new Error(`Health failed: ${health.status} ${await health.text()}`);
const healthBody = await health.json();
if (
  typeof healthBody.agent?.demo_mode !== "boolean" ||
  typeof healthBody.agent?.maps_live !== "boolean" ||
  typeof healthBody.agent?.gemini_live !== "boolean" ||
  typeof healthBody.agent?.adk_version !== "string"
) {
  throw new Error(`Health is missing sanitized agent state: ${JSON.stringify(healthBody)}`);
}
if (process.env.REQUIRE_LIVE === "true" && (!healthBody.agent.maps_live || !healthBody.agent.gemini_live)) {
  throw new Error(`Agent providers are not live: ${JSON.stringify(healthBody.agent)}`);
}
console.log("Health:", JSON.stringify(healthBody));

const payload = {
  request_id: crypto.randomUUID(),
  location: { lat: 34.702485, lng: 135.495951, label: "大阪・梅田" },
  home_location: { lat: 34.702485, lng: 135.495951, label: "ホーム" },
  context_hint: "home",
  preferences: {
    duration_minutes: 90,
    budget_yen: 1500,
    transport: "walk_transit",
    pace: "normal",
    mood: "anything",
    return_buffer_minutes: 25
  },
  now: new Date().toISOString()
};

const response = await request("/api/plan/stream", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(payload)
});
if (!response.ok) throw new Error(`Plan failed: ${response.status} ${await response.text()}`);
const text = await response.text();
const lines = text.trim().split("\n").filter(Boolean).map((line) => JSON.parse(line));
const plan = lines.find((event) => event.type === "plan")?.plan;
if (!plan || plan.stops?.length < 2) throw new Error("Plan event or stops missing");
if (plan.mode !== "departure") throw new Error(`Expected departure mode, got ${plan.mode}`);
if (!plan.safety?.passed) throw new Error("Safety report did not pass");
if (process.env.REQUIRE_LIVE === "true" && plan.source !== "live") {
  throw new Error(`Expected live plan, got ${plan.source}`);
}
console.log(`Plan: ${plan.title} / ${plan.stops.length} spots / +${plan.luck_total} LUCK`);
console.log(`Agent stream: ${lines.length} events / ${lines.filter((item) => item.type === "trace").length} traces`);

const calendar = await request("/api/calendar/commit", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ plan })
});
if (!calendar.ok) throw new Error(`Calendar failed: ${calendar.status} ${await calendar.text()}`);
const calendarBody = await calendar.json();
if (calendarBody.event_ids?.length !== plan.calendar_events.length) {
  throw new Error("Calendar event count mismatch");
}
console.log(`Calendar: ${calendarBody.created} created / demo=${calendarBody.demo}`);

const replan = await request("/api/replan", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    request_id: crypto.randomUUID(),
    plan,
    current_stop_index: 0,
    reason: "delay",
    delay_minutes: 15,
    now: new Date().toISOString()
  })
});
if (!replan.ok) throw new Error(`Replan failed: ${replan.status} ${await replan.text()}`);
const replanned = await replan.json();
if (new Date(replanned.end_at) > new Date(replanned.return_by)) throw new Error("Replan exceeded return guard");
console.log(`Replan: ${replanned.title} / ${replanned.stops.length} remaining spots / return guard OK`);
