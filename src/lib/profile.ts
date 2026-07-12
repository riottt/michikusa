import "server-only";

import { ensureSchema, getDb } from "@/lib/db";

export interface UserProfile {
  luckTotal: number;
  durationMinutes: number;
  budgetYen: number;
  transport: "walk" | "walk_transit" | "bicycle";
  homeLocation: { lat: number; lng: number; label?: string | null } | null;
}

export async function getProfile(sessionId: string): Promise<UserProfile> {
  await ensureSchema();
  const result = await getDb().execute({
    sql: `SELECT luck_total, duration_minutes, budget_yen, transport,
                 home_lat, home_lng, home_label
          FROM user_settings WHERE session_id = ? LIMIT 1`,
    args: [sessionId]
  });
  const row = result.rows[0];
  if (!row) {
    await getDb().execute({
      sql: `INSERT INTO user_settings(session_id, duration_minutes, budget_yen, transport, luck_total)
            VALUES (?, 90, 1500, 'walk_transit', 120)
            ON CONFLICT(session_id) DO NOTHING`,
      args: [sessionId]
    });
    return {
      luckTotal: 120,
      durationMinutes: 90,
      budgetYen: 1500,
      transport: "walk_transit",
      homeLocation: null
    };
  }
  return {
    luckTotal: Number(row.luck_total ?? 0),
    durationMinutes: Number(row.duration_minutes ?? 90),
    budgetYen: Number(row.budget_yen ?? 1500),
    transport: String(row.transport ?? "walk_transit") as UserProfile["transport"],
    homeLocation:
      row.home_lat != null && row.home_lng != null
        ? {
            lat: Number(row.home_lat),
            lng: Number(row.home_lng),
            label: row.home_label ? String(row.home_label) : null
          }
        : null
  };
}

export async function updateProfile(
  sessionId: string,
  input: Partial<Omit<UserProfile, "luckTotal">>
): Promise<UserProfile> {
  const current = await getProfile(sessionId);
  const next = { ...current, ...input };
  await getDb().execute({
    sql: `INSERT INTO user_settings(
            session_id, home_lat, home_lng, home_label,
            duration_minutes, budget_yen, transport, luck_total
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(session_id) DO UPDATE SET
            home_lat = excluded.home_lat,
            home_lng = excluded.home_lng,
            home_label = excluded.home_label,
            duration_minutes = excluded.duration_minutes,
            budget_yen = excluded.budget_yen,
            transport = excluded.transport,
            updated_at = CURRENT_TIMESTAMP`,
    args: [
      sessionId,
      next.homeLocation?.lat ?? null,
      next.homeLocation?.lng ?? null,
      next.homeLocation?.label ?? null,
      next.durationMinutes,
      next.budgetYen,
      next.transport,
      current.luckTotal
    ]
  });
  return next;
}

export async function addLuck(sessionId: string, amount: number): Promise<number> {
  await ensureSchema();
  await getProfile(sessionId);
  await getDb().execute({
    sql: `UPDATE user_settings SET luck_total = luck_total + ?, updated_at = CURRENT_TIMESTAMP
          WHERE session_id = ?`,
    args: [amount, sessionId]
  });
  return (await getProfile(sessionId)).luckTotal;
}
