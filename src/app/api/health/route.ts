import { NextResponse } from "next/server";

import { fetchAgent } from "@/lib/agent-client";
import { ensureSchema } from "@/lib/db";

export const runtime = "nodejs";

export async function GET() {
  try {
    await ensureSchema();
    const response = await fetchAgent("/health", { method: "GET" });
    const agent = response.ok ? await response.json() : { status: "unavailable" };
    return NextResponse.json({ status: "ok", web: "ok", database: "ok", agent });
  } catch (error) {
    return NextResponse.json(
      { status: "degraded", error: error instanceof Error ? error.message : "unknown error" },
      { status: 503 }
    );
  }
}
