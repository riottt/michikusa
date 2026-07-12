import { createClient } from "@libsql/client";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const url = process.env.TURSO_DATABASE_URL || "file:data/michikusa.db";
if (url.startsWith("file:")) await mkdir(path.dirname(url.slice(5)), { recursive: true });
const db = createClient({ url, authToken: process.env.TURSO_AUTH_TOKEN || undefined });
const statements = [
  `CREATE TABLE IF NOT EXISTS app_sessions (id TEXT PRIMARY KEY, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
  `CREATE TABLE IF NOT EXISTS plans (id TEXT PRIMARY KEY, session_id TEXT NOT NULL, plan_json TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'planned', luck_earned INTEGER NOT NULL DEFAULT 0, calendar_event_ids_json TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
  `CREATE INDEX IF NOT EXISTS idx_plans_session_created ON plans(session_id, created_at DESC)`,
  `CREATE TABLE IF NOT EXISTS oauth_connections (session_id TEXT PRIMARY KEY, access_token_encrypted TEXT NOT NULL, refresh_token_encrypted TEXT, expires_at TEXT NOT NULL, scope TEXT, calendar_id TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
  `CREATE TABLE IF NOT EXISTS user_settings (session_id TEXT PRIMARY KEY, home_lat REAL, home_lng REAL, home_label TEXT, duration_minutes INTEGER NOT NULL DEFAULT 90, budget_yen INTEGER NOT NULL DEFAULT 1500, transport TEXT NOT NULL DEFAULT 'walk_transit', luck_total INTEGER NOT NULL DEFAULT 120, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`
];
await db.batch(statements.map((sql) => ({ sql, args: [] })), "write");
db.close();
console.log(`Database schema ready: ${url}`);
