# Job Remediation - 2026-03-31

## Completed In This Session

### 1. Scheduler hardening

Implemented in `packages/server/src/jobs/scheduler.ts`.

Completed changes:

- replaced plain `setInterval` execution with self-rescheduling timers
- added one pending rerun slot for single-concurrency jobs instead of silently dropping every overlapping tick
- added heartbeat-based run state
- added `lastStartedAt`, `lastCompletedAt`, `lastHeartbeatAt`, `lastDurationMs`, and `lastLagMs`
- made Redis lock policy explicit per job with `strict` vs `degraded-local`
- prevented duplicate registration by making `startScheduler()` idempotent

Operational effect:

- live jobs now expose actual lag and run duration
- stale remote `running=1` flags are no longer trusted when heartbeat is old
- selected lower-risk jobs can continue in degraded local mode if Redis lock acquisition is unavailable

### 2. Watchdog alignment

Implemented in `packages/server/src/jobs/health-watchdog.job.ts`.

Completed changes:

- added `refresh-live-matches` to the critical set
- watchdog now evaluates running jobs against `lastStartedAt` / `lastCompletedAt` instead of only legacy `lastRun`

Operational effect:

- live refresh failures are now visible to monitoring
- stuck detection is less dependent on stale completion timestamps

### 3. Job result payload compaction

Implemented in:

- `packages/server/src/jobs/job-result-serializer.ts`
- `packages/server/src/jobs/job-progress.ts`
- `packages/server/src/jobs/scheduler.ts`

Completed changes:

- audit metadata now uses summarized job result payloads
- Redis progress payloads are compacted before storage
- `check-live-trigger` progress keeps operator-useful fields but drops heavy prompt/debug blobs
- `re-evaluate` progress stores discrepancy count plus a bounded sample, not an unbounded full array

Operational effect:

- lower Redis and audit log bloat
- job output remains useful for UI and incident review

### 4. Reference-data job truthfulness

Implemented in:

- `packages/server/src/lib/league-team-directory.service.ts`
- `packages/server/src/jobs/sync-reference-data.job.ts`

Completed changes:

- team-directory refresh now reports source state:
- `fresh_cache`
- `provider_refreshed`
- `remote_refreshed`
- `stale_fallback`
- `empty_provider`
- sync job now counts refreshed, skipped-fresh, stale-fallback, empty, and failed separately

Operational effect:

- `sync-reference-data` no longer reports every fulfilled call as a successful refresh

### 5. Provider-insight job metric cleanup

Implemented in `packages/server/src/jobs/refresh-provider-insights.job.ts`.

Completed changes:

- removed misleading `oddsRefreshed` reporting
- replaced vague counters with:
- `fixturesAvailable`
- `fixtureRefreshed`
- `eventRefreshed`
- `statisticsRefreshed`
- `lineupsRefreshed`
- `predictionsRefreshed`
- `standingsRefreshed`

Operational effect:

- output now matches what the job is actually doing in the non-live prewarm path

### 6. Housekeeping hardening

Implemented in:

- `packages/server/src/jobs/purge-audit.job.ts`
- `packages/server/src/config.ts`

Completed changes:

- housekeeping now runs phased cleanup with per-phase failure capture instead of one all-or-nothing `Promise.all`
- added `failedPhases`
- switched vacuum targeting to per-table thresholds
- added explicit opt-in retention for `user_recommendation_deliveries` via `RECOMMENDATION_DELIVERIES_KEEP_DAYS`
- default remains disabled (`0`) unless the deployment opts in

Operational effect:

- one failed cleanup phase no longer masks all other successful retention work
- retention policy for delivery history is now explicit instead of implicit

### 7. Expire-watchlist reporting

Implemented in:

- `packages/server/src/repos/watchlist.repo.ts`
- `packages/server/src/jobs/expire-watchlist.job.ts`

Completed changes:

- added `expireOldEntriesDetailed()`
- job now returns:
- `expiredSubscriptions`
- `refreshedSubscriberCounts`
- `deletedMonitoredMatches`
- `totalChanged`

Operational effect:

- watchlist cleanup is now measurable instead of returning a single lossy aggregate

### 8. Settlement orchestration drift reduction

Implemented in:

- `packages/server/src/lib/settlement-history-hydration.ts`
- `packages/server/src/jobs/auto-settle.job.ts`
- `packages/server/src/jobs/re-evaluate.job.ts`

Completed changes:

- centralized shared finished-fixture hydration
- centralized shared regular-time score hydration
- centralized shared archive-row building for settlement history

Operational effect:

- `auto-settle` and `re-evaluate` now share the same history hydration path for finished fixtures and regular-time score backfill

### 9. Prematch job durability and fairness improvements

Implemented in:

- `packages/server/src/jobs/update-predictions.job.ts`
- `packages/server/src/jobs/enrich-watchlist.job.ts`

Completed changes:

- replaced process-local force flags with Redis-backed force keys plus in-memory fallback
- `update-predictions` now sorts by kickoff priority
- `enrich-watchlist` now sorts by top-league priority and kickoff proximity

Operational effect:

- manual force is no longer limited to one process when Redis is available
- backlog handling is more deliberate than a raw watchlist sweep

### 10. Fetch-matches decomposition

Implemented in:

- `packages/server/src/jobs/fetch-matches.job.ts`
- `packages/server/src/jobs/sync-watchlist-metadata.job.ts`
- `packages/server/src/jobs/auto-add-top-league-watchlist.job.ts`
- `packages/server/src/jobs/auto-add-favorite-team-watchlist.job.ts`
- `packages/server/src/jobs/watchlist-side-effects.shared.ts`
- `packages/server/src/jobs/scheduler.ts`
- `packages/server/src/config.ts`

Completed changes:

- `fetch-matches` now only handles fixture ingest, stats enrichment, archive, replace-all, and adaptive polling
- watchlist metadata sync moved into its own job
- top-league auto-add moved into its own job
- favorite-team auto-add moved into its own job
- the scheduler now tracks these as separate operational units with independent status and failure surfaces

Operational effect:

- ingest can succeed or fail independently from watchlist side effects
- retries and incidents are now scoped to the actual failing responsibility
- watchlist automation is no longer able to contaminate core fixture-ingest status

### 11. Persistent job run history and admin observability

Implemented in:

- `packages/server/src/db/migrations/037_job_run_history.sql`
- `packages/server/src/repos/job-runs.repo.ts`
- `packages/server/src/jobs/scheduler.ts`
- `packages/server/src/routes/jobs.routes.ts`
- `packages/server/src/jobs/purge-audit.job.ts`

Completed changes:

- added persistent `job_run_history` storage for success, failure, and strict-lock skip events
- persisted per-run `scheduled_at`, `started_at`, `completed_at`, `lag_ms`, `duration_ms`, `degraded_locking`, `lock_policy`, and summary/error fields
- `GET /api/jobs` now carries 24h history summary per job
- added `GET /api/jobs/runs` for recent run history plus overview window
- housekeeping now purges old job run history using `JOB_RUN_HISTORY_KEEP_DAYS`

Operational effect:

- scheduler state is no longer only an in-memory/Redis snapshot
- degraded local locking and lag are visible over time instead of only on the last run
- admin tooling can inspect historical job behavior without mining generic audit logs

### 12. Failure-injection and backlog coverage

Implemented in:

- `packages/server/src/__tests__/scheduler.test.ts`
- `packages/server/src/__tests__/update-predictions.job.test.ts`
- `packages/server/src/__tests__/enrich-watchlist.job.test.ts`

Completed changes:

- added scheduler coverage for strict-lock skip persistence when Redis is unavailable
- added scheduler coverage for pending rerun retention when a single-concurrency job overruns its interval
- added prematch backlog ordering checks for `update-predictions`
- added prematch backlog ordering checks for `enrich-watchlist`

Operational effect:

- the key failure modes from the audit now have regression tests, not only implementation changes

## Verification

Typecheck:

- `npm run typecheck --prefix packages/server`

Result:

- pass

Job-focused verification:

- `npm test --prefix packages/server -- src/__tests__/scheduler.test.ts src/__tests__/jobs.routes.test.ts src/__tests__/live-monitor.routes.test.ts src/__tests__/job-progress.test.ts src/__tests__/fetch-matches.job.test.ts src/__tests__/sync-watchlist-metadata.job.test.ts src/__tests__/auto-add-top-league-watchlist.job.test.ts src/__tests__/auto-add-favorite-team-watchlist.job.test.ts src/__tests__/refresh-live-matches.job.test.ts src/__tests__/refresh-provider-insights.job.test.ts src/__tests__/sync-reference-data.job.test.ts src/__tests__/check-live-trigger.job.test.ts src/__tests__/update-predictions.job.test.ts src/__tests__/enrich-watchlist.job.test.ts src/__tests__/expire-watchlist.job.test.ts src/__tests__/purge-audit.job.test.ts src/__tests__/integration-health.job.test.ts src/__tests__/health-watchdog.job.test.ts src/__tests__/auto-settle.test.ts src/__tests__/auto-settle.integration.test.ts src/__tests__/re-evaluate.test.ts src/__tests__/watchlist.repo.test.ts src/__tests__/league-team-directory.service.test.ts`

Result:

- `23` test files passed
- `196` tests passed

## Residual Notes

The highest-risk findings from the audit were fixed in this session.

Residual items after this pass:

- the new `job_run_history` table is added via migration `037_job_run_history.sql`; runtime environments still need that migration applied
- run history is now persisted and queryable, but there is not yet a dedicated frontend dashboard consuming `/api/jobs/runs`
- soak coverage is implemented as failure-injection regression tests in Vitest, not as a long-running staging burn-in harness
