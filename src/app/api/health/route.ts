import { NextResponse } from "next/server";

import { fetchAgent } from "@/lib/agent-client";
import { ensureSchema } from "@/lib/db";

export const runtime = "nodejs";

export async function GET() {
  try {
    await ensureSchema();
    const response = await fetchAgent("/health", { method: "GET" });
    if (!response.ok) {
      console.error("Agent health check failed", { status: response.status });
      return NextResponse.json({ status: "degraded", error: "agent_unavailable" }, { status: 503 });
    }
    const agent = (await response.json()) as {
      demo_mode: boolean;
      adk_version: string;
      maps_live: boolean;
      gemini_live: boolean;
    };
    return NextResponse.json({
      status: "ok",
      web: "ok",
      database: "ok",
      planning: "ok",
      agent: {
        demo_mode: Boolean(agent.demo_mode),
        adk_version: String(agent.adk_version),
        maps_live: Boolean(agent.maps_live),
        gemini_live: Boolean(agent.gemini_live)
      }
    });
  } catch (error) {
    console.error("Health check failed", { errorType: error instanceof Error ? error.name : "unknown" });
    return NextResponse.json({ status: "degraded", error: "service_unavailable" }, { status: 503 });
  }
}
