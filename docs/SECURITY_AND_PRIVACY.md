# セキュリティと位置情報

## 公開リポジトリ

次をコミットしない。

- `.env`
- `.env.local`
- Google APIキー
- OAuth client secret
- Turso token
- Calendar access / refresh token
- Secret Managerの値
- 実ユーザーの位置履歴
- ローカルDB

`.gitignore` と `.dockerignore` で除外しています。

確認例:

```bash
git grep -nE "AIza|Bearer |TURSO_AUTH_TOKEN|GOOGLE_OAUTH_CLIENT_SECRET|refresh_token"
git diff --cached
```

## APIキー

### ブラウザ用Mapsキー

ブラウザへ配信されるため、秘密として扱えません。Google Cloud側で次を設定します。

- HTTPリファラー制限
- 本番ドメインとlocalhostだけを許可
- Maps JavaScript APIだけを許可
- 予算アラートと割り当て上限

### サーバー用Mapsキー

Secret Managerに保存し、Places APIとRoutes APIだけを許可します。ブラウザへ渡しません。

## Agent Cloud Run

- `--no-allow-unauthenticated`
- Webサービスアカウントだけに `roles/run.invoker`
- Google署名IDトークンを `X-Serverless-Authorization` へ設定
- 共有シークレットを `X-Michikusa-Secret` へ設定

## Google Calendar

OAuthスコープ:

```text
calendar.freebusy
calendar.app.created
```

- 既存Calendarの予定本文を取得しない
- freeBusyだけを入力に使う
- MICHIKUSA専用の副Calendarだけへ書く
- 書き込みは「この道草で出発」の後
- 再計画は既に作成したeventだけを更新

OAuth tokenはTursoへ平文保存しません。

```text
AES-256-GCM
  ├─ random IV
  ├─ authentication tag
  └─ encrypted payload
```

暗号鍵はSecret Managerへ保存します。

## セッション

- ランダムUUID
- HTTP-only Cookie
- SameSite=Lax
- 本番はSecure
- 1年で期限切れ

ログインを作らないため、端末を変えた履歴同期は今回の範囲外です。

## 位置情報

### 取得

ブラウザのGeolocation APIを、ユーザー許可後に使用します。拒否時はデモ位置で動作します。

### 保存

プランには出発点と立ち寄り地点を含みます。本番運用では次を追加検討します。

- 保存期間
- 削除API
- 緯度経度の丸め
- ホーム位置の別暗号化
- 履歴の自動削除

### 共有

共有カードへ次を載せません。

- 自宅の正確な座標
- 正確な出発地点
- 住所
- Calendarの予定名
- OAuth情報

エリア名と抽象ルートだけを使います。

## 入力検査

Web:

- Zod
- 位置座標範囲
- 時間20〜300分
- 予算0〜20,000円
- request ID長
- replan indexと遅延上限

Agent:

- Pydantic
- 構造化Plan
- SafetyReport
- Calendar event schema

## レート制御

費用の発生し得る操作は、匿名セッションごと・IPアドレスごとに制限しています。計画生成・再計画はセッションごとに10分3回、IPごとに10分12回です。カレンダー確定も同様に、セッションごとに10分6回、IPごとに10分24回へ制限しています。

現状はプロセスメモリ方式です。複数Cloud Runインスタンスへ広げる運用では、TursoまたはRedis系の共有ストアへ置き換えます。

## HTTPヘッダー

- `X-Content-Type-Options: nosniff`
- `Referrer-Policy: strict-origin-when-cross-origin`
- `Permissions-Policy`
- `X-Frame-Options: DENY`

本番ではContent Security Policyも追加候補です。Google Mapsのscript、画像、接続先を含めた許可リストを作ります。

## 課金APIの多層ガード

公開環境では、セッション/IPの短時間制限に加えて、Tursoの`costly_request_counters`で全体10分枠とAsia/Tokyo日次枠を原子的に確保します。既定のlive plan枠は10分10回・1日40回です。Cloud Runのcold startや再デプロイでもカウンタは失われません。

日次枠または永続ストア障害時のplanは、Gemini・Places・Routesを呼ばない明示的なdemo/fallbackへ降格します。replanとCalendarの枠超過は429で拒否します。Geminiの2ノードは単一候補、512/256 output token、30/20秒timeoutです。

クラウド側では、両Cloud Run serviceをmin 0、service/revision max 1にし、Agent concurrencyを2にします。Maps JavaScript map loadsは500/日、Places SearchNearbyとRoutes ComputeRoutesは各100/日を上限目安にします。月額500 JPYのproject専用Budget Alertは通知であり、自動停止装置ではありません。

緊急停止は、対象APIのquotaを0へ下げるか、Agentの`DEMO_MODE=true`で再デプロイします。復旧時はquota metricとunitをreadbackしてから元の値へ戻します。

## 残る課題

- OAuth公開時のGoogle検証
- 位置履歴の削除画面
- 実地の危険区域データ
- 深夜帯や災害時の停止条件
- 店舗の臨時休業精度
- 多インスタンス対応レート制御
- Cloud Audit Logsとアラート
