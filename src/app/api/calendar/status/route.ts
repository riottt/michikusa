import { NextResponse } from "next/server";

import { getCalendarStatus } from "@/lib/calendar";
import { getOrCreateSessionId } from "@/lib/session";

export const runtime = "nodejs";

export async function GET() {
  const sessionId = await getOrCreateSessionId();
  return NextResponse.json(await getCalendarStatus(sessionId));
}
