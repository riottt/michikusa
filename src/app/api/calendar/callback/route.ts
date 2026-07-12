import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";

import { exchangeCalendarCode, saveCalendarConnection } from "@/lib/calendar";
import { serverEnv } from "@/lib/env";
import { getOrCreateSessionId } from "@/lib/session";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  const state = request.nextUrl.searchParams.get("state");
  const cookieStore = await cookies();
  const expected = cookieStore.get("michikusa_oauth_state")?.value;
  cookieStore.delete("michikusa_oauth_state");
  if (!code || !state || !expected || state !== expected) {
    return NextResponse.redirect(new URL("/?calendar=error", serverEnv.appUrl));
  }
  try {
    const sessionId = await getOrCreateSessionId();
    const token = await exchangeCalendarCode(code);
    await saveCalendarConnection(sessionId, token);
    return NextResponse.redirect(new URL("/?calendar=connected", serverEnv.appUrl));
  } catch {
    return NextResponse.redirect(new URL("/?calendar=error", serverEnv.appUrl));
  }
}
