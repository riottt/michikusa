import { NextRequest } from "next/server";

import { fetchCalendarAvailability } from "@/lib/calendar";
import { getOrCreateSessionId } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest): Promise<Response> {
  const sessionId = await getOrCreateSessionId();
  const start = request.nextUrl.searchParams.get("start");
  const end = request.nextUrl.searchParams.get("end");
  const timeMin = start ? new Date(start) : new Date();
  const timeMax = end ? new Date(end) : new Date(timeMin.getTime() + 10 * 60 * 60 * 1000);
  return Response.json(await fetchCalendarAvailability(sessionId, timeMin, timeMax));
}
