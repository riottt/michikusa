# Google Cloud構築手順

## 1. 配置構成

- `michikusa-web`: 公開Cloud Runサービス
- `michikusa-agent`: 非公開Cloud Runサービス
- Artifact Registry: 2つのコンテナ
- Cloud Build: ビルドとpush
- Secret Manager: APIキー、OAuth、Turso、内部シークレット
- Agent Platform / Gemini: ADKのLLMノード
- Places API (New)
- Routes API
- Calendar API

## 2. API有効化

`deploy.sh`でも実行します。

```bash
gcloud services enable \
  run.googleapis.com \
  artifactregistry.googleapis.com \
  cloudbuild.googleapis.com \
  secretmanager.googleapis.com \
  aiplatform.googleapis.com \
  places.googleapis.com \
  routes.googleapis.com \
  calendar-json.googleapis.com
```

Maps JavaScript APIはGoogle Cloud ConsoleでBrowser keyと合わせて有効化します。

## 3. Secret Manager

次のSecretを作成します。

```text
michikusa-agent-shared-secret
michikusa-maps-server-key
michikusa-oauth-client-id
michikusa-oauth-client-secret
michikusa-token-encryption-key
michikusa-turso-url
michikusa-turso-token
```

例:

```bash
printf '%s' 'long-random-value' | \
  gcloud secrets create michikusa-agent-shared-secret --data-file=-
```

既存Secretへ新しい版を追加する場合:

```bash
printf '%s' 'new-value' | \
  gcloud secrets versions add michikusa-agent-shared-secret --data-file=-
```

## 4. サービスアカウント

```text
michikusa-web@PROJECT_ID.iam.gserviceaccount.com
michikusa-agent@PROJECT_ID.iam.gserviceaccount.com
```

Agent側にはGeminiを呼ぶ権限、両方には必要なSecretへのアクセス権を与えます。Webサービスアカウントだけに、非公開Agentサービスの`roles/run.invoker`を付けます。

## 5. Mapsキー

### Browser key

- Maps JavaScript APIだけを許可
- Cloud Run URLと独自ドメインをHTTPリファラーへ登録
- 日次上限とアラートを設定

### Server key

- Places API (New)とRoutes APIだけを許可
- Secret ManagerからAgentへ渡す
- `NEXT_PUBLIC_`を付けない

## 6. Calendar OAuth

1. OAuth同意画面を設定する。
2. Web application Clientを作成する。
3. ローカルURIを登録する。
4. Cloud Run配置後、Web URLのcallback URIを追加する。
5. Client ID/SecretをSecret Managerへ保存する。

## 7. 配置

```bash
export GOOGLE_CLOUD_PROJECT="your-project-id"
export REGION="asia-northeast1"
export AGENT_PLATFORM_LOCATION="global"
export NEXT_PUBLIC_GOOGLE_MAPS_API_KEY="browser-key"
export NEXT_PUBLIC_GOOGLE_MAP_ID="map-id"

./deploy.sh
```

処理:

1. API有効化
2. Artifact Registry作成
3. サービスアカウント作成
4. Cloud Buildで2イメージ作成
5. 非公開Agentを配置
6. WebへAgent invoke権限を付与
7. 公開Webを配置
8. Web URLとOAuth callback環境変数を更新

## 8. Cloud Run間認証

WebはMetadata ServerからAgent URL向けのIDトークンを取得し、標準の`Authorization: Bearer <ID_TOKEN>`ヘッダーへ入れます。Agent側のCloud Run IAM検査に加え、アプリ層で`X-Michikusa-Secret`も照合します。

## 9. デプロイ後の確認

```bash
WEB_URL=$(gcloud run services describe michikusa-web \
  --region asia-northeast1 --format='value(status.url)')

curl "$WEB_URL/api/health"
```

確認項目:

- `web: ok`
- `database: ok`
- Agent healthが返る
- Mapsが表示される
- Calendar OAuth callbackが一致する
- 「この道草で出発」でCalendarへ予定が入る
- 遅延再計画後、既存予定が更新される

## 10. 課金と運用

- Cloud Runは`deploy.sh`の既定で最小0・最大1インスタンス。増やす場合は`MAX_INSTANCES`を明示してから行う。
- PlacesのFieldMaskを必要項目に限定する。
- 候補取得は一回20件以内にする。
- Next.js側で、計画生成と再計画をセッションごとに10分3回・IPごとに10分12回へ制限する。
- Cloud Billingでプロジェクト単位の月額Budget Alertを作成する。Budgetは通知のみで自動停止しないため、Cloud Run上限とAPIキー制限を併用する。
- Cloud LoggingでAgentのエラー率とレイテンシを確認する。
