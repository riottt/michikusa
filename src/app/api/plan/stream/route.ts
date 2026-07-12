import { NextRequest } from "next/server";

import { fetchAgent } from "@/lib/agent-client";
import { fetchCalendarAvailability } from "@/lib/calendar";
import { listRecentPlans, savePlan } from "@/lib/plans";
import { allowCostlyRequest } from "@/lib/rate-limit";
import { getOrCreateSessionId } from "@/lib/session";
import { planStartSchema } from "@/lib/validation";
import type { MichikusaPlan, PlanRequestPayload } from "@/types/michikusa";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest): Promise<Response> {
  const sessionId = await getOrCreateSessionId();
  if (!allowCostlyRequest("plan", sessionId, request.headers)) {
    return Response.json({ error: "少し時間を置いてから、もう一度試してください。" }, { status: 429 });
  }

  const parsed = planStartSchema.safeParse(await request.json());
  if (!parsed.success) {
    return Response.json({ error: "入力内容を確認できませんでした。", details: parsed.error.flatten() }, { status: 400 });
  }

  const now = new Date(parsed.data.now ?? new Date().toISOString());
  const availability = await fetchCalendarAvailability(
    sessionId,
    now,
    new Date(now.getTime() + 8 * 60 * 60 * 1000)
  ).catch(() => ({ busy: [], source: "none" as const, connected: false }));
  const historyPlans = await listRecentPlans(sessionId, 8);
  const nextEventAt = availability.busy
    .map((slot) => new Date(slot.start))
    .filter((date) => date > now)
    .sort((a, b) => a.getTime() - b.getTime())[0];

  const payload: PlanRequestPayload = {
    request_id: parsed.data.request_id,
    user_id: sessionId,
    location: parsed.data.location,
    now: now.toISOString(),
    timezone: "Asia/Tokyo",
    home_location: parsed.data.home_location ?? null,
    context_hint: parsed.data.context_hint,
    preferences: parsed.data.preferences,
    calendar: {
      connected: availability.connected,
      busy: availability.busy,
      next_event_at: nextEventAt?.toISOString() ?? null,
      source: availability.source
    },
    history: historyPlans.flatMap((plan) =>
      plan.stops.map((stop) => ({
        place_id: stop.place_id,
        category: stop.category,
        completed_at: plan.end_at
      }))
    )
  };

  let upstream: Response;
  try {
    upstream = await fetchAgent("/v1/plan/stream", {
      method: "POST",
      body: JSON.stringify(payload),
      signal: request.signal
    });
  } catch (error) {
    console.error("Agent connection failed", { errorType: error instanceof Error ? error.name : "unknown" });
    return Response.json({ error: "エージェントへ接続できませんでした。" }, { status: 503 });
  }
  if (!upstream.ok || !upstream.body) {
    console.error("Agent response failed", { status: upstream.status });
    return Response.json({ error: "エージェントが一時的に利用できません。" }, { status: 502 });
  }

  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const reader = upstream.body!.getReader();
      let buffer = "";
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          controller.enqueue(value);
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";
          for (const line of lines) {
            if (!line.trim()) continue;
            try {
              const event = JSON.parse(line) as { type?: string; plan?: MichikusaPlan };
              if (event.type === "plan" && event.plan) await savePlan(sessionId, event.plan);
            } catch {
              // The original stream remains intact for the browser.
            }
          }
        }
        if (buffer.trim()) {
          try {
            const event = JSON.parse(buffer) as { type?: string; plan?: MichikusaPlan };
            if (event.type === "plan" && event.plan) await savePlan(sessionId, event.plan);
          } catch {
            controller.enqueue(encoder.encode("\n"));
          }
        }
      } catch (error) {
        console.error("Agent stream failed", { errorType: error instanceof Error ? error.name : "unknown" });
        controller.enqueue(
          encoder.encode(
            `${JSON.stringify({
              type: "error",
              message: "ルートの生成が途中で止まりました。もう一度試してください。",
              recoverable: false
            })}\n`
          )
        );
      } finally {
        controller.close();
        reader.releaseLock();
      }
    },
    cancel() {
      upstream.body?.cancel().catch(() => undefined);
    }
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no"
    }
  });
}
