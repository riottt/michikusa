import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { buildCalendarAuthUrl } from "@/lib/calendar";
import { isCalendarOAuthConfigured, serverEnv } from "@/lib/env";
import { getOrCreateSessionId } from "@/lib/session";

export const runtime = "nodejs";

export async function GET() {
  await getOrCreateSessionId();
  if (!isCalendarOAuthConfigured()) {
    return NextResponse.redirect(new URL("/?calendar=demo", serverEnv.appUrl));
  }
  const state = randomBytes(24).toString("base64url");
  (await cookies()).set("michikusa_oauth_state", state, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 10 * 60
  });
  return NextResponse.redirect(buildCalendarAuthUrl(state));
}
