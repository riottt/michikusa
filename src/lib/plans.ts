import "server-only";

import { getDb, ensureSchema } from "@/lib/db";
import type { MichikusaPlan } from "@/types/michikusa";

export async function savePlan(sessionId: string, plan: MichikusaPlan): Promise<void> {
  await ensureSchema();
  await getDb().execute({
    sql: `INSERT INTO plans(id, session_id, plan_json, status)
          VALUES (?, ?, ?, 'planned')
          ON CONFLICT(id) DO UPDATE SET plan_json = excluded.plan_json, updated_at = CURRENT_TIMESTAMP
          WHERE plans.session_id = excluded.session_id`,
    args: [plan.id, sessionId, JSON.stringify(plan)]
  });
}

export async function updatePlanStatus(
  sessionId: string,
  planId: string,
  status: "planned" | "active" | "completed",
  luckEarned?: number,
  calendarEventIds?: string[]
): Promise<void> {
  await ensureSchema();
  await getDb().execute({
    sql: `UPDATE plans SET status = ?, luck_earned = COALESCE(?, luck_earned),
          calendar_event_ids_json = COALESCE(?, calendar_event_ids_json),
          updated_at = CURRENT_TIMESTAMP
          WHERE id = ? AND session_id = ?`,
    args: [
      status,
      luckEarned ?? null,
      calendarEventIds ? JSON.stringify(calendarEventIds) : null,
      planId,
      sessionId
    ]
  });
}

export async function listRecentPlans(sessionId: string, limit = 10): Promise<MichikusaPlan[]> {
  await ensureSchema();
  const result = await getDb().execute({
    sql: `SELECT plan_json FROM plans WHERE session_id = ? ORDER BY created_at DESC LIMIT ?`,
    args: [sessionId, limit]
  });
  return result.rows.flatMap((row) => {
    try {
      return [JSON.parse(String(row.plan_json)) as MichikusaPlan];
    } catch {
      return [];
    }
  });
}
