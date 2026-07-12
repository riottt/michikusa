import "server-only";

import { getDb, ensureSchema } from "@/lib/db";
import { isCalendarOAuthConfigured, serverEnv } from "@/lib/env";
import { decryptSecret, encryptSecret } from "@/lib/token-vault";
import type { BusySlot, CalendarStatus } from "@/types/michikusa";

const SCOPES = [
  "https://www.googleapis.com/auth/calendar.freebusy",
  "https://www.googleapis.com/auth/calendar.app.created"
];

interface TokenResponse {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
  scope?: string;
  token_type?: string;
}

interface ConnectionRow {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: Date;
  scope: string | null;
  calendarId: string | null;
}

export function buildCalendarAuthUrl(state: string): string {
  if (!serverEnv.googleOAuthClientId) throw new Error("Google OAuth is not configured");
  const params = new URLSearchParams({
    client_id: serverEnv.googleOAuthClientId,
    redirect_uri: serverEnv.googleOAuthRedirectUri,
    response_type: "code",
    access_type: "offline",
    include_granted_scopes: "true",
    prompt: "consent",
    scope: SCOPES.join(" "),
    state
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

async function tokenRequest(params: URLSearchParams): Promise<TokenResponse> {
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params,
    cache: "no-store"
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Google OAuth token exchange failed (${response.status}): ${detail.slice(0, 240)}`);
  }
  return (await response.json()) as TokenResponse;
}

export async function exchangeCalendarCode(code: string): Promise<TokenResponse> {
  if (!serverEnv.googleOAuthClientId || !serverEnv.googleOAuthClientSecret) {
    throw new Error("Google OAuth is not configured");
  }
  return tokenRequest(
    new URLSearchParams({
      code,
      client_id: serverEnv.googleOAuthClientId,
      client_secret: serverEnv.googleOAuthClientSecret,
      redirect_uri: serverEnv.googleOAuthRedirectUri,
      grant_type: "authorization_code"
    })
  );
}

export async function saveCalendarConnection(sessionId: string, token: TokenResponse): Promise<void> {
  await ensureSchema();
  const current = await getCalendarConnection(sessionId);
  const refreshToken = token.refresh_token ?? current?.refreshToken ?? null;
  await getDb().execute({
    sql: `INSERT INTO oauth_connections(
            session_id, access_token_encrypted, refresh_token_encrypted, expires_at, scope, calendar_id
          ) VALUES (?, ?, ?, ?, ?, ?)
          ON CONFLICT(session_id) DO UPDATE SET
            access_token_encrypted = excluded.access_token_encrypted,
            refresh_token_encrypted = COALESCE(excluded.refresh_token_encrypted, oauth_connections.refresh_token_encrypted),
            expires_at = excluded.expires_at,
            scope = excluded.scope,
            updated_at = CURRENT_TIMESTAMP`,
    args: [
      sessionId,
      encryptSecret(token.access_token),
      refreshToken ? encryptSecret(refreshToken) : null,
      new Date(Date.now() + token.expires_in * 1000).toISOString(),
      token.scope ?? SCOPES.join(" "),
      current?.calendarId ?? null
    ]
  });
}

export async function getCalendarConnection(sessionId: string): Promise<ConnectionRow | null> {
  await ensureSchema();
  const result = await getDb().execute({
    sql: `SELECT access_token_encrypted, refresh_token_encrypted, expires_at, scope, calendar_id
          FROM oauth_connections WHERE session_id = ? LIMIT 1`,
    args: [sessionId]
  });
  const row = result.rows[0];
  if (!row) return null;
  return {
    accessToken: decryptSecret(String(row.access_token_encrypted)),
    refreshToken: row.refresh_token_encrypted
      ? decryptSecret(String(row.refresh_token_encrypted))
      : null,
    expiresAt: new Date(String(row.expires_at)),
    scope: row.scope ? String(row.scope) : null,
    calendarId: row.calendar_id ? String(row.calendar_id) : null
  };
}

export async function setCalendarId(sessionId: string, calendarId: string): Promise<void> {
  await ensureSchema();
  await getDb().execute({
    sql: `UPDATE oauth_connections SET calendar_id = ?, updated_at = CURRENT_TIMESTAMP WHERE session_id = ?`,
    args: [calendarId, sessionId]
  });
}

export async function deleteCalendarConnection(sessionId: string): Promise<void> {
  await ensureSchema();
  await getDb().execute({ sql: "DELETE FROM oauth_connections WHERE session_id = ?", args: [sessionId] });
}

async function refreshConnection(sessionId: string, connection: ConnectionRow): Promise<ConnectionRow> {
  if (!connection.refreshToken || !serverEnv.googleOAuthClientId || !serverEnv.googleOAuthClientSecret) {
    throw new Error("Google Calendar session expired; reconnect Calendar");
  }
  const token = await tokenRequest(
    new URLSearchParams({
      refresh_token: connection.refreshToken,
      client_id: serverEnv.googleOAuthClientId,
      client_secret: serverEnv.googleOAuthClientSecret,
      grant_type: "refresh_token"
    })
  );
  await saveCalendarConnection(sessionId, { ...token, refresh_token: connection.refreshToken });
  const refreshed = await getCalendarConnection(sessionId);
  if (!refreshed) throw new Error("Failed to persist refreshed Calendar token");
  return refreshed;
}

export async function getValidCalendarConnection(sessionId: string): Promise<ConnectionRow | null> {
  const connection = await getCalendarConnection(sessionId);
  if (!connection) return null;
  if (connection.expiresAt.getTime() > Date.now() + 60_000) return connection;
  return refreshConnection(sessionId, connection);
}

export async function getCalendarStatus(sessionId: string): Promise<CalendarStatus> {
  if (!isCalendarOAuthConfigured()) {
    return {
      connected: false,
      demo: true,
      calendarId: "demo-michikusa-calendar",
      scopes: [],
      message: "デモ連携。OAuth設定後はGoogleカレンダーへ実登録します"
    };
  }
  const connection = await getCalendarConnection(sessionId);
  if (!connection) {
    return {
      connected: false,
      demo: false,
      message: "Googleカレンダーは未接続です"
    };
  }
  return {
    connected: true,
    demo: false,
    calendarId: connection.calendarId,
    scopes: connection.scope?.split(" ") ?? [],
    message: "Googleカレンダー接続済み"
  };
}

export async function fetchCalendarAvailability(
  sessionId: string,
  timeMin: Date,
  timeMax: Date
): Promise<{ busy: BusySlot[]; source: "google" | "demo" | "none"; connected: boolean }> {
  if (!isCalendarOAuthConfigured()) {
    const demoStart = new Date(timeMin.getTime() + 4 * 60 * 60 * 1000 + 20 * 60 * 1000);
    return {
      busy: [
        {
          start: demoStart.toISOString(),
          end: new Date(demoStart.getTime() + 60 * 60 * 1000).toISOString(),
          summary: "次の予定（デモ）"
        }
      ],
      source: "demo",
      connected: false
    };
  }
  const connection = await getValidCalendarConnection(sessionId);
  if (!connection) return { busy: [], source: "none", connected: false };
  const response = await fetch("https://www.googleapis.com/calendar/v3/freeBusy", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${connection.accessToken}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      timeMin: timeMin.toISOString(),
      timeMax: timeMax.toISOString(),
      timeZone: "Asia/Tokyo",
      items: [{ id: "primary" }]
    }),
    cache: "no-store"
  });
  if (!response.ok) {
    throw new Error(`Calendar freeBusy failed (${response.status})`);
  }
  const payload = (await response.json()) as {
    calendars?: Record<string, { busy?: Array<{ start: string; end: string }> }>;
  };
  return {
    busy: (payload.calendars?.primary?.busy ?? []).map((slot) => ({ ...slot })),
    source: "google",
    connected: true
  };
}
