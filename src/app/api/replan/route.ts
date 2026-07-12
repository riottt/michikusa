import { NextRequest, NextResponse } from "next/server";

import { fetchAgent } from "@/lib/agent-client";
import { savePlan } from "@/lib/plans";
import { allowCostlyRequest } from "@/lib/rate-limit";
import { getOrCreateSessionId } from "@/lib/session";
import { replanSchema } from "@/lib/validation";
import type { MichikusaPlan } from "@/types/michikusa";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const sessionId = await getOrCreateSessionId();
  if (!allowCostlyRequest("replan", sessionId, request.headers)) {
    return NextResponse.json({ error: "少し時間を置いてから、もう一度試してください。" }, { status: 429 });
  }
  const parsed = replanSchema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: "再計画の入力が不正です。" }, { status: 400 });
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
