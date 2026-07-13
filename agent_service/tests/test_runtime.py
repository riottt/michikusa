from __future__ import annotations

from datetime import datetime, timedelta, timezone
import json

import pytest

from michikusa_agent.models import (
    CalendarCommitRequest,
    GeoPoint,
    MichikusaPlan,
    PlanRequest,
    Preferences,
    ReplanReason,
    ReplanRequest,
)
from michikusa_agent.runtime import MichikusaRuntime
from michikusa_agent import server
from michikusa_agent import workflow
from michikusa_agent.config import Settings
from michikusa_agent.services import maps


def sample_request(context_hint: str = "outside") -> PlanRequest:
    now = datetime(2026, 7, 11, 5, 0, tzinfo=timezone.utc)
    return PlanRequest(
        request_id=f"test-plan-{context_hint}",
        user_id="pytest-user",
        location=GeoPoint(lat=34.702485, lng=135.495951, label="大阪・梅田"),
        home_location=GeoPoint(lat=34.702485, lng=135.495951, label="ホーム") if context_hint == "home" else None,
        now=now,
        context_hint=context_hint,
        preferences=Preferences(
            duration_minutes=90,
            budget_yen=1500,
            transport="walk_transit",
            return_buffer_minutes=25,
        ),
    )


def test_plan_source_requires_both_live_providers() -> None:
    plan_source = getattr(workflow, "_plan_source", None)
    assert callable(plan_source), "workflow._plan_source must define source integrity"
    assert plan_source(maps_live=True, gemini_live=True) == "live"
    assert plan_source(maps_live=True, gemini_live=False) == "fallback"
    assert plan_source(maps_live=False, gemini_live=True) == "fallback"
    assert plan_source(maps_live=False, gemini_live=False) == "demo"


def test_live_llm_nodes_have_bounded_generation(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("GOOGLE_CLOUD_PROJECT", "test-project")
    monkeypatch.setenv("GOOGLE_GENAI_USE_ENTERPRISE", "true")
    settings = Settings(
        demo_mode=False,
        maps_server_api_key="test-key",
        gemini_model="gemini-test",
        agent_shared_secret="test-secret",
    )
    creative = workflow._creative_agent(settings, False)
    narrator = workflow._memory_agent(settings, False)
    assert creative.generate_content_config.max_output_tokens == 512
    assert narrator.generate_content_config.max_output_tokens == 256
    assert creative.generate_content_config.candidate_count == 1
    assert narrator.generate_content_config.candidate_count == 1
    assert creative.timeout == 30
    assert narrator.timeout == 20


@pytest.mark.asyncio
async def test_forced_demo_plan_does_not_call_live_maps(monkeypatch: pytest.MonkeyPatch) -> None:
    async def unexpected_call(*args, **kwargs):
        raise AssertionError("live HTTP client must not be used")

    monkeypatch.setattr("httpx.AsyncClient.post", unexpected_call)
    request = sample_request().model_copy(update={"force_demo": True})
    plan = await MichikusaRuntime().create_plan(request)
    assert plan.source in {"demo", "fallback"}


@pytest.mark.asyncio
async def test_routes_requests_ordered_high_quality_walking_and_bicycle_geometry(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    settings = Settings(
        demo_mode=False,
        maps_server_api_key="test-key",
        gemini_model="gemini-test",
        agent_shared_secret="test-secret",
    )
    monkeypatch.setattr(maps, "get_settings", lambda: settings)
    requests: list[dict] = []

    class Response:
        def raise_for_status(self) -> None:
            return None

        def json(self) -> dict:
            return {
                "routes": [{
                    "distanceMeters": 1840,
                    "duration": "1260s",
                    "polyline": {"encodedPolyline": "provider-road-geometry"},
                }]
            }

    async def post(_client, url: str, *, headers: dict, json: dict) -> Response:
        requests.append({"url": url, "headers": headers, "body": json})
        return Response()

    monkeypatch.setattr(maps.httpx.AsyncClient, "post", post)
    points = [
        GeoPoint(lat=34.70, lng=135.49),
        GeoPoint(lat=34.71, lng=135.50),
        GeoPoint(lat=34.72, lng=135.51),
    ]

    walking = await maps.compute_route_for_points(points, "徒歩＋電車")
    bicycle = await maps.compute_route_for_points(points, "自転車")

    assert walking[2] == "provider-road-geometry"
    assert walking[4] == "google"
    assert requests[0]["body"]["travelMode"] == "WALK"
    assert requests[0]["body"]["polylineQuality"] == "HIGH_QUALITY"
    assert requests[0]["body"]["polylineEncoding"] == "ENCODED_POLYLINE"
    assert requests[0]["body"]["computeAlternativeRoutes"] is False
    assert requests[0]["body"]["routeModifiers"] == {"avoidIndoor": True}
    assert requests[0]["body"]["intermediates"][0]["location"]["latLng"] == {
        "latitude": points[1].lat,
        "longitude": points[1].lng,
    }
    assert requests[0]["headers"]["X-Goog-FieldMask"] == (
        "routes.duration,routes.distanceMeters,routes.polyline.encodedPolyline"
    )
    assert bicycle[2] == "provider-road-geometry"
    assert requests[1]["body"]["travelMode"] == "BICYCLE"
    assert "routeModifiers" not in requests[1]["body"]


@pytest.mark.asyncio
async def test_replan_replaces_or_clears_stale_route_geometry(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    service = MichikusaRuntime()
    original = await service.create_plan(sample_request())
    original.source = "live"
    original.encoded_polyline = "stale-route"
    calls: list[list[GeoPoint]] = []

    async def route(points, transport_summary, **_kwargs):
        calls.append(points)
        return 2200, 28, "fresh-route", points, "google"

    monkeypatch.setattr(workflow, "compute_route_for_points", route)
    changed = await service.replan(
        ReplanRequest(
            request_id="replan-fresh-geometry",
            user_id="pytest-user",
            now=original.start_at + timedelta(minutes=20),
            plan=original,
            current_stop_index=0,
            reason=ReplanReason.DELAY,
            delay_minutes=15,
        )
    )
    assert changed.encoded_polyline == "fresh-route"
    assert changed.distance_km == 2.2
    assert len(calls) == 1

    go_home = await service.replan(
        ReplanRequest(
            request_id="replan-clear-geometry",
            user_id="pytest-user",
            now=original.start_at + timedelta(minutes=20),
            plan=original,
            current_stop_index=0,
            reason=ReplanReason.GO_HOME,
            delay_minutes=0,
        )
    )
    assert go_home.encoded_polyline is None
    assert go_home.route_points == [go_home.origin]
    assert len(calls) == 1


@pytest.mark.asyncio
async def test_adk_graph_stream_produces_traces_pins_and_plan() -> None:
    request = sample_request()
    service = MichikusaRuntime()
    events = [event async for event in service.stream_plan(request)]
    kinds = [event["type"] for event in events]
    assert kinds[0] == "run_started"
    assert kinds.count("trace") >= 18
    assert kinds.count("pin") >= 2
    plan = MichikusaPlan.model_validate(next(event["plan"] for event in events if event["type"] == "plan"))
    assert 2 <= len(plan.stops) <= 4
    assert plan.safety.passed
    assert plan.budget_yen <= request.preferences.budget_yen
    assert plan.end_at <= plan.return_by
    assert {check.key for check in plan.safety.checks} >= {"time_window", "budget", "opening_hours", "late_night"}
    assert plan.calendar_events
    assert plan.luck_total == sum(stop.activity.luck for stop in plan.stops)
    assert plan.agent_version.startswith("adk-")
    share_payload = json.dumps(plan.share.model_dump(mode="json"), ensure_ascii=False)
    assert str(plan.origin.lat) not in share_payload
    assert str(plan.origin.lng) not in share_payload


@pytest.mark.asyncio
async def test_home_and_outside_contexts_select_different_modes() -> None:
    service = MichikusaRuntime()
    home = await service.create_plan(sample_request("home"))
    outside = await service.create_plan(sample_request("outside"))
    assert home.mode == "departure"
    assert outside.mode == "detour"


@pytest.mark.asyncio
async def test_calendar_action_graph_creates_all_timeline_events_in_demo() -> None:
    service = MichikusaRuntime()
    plan = await service.create_plan(sample_request())
    result = await service.calendar_commit(
        CalendarCommitRequest(
            request_id="calendar-test",
            user_id="pytest-user",
            access_token="demo-calendar-token",
            plan=plan,
            demo=True,
        )
    )
    assert result.demo is True
    assert result.created == len(plan.calendar_events)
    assert len(result.event_ids) == len(plan.calendar_events)


@pytest.mark.asyncio
async def test_replan_graph_preserves_executable_plan_and_return_guard() -> None:
    service = MichikusaRuntime()
    original = await service.create_plan(sample_request())
    for reason in ReplanReason:
        changed = await service.replan(
            ReplanRequest(
                request_id=f"replan-{reason.value}",
                user_id="pytest-user",
                now=original.start_at + timedelta(minutes=20),
                plan=original,
                current_stop_index=0,
                reason=reason,
                delay_minutes=15,
            )
        )
        assert changed.duration_minutes >= 1
        assert changed.end_at <= changed.return_by
        assert changed.return_by <= original.return_by
        assert any(check.key == "replan_return" and check.passed for check in changed.safety.checks)
        assert changed.share.spots == len(changed.stops)
        assert changed.luck_total == sum(stop.activity.luck for stop in changed.stops)


@pytest.mark.asyncio
async def test_plan_stream_masks_unexpected_provider_errors(monkeypatch: pytest.MonkeyPatch) -> None:
    async def fail_stream(_: PlanRequest):
        raise RuntimeError("provider keyString: should-never-reach-the-browser")
        yield  # pragma: no cover

    monkeypatch.setattr(server.runtime, "stream_plan", fail_stream)
    response = await server.plan_stream(sample_request())
    payload = json.loads("".join([chunk async for chunk in response.body_iterator]))

    assert payload["type"] == "error"
    assert payload["message"] == "ルートの生成を続けられませんでした。"
    assert "keyString" not in json.dumps(payload)
