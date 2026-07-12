# MICHIKUSA

**行きたい場所がない日に、出かける理由をつくるAI外出エージェント。**

MICHIKUSAは、現在地・空き時間・予算・移動手段・Googleカレンダーの予定をもとに、AIがその場限りの道草ルートを組み立てるスマホ対応Webアプリです。候補一覧を比較させるのではなく、行き先、順番、各地点での過ごし方、帰る時刻まで一つのタイムラインにします。

家にいて一日を始められない時は、生活圏を少し越える外出を作ります。外出中に次の行き先を失った時は、帰宅方向を崩さない短い寄り道を作ります。

> 行き先は考えなくていい。行くかどうかだけ、決めて。

## 体験の流れ

1. 地図上の「今日を動かす」を押す。
2. Google ADKのグラフが、Calendar・場所・移動範囲・履歴を並行して確認する。
3. 地図へ2〜4個のピンとルートが順番に現れる。
4. 「この道草で出発」を押すと、移動と滞在の予定をGoogleカレンダーへまとめて登録する。
5. 各地点で「読む」「撮る」「聴く」「休む」など一つの遊びを行い、LUCKを得る。
6. 遅延、休業、疲労、帰宅希望が発生した場合は、残りのルートとCalendar予定を組み直す。
7. 正確な自宅位置を含めない共有カードを作る。

## 技術構成

```text
Mobile browser / PWA
        │
        ▼
Next.js 16 Web API + UI
Cloud Run: michikusa-web
        │  private service-to-service request
        ▼
Google ADK 2.4 graph workflows + FastAPI
Cloud Run: michikusa-agent
        ├─ Gemini on Google Cloud Agent Platform
        ├─ Google Places API (New)
        ├─ Google Routes API
        └─ Google Calendar API

Next.js server
        └─ Turso / local libSQL
```

### ADKワークフロー

- 計画生成: 18ノード、うち4探索ノードを並列実行
- 再計画: 7ノード、うち3観測ノードを並列実行
- Calendar反映: 4ノード
- LLMノード: 現地での遊びの生成、共有カード用の呼び名生成
- 決定的ノード: 状況判定、候補評価、経路構成、安全確認、Calendar下書き、再計画

生成AIに全判断を任せず、営業時間、予算、帰宅時刻、夜間の場所選定は検査可能なコードで制御しています。

## ローカル起動

### 前提

- Node.js 22以上
- Python 3.11以上
- npm

### 1. 依存関係とローカル環境を作る

```bash
npm ci
npm run setup
```

`npm run setup`は次を行います。

- `.env.example`から`.env.local`を作成
- `.venv`を作成
- Google ADKとFastAPIの依存関係を導入
- ローカルlibSQLのスキーマを作成

### 2. Webとエージェントを同時に起動する

```bash
npm run dev
```

- Web: `http://localhost:3000`
- Agent API: `http://localhost:8081`
- Agent health: `http://localhost:8081/health`

初期状態は`DEMO_MODE=true`です。APIキーなしで、地図、ADKグラフ、Calendar登録のデモ経路、再計画、LUCK、共有カードまで操作できます。

## 実APIへ切り替える

`.env.local`を編集します。

```dotenv
DEMO_MODE=false
NEXT_PUBLIC_DEMO_MODE=false

NEXT_PUBLIC_GOOGLE_MAPS_API_KEY=...
NEXT_PUBLIC_GOOGLE_MAP_ID=...
GOOGLE_MAPS_SERVER_API_KEY=...

GOOGLE_GENAI_USE_ENTERPRISE=true
GOOGLE_CLOUD_PROJECT=your-project-id
GOOGLE_CLOUD_LOCATION=global
GEMINI_MODEL=gemini-2.5-flash

GOOGLE_OAUTH_CLIENT_ID=...
GOOGLE_OAUTH_CLIENT_SECRET=...
GOOGLE_OAUTH_REDIRECT_URI=http://localhost:3000/api/calendar/callback
TOKEN_ENCRYPTION_KEY=long-random-secret

TURSO_DATABASE_URL=libsql://...
TURSO_AUTH_TOKEN=...
```

Googleカレンダーは、画面左上のメニューから接続します。Calendarへ書き込むのは、ユーザーが「この道草で出発」を押した後です。

## 主なコマンド

```bash
npm run lint             # ESLint
npm run typecheck        # TypeScript
npm run test:agent       # ADKグラフのpytest
npm run build            # Next.js本番ビルド
npm run verify           # 上記をまとめて実行
npm run test:smoke       # 起動中サービスへのAPIスモークテスト
npm run preview:screenshot
npm run db:migrate
```

## Cloud Runへの配置

2つのCloud Runサービスとして配置します。

```bash
export GOOGLE_CLOUD_PROJECT="your-project-id"
export REGION="asia-northeast1"
./deploy.sh
```

`deploy.sh`はArtifact Registry、Cloud Build、Secret Manager、サービスアカウント、非公開Agentサービス、公開Webサービスを構成します。Google OAuthのリダイレクトURIだけは、発行されたWeb URLをGoogle Cloud Consoleへ登録してください。

詳しい手順は[`docs/GOOGLE_CLOUD_SETUP.md`](docs/GOOGLE_CLOUD_SETUP.md)にあります。

## ディレクトリ

```text
src/
  app/                         Next.js App RouterとRoute Handlers
  components/                  地図中心のモバイルUI
  lib/                         Calendar OAuth、Turso、Agent接続、暗号化
  types/                       Web側の共有型
agent_service/
  michikusa_agent/
    workflow.py                ADKグラフ3系統
    runtime.py                 ADK RunnerとNDJSONイベント変換
    server.py                  FastAPI Agent API
    services/                  Places、Routes、Calendar、デモモデル
  tests/                       グラフ契約テスト
scripts/                       セットアップ、起動、検証、撮影
docs/                          設計、計画、デプロイ、デモ台本
```

## 設計資料

- [プロダクト仕様](docs/PRODUCT_SPEC.md)
- [実装計画書](docs/IMPLEMENTATION_PLAN.md)
- [システム構成](docs/ARCHITECTURE.md)
- [ADKエージェント設計](docs/AGENT_DESIGN.md)
- [Google Calendar OAuth](docs/CALENDAR_OAUTH.md)
- [ローカル起動](docs/LOCAL_SETUP.md)
- [Google Cloud構築](docs/GOOGLE_CLOUD_SETUP.md)
- [APIリファレンス](docs/API_REFERENCE.md)
- [審査デモ台本](docs/DEMO_SCRIPT.md)
- [検証記録](docs/VERIFICATION.md)

## 公開リポジトリで扱わないもの

- `.env.local`
- Gemini、Maps、Turso、OAuthの認証情報
- Calendarのアクセストークンとリフレッシュトークン
- ローカルDB
- `.next`、`.venv`、`node_modules`
- 実住所を含む共有カード

CalendarトークンはAES-256-GCMで暗号化してTursoへ保存します。Webから非公開AgentサービスへはCloud RunのIDトークンと共有シークレットを併用できます。
