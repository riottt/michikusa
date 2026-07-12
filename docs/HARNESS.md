# MICHIKUSA Delivery Harness

このハーネスは、計画・実装・レビューを3つの宣言roleに分け、証拠が揃う前に次工程へ進めないrepo-localワークフローです。Codexの子エージェント自動起動は行いません。

各artifactには `role`、`actor_id`、`task_slug`、`iteration` が必要です。これはdeclared provenanceであり、暗号学的な本人確認ではありません。reviewerとimplementerの宣言actorが異なることは検査しますが、現実の人物・プロセスの同一性までは保証しません。

## Flow

```text
plan: pending --plan artifact--> ready
implementation: blocked --RED(non-zero)--> GREEN(0) --> final(0)
               --matching implementation artifact--> success
review: blocked --review artifact--> approved --> complete
                                   \-> changes_requested --reopen--> implementation
```

`approved` 以外では完了になりません。`changes_requested` から再実装するには、必ず `reopen` を実行します。

## Quick start

```bash
npm run harness -- init interactive-map --goal "地図をドラッグ・ズームできるようにする"
npm run harness -- status interactive-map
```

Codexで `planner` roleを使い、`.codex/harness/schemas/plan.schema.json` に沿うJSONを `.codex/harness/inbox/` に作成します。

```bash
npm run harness -- plan interactive-map --artifact .codex/harness/inbox/interactive-map-plan.json
```

次に `implementer` roleでTDD実装を行います。コマンド名は `.codex/harness/config.json` のallowlistから選び、trusted orchestratorが実行します。実行は引数配列と `shell: false` で行われます。

```bash
npm run harness -- verify interactive-map --stage red --command test:harness
npm run harness -- verify interactive-map --stage green --command test:harness
npm run harness -- verify interactive-map --stage final --command lint
```

REDは非0、GREEN/finalは0が受理条件です。各実行はtimestamp、exit code、出力SHA-256、allowlist command名、HMAC-SHA-256署名を `.codex/harness/runtime/<slug>/receipts/<iteration>/` に保存します。implementation artifactの `verification` には3 receiptのstage、command、path、exit code、SHA-256、`receipt_signature` をそのまま転記します。受理時はcanonical receiptを再生成し、署名を `timingSafeEqual` で照合します。

## Receipt trust model

`MICHIKUSA_HARNESS_SIGNING_KEY` に32 bytes以上のランダム値を設定します。この鍵はreview/orchestrator側の実行環境だけに保持し、implementer roleへ渡しません。`verify`と`implement`の受理コマンドはtrusted orchestratorが実行します。鍵はrepo、artifact、state、receipt、ログへ保存しません。鍵がなければ署名作成・検証ともfail closedします。

HMACは、鍵を持たないroleによるreceiptファイル改ざんの検出を目的とします。同じOSユーザーがorchestrator環境、プロセスメモリ、コード自体を自由に読める場合まで防ぐものではありません。強い分離が必要な運用では、CI secretや別実行ユーザーでorchestratorを動かしてください。鍵をローテーションすると進行中taskの既存receiptは再検証できないため、そのiterationの検証を再実行します。

```bash
npm run harness -- implement interactive-map --artifact .codex/harness/inbox/interactive-map-implementation.json
```

最後に `reviewer` roleでレビューし、implementerと異なる宣言 `actor_id` を使います。

```bash
npm run harness -- review interactive-map --artifact .codex/harness/inbox/interactive-map-review.json
```

変更要求がある場合は、レビュー内容を確認してから明示的に戻します。

```bash
npm run harness -- reopen interactive-map
```

## Resume and diagnostics

```bash
npm run harness -- --resume interactive-map
npm run harness -- resume interactive-map
npm run harness -- check interactive-map
```

全コマンドは1行JSONを返し、必ず `status`、`summary`、`next_actions`、`artifacts` を含みます。操作不能・不正artifact・破損state・同時実行lockは非0で終了します。

`check` はconfig、4 schema、3 agent TOMLをTOML parserで構文・型・path検証し、repo-local skillとruntime stateの整合も検査します。runtime書込みは各directory componentを`lstat`/`realpath`で確認し、symlinkを拒否して原子的に保存します。artifactもrealpath後にrepo内であることを確認します。runtime、logs、inbox内容はGit対象外です。

## Public repository safety

- artifact、state、logsにAPIキー、OAuth token、個人情報を書かない。
- 実装roleは既存の未コミット変更を戻さない。
- review roleはGit diffとsecret混入を確認する。
- 実行していないテストを `passed` と記録しない。

## Harness verification

```bash
npm run test:harness
npm run test:harness:coverage
npm run lint
npm run typecheck
```
