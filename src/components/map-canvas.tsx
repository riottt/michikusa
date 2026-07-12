"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import type { GeoPoint, MichikusaPlan, PlanStop } from "@/types/michikusa";

export interface MapCandidate {
  place_id: string;
  name: string;
  category: string;
  location: GeoPoint;
  accepted?: boolean;
}

interface MapCanvasProps {
  current: GeoPoint;
  candidates: MapCandidate[];
  pins: PlanStop[];
  plan: MichikusaPlan | null;
  currentSpotIndex: number;
  planning: boolean;
  completedSpotIds: Set<string>;
}

const palette = {
  pink: "#ff86ac",
  purple: "#a992ff",
  green: "#63cfa4",
  orange: "#ff8a52"
} as const;

function project(point: GeoPoint, center: GeoPoint): { x: number; y: number } {
  const x = 50 + (point.lng - center.lng) * 4300;
  const y = 49 - (point.lat - center.lat) * 4300;
  return {
    x: Math.min(92, Math.max(8, x)),
    y: Math.min(88, Math.max(10, y))
  };
}

function DemoMap({
  current,
  candidates,
  pins,
  currentSpotIndex,
  planning,
  completedSpotIds
}: Omit<MapCanvasProps, "plan">) {
  const points = useMemo(
    () => [current, ...pins.map((pin) => pin.location)],
    [current, pins]
  );
  const route = points.map((point) => project(point, current));
  const polyline = route.map((point) => `${point.x},${point.y}`).join(" ");

  return (
    <div className="demo-map" aria-label="MICHIKUSAデモ地図">
      <svg className="demo-map__svg" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
        <defs>
          <linearGradient id="mapFade" x1="0" x2="1" y1="0" y2="1">
            <stop offset="0" stopColor="#fffdfc" />
            <stop offset="0.52" stopColor="#fbfafc" />
            <stop offset="1" stopColor="#f6fbf8" />
          </linearGradient>
          <filter id="routeGlow" x="-30%" y="-30%" width="160%" height="160%">
            <feGaussianBlur stdDeviation="0.65" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>
        <rect width="100" height="100" fill="url(#mapFade)" />
        <path d="M-4 15 C15 12 30 22 48 18 S78 6 106 12" fill="none" stroke="#e8e3ef" strokeWidth="1.1" />
        <path d="M2 40 C18 31 34 38 48 31 S77 24 101 34" fill="none" stroke="#ebe7ee" strokeWidth="0.9" />
        <path d="M-2 72 C18 64 32 76 53 65 S78 54 105 61" fill="none" stroke="#e9e5ec" strokeWidth="1" />
        <path d="M13 -4 C14 18 25 34 23 52 S17 80 24 105" fill="none" stroke="#ece8ef" strokeWidth="1" />
        <path d="M43 -4 C39 21 49 34 46 54 S39 79 43 104" fill="none" stroke="#ebe7ef" strokeWidth="0.9" />
        <path d="M77 -4 C73 20 83 35 78 58 S71 84 76 105" fill="none" stroke="#e9e5ed" strokeWidth="1.1" />
        <path d="M89 -4 C76 20 91 38 87 57 S80 88 90 105" fill="none" stroke="#dcecf5" strokeWidth="4.3" opacity="0.72" />
        <g fill="#f2f0f3" opacity="0.86">
          <rect x="4" y="19" width="12" height="11" rx="2" />
          <rect x="28" y="6" width="11" height="13" rx="2" />
          <rect x="52" y="10" width="16" height="11" rx="2" />
          <rect x="73" y="14" width="9" height="12" rx="2" />
          <rect x="6" y="47" width="14" height="13" rx="2" />
          <rect x="28" y="44" width="12" height="10" rx="2" />
          <rect x="53" y="40" width="17" height="14" rx="2" />
          <rect x="75" y="40" width="9" height="12" rx="2" />
          <rect x="8" y="78" width="15" height="12" rx="2" />
          <rect x="31" y="71" width="14" height="16" rx="2" />
          <rect x="55" y="72" width="12" height="11" rx="2" />
          <rect x="76" y="72" width="9" height="15" rx="2" />
        </g>
        <g fill="#dff1e6" opacity="0.9">
          <circle cx="19" cy="36" r="4.6" />
          <circle cx="65" cy="30" r="5.4" />
          <circle cx="16" cy="67" r="5.5" />
          <circle cx="66" cy="88" r="6.1" />
        </g>
        {route.length > 1 && (
          <polyline
            points={polyline}
            fill="none"
            stroke="#a992ff"
            strokeWidth="1.45"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeDasharray="2.2 2.2"
            filter="url(#routeGlow)"
            className="route-line"
          />
        )}
      </svg>

      {candidates.map((candidate, index) => {
        const point = project(candidate.location, current);
        return (
          <span
            key={candidate.place_id}
            className={`candidate-dot ${candidate.accepted === false ? "candidate-dot--rejected" : ""}`}
            style={{ left: `${point.x}%`, top: `${point.y}%`, animationDelay: `${index * 32}ms` }}
            aria-hidden="true"
          />
        );
      })}

      <div className="current-location" style={{ left: "50%", top: "49%" }}>
        <span className="current-location__pulse" />
        <span className="current-location__dot" />
      </div>

      {pins.map((pin, index) => {
        const point = project(pin.location, current);
        const isCurrent = index === currentSpotIndex;
        const isComplete = completedSpotIds.has(pin.id);
        const color = palette[pin.activity.color];
        return (
          <button
            type="button"
            key={pin.id}
            className={`map-pin ${isCurrent ? "map-pin--current" : ""} ${isComplete ? "map-pin--complete" : ""}`}
            style={{ left: `${point.x}%`, top: `${point.y}%`, "--pin-color": color } as React.CSSProperties}
            aria-label={`${pin.order}. ${pin.name}`}
          >
            {isComplete ? "✓" : pin.order}
          </button>
        );
      })}

      {planning && (
        <div className="map-scanner" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
      )}
    </div>
  );
}

async function loadGoogleMaps(): Promise<typeof google | null> {
  if (typeof window === "undefined") return null;
  if (window.google?.maps) return window.google;
  if (window.__michikusaMapsPromise) return window.__michikusaMapsPromise;
  const key = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
  if (!key) return null;
  window.__michikusaMapsPromise = new Promise((resolve, reject) => {
    const callback = `__michikusaMapsReady${Date.now()}`;
    (window as unknown as Record<string, unknown>)[callback] = () => {
      delete (window as unknown as Record<string, unknown>)[callback];
      resolve(window.google!);
    };
    const script = document.createElement("script");
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}&callback=${callback}&v=weekly&language=ja&region=JP`;
    script.async = true;
    script.onerror = () => reject(new Error("Google Maps failed to load"));
    document.head.appendChild(script);
  });
  return window.__michikusaMapsPromise;
}

function GoogleMapCanvas({ current, candidates, pins, currentSpotIndex, completedSpotIds }: MapCanvasProps) {
  const node = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<google.maps.Map | null>(null);
  const overlays = useRef<Array<google.maps.MVCObject>>([]);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let mounted = true;
    loadGoogleMaps()
      .then((g) => {
        if (!mounted || !g || !node.current) return;
        mapRef.current = new g.maps.Map(node.current, {
          center: current,
          zoom: 14,
          disableDefaultUI: true,
          clickableIcons: false,
          gestureHandling: "greedy",
          mapId: process.env.NEXT_PUBLIC_GOOGLE_MAP_ID || undefined,
          styles: process.env.NEXT_PUBLIC_GOOGLE_MAP_ID
            ? undefined
            : [
                { elementType: "geometry", stylers: [{ color: "#fbfafb" }] },
                { elementType: "labels.text.fill", stylers: [{ color: "#88858d" }] },
                { elementType: "labels.icon", stylers: [{ visibility: "off" }] },
                { featureType: "poi", stylers: [{ visibility: "off" }] },
                { featureType: "road", elementType: "geometry", stylers: [{ color: "#ebe8ed" }] },
                { featureType: "water", elementType: "geometry", stylers: [{ color: "#e0edf7" }] },
                { featureType: "landscape.natural", stylers: [{ color: "#e8f4eb" }] }
              ]
        });
      })
      .catch(() => setFailed(true));
    return () => {
      mounted = false;
    };
  }, [current]);

  useEffect(() => {
    const map = mapRef.current;
    const g = window.google;
    if (!map || !g) return;
    overlays.current.forEach((overlay) => {
      if ("setMap" in overlay && typeof (overlay as google.maps.Marker).setMap === "function") {
        (overlay as google.maps.Marker).setMap(null);
      }
    });
    overlays.current = [];
    const bounds = new g.maps.LatLngBounds();
    bounds.extend(current);

    const currentCircle = new g.maps.Circle({
      map,
      center: current,
      radius: 32,
      fillColor: "#7d76ff",
      fillOpacity: 0.2,
      strokeColor: "#ffffff",
      strokeWeight: 4
    });
    overlays.current.push(currentCircle);

    candidates.forEach((candidate) => {
      const circle = new g.maps.Circle({
        map,
        center: candidate.location,
        radius: 18,
        fillColor: candidate.accepted === false ? "#c8c5cb" : "#ff9db9",
        fillOpacity: candidate.accepted === false ? 0.2 : 0.55,
        strokeOpacity: 0,
        clickable: false
      });
      overlays.current.push(circle);
      bounds.extend(candidate.location);
    });

    pins.forEach((pin, index) => {
      const marker = new g.maps.Marker({
        map,
        position: pin.location,
        label: {
          text: completedSpotIds.has(pin.id) ? "✓" : String(pin.order),
          color: "#ffffff",
          fontWeight: "700"
        },
        title: pin.name,
        zIndex: index === currentSpotIndex ? 10 : 5
      });
      overlays.current.push(marker);
      bounds.extend(pin.location);
    });

    if (pins.length) {
      const line = new g.maps.Polyline({
        map,
        path: [current, ...pins.map((pin) => pin.location)],
        strokeColor: "#a992ff",
        strokeOpacity: 0.9,
        strokeWeight: 5,
        geodesic: true
      });
      overlays.current.push(line);
      map.fitBounds(bounds, 72);
    } else {
      map.panTo(current);
    }
  }, [current, candidates, pins, currentSpotIndex, completedSpotIds]);

  if (failed) return <DemoMap current={current} candidates={candidates} pins={pins} currentSpotIndex={currentSpotIndex} planning={false} completedSpotIds={completedSpotIds} />;
  return <div ref={node} className="google-map" aria-label="Googleマップ" />;
}

export function MapCanvas(props: MapCanvasProps) {
  const hasKey = Boolean(process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY);
  return hasKey ? <GoogleMapCanvas {...props} /> : <DemoMap {...props} />;
}
