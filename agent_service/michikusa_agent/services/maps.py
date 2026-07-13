from __future__ import annotations

import asyncio
from typing import Any

import httpx

from ..config import get_settings
from ..data.demo_places import DEMO_PLACE_TEMPLATES
from ..models import GeoPoint, PlaceCandidate, RouteDraft
from .geo import haversine_m

PLACE_TYPES = [
    "book_store",
    "cafe",
    "park",
    "art_gallery",
    "museum",
    "library",
    "tourist_attraction",
    "bakery",
    "shopping_mall",
]

PRICE_LEVELS = {
    "PRICE_LEVEL_FREE": 0,
    "PRICE_LEVEL_INEXPENSIVE": 1,
    "PRICE_LEVEL_MODERATE": 2,
    "PRICE_LEVEL_EXPENSIVE": 3,
    "PRICE_LEVEL_VERY_EXPENSIVE": 4,
}

CATEGORY_COST = {
    "cafe": 750,
    "bakery": 600,
    "restaurant": 1400,
    "book_store": 0,
    "park": 0,
    "library": 0,
    "art_gallery": 400,
    "museum": 600,
    "tourist_attraction": 500,
    "shopping_mall": 500,
}


def demo_places(origin: GeoPoint, radius_m: int = 5000) -> list[PlaceCandidate]:
    candidates: list[PlaceCandidate] = []
    for index, template in enumerate(DEMO_PLACE_TEMPLATES):
        point = GeoPoint(
            lat=origin.lat + template.lat_offset,
            lng=origin.lng + template.lng_offset,
            label=template.name,
        )
        if haversine_m(origin, point) > max(radius_m * 1.4, 1200):
            continue
        candidates.append(
            PlaceCandidate(
                place_id=f"demo-{template.slug}",
                name=template.name,
                category=template.category,
                location=point,
                address=template.address,
                open_now=True,
                rating=template.rating,
                price_level=0 if template.estimated_cost_yen == 0 else 1,
                google_maps_uri=None,
                source="demo",
                estimated_cost_yen=template.estimated_cost_yen,
                novelty_score=0.58 + ((index * 13) % 30) / 100,
            )
        )
    return candidates


def _normalise_place(raw: dict[str, Any]) -> PlaceCandidate | None:
    location = raw.get("location") or {}
    latitude = location.get("latitude")
    longitude = location.get("longitude")
    if latitude is None or longitude is None:
        return None
    display_name = raw.get("displayName") or {}
    name = display_name.get("text") or raw.get("formattedAddress") or "名前のない場所"
    category = raw.get("primaryType") or "point_of_interest"
    price_level = PRICE_LEVELS.get(raw.get("priceLevel"), None)
    estimated_cost = CATEGORY_COST.get(category, 0)
    if price_level is not None:
        estimated_cost = [0, 700, 1300, 2500, 5000][min(price_level, 4)]
    photos = raw.get("photos") or []
    photo_name = photos[0].get("name") if photos else None
    return PlaceCandidate(
        place_id=raw.get("id") or f"google-{latitude}-{longitude}",
        name=name,
        category=category,
        location=GeoPoint(lat=latitude, lng=longitude, label=name),
        address=raw.get("formattedAddress"),
        open_now=(raw.get("currentOpeningHours") or {}).get("openNow"),
        rating=raw.get("rating"),
        price_level=price_level,
        google_maps_uri=raw.get("googleMapsUri"),
        photo_name=photo_name,
        source="google",
        estimated_cost_yen=estimated_cost,
        novelty_score=0.68,
    )


async def search_places(
    origin: GeoPoint, radius_m: int, max_results: int = 20, *, force_demo: bool = False
) -> list[PlaceCandidate]:
    settings = get_settings()
    if force_demo or not settings.live_maps_enabled:
        await asyncio.sleep(0.18)
        return demo_places(origin, radius_m)

    body = {
        "includedTypes": PLACE_TYPES,
        "maxResultCount": min(max_results, 20),
        "rankPreference": "POPULARITY",
        "locationRestriction": {
            "circle": {
                "center": {"latitude": origin.lat, "longitude": origin.lng},
                "radius": float(min(max(radius_m, 500), 50000)),
            }
        },
        "languageCode": "ja",
        "regionCode": "JP",
    }
    field_mask = ",".join(
        [
            "places.id",
            "places.displayName",
            "places.primaryType",
            "places.location",
            "places.formattedAddress",
            "places.currentOpeningHours.openNow",
            "places.rating",
            "places.priceLevel",
            "places.googleMapsUri",
            "places.photos.name",
        ]
    )
    headers = {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": settings.maps_server_api_key or "",
        "X-Goog-FieldMask": field_mask,
    }
    async with httpx.AsyncClient(timeout=12) as client:
        response = await client.post(settings.places_endpoint, headers=headers, json=body)
        response.raise_for_status()
        payload = response.json()
    places = [place for raw in payload.get("places", []) if (place := _normalise_place(raw))]
    if len(places) < 6:
        known_ids = {place.place_id for place in places}
        places.extend([place for place in demo_places(origin, radius_m) if place.place_id not in known_ids])
    return places[:max_results]


def route_travel_mode(transport_summary: str) -> str:
    return "BICYCLE" if transport_summary == "自転車" else "WALK"


async def compute_route_for_points(
    points: list[GeoPoint],
    transport_summary: str,
    *,
    fallback_distance_m: int = 0,
    force_demo: bool = False,
) -> tuple[int, int, str | None, list[GeoPoint], str]:
    settings = get_settings()
    travel_mode = route_travel_mode(transport_summary)
    if force_demo or not settings.live_maps_enabled or len(points) < 2:
        distance = 0
        for start, end in zip(points, points[1:]):
            distance += int(haversine_m(start, end) * 1.16)
        speed = 190 if travel_mode == "BICYCLE" else 72
        duration = max(1, int(distance / speed))
        await asyncio.sleep(0.10)
        return distance, duration, None, points, "estimated"

    origin = points[0]
    destination = points[-1]
    intermediates = [
        {"location": {"latLng": {"latitude": point.lat, "longitude": point.lng}}}
        for point in points[1:-1]
    ]
    body: dict[str, Any] = {
        "origin": {"location": {"latLng": {"latitude": origin.lat, "longitude": origin.lng}}},
        "destination": {
            "location": {"latLng": {"latitude": destination.lat, "longitude": destination.lng}}
        },
        "travelMode": travel_mode,
        "computeAlternativeRoutes": False,
        "polylineQuality": "HIGH_QUALITY",
        "polylineEncoding": "ENCODED_POLYLINE",
        "languageCode": "ja-JP",
        "units": "METRIC",
    }
    if travel_mode == "WALK":
        body["routeModifiers"] = {"avoidIndoor": True}
    if intermediates:
        body["intermediates"] = intermediates
    headers = {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": settings.maps_server_api_key or "",
        "X-Goog-FieldMask": "routes.duration,routes.distanceMeters,routes.polyline.encodedPolyline",
    }
    async with httpx.AsyncClient(timeout=12) as client:
        response = await client.post(settings.routes_endpoint, headers=headers, json=body)
        response.raise_for_status()
        payload = response.json()
    routes = payload.get("routes") or []
    if not routes:
        raise RuntimeError("Routes API returned no route")
    first = routes[0]
    duration_value = str(first.get("duration") or "0s").removesuffix("s")
    try:
        duration_minutes = max(1, round(float(duration_value) / 60))
    except ValueError:
        duration_minutes = max(1, fallback_distance_m // (190 if travel_mode == "BICYCLE" else 72))
    return (
        int(first.get("distanceMeters") or fallback_distance_m),
        duration_minutes,
        (first.get("polyline") or {}).get("encodedPolyline"),
        points,
        "google",
    )


async def compute_route_geometry(
    route: RouteDraft, *, force_demo: bool = False
) -> tuple[int, int, str | None, list[GeoPoint], str]:
    return await compute_route_for_points(
        [route.origin, *[stop.place.location for stop in route.stops]],
        route.transport_summary,
        fallback_distance_m=route.estimated_distance_m,
        force_demo=force_demo,
    )
