from __future__ import annotations

import os
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parents[2]
load_dotenv(ROOT / ".env")
load_dotenv(ROOT / ".env.local")


def _as_bool(value: str | None, default: bool = False) -> bool:
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


@dataclass(frozen=True)
class Settings:
    demo_mode: bool
    maps_server_api_key: str | None
    gemini_model: str
    agent_shared_secret: str
    app_name: str = "michikusa"
    default_timezone: str = "Asia/Tokyo"
    places_endpoint: str = "https://places.googleapis.com/v1/places:searchNearby"
    routes_endpoint: str = "https://routes.googleapis.com/directions/v2:computeRoutes"
    route_matrix_endpoint: str = "https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix"
    calendar_api_base: str = "https://www.googleapis.com/calendar/v3"

    @property
    def live_gemini_enabled(self) -> bool:
        return bool(
            os.getenv("GOOGLE_API_KEY")
            or (
                _as_bool(
                    os.getenv("GOOGLE_GENAI_USE_ENTERPRISE"),
                    _as_bool(os.getenv("GOOGLE_GENAI_USE_VERTEXAI"), True),
                )
                and os.getenv("GOOGLE_CLOUD_PROJECT")
            )
        ) and not self.demo_mode

    @property
    def live_maps_enabled(self) -> bool:
        return bool(self.maps_server_api_key) and not self.demo_mode


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    demo_mode = _as_bool(os.getenv("DEMO_MODE"), True)
    shared_secret = os.getenv("AGENT_SHARED_SECRET", "local-development-only")
    if not demo_mode and shared_secret == "local-development-only":
        raise RuntimeError("AGENT_SHARED_SECRET must be configured when DEMO_MODE=false")
    return Settings(
        demo_mode=demo_mode,
        maps_server_api_key=os.getenv("GOOGLE_MAPS_SERVER_API_KEY") or None,
        gemini_model=os.getenv("GEMINI_MODEL", "gemini-3.5-flash"),
        agent_shared_secret=shared_secret,
    )
