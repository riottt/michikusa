import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { fetchAgent } from "@/lib/agent-client";
import { getCalendarStatus, getValidCalendarConnection, setCalendarId } from "@/lib/calendar";
import { isCalendarOAuthConfigured } from "@/lib/env";
import { updatePlanStatus } from "@/lib/plans";
import { costlyRequestMode } from "@/lib/rate-limit";
import { readBoundedJson } from "@/lib/request-json";
import { getOrCreateSessionId } from "@/lib/session";
import type { CalendarCommitResult, MichikusaPlan } from "@/types/michikusa";

const bodySchema = z.object({
  plan: z.record(z.string(), z.unknown()),
  existingEventIds: z.array(z.string().min(1)).max(32).optional().default([])
});

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const json = await readBoundedJson(request);
  if (!json.ok) return json.response;
  const parsed = bodySchema.safeParse(json.value);
  if (!parsed.success) return NextResponse.json({ error: "予定を読み取れませんでした。" }, { status: 400 });
  const sessionId = await getOrCreateSessionId();
  if (await costlyRequestMode("calendar", sessionId, request.headers) !== "live") {
    return NextResponse.json({ error: "少し時間を置いてから、もう一度試してください。" }, { status: 429 });
  }
  const plan = parsed.data.plan as unknown as MichikusaPlan;
  const status = await getCalendarStatus(sessionId);
  const connection = isCalendarOAuthConfigured()
    ? await getValidCalendarConnection(sessionId)
    : null;
  if (isCalendarOAuthConfigured() && !connection) {
    return NextResponse.json({ error: "Googleカレンダーを接続してください。" }, { status: 409 });
  }
  const response = await fetchAgent("/v1/calendar/commit", {
    method: "POST",
    body: JSON.stringify({
      request_id: plan.request_id,
      user_id: sessionId,
      access_token: connection?.accessToken ?? "demo-local-token",
      plan,
      calendar_id: connection?.calendarId ?? status.calendarId ?? null,
      existing_event_ids: parsed.data.existingEventIds,
      demo: !connection
    })
  });
  if (!response.ok) {
    console.error("Calendar commit response failed", { status: response.status });
    return NextResponse.json({ error: "Calendarへの登録を完了できませんでした。もう一度試してください。" }, { status: 502 });
  }
  const result = (await response.json()) as CalendarCommitResult;
  if (connection && result.calendar_id) await setCalendarId(sessionId, result.calendar_id);
  await updatePlanStatus(sessionId, plan.id, "active", undefined, result.event_ids);
  return NextResponse.json(result);
}
