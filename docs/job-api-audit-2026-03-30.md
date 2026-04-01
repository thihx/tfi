# Job API Audit - 2026-03-30

## Scope

Audit all scheduler jobs that can touch `Football API` and identify why quota burn accelerated even when `Fetch Matches` did not appear to scale linearly.

## Runtime Snapshot

Observed on `2026-03-30` from production-connected DB:

- `matches`: `46`
- live matches in `matches`: `2`
- `NS` within +/-10 minutes of kickoff: `1`
- `monitored_matches`: `267`
- active user subscriptions: `0`

Last 24h scheduler executions:

- `JOB_REFRESH_LIVE_MATCHES`: `5864`
- `JOB_CHECK_LIVE_TRIGGER`: `5793`
- `JOB_FETCH_MATCHES`: `1465`
- `JOB_REFRESH_PROVIDER_INSIGHTS`: `1465`
- `JOB_AUTO_SETTLE`: `145`
- `JOB_UPDATE_PREDICTIONS`: `47`
- `JOB_SYNC_REFERENCE_DATA`: `1`

## Findings

`Fetch Matches` is not the only quota burner.

### 1. `refresh-live-matches` was a major continuous consumer

Before the fix, each run did:

- `fetchFixturesByIds` for every tracked live / near-live fixture chunk
- `fetchFixtureStatistics` for every live fixture

Current runtime metadata showed `tracked=3`, `live=2`, interval `15s`.

Estimated logical call volume:

- `1` fixture call + `2` stats calls every `15s`
- about `3 * 4 * 24 = 288` logical calls/day per tracked group
- with observed run count `5864`, practical estimate was about `17,592` logical calls/day before retries

### 2. `refresh-provider-insights` was also refreshing live fixtures every minute

Before the fix, each run force-refreshed:

- fixtures
- statistics
- events
- lineups
- odds

Current runtime metadata showed `candidates=2`, both live.

Estimated logical call volume:

- `1` fixture batch + `2` stats + `2` events + `2` lineups + `2` odds every minute
- about `9 * 1440 = 12,960` logical calls/day before retries / odds fallbacks

This job overlapped heavily with `refresh-live-matches`.

### 3. `check-live-trigger` can hit provider APIs indirectly, but is not the current primary culprit

`check-live-trigger` itself only reads DB state, then may call `runPipelineBatch`.
That pipeline can hit:

- fixture cache refresh
- statistics
- events
- odds

In the current runtime sample, recent job metadata repeatedly showed `liveCount=0`, so this path is not the present quota spike driver. It remains a secondary risk when active live watchlist volume grows.

### 4. `fetch-matches` still consumes Football API, but less than the two jobs above

It fetches:

- fixtures for date windows
- live stats for live rows
- settlement stats for newly finished fixtures

It also has adaptive skipping. Observed run count in the last 24h was `1465`, much lower than the `15s` jobs.

### 5. Secondary consumers exist but are lower-frequency

- `update-predictions`: prediction endpoint, every `30m`
- `sync-reference-data`: leagues / teams / standings, every `12h`
- `auto-settle`: fixtures-by-id and stats fallback, every `10m`

These are not the current dominant cause of the half-day burn.

## Root Cause

The spike came from overlapping background jobs that refreshed the same live match domains independently:

- `refresh-live-matches`
- `refresh-provider-insights`
- `fetch-matches`

The most wasteful overlap was that two dedicated background jobs were both polling live fixtures and live stats on short intervals, while only one small set of live matches was active.

## Fix Implemented

### `refresh-live-matches`

Changed to:

- use shared fixture cache via `ensureFixturesForMatchIds`
- reuse provider stats cache when still fresh
- call `fetchFixtureStatistics` only for stale / missing live stats
- persist refreshed stats back into provider cache

Effect:

- fixture polling now respects shared cache TTL instead of raw polling every `15s`
- live stats polling now respects TTL instead of unconditional per-run fetch

### `refresh-provider-insights`

Changed to:

- stop background prewarm for live fixtures
- only prewarm non-live watchlist candidates
- use TTL-aware `ensureScoutInsight` flow instead of unconditional force refresh

Effect:

- removes the minute-by-minute live detail refresh loop that duplicated `refresh-live-matches`
- keeps prematch insight cache warm without constant refetch

### `fetch-matches`

Changed to:

- stop calling live / finished stats endpoint directly
- route stats lookups through centralized `ensureFixtureStatistics`
- reuse provider stats cache semantics already used by other provider flows

Effect:

- the same `fixture statistics` endpoint is now controlled in one helper path for the active scheduler hot-paths

### `update-predictions`

Changed to:

- stop calling `fetchPrediction` directly from the job
- route prediction reads through centralized `ensureFixturePrediction`
- allow negative-cache behavior for `null` prediction responses

Effect:

- repeated NS prediction refreshes now reuse central prediction cache instead of each job run hitting provider directly

### `auto-settle`

Changed to:

- stop calling `fetchFixturesByIds` directly for missing final fixtures
- stop calling `fetchFixtureStatistics` directly for settlement fallback
- route fixture and stats access through centralized provider helpers first

Effect:

- settlement flow now shares fixture / stats cache behavior with the rest of the runtime instead of opening its own provider path

## Centralization Status After This Refactor

Centralized in scheduler hot-paths:

- `refresh-live-matches`
- `refresh-provider-insights`
- `fetch-matches` for fixture statistics
- `update-predictions`
- `auto-settle`
- `re-evaluate`
- `league-catalog.service.ts` through centralized reference-data provider helper
- `league-team-directory.service.ts` through centralized reference-data provider helper
- `proxy.routes.ts` for `league-fixtures` through centralized reference-data provider helper

Still not fully centralized:

- LLM response cache/dedupe layer
- any future ad-hoc provider scripts outside runtime paths

These remaining paths were not claimed as complete in this pass.

## Residual Risks

- `check-live-trigger` can still consume Football API when live watchlist analysis is active
- `update-predictions` still overlaps conceptually with prematch provider prediction cache
- `monitored_matches` volume is much larger than active subscriptions; if background jobs expand candidate selection again, waste can return quickly

## Recommended Next Steps

1. Add provider call counters per endpoint and per job run into audit metadata.
2. Add a hard cap or TTL gate around live pipeline re-analysis when multiple matches are active.
3. Review whether `update-predictions` and prematch provider-insight refresh should share one cache source instead of calling prediction endpoints separately.

## Verification

Validated locally after code changes:

- `npm test --prefix packages/server -- src/__tests__/refresh-live-matches.job.test.ts src/__tests__/refresh-provider-insights.job.test.ts src/__tests__/fetch-matches.job.test.ts`
- `npm run typecheck --prefix packages/server`
