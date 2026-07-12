# MICHIKUSA Hackathon Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make MICHIKUSA judge-ready by exposing truthful runtime state, explaining replan outcomes, strengthening agent contracts, and deploying a live Google Cloud build.

**Architecture:** Keep the existing Next.js + private FastAPI/ADK split. Add presentation-only state derived from existing plan and Calendar responses, forward a sanitized agent health payload, extend deterministic pytest and Playwright contracts, and make OAuth deployment optional while keeping Maps and Gemini live.

**Tech Stack:** Next.js 16, React 19, TypeScript, Python 3.11, Google ADK 2.4, pytest, Playwright, Cloud Run, Cloud Build, Secret Manager.

---

### Task 1: Add failing judge-facing UI contracts

**Files:**
- Modify: `scripts/e2e-check.mjs`

- [ ] **Step 1: Assert the result source, Calendar wording, replan control name, safety label, and replan receipt**

```js
await visibleText("DEMO DATA");
await visibleText("安全確認");

await page.getByRole("button", { name: "この道草で出発" }).click();
await visibleText("カレンダーは未接続です");

const replanMenu = page.getByRole("button", { name: "予定変更・再計画" });
await replanMenu.click();
await page.getByRole("button", { name: /15分遅れている/ }).click();
await visibleText("15分の遅れに合わせて再計画");
```

- [ ] **Step 2: Run E2E and verify RED**

Run: `npm run test:e2e`

Expected: FAIL because `DEMO DATA`, `安全確認`, the Calendar wording, named replan control, and replan receipt do not exist yet.

- [ ] **Step 3: Commit the failing contract**

```bash
git add scripts/e2e-check.mjs
git commit -m "test: define judge-facing UI contracts"
```

### Task 2: Implement truthful UI state and replan receipt

**Files:**
- Modify: `src/components/michikusa-app.tsx`
- Modify: `src/app/globals.css`
- Modify: `scripts/e2e-check.mjs`

- [ ] **Step 1: Add a typed replan receipt derived from the previous and next plans**

```ts
interface ReplanReceipt {
  reason: ReplanReason;
  title: string;
  detail: string;
}

function buildReplanReceipt(previous: MichikusaPlan, next: MichikusaPlan, reason: ReplanReason): ReplanReceipt {
  const durationDelta = next.duration_minutes - previous.duration_minutes;
  const spotDelta = next.stops.length - previous.stops.length;
  const titleByReason: Record<ReplanReason, string> = {
    delay: "15分の遅れに合わせて再計画",
    closed: "閉まっている場所を入れ替えました",
    tired: "休みやすい道草へ軽くしました",
    go_home: "帰る道へ切り替えました"
  };
  const durationText = durationDelta === 0 ? "所要時間を維持" : `${Math.abs(durationDelta)}分${durationDelta < 0 ? "短縮" : "調整"}`;
  const spotText = spotDelta === 0 ? `${next.stops.length}地点を維持` : `${previous.stops.length}→${next.stops.length}地点`;
  return { reason, title: titleByReason[reason], detail: `${durationText}・${spotText}・${timeLabel(next.return_by)}までに帰宅` };
}
```

- [ ] **Step 2: Render source badge, meaningful safety label, Calendar truth, accessible replan control, and receipt**

```tsx
<span className={`runtime-badge runtime-badge--${plan.source}`}>
  {plan.source === "live" ? "LIVE DATA" : plan.source === "fallback" ? "FALLBACK" : "DEMO DATA"}
</span>
<div className="safety-score" aria-label={`安全確認 ${plan.safety.score}点`}>
  <ShieldCheck size={16} /><span>安全確認</span><strong>{plan.safety.score}</strong>
</div>
<button type="button" aria-label="予定変更・再計画" onClick={() => setSheet("replan")}>
  <CircleEllipsis size={19} />
</button>
```

For demo Calendar commits, set the toast to `道草を開始しました。カレンダーは未接続です`. Store `buildReplanReceipt(plan, next, reason)` after a successful replan and render it above the active stop card.

- [ ] **Step 3: Add compact styles without changing the existing visual hierarchy**

```css
.runtime-badge { display:inline-flex; align-items:center; min-height:22px; padding:0 8px; border-radius:999px; font-size:9px; font-weight:800; letter-spacing:.08em; }
.runtime-badge--live { color:#18744b; background:#e8f8ef; }
.runtime-badge--demo { color:#84611b; background:#fff4d9; }
.runtime-badge--fallback { color:#9a4b35; background:#fff0ea; }
.replan-receipt { margin-bottom:10px; padding:10px 12px; border-radius:16px; background:rgba(255,255,255,.9); }
```

- [ ] **Step 4: Run E2E and verify GREEN**

Run: `npm run test:e2e`

Expected: PASS with seven screenshots and no console/network errors.

- [ ] **Step 5: Commit the UI implementation**

```bash
git add src/components/michikusa-app.tsx src/app/globals.css scripts/e2e-check.mjs
git commit -m "fix: make planning state judge-readable"
```

### Task 3: Expose sanitized runtime health and strengthen agent contracts

**Files:**
- Modify: `src/app/api/health/route.ts`
- Modify: `scripts/smoke-test.mjs`
- Modify: `agent_service/tests/test_runtime.py`
- Modify: `agent_service/michikusa_agent/workflow.py`

- [ ] **Step 1: Add a failing source-integrity test plus safety and privacy contracts**

```py
from michikusa_agent.workflow import _plan_source

def test_plan_source_requires_both_live_providers() -> None:
    assert _plan_source(maps_live=True, gemini_live=True) == "live"
    assert _plan_source(maps_live=True, gemini_live=False) == "fallback"
    assert _plan_source(maps_live=False, gemini_live=True) == "fallback"
    assert _plan_source(maps_live=False, gemini_live=False) == "demo"

assert plan.budget_yen <= request.preferences.budget_yen
assert plan.end_at <= plan.return_by
assert {check.key for check in plan.safety.checks} >= {"time_window", "budget", "opening_hours", "late_night"}
assert plan.origin.label not in {plan.share.area_label, plan.share.title, plan.share.theme}
```

For every `ReplanReason`, assert a passing `replan_return` check and ensure the new plan still satisfies the original return limit.

- [ ] **Step 2: Run the agent tests and verify RED**

Run: `npm run test:agent`

Expected: FAIL because `_plan_source` does not exist.

- [ ] **Step 3: Implement strict plan-source semantics**

```py
def _plan_source(*, maps_live: bool, gemini_live: bool) -> Literal["live", "demo", "fallback"]:
    if maps_live and gemini_live:
        return "live"
    if maps_live or gemini_live:
        return "fallback"
    return "demo"
```

Use `_plan_source(maps_live=settings.live_maps_enabled, gemini_live=settings.live_gemini_enabled)` in `finalizer_agent`.

- [ ] **Step 4: Forward only safe Agent health fields**

```ts
const agent = await response.json() as {
  demo_mode: boolean;
  adk_version: string;
  maps_live: boolean;
  gemini_live: boolean;
};
return NextResponse.json({
  status: "ok",
  web: "ok",
  database: "ok",
  planning: "ok",
  agent
});
```

- [ ] **Step 5: Require live flags in production smoke mode**

```js
if (process.env.REQUIRE_LIVE === "true") {
  if (!healthBody.agent?.maps_live || !healthBody.agent?.gemini_live) throw new Error("Agent providers are not live");
  if (plan.source !== "live") throw new Error(`Expected live plan, got ${plan.source}`);
}
```

- [ ] **Step 6: Run focused tests and verify GREEN**

Run: `npm run test:agent && npm run test:smoke`

Expected: PASS locally with demo mode; production will additionally use `REQUIRE_LIVE=true`.

- [ ] **Step 7: Commit runtime evidence**

```bash
git add src/app/api/health/route.ts scripts/smoke-test.mjs agent_service/tests/test_runtime.py agent_service/michikusa_agent/workflow.py
git commit -m "test: strengthen agent judging contracts"
```

### Task 4: Make deployment work without pretending OAuth exists

**Files:**
- Modify: `deploy.sh`
- Modify: `docs/GOOGLE_CLOUD_SETUP.md`

- [ ] **Step 1: Add a deploy preflight that treats OAuth as an optional pair**

```bash
required_secrets=(
  michikusa-agent-shared-secret
  "$BROWSER_MAPS_KEY_SECRET"
  michikusa-maps-server-key
  michikusa-token-encryption-key
  michikusa-turso-url
  michikusa-turso-token
)

if gcloud secrets describe michikusa-oauth-client-id --project "$PROJECT_ID" >/dev/null 2>&1 &&
   gcloud secrets describe michikusa-oauth-client-secret --project "$PROJECT_ID" >/dev/null 2>&1; then
  OAUTH_CONFIGURED=true
else
  OAUTH_CONFIGURED=false
fi
```

- [ ] **Step 2: Build the web secret arguments dynamically**

```bash
WEB_SECRET_BINDINGS="AGENT_SHARED_SECRET=michikusa-agent-shared-secret:latest,TOKEN_ENCRYPTION_KEY=michikusa-token-encryption-key:latest,TURSO_DATABASE_URL=michikusa-turso-url:latest,TURSO_AUTH_TOKEN=michikusa-turso-token:latest"
if [[ "$OAUTH_CONFIGURED" == "true" ]]; then
  WEB_SECRET_BINDINGS+=",GOOGLE_OAUTH_CLIENT_ID=michikusa-oauth-client-id:latest,GOOGLE_OAUTH_CLIENT_SECRET=michikusa-oauth-client-secret:latest"
fi
```

- [ ] **Step 3: Document the live-without-OAuth behavior**

State that Gemini, Places, and Routes can be live while Calendar remains visibly disconnected; adding both OAuth secrets and redeploying enables Calendar.

- [ ] **Step 4: Validate shell syntax**

Run: `bash -n deploy.sh`

Expected: exit 0.

- [ ] **Step 5: Commit deployment hardening**

```bash
git add deploy.sh docs/GOOGLE_CLOUD_SETUP.md
git commit -m "fix: make calendar oauth deployment optional"
```

### Task 5: Refresh verification evidence and complete local gates

**Files:**
- Modify: `docs/VERIFICATION.md`
- Modify: `README.md`

- [ ] **Step 1: Update documented checks and current test counts**

Record lint, typecheck, Agent tests, build, E2E mobile, E2E desktop, audit, health, smoke, and secret scan as command-backed evidence. Do not mark production checks complete before deployment.

- [ ] **Step 2: Run the complete local gate**

Run: `npm run verify && npm run test:e2e && E2E_LAYOUT=desktop E2E_OUTPUT_DIR=artifacts-desktop npm run test:e2e && npm audit --omit=dev --audit-level=high`

Expected: all commands exit 0; pytest reports all tests passing; both E2E reports contain empty `consoleErrors` and `failedRequests`.

- [ ] **Step 3: Run secret and diff checks**

Run: `git diff --check && git grep -nE '(AIza[0-9A-Za-z_-]{20,}|gh[pousr]_[0-9A-Za-z]{20,}|-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----)' -- ':!package-lock.json'`

Expected: `git diff --check` exits 0 and the secret pattern produces no matches.

- [ ] **Step 4: Commit verification docs**

```bash
git add docs/VERIFICATION.md README.md
git commit -m "docs: refresh hackathon verification evidence"
```

### Task 6: Publish through the protected branch and deploy Cloud Run

**Files:**
- Modify after verification: `docs/VERIFICATION.md`

- [ ] **Step 1: Push the hardening branch and open a PR**

```bash
git push -u origin codex/hackathon-hardening
gh pr create --repo riottt/michikusa --base main --head codex/hackathon-hardening --title "fix: harden MICHIKUSA for hackathon judging" --body-file /tmp/michikusa-pr.md
```

- [ ] **Step 2: Merge through protected main after checks pass**

```bash
gh pr merge --repo riottt/michikusa --squash --delete-branch
git fetch origin --prune
```

- [ ] **Step 3: Create and bill the dedicated project**

```bash
gcloud projects create michikusa-hackathon-20260712 --name=MICHIKUSA
BILLING_ACCOUNT_ID="$(gcloud billing accounts list --filter='open=true' --limit=1 --format='value(name.basename())')"
gcloud billing projects link michikusa-hackathon-20260712 --billing-account="$BILLING_ACCOUNT_ID"
```

- [ ] **Step 4: Create restricted API keys and required secrets**

Create separate browser and server API keys. Restrict the browser key to Maps JavaScript API and the deployed origin after the first URL is known; restrict the server key to Places API and Routes API. Populate app secrets from the current local environment without printing secret values.

- [ ] **Step 5: Deploy both services**

Run: `GOOGLE_CLOUD_PROJECT=michikusa-hackathon-20260712 REGION=asia-northeast1 ./deploy.sh`

Expected: a public `michikusa-web` URL and a private `michikusa-agent` URL.

- [ ] **Step 6: Verify production health and live planning**

Run: `SMOKE_BASE_URL="$WEB_URL" REQUIRE_LIVE=true npm run test:smoke`

Expected: home 200, health 200 with `maps_live=true` and `gemini_live=true`, plan source `live`, Calendar demo or disconnected state explicitly reported, and replan return guard OK.

- [ ] **Step 7: Record production evidence**

Add the public URL, revision names, UTC verification time, health payload summary, and smoke results to `docs/VERIFICATION.md`, commit on a new docs branch, and merge through a second small PR only if the recorded evidence contains no credentials.
