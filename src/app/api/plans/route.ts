import { listRecentPlans } from "@/lib/plans";
import { getOrCreateSessionId } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const sessionId = await getOrCreateSessionId();
  return Response.json({ plans: await listRecentPlans(sessionId, 12) });
}
