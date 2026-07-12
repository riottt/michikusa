---
name: team-delivery-excellence
description: Run the repo-local planner, implementer, and reviewer delivery harness with typed artifacts and TDD receipts.
---

# Team Delivery Excellence

Use only the repo-local Codex roles `planner`, `implementer`, and `reviewer`.

1. Ask `planner` for a plan artifact and accept it with `harness plan`.
2. Ask `implementer` for the RED/GREEN/final command names. Have the trusted orchestrator run `harness verify` with its signing key, then accept matching signed implementation evidence.
3. Ask a separately declared `reviewer` actor for the review artifact.
4. Complete only on `approved`; use `harness reopen` after `changes_requested`.

Artifacts must be placed in `.codex/harness/inbox`, must match the published schemas, and must never contain secrets. `actor_id` is declared provenance only; it is not cryptographic identity verification. `MICHIKUSA_HARNESS_SIGNING_KEY` belongs only to the trusted orchestrator and must never be given to the implementer role.

Reference: [delivery harness runbook](../../../docs/HARNESS.md)
