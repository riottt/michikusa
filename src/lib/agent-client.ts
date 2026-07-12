import "server-only";

import { serverEnv } from "@/lib/env";

let cachedIdentity: { token: string; expiresAt: number } | null = null;

function tokenExpiry(token: string): number {
  try {
    const segment = token.split(".")[1];
    if (!segment) return 0;
    const payload = JSON.parse(Buffer.from(segment, "base64url").toString("utf8")) as { exp?: number };
    return (payload.exp ?? 0) * 1000;
  } catch {
    return 0;
  }
}

async function cloudRunIdentityToken(audience: string): Promise<string> {
  if (cachedIdentity && cachedIdentity.expiresAt > Date.now() + 60_000) return cachedIdentity.token;
  const endpoint = new URL("http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/identity");
  endpoint.searchParams.set("audience", audience);
  endpoint.searchParams.set("format", "full");
  const response = await fetch(endpoint, { headers: { "Metadata-Flavor": "Google" }, cache: "no-store" });
  if (!response.ok) throw new Error(`Cloud Run identity token request failed (${response.status})`);
  const token = await response.text();
  cachedIdentity = { token, expiresAt: tokenExpiry(token) || Date.now() + 45 * 60_000 };
  return token;
}

export async function fetchAgent(path: string, init: RequestInit = {}): Promise<Response> {
  if (!serverEnv.demoMode && serverEnv.agentSharedSecret === "local-development-only") {
    throw new Error("AGENT_SHARED_SECRET must be configured when DEMO_MODE=false");
  }
  const headers = new Headers(init.headers);
  headers.set("Content-Type", "application/json");
  headers.set("X-Michikusa-Secret", serverEnv.agentSharedSecret);
  if (serverEnv.agentAudience) {
    // Cloud Run validates the standard Authorization header before forwarding
    // the request to the private agent service.
    headers.set("Authorization", `Bearer ${await cloudRunIdentityToken(serverEnv.agentAudience)}`);
  }
  return fetch(`${serverEnv.agentServiceUrl}${path}`, {
    ...init,
    headers,
    cache: "no-store",
    signal: init.signal ?? AbortSignal.timeout(65_000)
  });
}
