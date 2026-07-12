import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { getProfile, updateProfile } from "@/lib/profile";
import { getOrCreateSessionId } from "@/lib/session";

const updateSchema = z.object({
  durationMinutes: z.number().int().min(20).max(300).optional(),
  budgetYen: z.number().int().min(0).max(20_000).optional(),
  transport: z.enum(["walk", "walk_transit", "bicycle"]).optional(),
  homeLocation: z
    .object({ lat: z.number(), lng: z.number(), label: z.string().optional().nullable() })
    .nullable()
    .optional()
});

export const runtime = "nodejs";

export async function GET() {
  const sessionId = await getOrCreateSessionId();
  return NextResponse.json(await getProfile(sessionId));
}

export async function POST(request: NextRequest) {
  const sessionId = await getOrCreateSessionId();
  const parsed = updateSchema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: "設定を保存できませんでした。" }, { status: 400 });
  return NextResponse.json(await updateProfile(sessionId, parsed.data));
}
