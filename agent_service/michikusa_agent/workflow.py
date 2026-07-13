from __future__ import annotations

import json
import math
import uuid
from datetime import datetime, timedelta
from typing import Any, Literal
from zoneinfo import ZoneInfo

from google.adk import Agent, Workflow
from google.adk.agents.context import Context
from google.adk.workflow import JoinNode, node
from google.genai import types

from .config import Settings, get_settings
from .models import (
    ActivitySuggestion,
    CalendarCommitRequest,
    CalendarEventDraft,
    CalendarWindow,
    CreativeOutput,
    GeoPoint,
    MemoryNarration,
    MemoryProfile,
    MichikusaPlan,
    MobilityProfile,
    PlanRequest,
    PlanStop,
    PlaceCandidate,
    ReplanReason,
    ReplanRequest,
    RouteDraft,
    RouteMatrix,
    RouteMetric,
    RouteStopDraft,
    SafetyCheck,
    SafetyReport,
    ShareCard,
    Situation,
)
from .services.calendar import commit_calendar
from .services.demo_llm import ACTIVITY_LIBRARY, DemoMichikusaModel
from .services.geo import area_label, haversine_m, round_up_time, walking_minutes
from .services.maps import compute_route_for_points, compute_route_geometry, search_places

DEFAULT_STAY_MINUTES: dict[str, int] = {
    "book_store": 24,
    "library": 25,
    "park": 20,
    "garden": 18,
    "cafe": 28,
    "bakery": 18,
    "river": 14,
    "street": 14,
    "shopping": 18,
    "art_gallery": 28,
    "museum": 30,
    "shrine": 15,
    "station": 10,
    "viewpoint": 14,
}


def _plan_source(*, maps_live: bool, gemini_live: bool) -> Literal["live", "demo", "fallback"]:
    if maps_live and gemini_live:
        return "live"
    if maps_live or gemini_live:
        return "fallback"
    return "demo"

DISCOVER_CATEGORIES = {
    "book_store",
    "art_gallery",
    "museum",
    "street",
    "shopping",
    "shrine",
    "station",
    "viewpoint",
}
STAY_CATEGORIES = {"cafe", "park", "library", "garden", "river", "bakery"}
LANDING_CATEGORIES = {"cafe", "park", "river", "garden", "library", "bakery"}


def _as_plan_request(raw: dict[str, Any] | PlanRequest) -> PlanRequest:
    return raw if isinstance(raw, PlanRequest) else PlanRequest.model_validate(raw)


def _as_replan_request(raw: dict[str, Any] | ReplanRequest) -> ReplanRequest:
    return raw if isinstance(raw, ReplanRequest) else ReplanRequest.model_validate(raw)


def _localise(value: datetime, timezone: str) -> datetime:
    zone = ZoneInfo(timezone)
    if value.tzinfo is None:
        return value.replace(tzinfo=zone)
    return value.astimezone(zone)


def _fallback_activity(stop: RouteStopDraft) -> ActivitySuggestion:
    spec = ACTIVITY_LIBRARY.get(stop.place.category, ACTIVITY_LIBRARY["street"])
    title, instruction, completion_type, duration, luck, color, icon = spec
    return ActivitySuggestion(
        stop_id=stop.id,
        short_label=title,
        title=title,
        instruction=instruction,
        completion_type=completion_type,
        duration_minutes=duration,
        luck=luck,
        color=color,
        icon=icon,
    )


async def situation_agent(ctx: Context, request: dict[str, Any]) -> dict[str, Any]:
    plan_request = _as_plan_request(request)
    now = _localise(plan_request.now, plan_request.timezone)
    inferred_home = False
    if plan_request.context_hint == "home":
        inferred_home = True
    elif plan_request.context_hint == "outside":
        inferred_home = False
    elif plan_request.home_location:
        inferred_home = haversine_m(plan_request.location, plan_request.home_location) <= 320
    else:
        inferred_home = plan_request.calendar.source == "demo" and now.hour < 15

    mode = "departure" if inferred_home else "detour"
    situation = Situation(
        mode=mode,
        headline="少しだけ、外へ。" if mode == "departure" else "もうひとつ、寄っていく？",
        action_label="外に連れ出して" if mode == "departure" else "このまま道草する",
        inferred_home=inferred_home,
        local_hour=now.hour,
    )
    ctx.state["situation"] = situation.model_dump(mode="json")
    ctx.state["local_now"] = now.isoformat()
    return {"mode": mode, "headline": situation.headline}


async def calendar_scout_agent(
    ctx: Context,
    request: dict[str, Any],
    situation: Situation,
) -> dict[str, Any]:
    plan_request = _as_plan_request(request)
    now = _localise(plan_request.now, plan_request.timezone)
    lead = 15 if situation.mode == "departure" else 5
    start = round_up_time(now + timedelta(minutes=lead), 5)
    desired = plan_request.preferences.duration_minutes or (150 if situation.mode == "departure" else 75)
    candidate_end = start + timedelta(minutes=desired)

    next_busy: datetime | None = None
    for busy in sorted(plan_request.calendar.busy, key=lambda item: item.start):
        busy_start = _localise(busy.start, plan_request.timezone)
        if busy_start > start:
            next_busy = busy_start
            break
    if plan_request.calendar.next_event_at:
        explicit = _localise(plan_request.calendar.next_event_at, plan_request.timezone)
        if explicit > start and (next_busy is None or explicit < next_busy):
            next_busy = explicit

    if next_busy:
        guarded_end = next_busy - timedelta(minutes=plan_request.preferences.return_buffer_minutes)
        end = min(candidate_end, guarded_end)
    else:
        end = candidate_end
    if end <= start + timedelta(minutes=25):
        end = start + timedelta(minutes=30)

    available = max(30, int((end - start).total_seconds() // 60))
    summary = f"{start:%H:%M}から{available}分"
    if next_busy:
        summary = f"次の予定まで{available}分"
    window = CalendarWindow(
        start=start,
        end=end,
        available_minutes=available,
        next_event_at=next_busy,
        connected=plan_request.calendar.connected,
        summary=summary,
    )
    ctx.state["calendar_window"] = window.model_dump(mode="json")
    return {"summary": summary, "available_minutes": available}


async def mobility_scout_agent(
    ctx: Context,
    request: dict[str, Any],
    situation: Situation,
) -> dict[str, Any]:
    plan_request = _as_plan_request(request)
    transport = plan_request.preferences.transport
    if situation.mode == "detour" and transport == "walk_transit":
        transport = "walk"
    duration = plan_request.preferences.duration_minutes or (150 if situation.mode == "departure" else 75)
    if transport == "walk":
        radius = 1800 if situation.mode == "detour" else 3200
        speed = 74.0
    elif transport == "bicycle":
        radius = 6500
        speed = 190.0
    else:
        radius = 7000 if duration >= 120 else 4500
        speed = 85.0
    target_spots = 3 if duration >= 70 else 2
    profile = MobilityProfile(
        transport=transport,
        search_radius_m=radius,
        max_one_way_minutes=max(12, min(35, duration // 4)),
        target_spots=target_spots,
        walking_speed_m_per_min=speed,
    )
    ctx.state["mobility_profile"] = profile.model_dump(mode="json")
    return {"transport": transport, "radius_m": radius, "target_spots": target_spots}


async def memory_scout_agent(ctx: Context, request: dict[str, Any]) -> dict[str, Any]:
    plan_request = _as_plan_request(request)
    place_ids = [item.place_id for item in plan_request.history[-20:] if item.place_id]
    categories = [item.category for item in plan_request.history[-20:] if item.category]
    novelty = 0.82 if len(place_ids) >= 3 else 0.68
    profile = MemoryProfile(
        recent_place_ids=place_ids,
        recent_categories=categories,
        novelty_bias=novelty,
    )
    ctx.state["memory_profile"] = profile.model_dump(mode="json")
    return {"remembered_places": len(place_ids), "novelty_bias": novelty}


async def place_scout_agent(
    ctx: Context,
    request: dict[str, Any],
    situation: Situation,
) -> dict[str, Any]:
    plan_request = _as_plan_request(request)
    preferences = plan_request.preferences
    duration = preferences.duration_minutes or (150 if situation.mode == "departure" else 75)
    if preferences.transport == "walk":
        radius = 2200 if situation.mode == "detour" else 3600
    elif preferences.transport == "bicycle":
        radius = 7000
    else:
        radius = 7500 if duration >= 120 else 4800
    candidates = await search_places(
        plan_request.location, radius, 20, force_demo=plan_request.force_demo
    )
    filtered = [
        candidate
        for candidate in candidates
        if candidate.open_now is not False
        and candidate.estimated_cost_yen <= max(preferences.budget_yen, 500)
    ]
    if len(filtered) < 5:
        filtered = candidates
    ctx.state["place_candidates"] = [candidate.model_dump(mode="json") for candidate in filtered]
    source = "google" if any(candidate.source == "google" for candidate in filtered) else "demo"
    ctx.state["place_source"] = source
    return {"candidates": len(filtered), "source": source}


async def route_matrix_agent(
    ctx: Context,
    request: dict[str, Any],
    place_candidates: list[dict[str, Any]],
    mobility_profile: MobilityProfile,
) -> dict[str, Any]:
    plan_request = _as_plan_request(request)
    candidates = [PlaceCandidate.model_validate(candidate) for candidate in place_candidates]
    metrics: list[RouteMetric] = []
    for candidate in candidates:
        distance = int(haversine_m(plan_request.location, candidate.location) * 1.14)
        if mobility_profile.transport == "bicycle":
            duration = max(4, math.ceil(distance / 190))
        elif mobility_profile.transport == "walk_transit" and distance > 2600:
            duration = max(12, math.ceil(distance / 430) + 8)
        else:
            duration = walking_minutes(distance, 74)
        metrics.append(RouteMetric(place_id=candidate.place_id, distance_m=distance, duration_minutes=duration))
    matrix = RouteMatrix(from_origin=metrics, source="estimated")
    ctx.state["route_matrix"] = matrix.model_dump(mode="json")
    return {"evaluated": len(metrics), "shortest_minutes": min((m.duration_minutes for m in metrics), default=0)}


def _score_candidate(
    candidate: PlaceCandidate,
    metric: RouteMetric,
    memory: MemoryProfile,
    budget_yen: int,
    role: str,
) -> float:
    rating = (candidate.rating or 4.0) / 5
    novelty = candidate.novelty_score
    if candidate.place_id in memory.recent_place_ids:
        novelty -= 0.55
    if candidate.category in memory.recent_categories:
        novelty -= 0.10
    distance_score = max(0.0, 1 - metric.duration_minutes / 45)
    budget_score = 1.0 if candidate.estimated_cost_yen <= budget_yen else 0.1
    role_match = 0.5
    if role == "discover" and candidate.category in DISCOVER_CATEGORIES:
        role_match = 1.0
    elif role == "stay" and candidate.category in STAY_CATEGORIES:
        role_match = 1.0
    elif role == "landing" and candidate.category in LANDING_CATEGORIES:
        role_match = 1.0
    return rating * 0.2 + novelty * 0.32 + distance_score * 0.22 + budget_score * 0.12 + role_match * 0.14


async def route_composer_agent(
    ctx: Context,
    request: dict[str, Any],
    situation: Situation,
    calendar_window: CalendarWindow,
    place_candidates: list[dict[str, Any]],
    route_matrix: RouteMatrix,
    memory_profile: MemoryProfile,
    mobility_profile: MobilityProfile,
) -> dict[str, Any]:
    """Compose a route incrementally so every newly selected stop remains executable.

    Candidate ranking from the origin alone can create a zig-zag route: an attractive
    first stop may be followed by a second stop on the opposite side of town, forcing
    the final time guard to remove almost the whole route.  MICHIKUSA instead scores
    every next stop from the *previous selected stop* and only accepts a stop when the
    projected return still fits the Calendar window.
    """

    plan_request = _as_plan_request(request)
    candidates = [PlaceCandidate.model_validate(candidate) for candidate in place_candidates]
    roles = ["discover", "stay", "landing"][: mobility_profile.target_spots]
    remaining_budget = plan_request.preferences.budget_yen
    return_minutes = 18 if situation.mode == "departure" else 10

    cursor = calendar_window.start
    previous = plan_request.location
    selected_ids: set[str] = set()
    stops: list[RouteStopDraft] = []
    total_distance = 0
    total_budget = 0

    def travel_for(distance: int) -> int:
        if mobility_profile.transport == "bicycle":
            return max(4, math.ceil(distance / 190))
        if mobility_profile.transport == "walk_transit" and distance > 2300:
            return max(12, math.ceil(distance / 450) + 8)
        return walking_minutes(distance, 72)

    for role in roles:
        ranked: list[tuple[float, PlaceCandidate, int, int, int]] = []
        for candidate in candidates:
            if candidate.place_id in selected_ids:
                continue
            distance = int(haversine_m(previous, candidate.location) * 1.16)
            travel_minutes = travel_for(distance)
            stay_minutes = DEFAULT_STAY_MINUTES.get(candidate.category, 18)
            if calendar_window.available_minutes < 70:
                stay_minutes = min(stay_minutes, 14)

            projected_arrival = cursor + timedelta(minutes=travel_minutes)
            projected_departure = projected_arrival + timedelta(minutes=stay_minutes)
            projected_end = projected_departure + timedelta(minutes=return_minutes)

            # Keep a compact fallback possible when the remaining window is tight.
            if projected_end > calendar_window.end:
                compact_stay = max(8, min(stay_minutes, 10))
                compact_departure = projected_arrival + timedelta(minutes=compact_stay)
                if compact_departure + timedelta(minutes=return_minutes) > calendar_window.end:
                    continue
                stay_minutes = compact_stay

            dynamic_metric = RouteMetric(
                place_id=candidate.place_id,
                distance_m=distance,
                duration_minutes=travel_minutes,
            )
            score = _score_candidate(candidate, dynamic_metric, memory_profile, remaining_budget, role)
            # A slight continuity bonus keeps the route flowing rather than zig-zagging.
            score += max(0.0, 1 - travel_minutes / 30) * 0.10
            ranked.append((score, candidate, distance, travel_minutes, stay_minutes))

        if not ranked:
            break

        _, choice, distance, travel_minutes, stay_minutes = max(ranked, key=lambda item: item[0])
        arrival = cursor + timedelta(minutes=travel_minutes)
        departure = arrival + timedelta(minutes=stay_minutes)
        stops.append(
            RouteStopDraft(
                id=f"spot-{len(stops) + 1}",
                order=len(stops) + 1,
                place=choice,
                arrival_at=arrival,
                departure_at=departure,
                travel_minutes=travel_minutes,
                stay_minutes=stay_minutes,
                role=role,
            )
        )
        selected_ids.add(choice.place_id)
        cursor = departure
        previous = choice.location
        total_distance += distance
        total_budget += choice.estimated_cost_yen
        remaining_budget = max(0, remaining_budget - choice.estimated_cost_yen)

    # A route is still valid in very short windows with one stop, but normal 60–180
    # minute sessions are designed to contain two or more distinct moments.
    if not stops and candidates:
        choice = min(candidates, key=lambda candidate: haversine_m(plan_request.location, candidate.location))
        distance = int(haversine_m(plan_request.location, choice.location) * 1.16)
        travel_minutes = travel_for(distance)
        stay_minutes = max(8, min(12, calendar_window.available_minutes - travel_minutes - return_minutes))
        arrival = cursor + timedelta(minutes=travel_minutes)
        departure = arrival + timedelta(minutes=stay_minutes)
        stops.append(
            RouteStopDraft(
                id="spot-1",
                order=1,
                place=choice,
                arrival_at=arrival,
                departure_at=departure,
                travel_minutes=travel_minutes,
                stay_minutes=stay_minutes,
                role="discover",
            )
        )
        cursor = departure
        total_distance = distance
        total_budget = choice.estimated_cost_yen

    end_at = min(cursor + timedelta(minutes=return_minutes), calendar_window.end)
    draft = RouteDraft(
        start_at=calendar_window.start,
        end_at=end_at,
        origin=plan_request.location,
        stops=stops,
        estimated_distance_m=max(total_distance, 500),
        estimated_budget_yen=total_budget,
        transport_summary={"walk": "徒歩", "walk_transit": "徒歩＋電車", "bicycle": "自転車"}[
            mobility_profile.transport
        ],
        route_points=[plan_request.location, *[stop.place.location for stop in stops]],
    )
    ctx.state["route_draft"] = draft.model_dump(mode="json")
    ctx.state["creative_input_json"] = json.dumps(draft.model_dump(mode="json"), ensure_ascii=False)
    return {"spots": len(stops), "end_at": draft.end_at.isoformat(), "budget_yen": total_budget}


async def route_geometry_agent(ctx: Context, route_draft: RouteDraft) -> dict[str, Any]:
    plan_request = _as_plan_request(ctx.state["request"])
    distance, duration, encoded, points, source = await compute_route_geometry(
        route_draft, force_demo=plan_request.force_demo
    )
    route_draft.estimated_distance_m = max(distance, route_draft.estimated_distance_m)
    route_draft.encoded_polyline = encoded
    route_draft.route_points = points
    ctx.state["route_draft"] = route_draft.model_dump(mode="json")
    ctx.state["route_geometry_source"] = source
    return {"distance_m": distance, "moving_minutes": duration, "source": source}


async def merge_creative_agent(
    ctx: Context,
    route_draft: RouteDraft,
    creative_output: dict[str, Any] | None = None,
) -> dict[str, Any]:
    if creative_output:
        creative = CreativeOutput.model_validate(creative_output)
    else:
        creative = CreativeOutput(
            route_title="今日は、道の方に決めてもらう。",
            route_subtitle="次のピンだけ追ってください。",
            activities=[_fallback_activity(stop) for stop in route_draft.stops],
        )
    activities = {activity.stop_id: activity for activity in creative.activities}
    for stop in route_draft.stops:
        activities.setdefault(stop.id, _fallback_activity(stop))
    creative.activities = [activities[stop.id] for stop in route_draft.stops]
    ctx.state["creative_output"] = creative.model_dump(mode="json")
    return {"title": creative.route_title, "activities": len(creative.activities)}


def _safety_report(route: RouteDraft, request: PlanRequest, window: CalendarWindow) -> SafetyReport:
    checks: list[SafetyCheck] = []
    checks.append(
        SafetyCheck(
            key="time_window",
            passed=route.end_at <= window.end,
            message="次の予定と帰宅余白の範囲内" if route.end_at <= window.end else "終了時刻が空き時間を超過",
        )
    )
    checks.append(
        SafetyCheck(
            key="budget",
            passed=route.estimated_budget_yen <= request.preferences.budget_yen,
            message="予算内" if route.estimated_budget_yen <= request.preferences.budget_yen else "予算を超過",
        )
    )
    checks.append(
        SafetyCheck(
            key="opening_hours",
            passed=all(stop.place.open_now is not False for stop in route.stops),
            message="営業状態を確認" if all(stop.place.open_now is not False for stop in route.stops) else "閉店候補を含む",
        )
    )
    late_unsafe = any(
        stop.arrival_at.hour >= 21 and stop.place.category in {"park", "river", "street"}
        for stop in route.stops
    )
    checks.append(
        SafetyCheck(
            key="late_night",
            passed=not late_unsafe,
            message="時間帯に合う場所" if not late_unsafe else "夜間の屋外地点を含む",
        )
    )
    passed_count = sum(check.passed for check in checks)
    return SafetyReport(passed=passed_count == len(checks), score=70 + passed_count * 7, checks=checks)


async def safety_validator_agent(
    ctx: Context,
    request: dict[str, Any],
    calendar_window: CalendarWindow,
    route_draft: RouteDraft,
) -> dict[str, Any]:
    report = _safety_report(route_draft, _as_plan_request(request), calendar_window)
    ctx.state["safety_report"] = report.model_dump(mode="json")
    return {"passed": report.passed, "score": report.score}


async def repair_agent(
    ctx: Context,
    request: dict[str, Any],
    calendar_window: CalendarWindow,
    route_draft: RouteDraft,
    safety_report: SafetyReport,
) -> dict[str, Any]:
    repairs: list[str] = []
    plan_request = _as_plan_request(request)
    if route_draft.end_at > calendar_window.end and route_draft.stops:
        route_draft.end_at = calendar_window.end
        last = route_draft.stops[-1]
        if last.departure_at > route_draft.end_at - timedelta(minutes=8):
            last.departure_at = route_draft.end_at - timedelta(minutes=8)
            last.stay_minutes = max(5, int((last.departure_at - last.arrival_at).total_seconds() // 60))
        repairs.append("帰宅余白を守るため滞在時間を短縮")
    if route_draft.estimated_budget_yen > plan_request.preferences.budget_yen:
        paid = sorted(route_draft.stops, key=lambda stop: stop.place.estimated_cost_yen, reverse=True)
        for stop in paid:
            if route_draft.estimated_budget_yen <= plan_request.preferences.budget_yen:
                break
            route_draft.estimated_budget_yen -= stop.place.estimated_cost_yen
            stop.place.estimated_cost_yen = 0
            repairs.append(f"{stop.place.name}を無料で楽しむ行動へ変更")
    for stop in route_draft.stops:
        if stop.arrival_at.hour >= 21 and stop.place.category in {"park", "river", "street"}:
            stop.place.category = "cafe"
            stop.place.name = "明るい休憩スポット"
            repairs.append("夜間の屋外地点を明るい休憩地点へ変更")
    safety_report.repairs.extend(repairs)
    ctx.state["route_draft"] = route_draft.model_dump(mode="json")
    ctx.state["safety_report"] = safety_report.model_dump(mode="json")
    return {"repairs": repairs, "count": len(repairs)}


async def final_safety_agent(
    ctx: Context,
    request: dict[str, Any],
    calendar_window: CalendarWindow,
    route_draft: RouteDraft,
    safety_report: SafetyReport,
) -> dict[str, Any]:
    final_report = _safety_report(route_draft, _as_plan_request(request), calendar_window)
    final_report.repairs = safety_report.repairs
    ctx.state["safety_report"] = final_report.model_dump(mode="json")
    return {"passed": final_report.passed, "score": final_report.score, "repairs": len(final_report.repairs)}


async def calendar_draft_agent(
    ctx: Context,
    route_draft: RouteDraft,
    creative_output: CreativeOutput,
) -> dict[str, Any]:
    activities = {activity.stop_id: activity for activity in creative_output.activities}
    events: list[CalendarEventDraft] = []
    cursor = route_draft.start_at
    for stop in route_draft.stops:
        if stop.arrival_at > cursor:
            events.append(
                CalendarEventDraft(
                    id=f"cal-{stop.id}-travel",
                    kind="travel",
                    summary=f"MICHIKUSA｜{stop.place.name}へ移動",
                    start=cursor,
                    end=stop.arrival_at,
                    location=stop.place.address or stop.place.name,
                    description="AIが組み立てた道草ルートの移動時間です。",
                    color_id="3",
                )
            )
        activity = activities.get(stop.id, _fallback_activity(stop))
        events.append(
            CalendarEventDraft(
                id=f"cal-{stop.id}",
                kind="spot",
                summary=f"MICHIKUSA｜{activity.short_label}",
                start=stop.arrival_at,
                end=stop.departure_at,
                location=stop.place.address or stop.place.name,
                description=f"{activity.instruction}\n完了すると +{activity.luck} LUCK",
                color_id={"pink": "4", "purple": "2", "green": "10", "orange": "6"}[activity.color],
            )
        )
        cursor = stop.departure_at
    if route_draft.end_at > cursor:
        events.append(
            CalendarEventDraft(
                id="cal-return",
                kind="return",
                summary="MICHIKUSA｜帰る時間",
                start=cursor,
                end=route_draft.end_at,
                location=None,
                description="帰宅余白を確保しています。ルートが遅れた場合はエージェントが再調整します。",
                color_id="8",
            )
        )
    ctx.state["calendar_events"] = [event.model_dump(mode="json") for event in events]
    return {"events": len(events), "start": route_draft.start_at.isoformat(), "end": route_draft.end_at.isoformat()}


async def share_prep_agent(
    ctx: Context,
    request: dict[str, Any],
    situation: Situation,
    route_draft: RouteDraft,
    creative_output: CreativeOutput,
) -> dict[str, Any]:
    plan_request = _as_plan_request(request)
    payload = {
        "mode": situation.mode,
        "local_hour": situation.local_hour,
        "categories": [stop.place.category for stop in route_draft.stops],
        "title": creative_output.route_title,
        "area": area_label(plan_request.location),
    }
    ctx.state["share_input_json"] = json.dumps(payload, ensure_ascii=False)
    return payload


async def finalizer_agent(
    ctx: Context,
    request: dict[str, Any],
    situation: Situation,
    route_draft: RouteDraft,
    creative_output: CreativeOutput,
    calendar_events: list[dict[str, Any]],
    safety_report: SafetyReport,
    memory_output: dict[str, Any] | None = None,
) -> dict[str, Any]:
    settings = get_settings()
    plan_request = _as_plan_request(request)
    memory = MemoryNarration.model_validate(
        memory_output
        or {
            "call_sign": "予定なき道草人",
            "theme": "今いる場所から始まる道草",
            "share_title": "TODAY'S MICHIKUSA",
        }
    )
    activities = {activity.stop_id: activity for activity in creative_output.activities}
    plan_stops: list[PlanStop] = []
    for stop in route_draft.stops:
        activity = activities.get(stop.id, _fallback_activity(stop))
        plan_stops.append(
            PlanStop(
                id=stop.id,
                order=stop.order,
                place_id=stop.place.place_id,
                name=stop.place.name,
                category=stop.place.category,
                location=stop.place.location,
                address=stop.place.address,
                maps_uri=stop.place.google_maps_uri,
                arrival_at=stop.arrival_at,
                departure_at=stop.departure_at,
                travel_minutes=stop.travel_minutes,
                stay_minutes=stop.stay_minutes,
                role=stop.role,
                activity=activity,
            )
        )
    luck_total = sum(stop.activity.luck for stop in plan_stops)
    duration_minutes = max(1, int((route_draft.end_at - route_draft.start_at).total_seconds() // 60))
    share = ShareCard(
        title=memory.share_title,
        call_sign=memory.call_sign,
        area_label=area_label(plan_request.location),
        spots=len(plan_stops),
        distance_km=round(route_draft.estimated_distance_m / 1000, 1),
        duration_minutes=duration_minutes,
        luck=luck_total,
        theme=memory.theme,
    )
    plan = MichikusaPlan(
        id=f"michi-{uuid.uuid4().hex[:12]}",
        request_id=plan_request.request_id,
        mode=situation.mode,
        title=creative_output.route_title,
        subtitle=creative_output.route_subtitle,
        origin=plan_request.location,
        start_at=route_draft.start_at,
        end_at=route_draft.end_at,
        return_by=route_draft.end_at,
        duration_minutes=duration_minutes,
        distance_km=round(route_draft.estimated_distance_m / 1000, 1),
        budget_yen=route_draft.estimated_budget_yen,
        transport_summary=route_draft.transport_summary,
        luck_total=luck_total,
        encoded_polyline=route_draft.encoded_polyline,
        route_points=route_draft.route_points,
        stops=plan_stops,
        calendar_events=[CalendarEventDraft.model_validate(item) for item in calendar_events],
        safety=safety_report,
        share=share,
        source=_plan_source(
            maps_live=settings.live_maps_enabled,
            gemini_live=settings.live_gemini_enabled,
        ),
    )
    ctx.state["final_plan"] = plan.model_dump(mode="json")
    return plan.model_dump(mode="json")


async def replan_context_agent(ctx: Context, replan_request: dict[str, Any]) -> dict[str, Any]:
    request = _as_replan_request(replan_request)
    ctx.state["working_plan"] = request.plan.model_dump(mode="json")
    ctx.state["replan_reason"] = request.reason.value
    return {"reason": request.reason.value, "delay_minutes": request.delay_minutes}


async def change_observer_agent(
    ctx: Context,
    replan_request: dict[str, Any],
) -> dict[str, Any]:
    request = _as_replan_request(replan_request)
    message = {
        ReplanReason.DELAY: f"{request.delay_minutes}分の遅れを検知",
        ReplanReason.CLOSED: "次の場所が利用できない状態を検知",
        ReplanReason.TIRED: "負荷を下げる希望を検知",
        ReplanReason.GO_HOME: "帰宅希望を検知",
    }[request.reason]
    ctx.state["change_observation"] = message
    return {"message": message}


async def replan_calendar_guard_agent(
    ctx: Context,
    replan_request: dict[str, Any],
) -> dict[str, Any]:
    request = _as_replan_request(replan_request)
    remaining = max(0, int((request.plan.return_by - _localise(request.now, "Asia/Tokyo")).total_seconds() // 60))
    ctx.state["remaining_window"] = remaining
    return {"remaining_minutes": remaining, "return_by": request.plan.return_by.isoformat()}


async def replan_place_refresh_agent(
    ctx: Context,
    replan_request: dict[str, Any],
) -> dict[str, Any]:
    request = _as_replan_request(replan_request)
    remaining = request.plan.stops[request.current_stop_index :]
    ctx.state["remaining_stops"] = [stop.model_dump(mode="json") for stop in remaining]
    return {"remaining_spots": len(remaining), "refresh_needed": request.reason == ReplanReason.CLOSED}


async def route_replanner_agent(
    ctx: Context,
    replan_request: dict[str, Any],
) -> dict[str, Any]:
    request = _as_replan_request(replan_request)
    plan = request.plan.model_copy(deep=True)
    now = _localise(request.now, "Asia/Tokyo")
    remaining = plan.stops[request.current_stop_index :]
    completed = plan.stops[: request.current_stop_index]

    if request.reason == ReplanReason.GO_HOME:
        remaining = []
        plan.end_at = now + timedelta(minutes=20)
        plan.return_by = plan.end_at
        plan.title = "ここから、帰れる道へ。"
        plan.subtitle = "未訪問のピンを閉じ、帰宅時間を守ります。"
    else:
        shift = request.delay_minutes if request.reason == ReplanReason.DELAY else 5
        cursor = now
        adjusted: list[PlanStop] = []
        for index, stop in enumerate(remaining):
            stop = stop.model_copy(deep=True)
            if request.reason == ReplanReason.CLOSED and index == 0:
                stop.name = "近くの代替スポット"
                stop.category = "cafe"
                stop.activity = ActivitySuggestion(
                    stop_id=stop.id,
                    short_label="10分だけ休む",
                    title="10分だけ休む",
                    instruction="明るい場所で飲み物を一つ選び、次の予定を考えずに休んでください。",
                    completion_type="timer",
                    duration_minutes=10,
                    luck=15,
                    color="orange",
                    icon="coffee",
                )
            travel = max(4, stop.travel_minutes - (3 if request.reason == ReplanReason.TIRED else 0))
            arrival = cursor + timedelta(minutes=travel)
            stay = min(stop.stay_minutes, 12) if request.reason == ReplanReason.TIRED else stop.stay_minutes
            departure = arrival + timedelta(minutes=stay)
            stop.arrival_at = arrival
            stop.departure_at = departure
            stop.travel_minutes = travel
            stop.stay_minutes = stay
            adjusted.append(stop)
            cursor = departure
        remaining = adjusted
        return_buffer = 12
        while remaining and cursor + timedelta(minutes=return_buffer) > plan.return_by:
            remaining.pop()
            cursor = remaining[-1].departure_at if remaining else now
        plan.end_at = min(plan.return_by, cursor + timedelta(minutes=return_buffer))
        plan.title = "道草を組み直しました。"
        plan.subtitle = "帰る時間を変えず、次のピンだけ入れ替えています。"

    plan.stops = [*completed, *remaining]
    plan.luck_total = sum(stop.activity.luck for stop in plan.stops)
    plan.duration_minutes = max(1, int((plan.end_at - plan.start_at).total_seconds() // 60))
    direct_route_points = [plan.origin, *[stop.location for stop in plan.stops]]
    plan.encoded_polyline = None
    plan.route_points = direct_route_points
    if len(direct_route_points) > 1:
        try:
            distance, _, encoded, route_points, _ = await compute_route_for_points(
                direct_route_points,
                plan.transport_summary,
                fallback_distance_m=round(plan.distance_km * 1000),
                force_demo=plan.source != "live",
            )
            plan.distance_km = round(distance / 1000, 1)
            plan.encoded_polyline = encoded
            plan.route_points = route_points
        except Exception:
            # Never retain stale provider geometry after the stop set changes.
            plan.encoded_polyline = None
            plan.route_points = direct_route_points
    else:
        plan.distance_km = 0
    plan.calendar_events = _calendar_events_for_plan(plan)
    plan.share.spots = len(plan.stops)
    plan.share.distance_km = plan.distance_km
    plan.share.duration_minutes = plan.duration_minutes
    plan.share.luck = plan.luck_total
    ctx.state["final_plan"] = plan.model_dump(mode="json")
    return {"spots": len(plan.stops), "end_at": plan.end_at.isoformat(), "shift": request.delay_minutes}


def _calendar_events_for_plan(plan: MichikusaPlan) -> list[CalendarEventDraft]:
    events: list[CalendarEventDraft] = []
    cursor = max(plan.start_at, plan.stops[0].arrival_at - timedelta(minutes=plan.stops[0].travel_minutes)) if plan.stops else plan.start_at
    for stop in plan.stops:
        if stop.arrival_at > cursor:
            events.append(
                CalendarEventDraft(
                    id=f"cal-{stop.id}-travel",
                    kind="travel",
                    summary=f"MICHIKUSA｜{stop.name}へ移動",
                    start=cursor,
                    end=stop.arrival_at,
                    location=stop.address or stop.name,
                    description="再計画された移動時間です。",
                    color_id="3",
                )
            )
        events.append(
            CalendarEventDraft(
                id=f"cal-{stop.id}",
                kind="spot",
                summary=f"MICHIKUSA｜{stop.activity.short_label}",
                start=stop.arrival_at,
                end=stop.departure_at,
                location=stop.address or stop.name,
                description=f"{stop.activity.instruction}\n+{stop.activity.luck} LUCK",
                color_id="6",
            )
        )
        cursor = stop.departure_at
    if plan.end_at > cursor:
        events.append(
            CalendarEventDraft(
                id="cal-return",
                kind="return",
                summary="MICHIKUSA｜帰る時間",
                start=cursor,
                end=plan.end_at,
                description="再計画後の帰宅時間です。",
                color_id="8",
            )
        )
    return events


async def replan_safety_agent(ctx: Context, final_plan: dict[str, Any]) -> dict[str, Any]:
    plan = MichikusaPlan.model_validate(final_plan)
    passed = plan.end_at <= plan.return_by and all(stop.departure_at <= plan.return_by for stop in plan.stops)
    plan.safety.passed = passed
    plan.safety.score = 98 if passed else 72
    plan.safety.checks.append(
        SafetyCheck(key="replan_return", passed=passed, message="帰宅時刻を維持" if passed else "帰宅時刻を再確認")
    )
    ctx.state["final_plan"] = plan.model_dump(mode="json")
    return {"passed": passed, "return_by": plan.return_by.isoformat()}


async def calendar_auth_agent(ctx: Context, calendar_request: dict[str, Any]) -> dict[str, Any]:
    request = CalendarCommitRequest.model_validate(calendar_request)
    valid = bool(request.access_token)
    if not valid:
        raise ValueError("Calendar access token is required")
    ctx.state["calendar_commit_demo"] = request.demo or request.access_token.startswith("demo-")
    return {"authenticated": True, "demo": ctx.state["calendar_commit_demo"]}


async def calendar_container_agent(ctx: Context, calendar_request: dict[str, Any]) -> dict[str, Any]:
    request = CalendarCommitRequest.model_validate(calendar_request)
    return {"calendar_id": request.calendar_id or "new-michikusa-calendar", "events": len(request.plan.calendar_events)}


async def calendar_action_agent(ctx: Context, calendar_request: dict[str, Any]) -> dict[str, Any]:
    request = CalendarCommitRequest.model_validate(calendar_request)
    result = await commit_calendar(request)
    ctx.state["calendar_result"] = result.model_dump(mode="json")
    return result.model_dump(mode="json")


async def calendar_receipt_agent(ctx: Context, calendar_result: dict[str, Any]) -> dict[str, Any]:
    ctx.state["final_calendar_result"] = calendar_result
    return calendar_result


def _creative_agent(settings: Settings, force_demo: bool) -> Agent:
    model: str | DemoMichikusaModel
    if settings.live_gemini_enabled and not force_demo:
        model = settings.gemini_model
    else:
        model = DemoMichikusaModel(model="michikusa-demo-creative", role="creative")
    return Agent(
        name="activity_director_agent",
        model=model,
        include_contents="none",
        instruction=(
            "あなたはMICHIKUSAのActivity Directorです。候補ルートを、短く、直感的で、現地ですぐ実行できる小さな遊びへ変換してください。"
            "仕事タスクや自己改善タスクにはしません。各地点に一つだけ行動を割り当て、文章は短くしてください。"
            "ROUTE_JSON<<{creative_input_json}>>ROUTE_JSON"
        ),
        output_schema=CreativeOutput,
        output_key="creative_output",
        mode="single_turn",
        timeout=30,
        generate_content_config=types.GenerateContentConfig(
            max_output_tokens=512,
            candidate_count=1,
            temperature=0.4,
        ),
    )


def _memory_agent(settings: Settings, force_demo: bool) -> Agent:
    model: str | DemoMichikusaModel
    if settings.live_gemini_enabled and not force_demo:
        model = settings.gemini_model
    else:
        model = DemoMichikusaModel(model="michikusa-demo-memory", role="memory")
    return Agent(
        name="memory_narrator_agent",
        model=model,
        include_contents="none",
        instruction=(
            "あなたはMICHIKUSAのMemory Narratorです。今日の道草に、少し笑えて生活感のある短い呼び名を付けてください。"
            "煽り文句は避け、共有カードに収まる短さにしてください。"
            "PLAN_JSON<<{share_input_json}>>PLAN_JSON"
        ),
        output_schema=MemoryNarration,
        output_key="memory_output",
        mode="single_turn",
        timeout=20,
        generate_content_config=types.GenerateContentConfig(
            max_output_tokens=256,
            candidate_count=1,
            temperature=0.5,
        ),
    )


def build_plan_workflow(*, force_demo: bool = False) -> Workflow:
    settings = get_settings()
    situation = node(situation_agent, name="situation_agent")
    calendar = node(calendar_scout_agent, name="calendar_scout_agent", parallel_worker=True)
    places = node(place_scout_agent, name="place_scout_agent", parallel_worker=True)
    mobility = node(mobility_scout_agent, name="mobility_scout_agent", parallel_worker=True)
    memory = node(memory_scout_agent, name="memory_scout_agent", parallel_worker=True)
    discovery_join = JoinNode(name="discovery_join")
    matrix = node(route_matrix_agent, name="route_matrix_agent")
    composer = node(route_composer_agent, name="route_composer_agent")
    geometry = node(route_geometry_agent, name="route_geometry_agent")
    creative = _creative_agent(settings, force_demo)
    merge = node(merge_creative_agent, name="creative_merge_agent")
    safety = node(safety_validator_agent, name="safety_validator_agent")
    repair = node(repair_agent, name="route_repair_agent")
    final_safety = node(final_safety_agent, name="final_safety_agent")
    calendar_draft = node(calendar_draft_agent, name="calendar_draft_agent")
    share_prep = node(share_prep_agent, name="share_prep_agent")
    narrator = _memory_agent(settings, force_demo)
    finalizer = node(finalizer_agent, name="finalizer_agent")

    return Workflow(
        name="michikusa_plan_workflow",
        description="ADK graph that turns current context into a safe outing timeline.",
        max_concurrency=6,
        edges=[
            ("START", situation, (calendar, places, mobility, memory)),
            ((calendar, places, mobility, memory), discovery_join, matrix, composer, geometry, creative, merge, safety, repair, final_safety, calendar_draft, share_prep, narrator, finalizer),
        ],
    )


def build_replan_workflow() -> Workflow:
    context = node(replan_context_agent, name="replan_context_agent")
    observer = node(change_observer_agent, name="change_observer_agent", parallel_worker=True)
    guard = node(replan_calendar_guard_agent, name="replan_calendar_guard_agent", parallel_worker=True)
    refresh = node(replan_place_refresh_agent, name="replan_place_refresh_agent", parallel_worker=True)
    joined = JoinNode(name="replan_join")
    replanner = node(route_replanner_agent, name="route_replanner_agent")
    safety = node(replan_safety_agent, name="replan_safety_agent")
    return Workflow(
        name="michikusa_replan_workflow",
        description="Observes a change and reflows the route while preserving return time.",
        max_concurrency=4,
        edges=[
            ("START", context, (observer, guard, refresh)),
            ((observer, guard, refresh), joined, replanner, safety),
        ],
    )


def build_calendar_workflow() -> Workflow:
    auth = node(calendar_auth_agent, name="calendar_auth_agent")
    container = node(calendar_container_agent, name="calendar_container_agent")
    action = node(calendar_action_agent, name="calendar_action_agent")
    receipt = node(calendar_receipt_agent, name="calendar_receipt_agent")
    return Workflow(
        name="michikusa_calendar_workflow",
        description="Creates or updates the MICHIKUSA calendar after human confirmation.",
        edges=[("START", auth, container, action, receipt)],
    )
