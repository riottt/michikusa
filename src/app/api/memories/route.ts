import { NextResponse } from "next/server";

import { listRecentPlans } from "@/lib/plans";
import { getOrCreateSessionId } from "@/lib/session";

export const runtime = "nodejs";

export async function GET() {
  const sessionId = await getOrCreateSessionId();
  return NextResponse.json({ plans: await listRecentPlans(sessionId, 12) });
}
