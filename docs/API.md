# API仕様

## Web API

### GET `/api/health`

Web、DB、Agentの状態を返す。

### POST `/api/plan/stream`

入力:

```json
{
  "request_id": "uuid",
  "location": { "lat": 34.702485, "lng": 135.495951, "label": "大阪・梅田" },
  "home_location": null,
  "context_hint": "outside",
  "preferences": {
    "duration_minutes": 90,
    "budget_yen": 1500,
    "transport": "walk_transit",
    "pace": "normal",
    "mood": "anything",
    "return_buffer_minutes": 25
  },
  "now": "2026-07-11T14:00:00+09:00"
}
```

出力: NDJSON

```json
{"type":"run_started","workflow":"michikusa_plan_workflow"}
{"type":"trace","trace":{"agent":"place_scout_agent","status":"running"}}
{"type":"candidate","candidate":{"name":"候補地点"}}
{"type":"pin","stop":{"order":1}}
{"type":"plan","plan":{"id":"...","stops":[]}}
```

### POST `/api/replan`

```json
{
  "request_id": "uuid",
  "plan": {},
  "current_stop_index": 0,
  "reason": "delay",
  "delay_minutes": 15,
  "now": "2026-07-11T15:00:00+09:00"
}
```

`reason`:

- `delay`
- `closed`
- `tired`
- `go_home`

### GET `/api/calendar/status`

OAuth接続状態を返す。

### GET `/api/calendar/connect`

OAuthを開始する。

### GET `/api/calendar/callback`

OAuth codeをtokenへ交換し、暗号化して保存する。

### GET `/api/calendar/availability`

Query:

```text
start=<ISO datetime>
end=<ISO datetime>
```

freeBusyを返す。

### POST `/api/calendar/commit`

```json
{
  "plan": {},
  "existingEventIds": []
}
```

初回はeventを作成し、再計画ではexisting event IDを更新する。

### GET / POST `/api/profile`

匿名セッションの設定とLUCKを取得・保存する。

### GET `/api/memories`

過去のプランを返す。

## Agent API

Agent APIはCloud Runで非公開にする。

認証:

```http
X-Michikusa-Secret: <secret>
```

Cloud Runではさらに標準の `Authorization: Bearer <ID_TOKEN>` が必要。

### GET `/health`

共有シークレット不要。サービス稼働だけを返す。

### GET `/v1/capabilities`

ADKバージョン、ノード数、連携状態を返す。

### POST `/v1/plan`

最終Planだけを返す。

### POST `/v1/plan/stream`

NDJSONでtrace、candidate、pin、planを返す。

### POST `/v1/replan`

再計画後のPlanを返す。

### POST `/v1/replan/stream`

再計画のtraceを含むNDJSONを返す。

### POST `/v1/calendar/commit`

専用Calendarを作成または再利用し、eventを作成・更新する。
