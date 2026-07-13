import type { GeoPoint } from "@/types/michikusa";

export type MapRouteSource = "routes-api" | "route-points" | "waypoints" | "none";

function isGeoPoint(point: GeoPoint): boolean {
  return Number.isFinite(point.lat)
    && Number.isFinite(point.lng)
    && point.lat >= -90
    && point.lat <= 90
    && point.lng >= -180
    && point.lng <= 180;
}

export function decodeGooglePolyline(encoded: string): GeoPoint[] {
  if (!encoded) return [];
  const points: GeoPoint[] = [];
  let index = 0;
  let latitude = 0;
  let longitude = 0;

  function nextDelta(): number {
    let result = 0;
    let shift = 0;
    while (index < encoded.length) {
      const value = encoded.charCodeAt(index) - 63;
      index += 1;
      if (value < 0 || value > 63 || shift > 30) throw new Error("Invalid encoded polyline");
      result |= (value & 0x1f) << shift;
      if (value < 0x20) return (result & 1) ? ~(result >> 1) : result >> 1;
      shift += 5;
    }
    throw new Error("Truncated encoded polyline");
  }

  while (index < encoded.length) {
    latitude += nextDelta();
    longitude += nextDelta();
    const point = { lat: latitude / 1e5, lng: longitude / 1e5 };
    if (!isGeoPoint(point)) throw new Error("Encoded polyline point is outside map bounds");
    points.push(point);
  }
  return points;
}

export function selectMapRoutePath({
  encodedPolyline,
  routePoints,
  waypoints,
}: {
  encodedPolyline?: string | null;
  routePoints?: GeoPoint[] | null;
  waypoints: GeoPoint[];
}): { points: GeoPoint[]; source: MapRouteSource } {
  if (encodedPolyline) {
    try {
      const decoded = decodeGooglePolyline(encodedPolyline);
      if (decoded.length > 1) return { points: decoded, source: "routes-api" };
    } catch {
      // Fall through to truthful non-provider geometry.
    }
  }
  const safeRoutePoints = (routePoints ?? []).filter(isGeoPoint);
  if (safeRoutePoints.length > 1) return { points: safeRoutePoints, source: "route-points" };
  const safeWaypoints = waypoints.filter(isGeoPoint);
  if (safeWaypoints.length > 1) return { points: safeWaypoints, source: "waypoints" };
  return { points: [], source: "none" };
}
