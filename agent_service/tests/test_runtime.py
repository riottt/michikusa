from __future__ import annotations

from datetime import datetime, timedelta, timezone

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


@pytest.mark.asyncio
async def test_adk_graph_stream_produces_traces_pins_and_plan() -> None:
    service = MichikusaRuntime()
    events = [event async for event in service.stream_plan(sample_request())]
    kinds = [event["type"] for event in events]
    assert kinds[0] == "run_started"
    assert kinds.count("trace") >= 18
    assert kinds.count("pin") >= 2
    plan = MichikusaPlan.model_validate(next(event["plan"] for event in events if event["type"] == "plan"))
    assert 2 <= len(plan.stops) <= 4
    assert plan.safety.passed
    assert plan.calendar_events
    assert plan.luck_total == sum(stop.activity.luck for stop in plan.stops)
    assert plan.agent_version.startswith("adk-")


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
        assert changed.share.spots == len(changed.stops)
        assert changed.luck_total == sum(stop.activity.luck for stop in changed.stops)
