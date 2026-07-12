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

/**
 * Limits costly model-backed requests twice: once per browser session and once
 * per client IP. The in-memory scope is deliberate; Cloud Run is capped to one
 * instance in deploy.sh, so this creates a real global ceiling for this app.
 */
export function allowCostlyRequest(
  kind: "plan" | "replan" | "calendar",
  sessionId: string,
  headers: Headers
): boolean {
  const windowMs = 10 * 60_000;
  const perSessionLimit = kind === "calendar" ? 6 : 3;
  const clientIp = getClientIp(headers);
  const perIpLimit = kind === "calendar" ? 24 : 12;

  return (
    checkRateLimit(`${kind}:session:${sessionId}`, perSessionLimit, windowMs) &&
    (!clientIp || checkRateLimit(`${kind}:ip:${clientIp}`, perIpLimit, windowMs))
  );
}
