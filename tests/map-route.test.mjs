import assert from "node:assert/strict";
import test from "node:test";

import { decodeGooglePolyline, selectMapRoutePath } from "../src/lib/map-route.ts";

test("decodes Google encoded polyline into detailed signed coordinates", () => {
  assert.deepEqual(decodeGooglePolyline("_p~iF~ps|U_ulLnnqC_mqNvxq`@"), [
    { lat: 38.5, lng: -120.2 },
    { lat: 40.7, lng: -120.95 },
    { lat: 43.252, lng: -126.453 },
  ]);
});

test("provider geometry wins over straight waypoint fallbacks", () => {
  const result = selectMapRoutePath({
    encodedPolyline: "_p~iF~ps|U_ulLnnqC_mqNvxq`@",
    routePoints: [{ lat: 1, lng: 1 }, { lat: 2, lng: 2 }],
    waypoints: [{ lat: 3, lng: 3 }, { lat: 4, lng: 4 }],
  });

  assert.equal(result.source, "routes-api");
  assert.equal(result.points.length, 3);
});

test("invalid provider geometry falls back truthfully to route points", () => {
  const routePoints = [{ lat: 34.7, lng: 135.49 }, { lat: 34.71, lng: 135.5 }];
  const result = selectMapRoutePath({
    encodedPolyline: "\u0000",
    routePoints,
    waypoints: [{ lat: 0, lng: 0 }],
  });

  assert.equal(result.source, "route-points");
  assert.deepEqual(result.points, routePoints);
});
