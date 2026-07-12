import { NextRequest } from "next/server";

import { listRecentPlans, savePlan, updatePlanStatus } from "@/lib/plans";
import { getOrCreateSessionId } from "@/lib/session";
import { planSaveSchema, planStatusSchema } from "@/lib/validation";
import type { MichikusaPlan } from "@/types/michikusa";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const sessionId = await getOrCreateSessionId();
  return Response.json({ plans: await listRecentPlans(sessionId, 12) });
}

export async function POST(request: NextRequest): Promise<Response> {
  const sessionId = await getOrCreateSessionId();
  const parsed = planSaveSchema.safeParse(await request.json());
  if (!parsed.success) return Response.json({ error: "Invalid plan" }, { status: 400 });
  const plan = parsed.data.plan as unknown as MichikusaPlan;
  if (!plan.id || !Array.isArray(plan.stops)) return Response.json({ error: "Invalid plan shape" }, { status: 400 });
  await savePlan(sessionId, plan);
  return Response.json({ saved: true, id: plan.id });
}

export async function PATCH(request: NextRequest): Promise<Response> {
  const sessionId = await getOrCreateSessionId();
  const parsed = planStatusSchema.safeParse(await request.json());
  if (!parsed.success) return Response.json({ error: "Invalid status" }, { status: 400 });
  await updatePlanStatus(
    sessionId,
    parsed.data.planId,
    parsed.data.status,
    parsed.data.luckEarned,
    parsed.data.calendarEventIds
  );
  return Response.json({ updated: true });
}
