# APIリファレンス

## Web API

### `GET /api/health`

Web、DB、Agentの状態を返します。

### `POST /api/plan/stream`

入力:

```json
{
  "request_id": "uuid",
  "location": { "lat": 34.702485, "lng": 135.495951, "label": "現在地" },
  "home_location": null,
  "context_hint": "auto",
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

出力は`application/x-ndjson`です。

### `POST /api/replan`

```json
{
  "request_id": "uuid",
  "plan": {},
  "current_stop_index": 0,
  "reason": "delay",
  "delay_minutes": 15,
  "now": "2026-07-11T14:30:00+09:00"
}
```

`reason`: `delay | closed | tired | go_home`

### `POST /api/calendar/commit`

```json
{
  "plan": {},
  "existingEventIds": []
}
```

OAuth未設定のローカルではデモ領収書を返します。OAuth設定済みで未接続の場合は409です。

### Calendar OAuth

```text
GET /api/calendar/connect
GET /api/calendar/callback
GET /api/calendar/status
POST /api/calendar/disconnect
GET /api/calendar/availability
```

### Profile / Plans

```text
GET|POST /api/profile
GET /api/memories
POST /api/plans/status
GET|POST /api/plans
```

## Agent API

Agent APIは`X-Michikusa-Secret`を要求します。Cloud Runでは追加でIAM認証を使います。

### `GET /health`

公開health endpointです。

### `GET /v1/capabilities`

ADK版、各Workflowノード数、実API接続状態を返します。

### `POST /v1/plan`

同期的にPlanを返します。

### `POST /v1/plan/stream`

NDJSONでAgentイベントとPlanを返します。

### `POST /v1/replan`

更新済みPlanを返します。

### `POST /v1/replan/stream`

再計画ノードのNDJSONとPlanを返します。

### `POST /v1/calendar/commit`

Calendar実行Workflowを動かし、作成・更新結果を返します。
