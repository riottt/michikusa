import { NextRequest, NextResponse } from "next/server";

import { fetchAgent } from "@/lib/agent-client";
import { savePlan } from "@/lib/plans";
import { costlyRequestMode } from "@/lib/rate-limit";
import { readBoundedJson } from "@/lib/request-json";
import { getOrCreateSessionId } from "@/lib/session";
import { replanSchema } from "@/lib/validation";
import type { MichikusaPlan } from "@/types/michikusa";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const json = await readBoundedJson(request);
  if (!json.ok) return json.response;
  const parsed = replanSchema.safeParse(json.value);
  if (!parsed.success) return NextResponse.json({ error: "再計画の入力が不正です。" }, { status: 400 });
  const sessionId = await getOrCreateSessionId();
  if (await costlyRequestMode("replan", sessionId, request.headers) !== "live") {
    return NextResponse.json({ error: "少し時間を置いてから、もう一度試してください。" }, { status: 429 });
  }
  const response = await fetchAgent("/v1/replan", {
    method: "POST",
    body: JSON.stringify({
      request_id: parsed.data.request_id,
      user_id: sessionId,
      now: parsed.data.now ?? new Date().toISOString(),
      plan: parsed.data.plan,
      current_stop_index: parsed.data.current_stop_index,
      reason: parsed.data.reason,
      delay_minutes: parsed.data.delay_minutes
    })
  });
  if (!response.ok) {
    console.error("Agent replan response failed", { status: response.status });
    return NextResponse.json({ error: "再計画を作れませんでした。少し時間をおいて、もう一度試してください。" }, { status: 502 });
  }
  const plan = (await response.json()) as MichikusaPlan;
  await savePlan(sessionId, plan);
  return NextResponse.json(plan);
}
