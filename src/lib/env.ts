import "server-only";

export const serverEnv = {
  agentServiceUrl: process.env.AGENT_SERVICE_URL ?? "http://127.0.0.1:8081",
  agentSharedSecret: process.env.AGENT_SHARED_SECRET ?? "local-development-only",
  agentAudience: process.env.AGENT_SERVICE_AUDIENCE,
  appUrl: process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000",
  tursoUrl: process.env.TURSO_DATABASE_URL ?? "file:data/michikusa.db",
  tursoAuthToken: process.env.TURSO_AUTH_TOKEN,
  googleOAuthClientId: process.env.GOOGLE_OAUTH_CLIENT_ID,
  googleOAuthClientSecret: process.env.GOOGLE_OAUTH_CLIENT_SECRET,
  googleOAuthRedirectUri:
    process.env.GOOGLE_OAUTH_REDIRECT_URI ??
    `${process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"}/api/calendar/callback`,
  tokenEncryptionKey: process.env.TOKEN_ENCRYPTION_KEY ?? "local-development-token-encryption-key",
  demoMode: (process.env.DEMO_MODE ?? "true").toLowerCase() !== "false"
} as const;

export function isCalendarOAuthConfigured(): boolean {
  return Boolean(serverEnv.googleOAuthClientId && serverEnv.googleOAuthClientSecret);
}
