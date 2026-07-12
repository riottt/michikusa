export type AgentColor = "pink" | "purple" | "green" | "orange";
export type CompletionType = "arrival" | "timer" | "photo" | "tap";
export type PlanMode = "departure" | "detour";

export interface GeoPoint {
  lat: number;
  lng: number;
  label?: string | null;
}

export interface BusySlot {
  start: string;
  end: string;
  summary?: string | null;
}

export interface PlanPreferences {
  duration_minutes?: number | null;
  budget_yen: number;
  transport: "walk" | "walk_transit" | "bicycle";
  pace?: "easy" | "normal" | "active";
  mood?: "anything" | "quiet" | "discover" | "food" | "green";
  return_buffer_minutes?: number;
}

export interface PlanRequestPayload {
  request_id: string;
  user_id: string;
  location: GeoPoint;
  now: string;
  timezone: string;
  home_location?: GeoPoint | null;
  context_hint: "home" | "outside" | "auto";
  preferences: PlanPreferences;
  calendar: {
    connected: boolean;
    busy: BusySlot[];
    next_event_at?: string | null;
    source: "google" | "demo" | "none";
  };
  history: Array<{
    place_id?: string | null;
    category?: string | null;
    completed_at?: string | null;
  }>;
}

export interface ActivitySuggestion {
  stop_id: string;
  short_label: string;
  title: string;
  instruction: string;
  completion_type: CompletionType;
  duration_minutes: number;
  luck: number;
  color: AgentColor;
  icon: "book" | "camera" | "coffee" | "music" | "walk" | "sparkles" | "leaf";
}

export interface PlanStop {
  id: string;
  order: number;
  place_id: string;
  name: string;
  category: string;
  location: GeoPoint;
  address?: string | null;
  maps_uri?: string | null;
  arrival_at: string;
  departure_at: string;
  travel_minutes: number;
  stay_minutes: number;
  role: "discover" | "stay" | "landing";
  activity: ActivitySuggestion;
}

export interface CalendarEventDraft {
  id: string;
  kind: "travel" | "spot" | "return";
  summary: string;
  start: string;
  end: string;
  location?: string | null;
  description: string;
  color_id?: string | null;
}

export interface SafetyReport {
  passed: boolean;
  score: number;
  checks: Array<{ key: string; passed: boolean; message: string }>;
  repairs: string[];
}

export interface ShareCardData {
  title: string;
  call_sign: string;
  area_label: string;
  spots: number;
  distance_km: number;
  duration_minutes: number;
  luck: number;
  theme: string;
}

export interface MichikusaPlan {
  id: string;
  request_id: string;
  mode: PlanMode;
  title: string;
  subtitle: string;
  origin: GeoPoint;
  start_at: string;
  end_at: string;
  return_by: string;
  duration_minutes: number;
  distance_km: number;
  budget_yen: number;
  transport_summary: string;
  luck_total: number;
  encoded_polyline?: string | null;
  route_points: GeoPoint[];
  stops: PlanStop[];
  calendar_events: CalendarEventDraft[];
  safety: SafetyReport;
  share: ShareCardData;
  source: "live" | "demo" | "fallback";
  agent_version: string;
}

export interface AgentTraceEvent {
  agent: string;
  label: string;
  message: string;
  status: "running" | "done" | "warning" | "error";
  color: AgentColor;
  metric?: string | null;
  payload?: unknown;
}

export interface CalendarStatus {
  connected: boolean;
  demo: boolean;
  calendarId?: string | null;
  scopes?: string[];
  message: string;
}

export interface CalendarCommitResult {
  calendar_id: string;
  calendar_summary: string;
  event_ids: string[];
  html_links: string[];
  created: number;
  updated: number;
  demo: boolean;
}

export type ReplanReason = "delay" | "closed" | "tired" | "go_home";
