from __future__ import annotations

import asyncio
import uuid
from collections.abc import AsyncGenerator
from typing import Any

import google.adk
from google.adk.runners import InMemoryRunner
from google.genai import types

from .config import get_settings
from .models import (
    AgentTraceEvent,
    CalendarCommitRequest,
    CalendarCommitResponse,
    MichikusaPlan,
    PlanRequest,
    ReplanRequest,
)
from .workflow import build_calendar_workflow, build_plan_workflow, build_replan_workflow

TRACE: dict[str, tuple[str, str, str]] = {
    "situation_agent": ("状況を読む", "家から出るか、今いる場所で寄り道するかを判断します。", "pink"),
    "calendar_scout_agent": ("空き時間を探す", "Google Calendarから使える時間と帰宅余白を確認します。", "purple"),
    "place_scout_agent": ("場所を探す", "今から行ける店、公園、書店、休憩場所を探します。", "pink"),
    "mobility_scout_agent": ("移動範囲を決める", "徒歩、電車、自転車から無理のない範囲を計算します。", "green"),
    "memory_scout_agent": ("最近の道草を思い出す", "同じ場所ばかりにならないよう履歴を確認します。", "orange"),
    "discovery_join": ("探索をまとめる", "並行して集めた条件を一つにまとめます。", "purple"),
    "route_matrix_agent": ("距離を比べる", "候補までの距離と移動時間を比較します。", "green"),
    "route_composer_agent": ("順番を決める", "行き先、立ち寄る順番、帰る時間を決めます。", "orange"),
    "route_geometry_agent": ("地図に道を描く", "選んだピンをGoogle Routesの経路へつなぎます。", "purple"),
    "activity_director_agent": ("過ごし方を作る", "読む、聴く、撮る、休むを場所ごとに一つ決めます。", "pink"),
    "creative_merge_agent": ("場所と遊びをつなぐ", "移動先と現地での遊びを一つの体験にします。", "green"),
    "safety_validator_agent": ("無理がないか確認", "営業時間、予算、時間帯、帰宅余白を確認します。", "green"),
    "route_repair_agent": ("静かに調整する", "条件に合わない部分だけを入れ替えます。", "orange"),
    "final_safety_agent": ("帰れる時間を確認", "最後の予定に間に合うことをもう一度確認します。", "green"),
    "calendar_draft_agent": ("時間割にする", "移動と滞在をGoogle Calendarへ置ける予定にします。", "purple"),
    "share_prep_agent": ("記録を準備する", "正確な住所を隠した共有カードを準備します。", "pink"),
    "memory_narrator_agent": ("今日の呼び名を付ける", "今日だけの少し生活感のある呼び名を作ります。", "orange"),
    "finalizer_agent": ("道草を確定する", "次のピンだけ追えば出発できる状態にしました。", "orange"),
    "replan_context_agent": ("変化を読み直す", "現在位置と残り時間を読み直します。", "purple"),
    "change_observer_agent": ("変化を見つける", "遅れ、疲れ、休業、帰宅希望を観測します。", "pink"),
    "replan_calendar_guard_agent": ("帰る時間を守る", "カレンダーの次の予定と帰宅時刻を固定します。", "green"),
    "replan_place_refresh_agent": ("残りの場所を確認", "未訪問のピンと代替候補を確認します。", "orange"),
    "replan_join": ("再計画条件をまとめる", "変化した条件を一つにまとめます。", "purple"),
    "route_replanner_agent": ("残りの道を組み直す", "完了済みの体験を残して次のピンだけ変えます。", "orange"),
    "replan_safety_agent": ("新しい道を確認", "組み直した後も帰宅時刻を守れるか確認します。", "green"),
    "calendar_auth_agent": ("Calendar接続を確認", "ユーザーが許可した接続情報を確認します。", "purple"),
    "calendar_container_agent": ("専用Calendarを準備", "MICHIKUSA専用カレンダーを選択または作成します。", "green"),
    "calendar_action_agent": ("予定を一括登録", "移動、遊び、帰宅をCalendarへまとめて反映します。", "orange"),
    "calendar_receipt_agent": ("登録結果を確認", "作成または更新した予定を記録します。", "pink"),
}


def _node_name(path: str | None) -> str | None:
    if not path:
        return None
    return path.split("/")[-1].split("@")[0]


def _metric(output: Any) -> str | None:
    if not isinstance(output, dict):
        return None
    for key, suffix in [
        ("candidates", "候補"),
        ("available_minutes", "分"),
        ("radius_m", "m"),
        ("spots", "ピン"),
        ("events", "予定"),
        ("distance_m", "m"),
        ("score", "点"),
        ("remaining_minutes", "分"),
        ("created", "件"),
    ]:
        if key in output:
            return f"{output[key]}{suffix}"
    return None


def _trace(node_name: str, status: str, output: Any = None) -> AgentTraceEvent:
    label, message, color = TRACE.get(node_name, (node_name, "処理しています。", "purple"))
    return AgentTraceEvent(
        agent=node_name,
        label=label,
        message=message,
        status=status,  # type: ignore[arg-type]
        color=color,  # type: ignore[arg-type]
        metric=_metric(output),
        payload=output if isinstance(output, (dict, list, str, int, float, bool)) else None,
    )


class MichikusaRuntime:
    """Runs the three Google ADK graph workflows used by MICHIKUSA."""

    def __init__(self) -> None:
        self.settings = get_settings()

    async def _run_graph(
        self,
        *,
        workflow: Any,
        initial_state: dict[str, Any],
        final_key: str,
        user_id: str,
        session_id: str,
    ) -> AsyncGenerator[dict[str, Any], None]:
        runner = InMemoryRunner(node=workflow, app_name=self.settings.app_name)
        await runner.session_service.create_session(
            app_name=self.settings.app_name,
            user_id=user_id,
            session_id=session_id,
            state=initial_state,
        )
        seen: set[str] = set()
        candidates_sent = False
        pins_sent = False
        try:
            async for event in runner.run_async(
                user_id=user_id,
                session_id=session_id,
                new_message=types.Content(role="user", parts=[types.Part(text="execute workflow")]),
            ):
                name = _node_name(event.node_info.path if event.node_info else None)
                if not name or name.endswith("workflow"):
                    continue
                if isinstance(event.output, list) and not event.actions.state_delta:
                    continue
                if name not in seen:
                    seen.add(name)
                    yield {"type": "trace", "trace": _trace(name, "running").model_dump(mode="json")}
                    await asyncio.sleep(0.025)
                yield {"type": "trace", "trace": _trace(name, "done", event.output).model_dump(mode="json")}

                delta = event.actions.state_delta or {}
                if not candidates_sent and "place_candidates" in delta:
                    candidates_sent = True
                    for candidate in delta.get("place_candidates") or []:
                        yield {"type": "candidate", "candidate": candidate}
                        await asyncio.sleep(0.02)
                if not pins_sent and "route_draft" in delta:
                    route = delta.get("route_draft") or {}
                    stops = route.get("stops") if isinstance(route, dict) else None
                    if stops:
                        pins_sent = True
                        for stop in stops:
                            yield {"type": "pin", "stop": stop}
                            await asyncio.sleep(0.045)

            session = await runner.session_service.get_session(
                app_name=self.settings.app_name,
                user_id=user_id,
                session_id=session_id,
            )
            if not session or final_key not in session.state:
                raise RuntimeError(f"ADK workflow completed without {final_key}")
            yield {"type": "result", "value": session.state[final_key]}
        finally:
            await runner.close()

    async def stream_plan(self, request: PlanRequest) -> AsyncGenerator[dict[str, Any], None]:
        yield {
            "type": "run_started",
            "run_id": request.request_id,
            "workflow": "michikusa_plan_workflow",
            "adk_version": google.adk.__version__,
            "planning_nodes": 18,
            "runtime": "live" if (self.settings.live_gemini_enabled or self.settings.live_maps_enabled) else "demo-adk",
            "at": request.now.isoformat(),
        }
        force_demo = False
        while True:
            try:
                final: MichikusaPlan | None = None
                pins_emitted = False
                async for item in self._run_graph(
                    workflow=build_plan_workflow(force_demo=force_demo),
                    initial_state={"request": request.model_dump(mode="json")},
                    final_key="final_plan",
                    user_id=request.user_id,
                    session_id=f"plan-{uuid.uuid4().hex}",
                ):
                    if item["type"] == "pin":
                        pins_emitted = True
                    if item["type"] == "result":
                        final = MichikusaPlan.model_validate(item["value"])
                    else:
                        yield item
                if final is None:
                    raise RuntimeError("plan was not produced")
                if force_demo:
                    final.source = "fallback"
                if not pins_emitted:
                    for stop in final.stops:
                        yield {
                            "type": "pin",
                            "stop": {
                                "id": stop.id,
                                "order": stop.order,
                                "place": {
                                    "place_id": stop.place_id,
                                    "name": stop.name,
                                    "category": stop.category,
                                    "location": stop.location.model_dump(mode="json"),
                                    "address": stop.address,
                                    "google_maps_uri": stop.maps_uri,
                                },
                                "arrival_at": stop.arrival_at.isoformat(),
                                "departure_at": stop.departure_at.isoformat(),
                                "travel_minutes": stop.travel_minutes,
                                "stay_minutes": stop.stay_minutes,
                                "role": stop.role,
                            },
                        }
                        await asyncio.sleep(0.045)
                yield {"type": "plan", "plan": final.model_dump(mode="json")}
                return
            except Exception as error:
                if not force_demo and (self.settings.live_gemini_enabled or self.settings.live_maps_enabled):
                    yield {
                        "type": "trace",
                        "trace": AgentTraceEvent(
                            agent="fallback_agent",
                            label="安全なデモ経路へ切り替え",
                            message="外部APIに接続できなかったため、同じADKグラフをデモデータで続けます。",
                            status="warning",
                            color="orange",
                            payload={"error": type(error).__name__},
                        ).model_dump(mode="json"),
                    }
                    force_demo = True
                    continue
                raise

    async def create_plan(self, request: PlanRequest) -> MichikusaPlan:
        final: MichikusaPlan | None = None
        async for item in self.stream_plan(request):
            if item["type"] == "plan":
                final = MichikusaPlan.model_validate(item["plan"])
        if final is None:
            raise RuntimeError("plan was not produced")
        return final

    async def stream_replan(self, request: ReplanRequest) -> AsyncGenerator[dict[str, Any], None]:
        yield {
            "type": "run_started",
            "run_id": request.request_id,
            "workflow": "michikusa_replan_workflow",
            "adk_version": google.adk.__version__,
            "replan_nodes": 7,
        }
        final: MichikusaPlan | None = None
        async for item in self._run_graph(
            workflow=build_replan_workflow(),
            initial_state={"replan_request": request.model_dump(mode="json")},
            final_key="final_plan",
            user_id=request.user_id,
            session_id=f"replan-{uuid.uuid4().hex}",
        ):
            if item["type"] == "result":
                final = MichikusaPlan.model_validate(item["value"])
            else:
                yield item
        if final is None:
            raise RuntimeError("replan was not produced")
        yield {"type": "plan", "plan": final.model_dump(mode="json")}

    async def replan(self, request: ReplanRequest) -> MichikusaPlan:
        final: MichikusaPlan | None = None
        async for item in self.stream_replan(request):
            if item["type"] == "plan":
                final = MichikusaPlan.model_validate(item["plan"])
        if final is None:
            raise RuntimeError("replan was not produced")
        return final

    async def calendar_commit(self, request: CalendarCommitRequest) -> CalendarCommitResponse:
        final: CalendarCommitResponse | None = None
        async for item in self._run_graph(
            workflow=build_calendar_workflow(),
            initial_state={"calendar_request": request.model_dump(mode="json")},
            final_key="final_calendar_result",
            user_id=request.user_id,
            session_id=f"calendar-{uuid.uuid4().hex}",
        ):
            if item["type"] == "result":
                final = CalendarCommitResponse.model_validate(item["value"])
        if final is None:
            raise RuntimeError("calendar workflow did not return a receipt")
        return final


runtime = MichikusaRuntime()
