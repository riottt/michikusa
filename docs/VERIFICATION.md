# 検証記録

検証日: 2026-07-13

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

検証日時: 2026-07-13 JST

| 項目 | 結果 |
|---|---|
| Canonical Public Web | `https://michikusa-web-jfgzddrn7a-an.a.run.app`（ハッカソン提出URL） |
| Deployed source | reviewed `origin/main` SHA `5948860` |
| Web revision | `michikusa-web-00012-kqp`、100% traffic |
| Agent revision | `michikusa-agent-00015-dc5`、非公開、100% traffic |
| Health | Web/database/planning `ok`、Public Web HTTP 200 |
| Agent runtime | `demo_mode=false`, ADK 2.4.0 |
| Provider | `maps_live=true`, `gemini_live=true` |
| Live plan | `REQUIRE_LIVE=true`で`source=live`とRoutes encoded geometryまで通過 |
| Calendar | 未接続sessionの期待されたHTTP 409と接続要求本文をsigned smokeで確認。成功パスは全`event_ids`を契約テストで維持 |
| Replan | signed GREEN/FINALでRoutes geometry更新とreturn guard通過 |
| Browser | duplicate key quarantine後のfresh sessionで`renderer=google`、`routeSource=routes-api`、`LIVE DATA`、fallbackなし |
| Post-quarantine live smoke | health providers live、3 spots / 60 events / 36 traces、Calendar expected disconnected、replan 3 remaining・return guard通過 |
| Access control | Public Web HTTP 200、未認証Agent HTTP 403 |
| Scale | Web/Agentともservice・revisionのmin 0 / max 1 |
| Harness | iteration 1のsigned live smoke成功後、iteration 2でsigned RED/GREEN `test:quarantine`とsigned FINAL `verify`を記録。GREENとFINALは成功 |

本番スモーク:

```bash
SMOKE_BASE_URL="https://michikusa-web-jfgzddrn7a-an.a.run.app" \
  REQUIRE_LIVE=true npm run test:smoke
```

初回GREENで判明したCalendar未接続409の判定を修正後、提出先でsigned GREENとFINAL、本番browser確認、cost/security readbackまで完了した。確認用に作成したtarget旧revision tagは削除し、一時credentialとdeployment worktreeも残していない。

旧重複環境 `michikusa-hackathon-20260712` は削除せず、rollback可能な状態で公開停止した。Web revision `michikusa-web-00008-q49`とAgent revision `michikusa-agent-00004-4vv`はいずれも未認証HTTP 403で、public WebおよびWeb-to-Agentのinvoker bindingを除去済み。duplicate Agent service accountの`roles/aiplatform.user`を除去し、`aiplatform.googleapis.com`、`maps-backend.googleapis.com`、`places.googleapis.com`、`routes.googleapis.com`をdisabledにした。browser keyはMaps APIだけかつ`https://disabled.invalid/*`だけ、server keyはPlaces/Routesだけかつserver allowed IP `192.0.2.1/32`だけに制限した。

ユーザー指定のno-delete方針に従い、両Cloud Run service/revisionはmin 0 / max 1で保持し、Secret Manager metadata、browser/server API key resource、container imageも削除していない。iteration 2のsigned RED `test:quarantine`は空IAM projectionの`null`を検出して非zeroとなり、collectorを安全に正規化した上でremediation後のsigned GREEN `test:quarantine`が成功した。signed FINAL `verify`も成功している。

Maps JavaScript APIの非同期ローダー推奨とlegacy Marker非推奨のwarningは残るが、console errorとfailed requestは発生していない。

## Cost / security verification

- `npm run test:cost`: LibSQLの原子的な全体10分・JST日次枠、上限更新、JSON Content-Type/64 KiB境界、Agentのprovider-free demo、Gemini生成上限を検証する。
- `npm run test:quarantine`: project `michikusa-hackathon-20260712`・region `asia-northeast1`へ固定したread-only verifier。Vertex role、4つの課金API、sanitized key restriction、Cloud Run IAM/scale、公開HTTP 403を確認し、key stringやsecret値は取得・表示しない。
- `npm run test:quarantine:contracts`: 正常なquarantine、reviewer指摘のhigh-risk状態、誤project/region、key/IAM/scale/HTTP違反、projected `null`の安全な正規化をpure testで検証する。
- `npm run verify`: lint、typecheck、harness、smoke/quarantine contracts、cost/map/agent tests、security check、production buildをまとめて実行する。
- 本番readbackではCloud Runのservice/revision max=1、min=0、Agent concurrency<=2、Web SAだけのAgent invoker、cost guard環境変数名、Budget project filter、API quota、API key restrictionsを確認する。
- Budget Alertは通知だけで支出を止めない。hard controlは永続live枠、Cloud Run max、Maps/Places/Routes quotaで行う。

## Map and route fidelity

- Google Mapsの標準basemapを使い、道路名、駅、地域名、POIを隠す独自styleは適用しない。
- live planはRoutes APIの`HIGH_QUALITY` encoded polylineを返し、Webはそれを復号して道路沿いの座標列を描画する。`route_points`と単純なwaypoint列はprovider geometryがない場合だけ使う。
- WALKは屋内経路を避ける設定を優先し、BICYCLEは自転車routeを要求する。alternative routeは要求せず、1 plan/replanあたりRoutes callは最大1回を維持する。
- replanは古いencoded polylineを保持せず、残ったstop集合から再計算する。stopがない場合はgeometryを消す。
- live browser確認では`.google-map[data-map-renderer="google"]`、`data-route-source="routes-api"`、`data-route-point-count > origin + stops`、標準地図label、console/network errorなしを確認する。

## 実認証が必要なため別途確認する項目

- Google OAuthと実Calendar書き込み
