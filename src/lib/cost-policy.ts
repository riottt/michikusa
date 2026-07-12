import type { Client } from "@libsql/client";

export type CostlyRequestKind = "plan" | "replan" | "calendar";

type Environment = Record<string, string | undefined>;

const DAILY_DEFAULTS: Record<CostlyRequestKind, number> = {
  plan: 40,
  replan: 80,
  calendar: 80,
};

const BURST_DEFAULTS: Record<CostlyRequestKind, number> = {
  plan: 10,
  replan: 30,
  calendar: 30,
};

function boundedInteger(value: string | undefined, fallback: number, maximum: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(maximum, Math.max(1, parsed));
}

export function costLimitFor(kind: CostlyRequestKind, env: Environment = process.env): number {
  return boundedInteger(env[`COST_GUARD_DAILY_${kind.toUpperCase()}_LIMIT`], DAILY_DEFAULTS[kind], 500);
}

export function burstLimitFor(kind: CostlyRequestKind, env: Environment = process.env): number {
  return boundedInteger(env[`COST_GUARD_10M_${kind.toUpperCase()}_LIMIT`], BURST_DEFAULTS[kind], 120);
}

export function dailyBucketStart(now: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

function tenMinuteBucketStart(now: Date): number {
  return Math.floor(now.getTime() / 600_000) * 600_000;
}

export async function reserveQuotaBucket(db: Pick<Client, "execute">, bucketKey: string, limit: number): Promise<boolean> {
  const result = await db.execute({
    sql: `INSERT INTO costly_request_counters(bucket_key, request_count)
          VALUES (?, 1)
          ON CONFLICT(bucket_key) DO UPDATE SET
            request_count = costly_request_counters.request_count + 1,
            updated_at = CURRENT_TIMESTAMP
          WHERE costly_request_counters.request_count < ?
          RETURNING request_count`,
    args: [bucketKey, limit],
  });
  return result.rows.length === 1;
}

export function reserveDailyQuota(
  db: Pick<Client, "execute">,
  kind: CostlyRequestKind,
  now: Date,
  limit = costLimitFor(kind),
): Promise<boolean> {
  return reserveQuotaBucket(db, `daily:${kind}:${dailyBucketStart(now)}`, limit);
}

export function reserveBurstQuota(
  db: Pick<Client, "execute">,
  kind: CostlyRequestKind,
  now: Date,
  limit = burstLimitFor(kind),
): Promise<boolean> {
  return reserveQuotaBucket(db, `10m:${kind}:${tenMinuteBucketStart(now)}`, limit);
}
