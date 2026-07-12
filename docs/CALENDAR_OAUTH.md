# Google Calendar連携

## 1. Calendarの役割

Calendarは保存先だけではありません。

- 入力: 今日の空き時間と次の予定を知る。
- 出力: AIが決めた移動・滞在・帰宅を時間割として置く。
- 再計画: 遅延や休業後に既存イベントを更新する。

## 2. OAuthスコープ

```text
https://www.googleapis.com/auth/calendar.freebusy
https://www.googleapis.com/auth/calendar.app.created
```

`calendar.freebusy`は予定タイトルを取得せず、埋まっている時間帯だけを確認します。`calendar.app.created`はMICHIKUSAが作成したCalendarとイベントを扱うために使います。

## 3. 接続フロー

```text
GET /api/calendar/connect
  stateを生成しHttpOnly Cookieへ保存
  Google OAuthへリダイレクト

GET /api/calendar/callback
  code/stateを受信
  Cookieのstateと一致確認
  token endpointで交換
  AES-256-GCMで暗号化してTursoへ保存
```

アクセストークンの期限が近い場合は、保存済みリフレッシュトークンで更新します。

## 4. 人の承認

Plan生成時にはCalendarへ書き込みません。

```text
AIがPlanを作る
↓
ユーザーが内容と帰宅目安を確認
↓
「この道草で出発」
↓
Calendar実行グラフ
```

OAuth未接続の場合でも、道草自体は開始できます。

## 5. イベント構造

例:

```json
{
  "summary": "MICHIKUSA｜小さな選書室へ移動",
  "start": { "dateTime": "2026-07-11T14:05:00+09:00" },
  "end": { "dateTime": "2026-07-11T14:18:00+09:00" },
  "location": "駅から少し離れた通り",
  "description": "AIが組み立てた道草ルートの移動時間です。",
  "extendedProperties": {
    "private": {
      "michikusaEventId": "cal-spot-1-travel",
      "michikusaKind": "travel"
    }
  }
}
```

Planには次の種類を含めます。

- `travel`: 次の地点への移動
- `spot`: 現地での遊び
- `return`: 帰宅または終了地点への移動

## 6. 再計画

初回登録のイベントIDをTursoとブラウザ状態へ保存します。再計画後は同じIDをAgentへ渡し、対応するイベントを`events.update`で更新します。

地点数が減った場合の提出版では、残ったイベントを更新します。運用版では、余った旧イベントを明示的に削除またはキャンセル表示へ変更する処理を追加します。

## 7. Google Cloud Console設定

1. Calendar APIを有効化する。
2. OAuth同意画面を設定する。
3. Web applicationのOAuth Clientを作る。
4. Redirect URIを登録する。

ローカル:

```text
http://localhost:3000/api/calendar/callback
```

Cloud Run:

```text
https://<michikusa-web-url>/api/calendar/callback
```

5. Client ID/SecretをSecret Managerへ保存する。
