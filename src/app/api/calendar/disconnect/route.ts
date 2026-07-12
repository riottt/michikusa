import { NextResponse } from "next/server";

import { deleteCalendarConnection } from "@/lib/calendar";
import { getOrCreateSessionId } from "@/lib/session";

export const runtime = "nodejs";

export async function POST() {
  const sessionId = await getOrCreateSessionId();
  await deleteCalendarConnection(sessionId);
  return NextResponse.json({ ok: true });
}
