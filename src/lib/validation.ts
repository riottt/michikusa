import { z } from "zod";

export const geoPointSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  label: z.string().max(120).optional().nullable()
});

export const planPreferencesSchema = z.object({
  duration_minutes: z.number().int().min(20).max(300).optional().nullable(),
  budget_yen: z.number().int().min(0).max(20_000),
  transport: z.enum(["walk", "walk_transit", "bicycle"]),
  pace: z.enum(["easy", "normal", "active"]).optional(),
  mood: z.enum(["anything", "quiet", "discover", "food", "green"]).optional(),
  return_buffer_minutes: z.number().int().min(10).max(90).optional()
});

export const planStartSchema = z.object({
  request_id: z.string().min(8).max(120),
  location: geoPointSchema,
  home_location: geoPointSchema.optional().nullable(),
  context_hint: z.enum(["home", "outside", "auto"]).default("auto"),
  preferences: planPreferencesSchema,
  now: z.string().datetime({ offset: true }).optional()
});

export const replanSchema = z.object({
  request_id: z.string().min(8).max(120),
  plan: z.record(z.string(), z.unknown()),
  current_stop_index: z.number().int().min(0),
  reason: z.enum(["delay", "closed", "tired", "go_home"]),
  delay_minutes: z.number().int().min(0).max(120).default(15),
  now: z.string().datetime({ offset: true }).optional()
});

export const planSaveSchema = z.object({
  plan: z.record(z.string(), z.unknown())
});

export const planStatusSchema = z.object({
  planId: z.string().min(1),
  status: z.enum(["planned", "active", "completed"]),
  luckEarned: z.number().int().min(0).optional(),
  calendarEventIds: z.array(z.string()).optional()
});
