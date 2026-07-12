from __future__ import annotations

import math
from datetime import datetime, timedelta

from ..models import GeoPoint

EARTH_RADIUS_M = 6_371_000


def haversine_m(a: GeoPoint, b: GeoPoint) -> float:
    lat1 = math.radians(a.lat)
    lat2 = math.radians(b.lat)
    d_lat = math.radians(b.lat - a.lat)
    d_lng = math.radians(b.lng - a.lng)
    h = math.sin(d_lat / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin(d_lng / 2) ** 2
    return 2 * EARTH_RADIUS_M * math.asin(math.sqrt(h))


def walking_minutes(distance_m: float, speed_m_per_min: float = 72.0) -> int:
    return max(2, math.ceil(distance_m / max(speed_m_per_min, 30.0)))


def round_up_time(value: datetime, interval_minutes: int = 5) -> datetime:
    value = value.replace(second=0, microsecond=0)
    remainder = value.minute % interval_minutes
    if remainder == 0:
        return value
    return value + timedelta(minutes=interval_minutes - remainder)


def polyline_points(origin: GeoPoint, stops: list[GeoPoint]) -> list[GeoPoint]:
    return [origin, *stops]


def area_label(point: GeoPoint) -> str:
    return point.label or "現在地付近"
