# ローカル起動手順

## 1. 必要な環境

```text
Node.js 22以上
Python 3.11以上
npm
```

確認:

```bash
node --version
python3 --version
npm --version
```

## 2. 初回

```bash
npm ci
npm run setup
npm run dev
```

ブラウザで`http://localhost:3000`を開きます。

`npm run dev`は次を同時起動します。

- Next.js: 3000
- FastAPI / Google ADK: 8081

## 3. デモモード

`.env.local`の初期値は次です。

```dotenv
DEMO_MODE=true
NEXT_PUBLIC_DEMO_MODE=true
```

外部認証情報は不要です。ブラウザの位置情報を拒否した場合は、大阪・梅田のデモ座標を使います。

確認できる導線:

1. 今日を動かす
2. 18ノードの実行表示
3. ピンとルート生成
4. Calendar疑似登録
5. 現地アクティビティ
6. LUCK獲得
7. 遅延などの再計画
8. 共有カード

## 4. 個別起動

```bash
npm run dev:agent
npm run dev:web
```

## 5. 検証

```bash
npm run lint
npm run typecheck
npm run test:agent
npm run build
```

起動した状態で:

```bash
npm run test:smoke
npm run preview:screenshot
```

## 6. 実API

`.env.local`へ設定後、`DEMO_MODE=false`にします。

Maps browser keyとserver keyは分けます。

- Browser key: HTTPリファラー制限、Maps JavaScript APIのみ
- Server key: Places API / Routes APIのみ、必要ならCloud Run出口制限

GeminiはCloud Run上ではサービスアカウントを使います。ローカルでは`gcloud auth application-default login`またはDeveloper API keyを使えます。

## 7. よくある問題

### Python環境がない

```bash
rm -rf .venv
npm run setup
```

### 8081が使用中

```bash
AGENT_PORT=8082 npm run dev:agent
AGENT_SERVICE_URL=http://127.0.0.1:8082 npm run dev:web
```

### 地図が白い

Browser keyがない場合はデモ地図を表示します。実Google Mapsを使う場合は、キーのHTTPリファラーとMaps JavaScript APIの有効化を確認します。

### Calendarがデモのまま

Client ID/Secret、Redirect URI、OAuth同意画面を確認し、メニューから再接続します。

### TursoではなくローカルDBを使いたい

```dotenv
TURSO_DATABASE_URL=file:data/michikusa.db
TURSO_AUTH_TOKEN=
```
