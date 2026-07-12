from __future__ import annotations

from datetime import datetime
from enum import StrEnum
from typing import Literal

from pydantic import BaseModel, Field, field_validator


class GeoPoint(BaseModel):
    lat: float = Field(ge=-90, le=90)
    lng: float = Field(ge=-180, le=180)
    label: str | None = None


class BusySlot(BaseModel):
    start: datetime
    end: datetime
    summary: str | None = None


class CalendarContext(BaseModel):
    connected: bool = False
    busy: list[BusySlot] = Field(default_factory=list)
    next_event_at: datetime | None = None
    source: Literal["google", "demo", "none"] = "none"


class Preferences(BaseModel):
    duration_minutes: int | None = Field(default=None, ge=20, le=300)
    budget_yen: int = Field(default=1500, ge=0, le=20000)
    transport: Literal["walk", "walk_transit", "bicycle"] = "walk_transit"
    pace: Literal["easy", "normal", "active"] = "normal"
    mood: Literal["anything", "quiet", "discover", "food", "green"] = "anything"
    return_buffer_minutes: int = Field(default=25, ge=10, le=90)


class HistoryItem(BaseModel):
    place_id: str | None = None
    category: str | None = None
    completed_at: datetime | None = None


class PlanRequest(BaseModel):
    request_id: str
    user_id: str = "demo-player"
    location: GeoPoint
    now: datetime
    timezone: str = "Asia/Tokyo"
    home_location: GeoPoint | None = None
    context_hint: Literal["home", "outside", "auto"] = "auto"
    preferences: Preferences = Field(default_factory=Preferences)
    calendar: CalendarContext = Field(default_factory=CalendarContext)
    history: list[HistoryItem] = Field(default_factory=list)
    force_demo: bool = False


class PlaceCandidate(BaseModel):
    place_id: str
    name: str
    category: str
    location: GeoPoint
    address: str | None = None
    open_now: bool | None = None
    rating: float | None = None
    price_level: int | None = None
    google_maps_uri: str | None = None
    photo_name: str | None = None
    source: Literal["google", "demo"] = "demo"
    estimated_cost_yen: int = 0
    novelty_score: float = 0.5


class Situation(BaseModel):
    mode: Literal["departure", "detour"]
    headline: str
    action_label: str
    inferred_home: bool
    local_hour: int


class CalendarWindow(BaseModel):
    start: datetime
    end: datetime
    available_minutes: int
    next_event_at: datetime | None = None
    connected: bool = False
    summary: str


class MobilityProfile(BaseModel):
    transport: Literal["walk", "walk_transit", "bicycle"]
    search_radius_m: int
    max_one_way_minutes: int
    target_spots: int
    walking_speed_m_per_min: float


class MemoryProfile(BaseModel):
    recent_place_ids: list[str] = Field(default_factory=list)
    recent_categories: list[str] = Field(default_factory=list)
    novelty_bias: float = 0.7


class RouteMetric(BaseModel):
    place_id: str
    distance_m: int
    duration_minutes: int


class RouteMatrix(BaseModel):
    from_origin: list[RouteMetric]
    source: Literal["google", "estimated"] = "estimated"


class RouteStopDraft(BaseModel):
    id: str
    order: int
    place: PlaceCandidate
    arrival_at: datetime
    departure_at: datetime
    travel_minutes: int
    stay_minutes: int
    role: Literal["discover", "stay", "landing"]


class RouteDraft(BaseModel):
    start_at: datetime
    end_at: datetime
    origin: GeoPoint
    stops: list[RouteStopDraft]
    estimated_distance_m: int
    estimated_budget_yen: int
    transport_summary: str
    encoded_polyline: str | None = None
    route_points: list[GeoPoint] = Field(default_factory=list)


class ActivitySuggestion(BaseModel):
    stop_id: str
    short_label: str
    title: str
    instruction: str
    completion_type: Literal["arrival", "timer", "photo", "tap"]
    duration_minutes: int = Field(ge=1, le=60)
    luck: int = Field(ge=5, le=100)
    color: Literal["pink", "purple", "green", "orange"]
    icon: Literal["book", "camera", "coffee", "music", "walk", "sparkles", "leaf"]


class CreativeOutput(BaseModel):
    route_title: str
    route_subtitle: str
    activities: list[ActivitySuggestion]


class MemoryNarration(BaseModel):
    call_sign: str
    theme: str
    share_title: str


class SafetyCheck(BaseModel):
    key: str
    passed: bool
    message: str


class SafetyReport(BaseModel):
    passed: bool
    score: int = Field(ge=0, le=100)
    checks: list[SafetyCheck]
    repairs: list[str] = Field(default_factory=list)


class CalendarEventDraft(BaseModel):
    id: str
    kind: Literal["travel", "spot", "return"]
    summary: str
    start: datetime
    end: datetime
    location: str | None = None
    description: str
    color_id: str | None = None


class ShareCard(BaseModel):
    title: str
    call_sign: str
    area_label: str
    spots: int
    distance_km: float
    duration_minutes: int
    luck: int
    theme: str


class PlanStop(BaseModel):
    id: str
    order: int
    place_id: str
    name: str
    category: str
    location: GeoPoint
    address: str | None = None
    maps_uri: str | None = None
    arrival_at: datetime
    departure_at: datetime
    travel_minutes: int
    stay_minutes: int
    role: Literal["discover", "stay", "landing"]
    activity: ActivitySuggestion


class MichikusaPlan(BaseModel):
    id: str
    request_id: str
    mode: Literal["departure", "detour"]
    title: str
    subtitle: str
    origin: GeoPoint
    start_at: datetime
    end_at: datetime
    return_by: datetime
    duration_minutes: int
    distance_km: float
    budget_yen: int
    transport_summary: str
    luck_total: int
    encoded_polyline: str | None = None
    route_points: list[GeoPoint]
    stops: list[PlanStop]
    calendar_events: list[CalendarEventDraft]
    safety: SafetyReport
    share: ShareCard
    source: Literal["live", "demo", "fallback"] = "demo"
    agent_version: str = "adk-2.4"


class ReplanReason(StrEnum):
    DELAY = "delay"
    CLOSED = "closed"
    TIRED = "tired"
    GO_HOME = "go_home"


class ReplanRequest(BaseModel):
    request_id: str
    user_id: str = "demo-player"
    now: datetime
    plan: MichikusaPlan
    current_stop_index: int = Field(default=0, ge=0)
    reason: ReplanReason
    delay_minutes: int = Field(default=15, ge=0, le=120)


class CalendarCommitRequest(BaseModel):
    request_id: str
    user_id: str = "demo-player"
    access_token: str
    plan: MichikusaPlan
    calendar_id: str | None = None
    existing_event_ids: list[str] = Field(default_factory=list)
    demo: bool = False


class CalendarCommitResponse(BaseModel):
    calendar_id: str
    calendar_summary: str
    event_ids: list[str]
    html_links: list[str] = Field(default_factory=list)
    created: int
    updated: int = 0
    demo: bool = False


class AgentTraceEvent(BaseModel):
    agent: str
    label: str
    message: str
    status: Literal["running", "done", "warning", "error"]
    color: Literal["pink", "purple", "green", "orange"]
    metric: str | None = None
    payload: dict | list | str | int | float | bool | None = None


class HealthResponse(BaseModel):
    status: Literal["ok"] = "ok"
    service: str = "michikusa-agent"
    demo_mode: bool
    adk_version: str
    maps_live: bool
    gemini_live: bool


class CalendarTokenRefreshResponse(BaseModel):
    access_token: str
    expires_in: int


class OAuthTokenRecord(BaseModel):
    access_token: str
    refresh_token: str | None = None
    expires_at: datetime
    scope: str | None = None
    token_type: str = "Bearer"

    @field_validator("expires_at")
    @classmethod
    def require_timezone(cls, value: datetime) -> datetime:
        if value.tzinfo is None:
            raise ValueError("expires_at must include a timezone")
        return value
