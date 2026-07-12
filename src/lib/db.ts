import "server-only";

import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { createClient, type Client } from "@libsql/client";

import { serverEnv } from "@/lib/env";

let client: Client | undefined;
let schemaPromise: Promise<void> | undefined;

function ensureLocalDirectory(url: string): void {
  if (!url.startsWith("file:")) return;
  const file = url.slice("file:".length);
  const directory = dirname(file);
  if (directory && directory !== ".") mkdirSync(directory, { recursive: true });
}

export function getDb(): Client {
  if (!client) {
    ensureLocalDirectory(serverEnv.tursoUrl);
    client = createClient({
      url: serverEnv.tursoUrl,
      authToken: serverEnv.tursoAuthToken
    });
  }
  return client;
}

export async function ensureSchema(): Promise<void> {
  if (!schemaPromise) {
    schemaPromise = (async () => {
      const db = getDb();
      const statements = [
        `CREATE TABLE IF NOT EXISTS app_sessions (
          id TEXT PRIMARY KEY,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        )`,
        `CREATE TABLE IF NOT EXISTS plans (
          id TEXT PRIMARY KEY,
          session_id TEXT NOT NULL,
          plan_json TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'planned',
          luck_earned INTEGER NOT NULL DEFAULT 0,
          calendar_event_ids_json TEXT,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        )`,
        `CREATE INDEX IF NOT EXISTS idx_plans_session_created ON plans(session_id, created_at DESC)`,
        `CREATE TABLE IF NOT EXISTS oauth_connections (
          session_id TEXT PRIMARY KEY,
          access_token_encrypted TEXT NOT NULL,
          refresh_token_encrypted TEXT,
          expires_at TEXT NOT NULL,
          scope TEXT,
          calendar_id TEXT,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        )`,
        `CREATE TABLE IF NOT EXISTS user_settings (
          session_id TEXT PRIMARY KEY,
          home_lat REAL,
          home_lng REAL,
          home_label TEXT,
          duration_minutes INTEGER NOT NULL DEFAULT 90,
          budget_yen INTEGER NOT NULL DEFAULT 1500,
          transport TEXT NOT NULL DEFAULT 'walk_transit',
          luck_total INTEGER NOT NULL DEFAULT 120,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        )`,
        `CREATE TABLE IF NOT EXISTS costly_request_counters (
          bucket_key TEXT PRIMARY KEY,
          request_count INTEGER NOT NULL,
          updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        )`
      ];
      await db.batch(statements.map((sql) => ({ sql, args: [] })), "write");
    })();
  }
  return schemaPromise;
}

export async function touchSession(sessionId: string): Promise<void> {
  await ensureSchema();
  await getDb().execute({
    sql: `INSERT INTO app_sessions(id) VALUES (?)
          ON CONFLICT(id) DO UPDATE SET updated_at = CURRENT_TIMESTAMP`,
    args: [sessionId]
  });
}
