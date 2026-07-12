import { createHash } from "node:crypto";

import { burstLimitFor, costLimitFor, reserveBurstQuota, reserveDailyQuota, type CostlyRequestKind } from "@/lib/cost-policy";
import { ensureSchema, getDb } from "@/lib/db";

type Entry = { count: number; resetAt: number };

const buckets = new Map<string, Entry>();

export function checkRateLimit(key: string, limit = 12, windowMs = 60_000): boolean {
  const now = Date.now();
  const existing = buckets.get(key);
  if (!existing || existing.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  if (existing.count >= limit) return false;
  existing.count += 1;
  return true;
}

function getClientIp(headers: Headers): string | null {
  const forwarded = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || headers.get("x-real-ip")?.trim() || null;
}

function anonymize(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 20);
}

/**
 * Limits costly model-backed requests twice: once per browser session and once
 * per client IP. The in-memory scope is deliberate; Cloud Run is capped to one
 * instance in deploy.sh, so this creates a real global ceiling for this app.
 */
export async function costlyRequestMode(
  kind: CostlyRequestKind,
  sessionId: string,
  headers: Headers
): Promise<"live" | "demo" | "blocked"> {
  const windowMs = 10 * 60_000;
  const perSessionLimit = kind === "calendar" ? 6 : 3;
  const clientIp = getClientIp(headers);
  const perIpLimit = kind === "calendar" ? 24 : 12;
  const sessionAllowed = checkRateLimit(`${kind}:session:${anonymize(sessionId)}`, perSessionLimit, windowMs);
  const ipAllowed = !clientIp || checkRateLimit(`${kind}:ip:${anonymize(clientIp)}`, perIpLimit, windowMs);
  if (!sessionAllowed || !ipAllowed) return "blocked";

  try {
    await ensureSchema();
    const db = getDb();
    const now = new Date();
    const burstAllowed = await reserveBurstQuota(db, kind, now, burstLimitFor(kind));
    if (!burstAllowed) return kind === "plan" ? "demo" : "blocked";
    const dailyAllowed = await reserveDailyQuota(db, kind, now, costLimitFor(kind));
    if (!dailyAllowed) return kind === "plan" ? "demo" : "blocked";
    return "live";
  } catch (error) {
    console.error("Cost guard unavailable", { kind, errorType: error instanceof Error ? error.name : "unknown" });
    return kind === "plan" ? "demo" : "blocked";
  }
}
