# 検証記録

このファイルは、提出ZIP作成時の実行結果で更新します。

## 静的検査

| 項目 | コマンド | 結果 |
|---|---|---|
| ESLint | `npm run lint` | 通過 |
| TypeScript | `npm run typecheck` | 通過 |
| ADKグラフ | `npm run test:agent` | 4件通過 |
| Next.js build | `npm run build` | 未記入 |
| npm audit | `npm audit --omit=dev --audit-level=high` | 未記入 |

## ADKテスト

- 計画ストリームが18ノード以上を返す。
- 90分で2〜4地点を返す。
- 家と外でモードが分かれる。
- Calendarデモが全下書きイベントを処理する。
- 4種類の再計画後も帰宅上限を守る。

## 実行検査

| 項目 | 結果 |
|---|---|
| Agent health | 未記入 |
| Web health | 未記入 |
| Plan NDJSON | 未記入 |
| Calendarデモ | 未記入 |
| Replan | 未記入 |
| Turso/local libSQL保存 | 未記入 |
| 390pxブラウザ導線 | 未記入 |
| Console error | 未記入 |
| ZIP展開検査 | 未記入 |
| Secret scan | 未記入 |

## 実認証が必要なため別途確認する項目

- Cloud Runへの実配置
- Agent Platform上のGemini応答
- Places APIの実候補
- Routes APIの実経路
- Google OAuthと実Calendar書き込み
- Tursoクラウドへの実保存
