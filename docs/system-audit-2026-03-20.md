# TFI System Audit

Date: 2026-03-20

## Scope

- Audited the current workspace snapshot, not a clean git baseline.
- The worktree is dirty in `packages/server/src/jobs/*` and a few local utility/log files, so "current health" items below reflect the code as checked out today.
- Focus areas:
  - server bootstrap, auth, routes, jobs, scheduler, persistence
  - frontend/backend API contracts
  - test/build health and coverage gaps

## Verification Performed

- `npm run typecheck`
- `npm run typecheck --prefix packages/server`
- `npm run test --prefix packages/server`
- `npx vitest run src/lib/services/__tests__/api-extended.test.ts`
- `npm run test --prefix packages/server -- src/__tests__/watchlist.routes.test.ts`
- `npm run test --prefix packages/server -- src/__tests__/fetch-matches.job.test.ts`

## Executive Summary

- Validated findings: 8
- Severity split: 1 critical, 4 high, 3 medium
- Biggest production risks:
  - auth fails open and exposes privileged/cost-bearing endpoints
  - finished fixtures can disappear before entering `matches_history`
  - `ai_performance` is incomplete/corrupted, so AI accuracy reporting and prompt feedback loops are not trustworthy
  - frontend watchlist updates use the wrong HTTP verb and are currently broken against the server contract

## Findings

### F1. Critical: auth fails open, while privileged and cost-bearing routes remain reachable

Severity: Critical

Evidence:

- `packages/server/src/index.ts:83-103`
  - JWT protection is only enabled when both Google OAuth env vars exist.
  - Otherwise the server starts normally and logs that auth is disabled.
- `packages/server/src/config.ts:33-40`
  - missing `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` silently disables auth
  - missing `JWT_SECRET` falls back to `tfi-dev-secret-change-me`
- privileged or cost-bearing routes remain registered regardless:
  - `packages/server/src/routes/jobs.routes.ts:15-40`
  - `packages/server/src/routes/settings.routes.ts:8-20`
  - `packages/server/src/routes/matches.routes.ts:22-25`
  - `packages/server/src/routes/leagues.routes.ts:133-160`
  - `packages/server/src/routes/proxy.routes.ts:22-31`
  - `packages/server/src/routes/proxy.routes.ts:174-225`

Impact:

- A production deployment with missing OAuth env vars boots into effectively unauthenticated mode.
- Any caller can trigger jobs, change scheduler intervals, overwrite settings, refresh matches, sync leagues from external APIs, send Telegram messages, and proxy Gemini/API-Sports requests.
- This is both a data integrity risk and a direct cost-abuse path.

Why this is valid:

- CORS does not protect server-to-server or curl access.
- The protection hook is the only auth gate in the server bootstrap, and it is explicitly disabled on missing env.

Recommended fix:

- Fail fast on startup outside local dev if auth secrets are missing.
- Remove the default JWT secret fallback; require `JWT_SECRET`.
- Protect mutation and proxy routes independently from Google OAuth configuration.
- Add rate limiting and/or service-level authorization for `/api/proxy/*`, `/api/jobs/*`, `/api/settings`, and admin maintenance routes.

### F2. High: `fetchMatchesJob` drops newly finished fixtures before they are archived

Severity: High

Evidence:

- `packages/server/src/jobs/fetch-matches.job.ts:19-20`
  - allowed statuses exclude `FT`, `AET`, `PEN`, `AWD`, `WO`
- `packages/server/src/jobs/fetch-matches.job.ts:129-135`
  - fetched fixtures are filtered by `ALLOWED_STATUSES` before becoming rows
- `packages/server/src/jobs/fetch-matches.job.ts:165-168`
  - archival reads only `allCurrentMatches` from the old table before `TRUNCATE`
- `packages/server/src/repos/matches-history.repo.ts:23-33`
  - archival only writes rows whose existing `matches.status` is already finished

Failure mode:

1. A match is live in `matches`.
2. The next API poll returns it as `FT`.
3. `fetchMatchesJob` filters it out immediately because `FT` is not allowed.
4. Archival runs against the old table, which still holds the previous live status.
5. The subsequent full refresh removes the match from `matches`.
6. The finished result never reaches `matches_history`.

Impact:

- `matches_history` misses normal match completions.
- `auto-settle` must rely on the fallback Football API fetch instead of local history.
- If the fallback API is unavailable or rate-limited, settlement is skipped for matches that should already be locally resolvable.

Coverage gap:

- `npm run test --prefix packages/server -- src/__tests__/fetch-matches.job.test.ts` passes, but the suite only checks that `archiveFinishedMatches()` was called, not that newly-finished fixtures are actually archived.

Recommended fix:

- Archive finished fixtures from the freshly fetched payload before filtering/truncating.
- Alternatively, keep finished rows long enough to archive them deterministically in the same run.
- Add a regression test where an old `2H` match becomes `FT` in the new API payload and assert that `matches_history` receives it.

### F3. High: server-side auto pipeline never creates `ai_performance` rows

Severity: High

Evidence:

- `packages/server/src/lib/server-pipeline.ts:970-1004`
  - server-side pipeline writes recommendations by calling `createRecommendation(...)` directly
  - there is no corresponding `createAiPerformanceRecord(...)` call afterwards
- `packages/server/src/routes/recommendations.routes.ts:75-90`
  - `ai_performance` is only auto-created inside the HTTP route handler for `POST /api/recommendations`

Impact:

- Recommendations created by the server scheduler path do not enter `ai_performance`.
- Accuracy stats, by-model breakdown, and prompt feedback context are missing the main production path that now generates recommendations.
- `autoSettleJob` and `reEvaluateAllResults` later call `settleAiPerformance(...)`, but if no row exists those updates are effectively no-ops.

Why this matters:

- The project already has a server-side pipeline (`check-live-trigger` -> `runPipelineBatch`).
- That path bypasses the only code that inserts tracking rows.

Recommended fix:

- Move AI performance creation into the repository/service layer so both HTTP and scheduled flows use the same side effect.
- At minimum, create the tracking row immediately after `createRecommendation(...)` in `server-pipeline.ts`.
- Add a server-pipeline integration test that asserts an AI performance row is created when a recommendation is saved.

### F4. High: existing `ai_performance` semantics are corrupted even when rows exist

Severity: High

Evidence:

- `packages/server/src/routes/recommendations.routes.ts:78-90`
  - route-created `ai_performance` rows do not pass `ai_should_push`
- `packages/server/src/repos/ai-performance.repo.ts:29-60`
  - `createAiPerformanceRecord()` defaults `ai_should_push` to `false`
- `packages/server/src/repos/ai-performance.repo.ts:128-154`
  - backfill also hard-codes `ai_should_push` to `false`
- `packages/server/src/jobs/auto-settle.job.ts:296-299`
  - settlement marks `was_correct` as `aiResult.result === 'win'`
- `packages/server/src/jobs/re-evaluate.job.ts:211-214`
  - same logic in re-evaluation
- `packages/server/src/repos/ai-performance.repo.ts:102-120`
  - accuracy stats count `was_correct = FALSE` as incorrect
- `packages/server/src/repos/ai-performance.repo.ts:258-265`
  - historical prompt context only includes rows where `ap.ai_should_push = true`

Impact:

- Rows inserted through the recommendation route are invisible to historical prompt context because `ai_should_push` is always false.
- `push` outcomes are classified as incorrect during settlement/re-evaluation, which drags down accuracy incorrectly.
- Model-performance reports are not reliable enough to drive prompt tuning or trust decisions.

Recommended fix:

- Persist the real `ai_should_push` value whenever the recommendation is created.
- Treat `push` as neutral (`was_correct = null`) consistently, matching the backfill logic.
- Add regression tests for:
  - route-created row keeps `ai_should_push = true`
  - settled `push` does not increment incorrect count
  - `getHistoricalPerformanceContext()` includes real push candidates

### F5. High: frontend watchlist updates use `PATCH`, backend only accepts `PUT`

Severity: High

Evidence:

- frontend client uses `PATCH`
  - `src/lib/services/api.ts:264-273`
- backend route only exposes `PUT`
  - `packages/server/src/routes/watchlist.routes.ts:29-31`
- the contract drift is encoded in tests on both sides:
  - `src/lib/services/__tests__/api-extended.test.ts:86-95`
  - `packages/server/src/__tests__/watchlist.routes.test.ts:97-100`

Verification:

- `npx vitest run src/lib/services/__tests__/api-extended.test.ts` passes
- `npm run test --prefix packages/server -- src/__tests__/watchlist.routes.test.ts` passes

This is exactly the problem: both suites pass independently while the real integrated contract is broken.

Impact:

- `useAppState.updateWatchlistItem()` calls the frontend helper, so UI edits can optimistic-update local state and then fail to persist server-side.
- Users get rollback behavior or silent failure depending on how the calling screen handles the rejected request.

Recommended fix:

- Pick one verb and align both sides.
- Prefer `PUT` if the backend contract stays as-is, or add a `PATCH` route if partial updates are intended.
- Add one contract/integration test that exercises the real frontend helper against a test Fastify app.

### F6. Medium: OAuth flow is missing `state` protection and returns JWT in the query string

Severity: Medium

Evidence:

- `packages/server/src/routes/auth.routes.ts:29-37`
  - Google authorization request does not set a `state` parameter
- `packages/server/src/routes/auth.routes.ts:97-105`
  - backend redirects to `?token=<jwt>`
- `src/hooks/useAuth.ts:14-24`
  - frontend reads the JWT from the URL on page load

Impact:

- Missing `state` leaves the flow open to login CSRF / callback mix-up issues.
- Returning JWTs in the URL leaks them into browser history, proxy logs, analytics/referrer surfaces, and any pre-hydration network activity before React removes the query string.

Recommended fix:

- Add signed `state` handling and validate it on callback.
- Stop returning the JWT in the query string.
- Prefer an `HttpOnly` cookie or a one-time code exchange on the frontend.

### F7. Medium: non-Football external clients have no timeout or retry budget

Severity: Medium

Evidence:

- `packages/server/src/lib/gemini.ts:7-25`
  - plain `fetch()` with no abort timeout, no retry
- `packages/server/src/lib/telegram.ts:7-36`
  - same pattern for Telegram
- `packages/server/src/routes/auth.routes.ts:53-81`
  - Google token exchange and profile fetch also use unbounded `fetch()`
- contrast:
  - `packages/server/src/lib/football-api.ts:67-117`
  - this client already implements timeout and retry

Impact:

- Scheduler jobs that depend on Gemini or Telegram can hang indefinitely on network stalls.
- A hung job keeps the scheduler lock until TTL expiry, which increases skipped runs and can trigger watchdog noise.
- OAuth login can also hang on slow upstreams rather than failing predictably.

Recommended fix:

- Introduce one shared outbound HTTP helper with:
  - `AbortController` deadline
  - bounded retries for idempotent operations
  - structured logging
- Reuse it across Gemini, Telegram, Google OAuth token/profile fetches.

### F8. Medium: recommendation dedupe collapses opposite corners/AH positions into one key

Severity: Medium

Evidence:

- `packages/server/src/lib/normalize-market.ts:14-18`
  - all Asian Handicap selections normalize to `asian_handicap`
  - all corners selections normalize to `corners`
- `packages/server/src/lib/normalize-market.ts:45-51`
  - dedupe key is `matchId + normalized market`
- `packages/server/src/repos/recommendations.repo.ts:193-206`
  - recommendation insert uses that key for `ON CONFLICT`
- settlement logic still distinguishes side/line from raw selection:
  - `packages/server/src/lib/settle-rules.ts:85-109`

Impact:

- `Over 9.5 Corners` and `Under 10.5 Corners` for the same match collide.
- `AH Home -0.5` and `AH Away +0.5` also collide.
- A later recommendation can overwrite an earlier, materially different position while preserving only one row.

Recommended fix:

- Include side and line in the canonical key for corners and Asian Handicap.
- Backfill existing rows before relying on dedupe logic for reporting or settlement history.
- Add tests proving that opposite corners/AH positions on the same match produce distinct `unique_key` values.

## Current Workspace Blockers

These are not all systemic design issues, but they do block shipping the current snapshot.

### B1. Frontend typecheck/build is currently red

Verification:

- `npm run typecheck` fails
- `package.json:11-19` wires build to `tsc --noEmit && vite build`, so production build is blocked

Examples from the current compiler output:

- `src/app/DashboardTab.tsx:203` uses `<PageHeader>` without the required `title` prop defined in `src/components/ui/PageHeader.tsx:1-7`
- `src/app/RecommendationsTab.tsx:185` has the same issue
- `src/app/WatchlistTab.test.tsx:12-18` still builds an old `AppConfig` shape that no longer matches `src/types/index.ts:150-153`
- additional current type errors also exist in `BetTrackerTab.tsx`, `match-merger.service.ts`, and multiple live-monitor tests

Suggested fix order:

1. restore the shared type contracts (`PageHeaderProps`, `AppConfig`, test fixtures)
2. rerun `npm run typecheck`
3. only then trust frontend test results again

### B2. Backend test suite is currently red because `generate-condition` imports a removed symbol

Verification:

- `npm run test --prefix packages/server` fails
- failure message: `TypeError: generateCondition is not a function`

Evidence:

- `packages/server/src/__tests__/generate-condition.test.ts:6`
  - imports `generateCondition` from `../jobs/enrich-watchlist.job.js`
- `packages/server/src/jobs/enrich-watchlist.job.ts:20-29`
  - file exports `setForceEnrich()` and `enrichWatchlistJob()`, but no `generateCondition`

Impact:

- The main backend suite is red on the current snapshot.
- That masks whether other job-level regressions were introduced.

Suggested fix:

- Either restore/export the helper that the suite expects, or delete/replace the stale suite if the logic truly moved elsewhere.
- After that, rerun the full server test suite before trusting other changes in the settlement/enrichment area.

## Suggested Fix Sequence

1. Lock down auth bootstrap and secret handling.
2. Fix match archival so finished fixtures are always persisted locally.
3. Repair `ai_performance` creation and semantics before using model metrics for any decisions.
4. Align the watchlist update contract and add an end-to-end contract test.
5. Restore current quality gates: frontend typecheck, backend test suite.
6. Harden OAuth flow and outbound HTTP timeouts.

