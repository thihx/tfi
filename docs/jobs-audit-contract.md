# TFI Jobs Audit Contract

Updated: 2026-06-06

## Scope

This contract audits the active backend scheduler jobs in `packages/server/src/jobs/`.
It covers business intent, technical dependencies, edge cases, consolidation decisions,
and regression tests required for the job layer.

The active scheduler registers 18 jobs:

| Job | Business contract | Main downstream risk if wrong |
| --- | --- | --- |
| `fetch-matches` | Maintain active match list and archive provider-finished matches. | Matches UI, watchlist, alert materialization, live AI all read stale/wrong match state. |
| `sync-watchlist-metadata` | Keep operational watchlist rows aligned with match metadata. | Live AI and alerts may work from stale kickoff/team/league fields. |
| `auto-add-top-league-watchlist` | Add eligible top-league NS matches to operational watchlist. | Missed automatic monitoring or excess watchlist load. |
| `auto-add-favorite-team-watchlist` | Add user favorite-team NS matches to personal watchlists with capacity checks. | Favorite-team users miss monitored matches or capacity rules are bypassed. |
| `refresh-live-matches` | Keep live/near-live score and terminal state fresh without full slate fetch. | Matches live board lags; finished games stay active; live AI reads stale score. |
| `materialize-match-alerts` | Create concrete kickoff alert rules from favorite-team/favorite-league settings. | Favorite alert settings do not become executable rules. |
| `check-match-alerts` | Evaluate kickoff and condition alert rules, enqueue/deliver alerts. | User condition push stops or duplicate alerts are emitted. |
| `deliver-telegram-notifications` | Flush recommendation Telegram delivery queue. | Saved recommendations are not delivered or are duplicated. |
| `deliver-match-alert-telegram` | Flush match-alert Telegram delivery queue. | Condition/start alerts are not delivered or are duplicated. |
| `sync-reference-data` | Refresh league catalog, team directory, and derived prematch profiles. | Provider/cache calls grow and contextual quality decays. |
| `refresh-tactical-overlays` | Refresh tactical overlay profile fields for approved teams. | Prematch/tactical context becomes stale. |
| `enrich-watchlist` | Add strategic context and recommended condition text before kickoff. | Watchlist rules stay thin; condition automation quality drops. |
| `check-live-trigger` | Select live watchlist matches and run the official AI recommendation pipeline. | Live recommendations stop, run too often, or audit misreports failures. |
| `refresh-provider-insights` | Prewarm non-live provider fixture/stats/events/odds cache for watched matches. | Later pipeline/UI reads become slower and provider bursts move to critical windows. |
| `auto-settle` | Settle pending recommendations and bets from history/provider fallback. | P/L, bankroll, and AI performance memory become stale or wrong. |
| `expire-watchlist` | Expire old watchlist/subscription rows after match completion window. | Old rows keep triggering sync/enrichment/live checks. |
| `purge-audit` | Daily housekeeping for high-growth logs/cache/history tables. | Storage grows unbounded or protected betting data is damaged. |
| `integration-health` | Probe external dependencies and alert on health transitions. | Outages are not detected or recovery is not reported. |
| `health-watchdog` | Detect overdue/stuck critical jobs and alert operators. | A stopped job silently breaks the chained pipeline. |

## Dependency Graph

`fetch-matches` is the root data hydrator for the active slate. It feeds:

- `refresh-live-matches` for fast score/status updates.
- `sync-watchlist-metadata`, `auto-add-*`, and `materialize-match-alerts`.
- `check-live-trigger` and `check-match-alerts`.
- `auto-settle` through archived match history.

`refresh-live-matches` is the low-latency correction path for live score and FT state.
It must not depend on full `fetch-matches` cadence for live board correctness.

`check-live-trigger` is the only scheduled entry into the AI recommendation pipeline.
It must use the same canonical live statuses as score refresh and must report partial
pipeline failures as partial/failure, not success.

`check-match-alerts` and `deliver-match-alert-telegram` form the user match-alert
delivery path. They are separate from AI recommendations and must remain observable
as critical jobs.

`integration-health` and `health-watchdog` are monitoring jobs. They must still run
when Redis locking is degraded; otherwise Redis outages disable the jobs that should
report Redis outages.

## Findings And Required Fixes

| ID | Severity | Finding | Required fix | Regression lock |
| --- | --- | --- | --- | --- |
| JF-001 | High | Monitoring jobs use strict Redis locks. If Redis is unavailable, `integration-health` and `health-watchdog` are skipped before they can report the outage. | Use `degraded-local` lock policy for both monitoring jobs. | Scheduler test proves monitoring jobs still run when Redis lock is unavailable. |
| JF-002 | High | `LIVE_STATUSES` default in config is `1H,2H`, while runtime jobs treat `HT,ET,BT,P,LIVE,INT` as live too. `check-live-trigger` can skip valid live states. | Default `LIVE_STATUSES` must be `1H,HT,2H,ET,BT,P,LIVE,INT`. | Config test locks default live statuses. |
| JF-003 | High | `check-live-trigger` audits `PIPELINE_COMPLETE` as `SUCCESS` when a whole batch throws, because rejected batches are not counted in `totalErrors`. | Track failed batches and failed match count; mark final pipeline outcome `PARTIAL` when any batch throws. | Check-live-trigger test expects final `PIPELINE_COMPLETE` outcome `PARTIAL` after a batch error. |
| JF-004 | Medium | `PIPELINE_BATCH_SIZE=0` or invalid values can create a non-advancing batch loop. | Clamp batch size to at least 1. | Check-live-trigger test sets batch size to 0 and still completes. |
| JF-005 | High | Health watchdog critical set misses `check-match-alerts`, `deliver-match-alert-telegram`, `sync-watchlist-metadata`, and `materialize-match-alerts`. Condition push can stop without a watchdog alert. | Add those jobs to the critical set. | Watchdog test proves `check-match-alerts` is monitored. |
| JF-006 | High | Provider can keep a fixture as `NS` hours after kickoff. Full match refresh then re-inserts the stale row, so Matches UI shows old NS games. | Drop provider-stale `NS` fixtures after a 3-hour kickoff grace window. | Fetch-matches test covers `Ukraine U21 vs USA U21` style stale NS fixture. |
| JF-007 | High | Live board FT/status latency was bounded by provider cache TTL and public live cap 0. | Use 5s live refresh, `real_required` fixture freshness, and public cap 20. | Refresh-live-matches tests cover `real_required` and public live candidates. |

## Consolidation Decision

Do not merge all jobs into one large orchestrator. The current system benefits from
separate failure domains: match fetch, live score, alerts, AI pipeline, settlement,
delivery, reference data, and monitoring can fail independently and be forced
individually from Settings.

Recommended consolidation is operational, not a broad code merge:

- Keep `deliver-telegram-notifications` and `deliver-match-alert-telegram` as separate
  scheduler jobs because they mark different queues and have different business payloads.
  A shared helper for batching/concurrency/message chunking is acceptable later.
- Keep `auto-add-top-league-watchlist` and `auto-add-favorite-team-watchlist` separate:
  top-league auto-add is operational/global, favorite-team auto-add is user/subscription
  capacity-sensitive.
- Treat `fetch-matches`, `refresh-live-matches`, `sync-watchlist-metadata`, and
  `materialize-match-alerts` as one logical match lifecycle stage in documentation and
  monitoring, but keep separate job controls for Force/rollback.
- Reference-data jobs can stay independent because their provider budgets and stale
  windows are different.

## Required Verification

Focused checks:

```powershell
npm run test --prefix packages/server -- src/__tests__/scheduler.test.ts src/__tests__/health-watchdog.job.test.ts src/__tests__/check-live-trigger.job.test.ts src/__tests__/fetch-matches.job.test.ts src/__tests__/refresh-live-matches.job.test.ts
npm run typecheck --prefix packages/server
```

Broad check before deploy:

```powershell
npm run test --prefix packages/server
npm run data-driven:verify-gates-ci --prefix packages/server
```

Full repo CI mirror remains:

```powershell
npm run verify:ci
```
