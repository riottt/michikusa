import { NextRequest, NextResponse } from "next/server";

import { addLuck } from "@/lib/profile";
import { updatePlanStatus } from "@/lib/plans";
import { getOrCreateSessionId } from "@/lib/session";
import { planStatusSchema } from "@/lib/validation";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const sessionId = await getOrCreateSessionId();
  const parsed = planStatusSchema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: "状態を保存できませんでした。" }, { status: 400 });
  await updatePlanStatus(
    sessionId,
    parsed.data.planId,
    parsed.data.status,
    parsed.data.luckEarned,
    parsed.data.calendarEventIds
  );
  const luckTotal = parsed.data.status === "completed" && parsed.data.luckEarned
    ? await addLuck(sessionId, parsed.data.luckEarned)
    : undefined;
  return NextResponse.json({ ok: true, luckTotal });
}
