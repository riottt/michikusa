from __future__ import annotations

import json

import google.adk
from fastapi import Depends, FastAPI, Header, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse

from .config import get_settings
from .models import (
    CalendarCommitRequest,
    CalendarCommitResponse,
    HealthResponse,
    MichikusaPlan,
    PlanRequest,
    ReplanRequest,
)
from .runtime import runtime

settings = get_settings()
app = FastAPI(
    title="MICHIKUSA Agent API",
    version="0.3.0",
    description="Google ADK graph workflows for outing planning, replanning, and Calendar actions.",
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
    allow_credentials=True,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["*"],
)


def require_secret(x_michikusa_secret: str | None = Header(default=None)) -> None:
    if x_michikusa_secret != settings.agent_shared_secret:
        raise HTTPException(status_code=401, detail="invalid agent secret")


@app.get("/health", response_model=HealthResponse)
async def health() -> HealthResponse:
    return HealthResponse(
        demo_mode=settings.demo_mode,
        adk_version=google.adk.__version__,
        maps_live=settings.live_maps_enabled,
        gemini_live=settings.live_gemini_enabled,
    )


@app.get("/v1/capabilities", dependencies=[Depends(require_secret)])
async def capabilities() -> dict:
    return {
        "framework": f"Google ADK {google.adk.__version__}",
        "workflows": {
            "plan": {"nodes": 18, "parallel_scouts": 4},
            "replan": {"nodes": 7, "parallel_observers": 3},
            "calendar_commit": {"nodes": 4},
        },
        "demo_mode": settings.demo_mode,
        "integrations": {
            "gemini": settings.live_gemini_enabled,
            "places": settings.live_maps_enabled,
            "routes": settings.live_maps_enabled,
            "calendar": True,
        },
    }


@app.post("/v1/plan", response_model=MichikusaPlan, dependencies=[Depends(require_secret)])
async def plan(request: PlanRequest) -> MichikusaPlan:
    return await runtime.create_plan(request)


@app.post("/v1/plan/stream", dependencies=[Depends(require_secret)])
async def plan_stream(request: PlanRequest) -> StreamingResponse:
    async def generate():
        try:
            async for event in runtime.stream_plan(request):
                yield json.dumps(event, ensure_ascii=False, default=str) + "\n"
        except Exception as error:
            yield json.dumps(
                {"type": "error", "message": str(error), "recoverable": False},
                ensure_ascii=False,
            ) + "\n"

    return StreamingResponse(
        generate(),
        media_type="application/x-ndjson",
        headers={"Cache-Control": "no-cache, no-transform", "X-Accel-Buffering": "no"},
    )


@app.post("/v1/replan", response_model=MichikusaPlan, dependencies=[Depends(require_secret)])
async def replan_route(request: ReplanRequest) -> MichikusaPlan:
    return await runtime.replan(request)


@app.post("/v1/replan/stream", dependencies=[Depends(require_secret)])
async def replan_stream(request: ReplanRequest) -> StreamingResponse:
    async def generate():
        async for event in runtime.stream_replan(request):
            yield json.dumps(event, ensure_ascii=False, default=str) + "\n"

    return StreamingResponse(generate(), media_type="application/x-ndjson")


@app.post(
    "/v1/calendar/commit",
    response_model=CalendarCommitResponse,
    dependencies=[Depends(require_secret)],
)
async def calendar_commit(request: CalendarCommitRequest) -> CalendarCommitResponse:
    return await runtime.calendar_commit(request)
