import "server-only";

import { randomUUID } from "node:crypto";
import { cookies } from "next/headers";

import { touchSession } from "@/lib/db";

const SESSION_COOKIE = "michikusa_sid";

export async function getOrCreateSessionId(): Promise<string> {
  const store = await cookies();
  let sessionId = store.get(SESSION_COOKIE)?.value;
  if (!sessionId) {
    sessionId = randomUUID();
    store.set(SESSION_COOKIE, sessionId, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 60 * 60 * 24 * 365
    });
  }
  await touchSession(sessionId);
  return sessionId;
}

export async function getSessionId(): Promise<string | null> {
  return (await cookies()).get(SESSION_COOKIE)?.value ?? null;
}
