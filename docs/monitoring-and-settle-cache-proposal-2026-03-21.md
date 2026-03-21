# Monitoring Dashboard And Settle Cache Proposal

Date: 2026-03-21

## 1. Executive Summary

There are two separate but related needs:

1. Production needs a true post-release operations dashboard, not just raw jobs, integration health, and audit logs.
2. Auto Settle still spends unnecessary Football API calls because the local DB does not retain enough finished-match data for settlement-critical use.

The highest-confidence direction is:

- Build a production monitoring dashboard on top of existing tables and panels, with a small set of new aggregated endpoints.
- Do not overload the current `matches` table with finished fixtures.
- Keep `matches` as the active slate only.
- Extend durable finished-match storage instead, using `matches_history` or a new finished-match cache table that stores settlement-critical data.
- Make Auto Settle and Re-Evaluate read local finished-match data first and call Football API only when required data is missing.
- Add one retention-driven housekeeping job that purges old operational data across audit logs, provider samples, live snapshots, odds movements, and finished-match settlement cache according to table-specific retention windows.

## 2. What The Code Does Today

### 2.1 Monitoring Surface Today

Current UI in [SettingsTab.tsx](c:/tfi/src/app/SettingsTab.tsx) exposes:

- job scheduler control
- integration health panel
- audit logs panel

Current server-side monitoring data exists in:

- [audit_logs](c:/tfi/packages/server/src/db/migrations/007_audit_logs.sql)
- [pipeline_runs](c:/tfi/packages/server/src/db/migrations/001_initial.sql)
- [provider_stats_samples](c:/tfi/packages/server/src/db/migrations/009_provider_samples.sql)
- [provider_odds_samples](c:/tfi/packages/server/src/db/migrations/009_provider_samples.sql)
- [recommendations](c:/tfi/packages/server/src/repos/recommendations.repo.ts)
- [ai_performance](c:/tfi/packages/server/src/repos/ai-performance.repo.ts)
- settlement provenance fields added in [011_settlement_audit.sql](c:/tfi/packages/server/src/db/migrations/011_settlement_audit.sql)

What is missing is an operations-oriented aggregation layer. Existing panels show raw system state, but not release-quality metrics such as:

- AI push rate
- no-bet / skip reasons
- odds provider coverage
- stats provider coverage
- settle backlog and unresolved rate
- correction rate after re-evaluation
- notification delivery success rate

### 2.2 Auto Settle Today

Current settle flow in [auto-settle.job.ts](c:/tfi/packages/server/src/jobs/auto-settle.job.ts):

1. Load unsettled recommendations and bets.
2. Look up finished matches from [matches-history.repo.ts](c:/tfi/packages/server/src/repos/matches-history.repo.ts).
3. If not found in history, call Football API `fetchFixturesByIds(...)`.
4. For all matches being settled, call Football API `fetchFixtureStatistics(...)`.
5. Use deterministic rules first, then AI fallback for unsupported markets.

Important current limitations:

- `matches_history` only stores final score/status and basic fixture metadata.
- It does not store settlement-critical stats such as corners/cards.
- It does not store normalized final stats snapshot.
- It does not store regulation-time score separately.
- Therefore Auto Settle still needs Football API for:
  - finished-result fallback when history is missing
  - statistics lookup even when history exists

### 2.3 Match Storage Today

The `matches` table is explicitly ephemeral in [matches.repo.ts](c:/tfi/packages/server/src/repos/matches.repo.ts):

- `replaceAllMatches()` does `TRUNCATE matches CASCADE`
- the table is rebuilt from the active fixture slate
- [fetch-matches.job.ts](c:/tfi/packages/server/src/jobs/fetch-matches.job.ts) archives FT matches to history before refresh

This means `matches` is not a durable source of truth for finished fixtures.

### 2.4 Watchlist/UI Today

The watchlist is a user-tracking table, not a match archive:

- backend repo: [watchlist.repo.ts](c:/tfi/packages/server/src/repos/watchlist.repo.ts)
- routes: [watchlist.routes.ts](c:/tfi/packages/server/src/routes/watchlist.routes.ts)
- UI: [WatchlistTab.tsx](c:/tfi/src/app/WatchlistTab.tsx)

Watchlist UI currently filters by watchlist item status (`active`, `expired`, `pending`), not by match final status. Match status is only joined from active `matches`.

## 3. Recommendation: Monitoring Dashboard

### 3.1 Product Goal

The goal is not another analytics report. The goal is an operator dashboard that answers:

- Is the pipeline healthy right now?
- Are recommendations being generated at expected rates?
- Are providers degrading?
- Are we missing stats or odds too often?
- Are notifications failing?
- Is settlement keeping up?
- Are corrections or unresolved outcomes increasing?

### 3.2 Recommended Dashboard Structure

Add a new section in Settings or a dedicated Ops tab with four blocks.

#### Block A. Pipeline Health

Data sources:

- [pipeline_runs](c:/tfi/packages/server/src/repos/pipeline-runs.repo.ts)
- [audit_logs](c:/tfi/packages/server/src/repos/audit-logs.repo.ts)
- [scheduler.ts](c:/tfi/packages/server/src/jobs/scheduler.ts)

Metrics:

- runs in last 1h / 24h
- average matches analyzed per run
- average saved per run
- average notified per run
- failure count by job in last 24h
- overdue jobs
- last successful run per core job

#### Block B. Recommendation Funnel

Data sources:

- [recommendations](c:/tfi/packages/server/src/repos/recommendations.repo.ts)
- audit actions from pipeline

Metrics:

- matches seen
- matches analyzed
- `should_push=true` rate
- saved rate
- notified rate
- no-bet rate
- top skip/no-bet reasons
- evidence mode distribution
- analysis mode distribution: `auto`, `system_force`, `manual_force`

#### Block C. Provider Coverage

Data sources:

- [provider_stats_samples](c:/tfi/packages/server/src/repos/provider-stats-samples.repo.ts)
- [provider_odds_samples](c:/tfi/packages/server/src/repos/provider-odds-samples.repo.ts)

Metrics:

- stats success rate by provider
- odds usable rate by provider/source
- latency p50/p95 by provider
- missing stats rate by league
- missing odds rate by league
- Live Score fallback hit rate
- Football API vs Live Score stats coverage side-by-side
- odds source mix: `live`, `the-odds-api`, `pre-match`, `none`

#### Block D. Settlement Health

Data sources:

- [recommendations](c:/tfi/packages/server/src/repos/recommendations.repo.ts)
- [bets](c:/tfi/packages/server/src/repos/bets.repo.ts)
- [ai_performance](c:/tfi/packages/server/src/repos/ai-performance.repo.ts)

Metrics:

- pending settlement count
- unresolved settlement count
- corrected settlement count last 7d / 30d
- settlement method mix: `rules`, `ai`, `manual`, `legacy`
- unresolved by market
- average settle lag from kickoff / from FT

### 3.3 Implementation Strategy

Do not build this from raw client-side aggregation.

Recommended server additions:

- new route group `GET /api/ops/*`
- repo queries that return already-aggregated cards and time-series

Suggested endpoints:

- `/api/ops/overview`
- `/api/ops/pipeline`
- `/api/ops/providers`
- `/api/ops/settlement`
- `/api/ops/notifications`

This is safer than overloading the existing reports endpoints because reports today are performance/analytics oriented, not ops oriented.

### 3.4 Monitoring Checklist

The checklist should be embedded in the dashboard and also available as a release checklist:

- All critical jobs ran successfully in last 2x interval
- Integration health overall is not `DOWN`
- Football API and Gemini are not degraded
- provider stats success rate over last 6h above threshold
- provider odds usable rate over last 6h above threshold
- unresolved settlements below threshold
- corrected settlements spike not detected
- Telegram delivery failures below threshold

## 4. Recommendation: Reduce Auto Settle Football API Usage

### 4.1 Key Conclusion

Storing FT fixtures in `watchlist` is not the right primary solution.

Reason:

- watchlist is user intent state
- finished-match cache is system state
- mixing them creates retention, UI, and semantics problems

Also, storing FT rows in the current `matches` table is not ideal because that table is intentionally ephemeral and full-refresh.

### 4.2 Preferred Design

Keep:

- `matches`: active slate only
- `watchlist`: tracked matches only

Enhance durable finished storage instead.

There are two viable options.

#### Option A. Extend `matches_history` (preferred if wanting minimal schema spread)

Add settlement-support columns:

- `regular_home_score`
- `regular_away_score`
- `final_stats JSONB`
- `final_events JSONB`
- `stats_provider`
- `result_source`
- `has_settlement_stats`

What to store in `final_stats`:

- corners
- yellow cards
- red cards
- possibly fouls if later needed

This is enough for most deterministic settle cases.

#### Option B. New table `finished_match_cache` (cleaner separation)

Schema purpose:

- one row per finished match
- normalized, settle-ready data
- not tied to live slate lifecycle

Suggested columns:

- `match_id`
- `date`
- `kickoff`
- `league_id`
- `league_name`
- `home_team`
- `away_team`
- `final_status`
- `home_score`
- `away_score`
- `regular_home_score`
- `regular_away_score`
- `final_stats JSONB`
- `final_events JSONB`
- `result_provider`
- `stats_provider`
- `captured_at`
- `expires_at` or rely on retention policy

This option is architecturally cleaner because it separates:

- live active table
- history/reporting archive
- settle-ready operational cache

### 4.3 My Recommendation Between A and B

Prefer Option B if you want long-term cleanliness.

Prefer Option A if you want faster implementation with less code churn.

Given the current codebase, Option A is likely the fastest path with acceptable complexity, because:

- `auto-settle.job.ts` already reads `matches_history`
- `re-evaluate.job.ts` already reads `matches_history`
- `fetch-matches.job.ts` already archives to `matches_history`

So the cheapest path is:

1. extend `matches_history`
2. capture final stats when a match transitions to FT
3. update settle jobs to read those fields first
4. only call Football API when fields are missing

### 4.4 When To Capture The Data

Best capture point:

- in [fetch-matches.job.ts](c:/tfi/packages/server/src/jobs/fetch-matches.job.ts), when a match is detected as FT/AET/PEN/AWD/WO

At that moment the job still has:

- fresh fixture result payload
- match identity
- final status

What it does not yet always have:

- full final stats snapshot for every FT match

Recommended change:

- when archiving a finished match, also attempt one final statistics fetch only once
- persist normalized final stats into history/cache

This is much cheaper than repeated settle-time stat fetches, because:

- one match finishes once
- settle job may revisit the same match multiple times

### 4.5 How Auto Settle Should Change

New settle resolution order:

1. read finished match from local durable store
2. if score/status present and required stats present, settle locally
3. if score exists but required stats missing, only fetch missing stats
4. if finished match not present locally, then call Football API
5. if API fetch succeeds, write back into durable store immediately

This makes Football API a backstop, not the default source.

### 4.6 Markets And Required Local Data

For each market category:

- `1x2`, `BTTS`, goals O/U, AH
  - need score
  - for `AET/PEN`, need regular-time score

- corners O/U and AH corners
  - need final corner counts

- cards O/U and AH cards
  - need final card counts and stable weighting policy

So durable finished storage must retain:

- final score
- regulation-time score
- corners
- cards

Without those fields, API cost reduction will remain partial.

## 5. Why Not Use Watchlist For FT Storage

Using watchlist itself as finished-match store is not recommended.

Problems:

- it overloads the purpose of the table
- UI filtering becomes coupled to system retention
- user deletions would interfere with settle data
- top-league auto-add/watch semantics become mixed with archive semantics

If the user still wants FT data associated with watched matches, that is fine, but it should be indirect:

- watchlist row stays as user intent
- final result/cache is stored elsewhere and joined when needed

## 6. If FT Must Be Kept Visible In DB, What Changes On UI

If you choose to keep FT rows in a DB table used by the watch/match UI, then the UI must explicitly filter them out.

For the current watchlist screen, the safest logic is:

- keep existing watchlist item status filter
- additionally hide rows whose joined match status is in `FT/AET/PEN/AWD/WO`
- or better, stop relying on current `matches` join for finished state and use a separate `is_finished` field from backend if needed

But again, this is a workaround, not the preferred architecture.

## 7. Cleanup And Retention

Current cleanup only handles audit logs in [purge-audit.job.ts](c:/tfi/packages/server/src/jobs/purge-audit.job.ts).

That is not enough anymore because the system now retains:

- audit logs
- provider stats samples
- provider odds samples
- match snapshots
- odds movements
- finished match cache/history

### 7.1 Recommended Job

Replace the narrow audit purge job with a broader housekeeping job, or extend it into a new `purge-operational-data` job.

Recommended subtasks:

- purge old `audit_logs`
- purge old `provider_stats_samples`
- purge old `provider_odds_samples`
- purge old `match_snapshots`
- purge old `odds_movements`
- purge old finished-match cache/history beyond retention

### 7.2 Recommended Retention Windows

Suggested defaults:

- `audit_logs`: 30 days
- `provider_stats_samples`: 14 days
- `provider_odds_samples`: 14 days
- `match_snapshots`: 14 days
- `odds_movements`: 14 days
- `finished match settlement cache/history`: 60 to 90 days minimum

Why longer for finished-match cache:

- re-evaluate/correction workflows may need older matches
- settlement disputes are more expensive than a small amount of DB storage

### 7.3 Implementation Style

Do not use one giant SQL statement across all tables.

Use:

- one housekeeping job
- table-specific purge functions
- individual retention env vars
- structured job result summary

That gives observability and safer rollback.

## 8. Proposed Phase Plan

### Phase A. Monitoring Dashboard MVP

- add `ops` aggregate queries and endpoints
- add dashboard panel in Settings or dedicated Ops tab
- include release checklist card
- add alert thresholds in UI

### Phase B. Finished Match Data For Settle

- extend `matches_history` or create `finished_match_cache`
- capture final stats on FT transition
- persist regulation-time score separately
- add indexes for settle lookups

### Phase C. Settle Fallback Refactor

- update Auto Settle to read local cache first
- update Re-Evaluate to read local cache first
- fetch Football API only for missing fields
- write-back on fallback success

### Phase D. Cleanup

- replace `purge-audit` with broader housekeeping job
- add per-table retention config
- expose housekeeping result in ops dashboard

## 9. Final Recommendation

If the goal is production safety plus lower cost, the best near-term plan is:

1. build the monitoring dashboard first
2. keep `matches` as active-only
3. do not use watchlist as finished archive
4. extend durable finished storage for settle-ready data
5. make Auto Settle and Re-Evaluate local-first
6. add one retention-driven housekeeping job for all operational tables

This gives the cost and speed win you want without weakening the existing live slate and watchlist semantics.
