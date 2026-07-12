# 検証記録

検証日: 2026-07-12

## 静的検査

| 項目 | コマンド | 結果 |
|---|---|---|
| ESLint | `npm run lint` | 通過 |
| TypeScript | `npm run typecheck` | 通過 |
| ADKグラフと審査契約 | `npm run test:agent` | 6件通過 |
| Next.js build | `npm run build` | 通過、16ルート生成 |
| npm audit | `npm audit --omit=dev --audit-level=high` | 重大度high以上0件 |
| Shell構文 | `bash -n deploy.sh` | 通過 |

## ADKテスト

- 計画ストリームが18ノード以上を返す。
- 90分で2〜4地点を返す。
- 家と外でモードが分かれる。
- Calendarデモが全下書きイベントを処理する。
- 4種類の再計画後も帰宅上限を守る。
- `live`はGeminiとMapsの両方が実接続の場合だけ返す。
- 予算、営業時間、夜間、帰宅時刻の安全チェックを含む。
- 共有データへ正確な緯度経度を含めない。

## 実行検査

| 項目 | 結果 |
|---|---|
| Agent health | `demo_mode=true`, ADK 2.4.0を確認 |
| Web health | HTTP 200、sanitized Agent状態を確認 |
| Plan NDJSON | 56イベント、36 trace、2地点を確認 |
| Calendarデモ | 5イベント作成、未接続表示を確認 |
| Replan | 遅延再計画後もreturn guard通過 |
| Turso/local libSQL保存 | schema作成とplan status更新を確認 |
| 390pxブラウザ導線 | 7画面完走、スクリーンショット保存 |
| 1440pxブラウザ導線 | 2カラム表示と7画面完走 |
| Console error | mobile/desktopとも0件 |
| Failed request | mobile/desktopとも0件 |
| Secret scan | コミット前に再実行 |

実行コマンド:

```bash
npm run verify
CHROMIUM_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  E2E_BASE_URL=http://localhost:3100 npm run test:e2e
CHROMIUM_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  E2E_BASE_URL=http://localhost:3100 E2E_LAYOUT=desktop \
  E2E_OUTPUT_DIR=artifacts-desktop npm run test:e2e
npm audit --omit=dev --audit-level=high
```

## 本番検証

Cloud Runデプロイ後に、公開URL、revision、live health、実plan source、再計画の結果を追記する。

## 実認証が必要なため別途確認する項目

- Cloud Runへの実配置
- Agent Platform上のGemini応答
- Places APIの実候補
- Routes APIの実経路
- Google OAuthと実Calendar書き込み
- Tursoクラウドへの実保存
