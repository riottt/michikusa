"use client";

import {
  AlertCircle,
  ArrowRight,
  Bike,
  BookOpen,
  BrainCircuit,
  CalendarCheck2,
  CalendarDays,
  Camera,
  Check,
  ChevronRight,
  CircleEllipsis,
  Clock3,
  Coffee,
  Compass,
  Download,
  Footprints,
  History,
  Home,
  Leaf,
  LoaderCircle,
  MapPin,
  Menu,
  Music2,
  Navigation,
  Route,
  Settings2,
  Share2,
  ShieldCheck,
  Sparkles,
  TrainFront,
  WalletCards,
  X
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { MapCanvas, type MapCandidate } from "@/components/map-canvas";
import type {
  ActivitySuggestion,
  AgentTraceEvent,
  CalendarCommitResult,
  CalendarStatus,
  GeoPoint,
  MichikusaPlan,
  PlanStop,
  ReplanReason
} from "@/types/michikusa";

type Phase = "idle" | "planning" | "ready" | "active" | "activity" | "complete";
type Sheet = "none" | "settings" | "menu" | "trace" | "replan" | "memories";
type Transport = "walk" | "walk_transit" | "bicycle";
type ContextHint = "auto" | "home" | "outside";
type Mood = "anything" | "quiet" | "discover" | "food" | "green";

interface Profile {
  luckTotal: number;
  durationMinutes: number;
  budgetYen: number;
  transport: Transport;
  homeLocation: GeoPoint | null;
}

interface StreamEvent {
  type: string;
  trace?: AgentTraceEvent;
  candidate?: MapCandidate;
  candidate_id?: string;
  accepted?: boolean;
  reason?: string;
  stop?: Record<string, unknown>;
  plan?: MichikusaPlan;
  message?: string;
}

const DEMO_LOCATION: GeoPoint = {
  lat: 34.702485,
  lng: 135.495951,
  label: "大阪・梅田"
};

const DEFAULT_PROFILE: Profile = {
  luckTotal: 120,
  durationMinutes: 90,
  budgetYen: 1500,
  transport: "walk_transit",
  homeLocation: null
};

const iconByActivity: Record<ActivitySuggestion["icon"], React.ComponentType<{ size?: number; strokeWidth?: number }>> = {
  book: BookOpen,
  camera: Camera,
  coffee: Coffee,
  music: Music2,
  walk: Footprints,
  sparkles: Sparkles,
  leaf: Leaf
};

function timeLabel(value: string): string {
  return new Intl.DateTimeFormat("ja-JP", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Asia/Tokyo"
  }).format(new Date(value));
}

function moneyLabel(value: number): string {
  return new Intl.NumberFormat("ja-JP", { style: "currency", currency: "JPY", maximumFractionDigits: 0 }).format(value);
}

function TransportGlyph({ transport, size = 15 }: { transport: Transport; size?: number }) {
  if (transport === "bicycle") return <Bike size={size} />;
  if (transport === "walk_transit") return <TrainFront size={size} />;
  return <Footprints size={size} />;
}

function draftPin(raw: Record<string, unknown>): PlanStop | null {
  const place = raw.place as Record<string, unknown> | undefined;
  const location = place?.location as GeoPoint | undefined;
  if (!place || !location) return null;
  return {
    id: String(raw.id),
    order: Number(raw.order),
    place_id: String(place.place_id),
    name: String(place.name),
    category: String(place.category),
    location,
    address: place.address ? String(place.address) : null,
    maps_uri: place.google_maps_uri ? String(place.google_maps_uri) : null,
    arrival_at: String(raw.arrival_at),
    departure_at: String(raw.departure_at),
    travel_minutes: Number(raw.travel_minutes),
    stay_minutes: Number(raw.stay_minutes),
    role: String(raw.role) as PlanStop["role"],
    activity: {
      stop_id: String(raw.id),
      short_label: "見つける",
      title: "次のピン",
      instruction: "この場所で小さな遊びが開きます。",
      completion_type: "arrival",
      duration_minutes: 5,
      luck: 10,
      color: ["pink", "green", "purple", "orange"][Math.max(0, Number(raw.order) - 1) % 4] as ActivitySuggestion["color"],
      icon: "sparkles"
    }
  };
}

function SheetShell({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="sheet-layer" role="presentation" onMouseDown={onClose}>
      <section className="sheet" role="dialog" aria-modal="true" aria-label={title} onMouseDown={(event) => event.stopPropagation()}>
        <div className="sheet__handle" />
        <header className="sheet__header">
          <h2>{title}</h2>
          <button className="icon-button" type="button" onClick={onClose} aria-label="閉じる">
            <X size={19} />
          </button>
        </header>
        <div className="sheet__body">{children}</div>
      </section>
    </div>
  );
}

function AgentBadge({ count, onClick, active }: { count: number; onClick: () => void; active: boolean }) {
  return (
    <button className={`agent-badge ${active ? "agent-badge--active" : ""}`} type="button" onClick={onClick}>
      <BrainCircuit size={15} />
      <span>ADK</span>
      <strong>{count || 18}</strong>
    </button>
  );
}

export function MichikusaApp() {
  const [phase, setPhase] = useState<Phase>("idle");
  const [sheet, setSheet] = useState<Sheet>("none");
  const [profile, setProfile] = useState<Profile>(DEFAULT_PROFILE);
  const [calendar, setCalendar] = useState<CalendarStatus>({ connected: false, demo: true, message: "Calendarを確認中" });
  const [location, setLocation] = useState<GeoPoint>(DEMO_LOCATION);
  const [locationMode, setLocationMode] = useState<"loading" | "live" | "demo">("demo");
  const [contextHint, setContextHint] = useState<ContextHint>("home");
  const [mood, setMood] = useState<Mood>("anything");
  const [plan, setPlan] = useState<MichikusaPlan | null>(null);
  const [candidates, setCandidates] = useState<MapCandidate[]>([]);
  const [pins, setPins] = useState<PlanStop[]>([]);
  const [traces, setTraces] = useState<AgentTraceEvent[]>([]);
  const [currentSpotIndex, setCurrentSpotIndex] = useState(0);
  const [completedSpotIds, setCompletedSpotIds] = useState<Set<string>>(new Set());
  const [earnedLuck, setEarnedLuck] = useState(0);
  const [toast, setToast] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [calendarCommit, setCalendarCommit] = useState<CalendarCommitResult | null>(null);
  const [timerRemaining, setTimerRemaining] = useState<number | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [memories, setMemories] = useState<MichikusaPlan[]>([]);
  const shareRef = useRef<HTMLDivElement | null>(null);
  const photoInput = useRef<HTMLInputElement | null>(null);

  const currentSpot = plan?.stops[currentSpotIndex] ?? null;
  const latestTrace = traces.at(-1);

  useEffect(() => {
    Promise.all([
      fetch("/api/profile", { cache: "no-store" }).then((response) => response.json()),
      fetch("/api/calendar/status", { cache: "no-store" }).then((response) => response.json())
    ])
      .then(([profileData, calendarData]) => {
        setProfile(profileData as Profile);
        setCalendar(calendarData as CalendarStatus);
      })
      .catch(() => undefined);

    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setLocation({ lat: position.coords.latitude, lng: position.coords.longitude, label: "現在地" });
        setLocationMode("live");
      },
      () => setLocationMode("demo"),
      { enableHighAccuracy: true, timeout: 7000, maximumAge: 60_000 }
    );
  }, []);

  useEffect(() => {
    if (!toast) return;
    const id = window.setTimeout(() => setToast(null), 3200);
    return () => window.clearTimeout(id);
  }, [toast]);

  useEffect(() => {
    if (timerRemaining == null || timerRemaining <= 0) return;
    const id = window.setInterval(() => {
      setTimerRemaining((value) => (value == null ? null : Math.max(0, value - 1)));
    }, 1000);
    return () => window.clearInterval(id);
  }, [timerRemaining]);

  const readStream = useCallback(async (response: Response) => {
    if (!response.ok || !response.body) throw new Error((await response.text()) || "生成に失敗しました");
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.trim()) continue;
        const event = JSON.parse(line) as StreamEvent;
        if (event.type === "trace" && event.trace) {
          setTraces((current) => [...current.filter((item) => item.agent !== event.trace!.agent), event.trace!]);
        } else if (event.type === "candidate" && event.candidate) {
          setCandidates((current) => [...current, event.candidate!]);
        } else if (event.type === "candidate_decision" && event.candidate_id) {
          setCandidates((current) =>
            current.map((candidate) =>
              candidate.place_id === event.candidate_id ? { ...candidate, accepted: Boolean(event.accepted) } : candidate
            )
          );
        } else if (event.type === "pin" && event.stop) {
          const pin = draftPin(event.stop);
          if (pin) setPins((current) => [...current.filter((item) => item.id !== pin.id), pin]);
        } else if (event.type === "plan" && event.plan) {
          setPlan(event.plan);
          setPins(event.plan.stops);
          setPhase("ready");
        } else if (event.type === "error") {
          throw new Error(event.message || "エージェントが停止しました");
        }
      }
    }
  }, []);

  async function createPlan() {
    setError(null);
    setPhase("planning");
    setPlan(null);
    setCandidates([]);
    setPins([]);
    setTraces([]);
    setCompletedSpotIds(new Set());
    setCurrentSpotIndex(0);
    setEarnedLuck(0);
    setCalendarCommit(null);
    const requestId = crypto.randomUUID();
    const body = {
      request_id: requestId,
      location,
      home_location:
        contextHint === "home" && !profile.homeLocation ? location : profile.homeLocation,
      context_hint: contextHint,
      preferences: {
        duration_minutes: profile.durationMinutes,
        budget_yen: profile.budgetYen,
        transport: profile.transport,
        pace: "normal",
        mood,
        return_buffer_minutes: 25
      },
      now: new Date().toISOString()
    };
    try {
      const response = await fetch("/api/plan/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });
      await readStream(response);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "道草を作れませんでした");
      setPhase("idle");
    }
  }

  async function startPlan() {
    if (!plan) return;
    setError(null);
    setPhase("active");
    try {
      const response = await fetch("/api/calendar/commit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan })
      });
      if (response.ok) {
        const result = (await response.json()) as CalendarCommitResult;
        setCalendarCommit(result);
        setToast(result.demo ? "予定をデモCalendarへ置きました" : "Googleカレンダーへ予定を登録しました");
      } else if (response.status === 409) {
        setToast("Calendar未接続。ルートはそのまま開始できます");
      } else {
        setToast("Calendar登録を省略して開始します");
      }
      await fetch("/api/plans/status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ planId: plan.id, status: "active" })
      });
    } catch {
      setToast("Calendar登録を省略して開始します");
    }
  }

  function arrive() {
    setTimerRemaining(null);
    setPhotoPreview(null);
    setPhase("activity");
  }

  async function completeSpot() {
    if (!plan || !currentSpot) return;
    const nextCompleted = new Set(completedSpotIds);
    nextCompleted.add(currentSpot.id);
    setCompletedSpotIds(nextCompleted);
    setEarnedLuck((value) => value + currentSpot.activity.luck);
    setToast(`+${currentSpot.activity.luck} LUCK`);
    setTimerRemaining(null);
    setPhotoPreview(null);
    if (currentSpotIndex >= plan.stops.length - 1) {
      setPhase("complete");
      const total = plan.luck_total;
      try {
        const response = await fetch("/api/plans/status", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            planId: plan.id,
            status: "completed",
            luckEarned: total,
            calendarEventIds: calendarCommit?.event_ids
          })
        });
        if (response.ok) {
          const result = (await response.json()) as { luckTotal?: number };
          if (result.luckTotal != null) setProfile((current) => ({ ...current, luckTotal: result.luckTotal! }));
        }
      } catch {
        // Completion remains visible even when persistence is unavailable.
      }
    } else {
      setCurrentSpotIndex((index) => index + 1);
      setPhase("active");
    }
  }

  async function requestReplan(reason: ReplanReason) {
    if (!plan) return;
    setSheet("none");
    setToast("ルートを組み直しています");
    try {
      const response = await fetch("/api/replan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          request_id: crypto.randomUUID(),
          plan,
          current_stop_index: currentSpotIndex,
          reason,
          delay_minutes: 15,
          now: new Date().toISOString()
        })
      });
      if (!response.ok) throw new Error(await response.text());
      const next = (await response.json()) as MichikusaPlan;
      setPlan(next);
      setPins(next.stops);
      setCurrentSpotIndex(Math.max(0, Math.min(currentSpotIndex, next.stops.length - 1)));
      if (calendarCommit) {
        const calendarResponse = await fetch("/api/calendar/commit", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ plan: next, existingEventIds: calendarCommit.event_ids })
        });
        if (calendarResponse.ok) setCalendarCommit((await calendarResponse.json()) as CalendarCommitResult);
      }
      setPhase(reason === "go_home" || next.stops.length === 0 ? "complete" : "active");
      setToast(next.title);
    } catch {
      setToast("再計画できませんでした。現在の道草を続けます");
    }
  }

  async function saveSettings() {
    await fetch("/api/profile", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(profile)
    }).catch(() => undefined);
    setSheet("none");
    setToast("条件を保存しました");
  }

  async function openMemories() {
    setSheet("memories");
    try {
      const response = await fetch("/api/memories", { cache: "no-store" });
      const data = (await response.json()) as { plans: MichikusaPlan[] };
      setMemories(data.plans);
    } catch {
      setMemories([]);
    }
  }

  async function shareMemory() {
    if (!plan) return;
    const text = `${plan.share.title}\n${plan.share.theme}\n${plan.share.area_label}・${plan.share.spots} SPOTS・+${plan.share.luck} LUCK\n#MICHIKUSA`;
    if (navigator.share) {
      await navigator.share({ title: "MICHIKUSA", text }).catch(() => undefined);
    } else {
      await navigator.clipboard.writeText(text);
      setToast("共有文をコピーしました");
    }
  }

  async function downloadCard() {
    if (!shareRef.current) return;
    const { toPng } = await import("html-to-image");
    const dataUrl = await toPng(shareRef.current, { pixelRatio: 2, cacheBust: true });
    const link = document.createElement("a");
    link.href = dataUrl;
    link.download = `michikusa-${plan?.id ?? "memory"}.png`;
    link.click();
  }

  function reset() {
    setPhase("idle");
    setPlan(null);
    setPins([]);
    setCandidates([]);
    setTraces([]);
    setCurrentSpotIndex(0);
    setCompletedSpotIds(new Set());
    setEarnedLuck(0);
    setError(null);
  }

  const idleHeadline = contextHint === "home" ? "少しだけ、外へ。" : contextHint === "outside" ? "もうひとつ、寄っていく？" : "行き先は、考えなくていい。";
  const idleAction = contextHint === "home" ? "外に連れ出して" : contextHint === "outside" ? "このまま道草する" : "今日を動かす";

  const progressText = useMemo(() => {
    if (!plan) return "";
    return `${Math.min(currentSpotIndex + 1, plan.stops.length)} / ${plan.stops.length}`;
  }, [plan, currentSpotIndex]);

  return (
    <main className="app-shell">
      <MapCanvas
        current={location}
        candidates={candidates}
        pins={pins}
        plan={plan}
        currentSpotIndex={currentSpotIndex}
        planning={phase === "planning"}
        completedSpotIds={completedSpotIds}
      />

      <header className="app-header">
        <div className="brand-lockup">
          <span className="brand">MICHIKUSA</span>
          <span className="brand-dot" />
        </div>
        <div className="header-actions">
          {phase !== "idle" && <AgentBadge count={traces.length} active={phase === "planning"} onClick={() => setSheet("trace")} />}
          <div className="luck-pill" aria-label={`${profile.luckTotal + earnedLuck} LUCK`}>
            <Sparkles size={14} />
            <strong>{profile.luckTotal + earnedLuck}</strong>
          </div>
          <button className="icon-button icon-button--glass" type="button" onClick={() => setSheet("menu")} aria-label="メニュー">
            <Menu size={20} />
          </button>
        </div>
      </header>

      <div className="location-chip">
        <span className={`location-chip__dot location-chip__dot--${locationMode}`} />
        <span>{location.label ?? "現在地"}</span>
        {locationMode === "demo" && <small>DEMO</small>}
      </div>

      {phase === "planning" && (
        <section className="agent-working" aria-live="polite">
          <div className="agent-orb">
            <span className="agent-orb__core"><Compass size={23} /></span>
            <span className="agent-orb__ring agent-orb__ring--one" />
            <span className="agent-orb__ring agent-orb__ring--two" />
          </div>
          <div>
            <small>AGENT IS MOVING</small>
            <strong>{latestTrace?.label ?? "今いる場所を見ています"}</strong>
            <p>{latestTrace?.message ?? "時間と場所を並行して調べています。"}</p>
          </div>
        </section>
      )}

      {phase === "idle" && (
        <section className="bottom-panel bottom-panel--idle">
          <div className="idle-copy">
            <span className="eyebrow"><Sparkles size={14} /> AI OUTING AGENT</span>
            <h1>{idleHeadline}</h1>
            <p>現在地と空き時間から、行き先・過ごし方・帰る時間まで決めます。</p>
          </div>
          <button className="condition-pill" type="button" onClick={() => setSheet("settings")}>
            <span><Clock3 size={15} />{profile.durationMinutes}分</span>
            <span><WalletCards size={15} />{moneyLabel(profile.budgetYen)}</span>
            <span><TransportGlyph transport={profile.transport} size={15} />{profile.transport === "walk_transit" ? "徒歩＋電車" : profile.transport === "bicycle" ? "自転車" : "徒歩"}</span>
            <Settings2 size={15} />
          </button>
          <button className="primary-action" type="button" onClick={createPlan} disabled={locationMode === "loading"}>
            <Sparkles size={20} />
            <span>{locationMode === "loading" ? "現在地を確認中" : idleAction}</span>
            <ArrowRight size={21} />
          </button>
          <button className="calendar-line" type="button" onClick={() => setSheet("menu")}>
            <CalendarDays size={16} />
            <span>{calendar.connected ? "次の予定までをCalendarから確認" : calendar.demo ? "Calendar連携はデモで確認できます" : "Calendarをつなぐと空き時間も任せられます"}</span>
            <ChevronRight size={16} />
          </button>
          {error && <p className="inline-error"><AlertCircle size={15} />{error}</p>}
        </section>
      )}

      {phase === "ready" && plan && (
        <section className="bottom-panel bottom-panel--ready">
          <div className="ready-head">
            <div>
              <span className="eyebrow"><Route size={14} /> TODAY&apos;S MICHIKUSA</span>
              <h2>{plan.title}</h2>
              <p>{plan.subtitle}</p>
            </div>
            <div className="safety-score"><ShieldCheck size={16} /><strong>{plan.safety.score}</strong></div>
          </div>
          <div className="summary-row">
            <span><Clock3 size={15} />{timeLabel(plan.start_at)}–{timeLabel(plan.return_by)}</span>
            <span><MapPin size={15} />{plan.stops.length} SPOTS</span>
            <span><Sparkles size={15} />+{plan.luck_total}</span>
          </div>
          <div className="mini-timeline">
            {plan.stops.map((stop) => (
              <div key={stop.id} className={`mini-timeline__item mini-timeline__item--${stop.activity.color}`}>
                <span>{stop.order}</span>
                <div><small>{timeLabel(stop.arrival_at)}</small><strong>{stop.activity.short_label}</strong></div>
              </div>
            ))}
          </div>
          <button className="primary-action" type="button" onClick={startPlan}>
            <Navigation size={20} />
            <span>この道草で出発</span>
            <ArrowRight size={21} />
          </button>
          <div className="ready-foot">
            <button type="button" onClick={createPlan}>作り直す</button>
            <button type="button" onClick={() => setSheet("trace")}>エージェントの判断を見る</button>
          </div>
        </section>
      )}

      {phase === "active" && plan && currentSpot && (
        <section className="bottom-panel bottom-panel--active">
          <div className="active-topline">
            <span>NEXT · {progressText}</span>
            <button type="button" onClick={() => setSheet("replan")}><CircleEllipsis size={19} /></button>
          </div>
          <div className="next-place">
            <div className={`spot-number spot-number--${currentSpot.activity.color}`}>{currentSpot.order}</div>
            <div>
              <small>{currentSpot.travel_minutes}分だけ移動</small>
              <h2>{currentSpot.name}</h2>
              <p>{currentSpot.address ?? "次のピンへ向かいます"}</p>
            </div>
          </div>
          <button className="primary-action" type="button" onClick={arrive}>
            <MapPin size={20} />
            <span>着いた</span>
            <ArrowRight size={21} />
          </button>
          {currentSpot.maps_uri ? (
            <a className="map-link" href={currentSpot.maps_uri} target="_blank" rel="noreferrer">Google Mapsで開く <ChevronRight size={15} /></a>
          ) : (
            <a
              className="map-link"
              href={`https://www.google.com/maps/search/?api=1&query=${currentSpot.location.lat},${currentSpot.location.lng}`}
              target="_blank"
              rel="noreferrer"
            >Google Mapsで開く <ChevronRight size={15} /></a>
          )}
        </section>
      )}

      {phase === "activity" && currentSpot && (
        <section className={`bottom-panel activity-card activity-card--${currentSpot.activity.color}`}>
          <div className="activity-icon">
            {(() => {
              const Icon = iconByActivity[currentSpot.activity.icon];
              return <Icon size={27} strokeWidth={1.8} />;
            })()}
          </div>
          <span className="eyebrow">SPOT {currentSpot.order} · +{currentSpot.activity.luck} LUCK</span>
          <h2>{currentSpot.activity.title}</h2>
          <p>{currentSpot.activity.instruction}</p>

          {/* Blob URLs are local-only and are intentionally rendered without Next Image optimization. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {photoPreview && <img className="photo-preview" src={photoPreview} alt="撮影した記録" />}
          <input
            ref={photoInput}
            className="visually-hidden"
            type="file"
            accept="image/*"
            capture="environment"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) setPhotoPreview(URL.createObjectURL(file));
            }}
          />

          {currentSpot.activity.completion_type === "timer" && timerRemaining == null && (
            <button className="primary-action" type="button" onClick={() => setTimerRemaining(8)}>
              <Clock3 size={20} /><span>{currentSpot.activity.duration_minutes}分はじめる</span><ArrowRight size={21} />
            </button>
          )}
          {currentSpot.activity.completion_type === "timer" && timerRemaining != null && timerRemaining > 0 && (
            <div className="mini-timer"><LoaderCircle size={22} /><strong>00:{String(timerRemaining).padStart(2, "0")}</strong><small>デモタイマー</small></div>
          )}
          {currentSpot.activity.completion_type === "timer" && timerRemaining === 0 && (
            <button className="primary-action" type="button" onClick={completeSpot}><Check size={20} /><span>できた</span><Sparkles size={19} /></button>
          )}
          {currentSpot.activity.completion_type === "photo" && !photoPreview && (
            <button className="primary-action" type="button" onClick={() => photoInput.current?.click()}><Camera size={20} /><span>一枚残す</span><ArrowRight size={21} /></button>
          )}
          {currentSpot.activity.completion_type === "photo" && photoPreview && (
            <button className="primary-action" type="button" onClick={completeSpot}><Check size={20} /><span>この一枚で完了</span><Sparkles size={19} /></button>
          )}
          {(["arrival", "tap"] as const).includes(currentSpot.activity.completion_type as "arrival" | "tap") && (
            <button className="primary-action" type="button" onClick={completeSpot}><Check size={20} /><span>見つけた</span><Sparkles size={19} /></button>
          )}
        </section>
      )}

      {phase === "complete" && plan && (
        <section className="completion-layer">
          <div className="completion-scroll">
            <div ref={shareRef} className="share-card">
              <div className="share-card__brand">MICHIKUSA <Sparkles size={15} /></div>
              <div className="share-card__route">
                {plan.stops.map((stop) => (
                  <span key={stop.id} className={`share-pin share-pin--${stop.activity.color}`}>{stop.order}</span>
                ))}
              </div>
              <small>{plan.share.title}</small>
              <h2>{plan.share.theme}</h2>
              <p>{plan.share.area_label}</p>
              <div className="share-stats">
                <span><strong>{plan.share.spots}</strong> SPOTS</span>
                <span><strong>{plan.share.distance_km}</strong> km</span>
                <span><strong>{plan.share.duration_minutes}</strong> min</span>
              </div>
              <div className="call-sign">
                <span>今日の呼び名</span>
                <strong>「{plan.share.call_sign}」</strong>
              </div>
              <div className="share-luck"><Sparkles size={18} /> +{plan.share.luck} LUCK</div>
            </div>
            <div className="completion-actions">
              <button className="primary-action" type="button" onClick={shareMemory}><Share2 size={20} /><span>思い出をシェア</span><ArrowRight size={21} /></button>
              <button className="secondary-action" type="button" onClick={downloadCard}><Download size={18} />カードを保存</button>
              <button className="text-action" type="button" onClick={reset}>もう一度、道草する</button>
            </div>
          </div>
        </section>
      )}

      {toast && <div className="toast" role="status"><Sparkles size={16} />{toast}</div>}

      {sheet === "settings" && (
        <SheetShell title="今日の条件" onClose={() => setSheet("none")}>
          <div className="setting-group">
            <label>いまの状態</label>
            <div className="segmented segmented--three">
              {([
                ["auto", "おまかせ", Compass],
                ["home", "家から", Home],
                ["outside", "外から", MapPin]
              ] as const).map(([value, label, Icon]) => (
                <button key={value} type="button" className={contextHint === value ? "selected" : ""} onClick={() => setContextHint(value)}><Icon size={17} />{label}</button>
              ))}
            </div>
          </div>
          <div className="setting-group">
            <label>使える時間</label>
            <div className="segmented segmented--three">
              {[60, 90, 150].map((value) => (
                <button key={value} type="button" className={profile.durationMinutes === value ? "selected" : ""} onClick={() => setProfile((current) => ({ ...current, durationMinutes: value }))}>{value}分</button>
              ))}
            </div>
          </div>
          <div className="setting-group">
            <label>予算</label>
            <div className="segmented segmented--three">
              {[0, 1000, 3000].map((value) => (
                <button key={value} type="button" className={profile.budgetYen === value ? "selected" : ""} onClick={() => setProfile((current) => ({ ...current, budgetYen: value }))}>{moneyLabel(value)}</button>
              ))}
            </div>
          </div>
          <div className="setting-group">
            <label>移動</label>
            <div className="segmented segmented--three">
              {([
                ["walk", "徒歩", Footprints],
                ["walk_transit", "徒歩＋電車", TrainFront],
                ["bicycle", "自転車", Bike]
              ] as const).map(([value, label, Icon]) => (
                <button key={value} type="button" className={profile.transport === value ? "selected" : ""} onClick={() => setProfile((current) => ({ ...current, transport: value }))}><Icon size={17} />{label}</button>
              ))}
            </div>
          </div>
          <div className="setting-group">
            <label>今日はどんな道草？</label>
            <div className="mood-grid">
              {([
                ["anything", "なんでも", Sparkles],
                ["quiet", "静かに", BookOpen],
                ["discover", "知らない道", Compass],
                ["food", "何か食べる", Coffee],
                ["green", "緑の方へ", Leaf]
              ] as const).map(([value, label, Icon]) => (
                <button key={value} type="button" className={mood === value ? "selected" : ""} onClick={() => setMood(value)}><Icon size={18} />{label}</button>
              ))}
            </div>
          </div>
          <button className="primary-action" type="button" onClick={saveSettings}><Check size={19} /><span>この条件にする</span></button>
        </SheetShell>
      )}

      {sheet === "menu" && (
        <SheetShell title="MICHIKUSA" onClose={() => setSheet("none")}>
          <div className="menu-list">
            <button type="button" onClick={() => setSheet("trace")}><span className="menu-icon menu-icon--purple"><BrainCircuit size={19} /></span><div><strong>エージェント</strong><small>ADKの調査と判断を見る</small></div><ChevronRight size={18} /></button>
            <button type="button" onClick={openMemories}><span className="menu-icon menu-icon--pink"><History size={19} /></span><div><strong>道草の記録</strong><small>これまでのルートを見る</small></div><ChevronRight size={18} /></button>
            <button type="button" onClick={() => window.location.assign("/api/calendar/connect")}><span className="menu-icon menu-icon--green"><CalendarCheck2 size={19} /></span><div><strong>Googleカレンダー</strong><small>{calendar.message}</small></div><ChevronRight size={18} /></button>
            <button type="button" onClick={() => setSheet("settings")}><span className="menu-icon menu-icon--orange"><Settings2 size={19} /></span><div><strong>条件を変える</strong><small>時間・予算・移動手段</small></div><ChevronRight size={18} /></button>
          </div>
          <p className="privacy-note">正確な自宅位置は共有カードへ載せません。Calendarへの登録は「この道草で出発」を押した後だけ行います。</p>
          <p className="legal-links"><a href="/privacy">プライバシーポリシー</a><span>・</span><a href="/terms">利用規約</a></p>
        </SheetShell>
      )}

      {sheet === "trace" && (
        <SheetShell title="エージェントの動き" onClose={() => setSheet("none")}>
          <div className="trace-intro"><BrainCircuit size={22} /><div><strong>Google ADK · 18 workflow nodes</strong><p>再計画7ノード、Calendar実行4ノードも別ワークフローで動きます。</p></div></div>
          <div className="trace-list">
            {(traces.length ? traces : [
              { agent: "situation_agent", label: "状況を読む", message: "家か外か、移動範囲を判定します。", status: "done", color: "pink" },
              { agent: "parallel_scouts", label: "並行して調べる", message: "Calendar、場所、移動、履歴を同時に確認します。", status: "done", color: "purple" },
              { agent: "route_scout", label: "道をつなぐ", message: "帰る余白まで含めてルートを作ります。", status: "done", color: "green" },
              { agent: "action_agent", label: "現実へ反映する", message: "地図、Calendar、記録へ渡します。", status: "done", color: "orange" }
            ] as AgentTraceEvent[]).map((trace, index) => (
              <div key={`${trace.agent}-${index}`} className={`trace-item trace-item--${trace.color}`}>
                <span>{index + 1}</span>
                <div><strong>{trace.label}</strong><p>{trace.message}</p></div>
                {trace.metric && <small>{trace.metric}</small>}
                <Check size={16} />
              </div>
            ))}
          </div>
        </SheetShell>
      )}

      {sheet === "replan" && (
        <SheetShell title="予定が変わった？" onClose={() => setSheet("none")}>
          <div className="replan-list">
            <button type="button" onClick={() => requestReplan("delay")}><Clock3 size={21} /><div><strong>15分遅れている</strong><small>帰る時間を守るように短縮</small></div><ChevronRight size={18} /></button>
            <button type="button" onClick={() => requestReplan("closed")}><AlertCircle size={21} /><div><strong>場所が閉まっていた</strong><small>近くのピンへ差し替え</small></div><ChevronRight size={18} /></button>
            <button type="button" onClick={() => requestReplan("tired")}><Coffee size={21} /><div><strong>少し疲れた</strong><small>休める場所だけ残す</small></div><ChevronRight size={18} /></button>
            <button type="button" onClick={() => requestReplan("go_home")}><Home size={21} /><div><strong>もう帰りたい</strong><small>帰る道に切り替える</small></div><ChevronRight size={18} /></button>
          </div>
        </SheetShell>
      )}

      {sheet === "memories" && (
        <SheetShell title="道草の記録" onClose={() => setSheet("none")}>
          <div className="memory-list">
            {memories.length === 0 ? (
              <div className="empty-state"><History size={26} /><strong>まだ記録はありません</strong><p>一度ルートを作ると、ここに残ります。</p></div>
            ) : memories.map((memory) => (
              <article key={memory.id} className="memory-item">
                <div className="memory-route">{memory.stops.map((stop) => <span key={stop.id} className={`memory-pin memory-pin--${stop.activity.color}`} />)}</div>
                <small>{new Intl.DateTimeFormat("ja-JP", { month: "short", day: "numeric", timeZone: "Asia/Tokyo" }).format(new Date(memory.start_at))}</small>
                <h3>{memory.share.theme}</h3>
                <p>{memory.share.area_label} · {memory.distance_km}km · +{memory.luck_total} LUCK</p>
              </article>
            ))}
          </div>
        </SheetShell>
      )}
    </main>
  );
}
