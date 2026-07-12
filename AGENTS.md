# MICHIKUSA Delivery Harness

このリポジトリの変更は、計画・実装・レビューを分離した delivery harness で進める。

## Required flow

1. `planner` が調査、影響範囲、受入条件、検証方法を `plan.schema.json` 準拠で記録する。
2. plan が `ready` になるまで `implementer` は変更しない。
3. `implementer` は承認済み plan だけを実装し、trusted orchestratorへallowlisted RED / GREEN / final検証の実行を依頼する。implementation artifactの証拠は署名receiptと一致させる。
4. implementation が `success` になるまで `reviewer` は承認判定しない。
5. `reviewer` は実装者と異なる `actor_id` を宣言して diff、テスト、セキュリティ、要件適合性を確認し、`review.schema.json` 準拠で `approved` または `changes_requested` を返す。
6. `approved` のときだけ完了。`changes_requested` は `harness reopen` で明示的に実装へ戻す。

## Commands

詳細は `docs/HARNESS.md` を参照する。基本コマンドは次のとおり。

```bash
npm run harness -- init <slug> --goal "..."
npm run harness -- plan <slug> --artifact <plan.json>
npm run harness -- verify <slug> --stage red --command <allowlisted-name>
npm run harness -- verify <slug> --stage green --command <allowlisted-name>
npm run harness -- verify <slug> --stage final --command <allowlisted-name>
npm run harness -- implement <slug> --artifact <implementation.json>
npm run harness -- review <slug> --artifact <review.json>
npm run harness -- --resume <slug>
npm run harness -- check <slug>
```

artifactは `.codex/harness/inbox/` に置く。repo外やrepo外を指すsymlinkは受理されない。runtime state と logs は `.codex/harness/` 配下のignore対象へ保存する。秘密情報を書かない。

`role` / `actor_id` / `task_slug` / `iteration` はdeclared provenanceであり、暗号学的な本人確認ではない。ハーネスが保証するのは、宣言値とtask/iterationの一致、およびreviewerとimplementerの宣言actorが異なることまで。独立性を過大表現しない。

`MICHIKUSA_HARNESS_SIGNING_KEY` は32 bytes以上とし、review/orchestrator側の実行環境だけに設定する。implementer roleへ値を渡さず、repo、artifact、state、receipt、ログへ保存しない。`verify`と`implement`の受理はtrusted orchestratorが行う。鍵がない場合はfail closedする。

## Verification

最小の focused test から始め、変更範囲に応じて `npm run lint`、`npm run typecheck`、`npm run build` を追加する。実行していない検証を成功として記録しない。
