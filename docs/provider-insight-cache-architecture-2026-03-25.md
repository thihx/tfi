# Provider Insight Cache Architecture

Date: 2026-03-25

## 1. Executive Summary

TFI currently behaves like a single-user system in several provider-facing paths:

- hot paths fetch live provider data on demand
- the server pipeline resolves live stats, events, and odds directly from providers
- proxy routes expose provider-backed reads directly to callers
- some jobs already batch or skip intelligently, but there is no unified cache-first read model

This is acceptable for one user or a small operator-only workload. It does not scale for multi-user usage where hundreds or thousands of users may watch the same live slate at the same time.

The required architectural change is:

- TFI consumers must read provider-derived data from a TFI-owned insight/cache layer
- only dedicated ingestion jobs may call external providers directly
- cache freshness must be adaptive by match state and business importance
- downstream consumers must tolerate bounded staleness instead of demanding direct provider round-trips

The goal is not merely to reduce traffic. The goal is to make TFI's read side scale independently from user count.

## 2. Problem Statement

### 2.1 Current Risk

Today, the effective cost of provider traffic still scales too closely with runtime demand:

- more live matches increase provider traffic
- more user-triggered reads increase provider traffic
- more re-analysis pressure increases provider traffic
- multiple consumers can fetch the same provider data repeatedly within a short time window

This creates four concrete risks:

1. provider rate-limit exhaustion
2. unnecessary latency in live analysis paths
3. higher operating cost per active user
4. cascading partial outages when a provider degrades

### 2.2 Desired Operating Model

The desired model is:

- provider calls are supply-side only
- user reads are cache-side only
- insight generation is centralized and shared across all users
- TFI can degrade gracefully by serving slightly stale data instead of failing hard

## 3. What The Code Does Today

### 3.1 Existing Good Foundations

The current codebase already has some pieces that should be preserved:

- `fetch-matches` uses adaptive skip logic in [fetch-matches.job.ts](../packages/server/src/jobs/fetch-matches.job.ts)
- provider sampling exists in [provider-sampling.ts](../packages/server/src/lib/provider-sampling.ts)
- durable finished-match storage exists in [matches-history.repo.ts](../packages/server/src/repos/matches-history.repo.ts)
- current canonical kickoff UTC work already improved timing correctness
- watch subscriptions are already user-scoped while match state is system-scoped

This means TFI is not starting from zero. It already has the right domain split between user intent and system match state.

### 3.2 Direct Provider Call Paths Still Present

#### A. Active-slate ingestion

[fetch-matches.job.ts](../packages/server/src/jobs/fetch-matches.job.ts) directly calls:

- `fetchFixturesForDate(...)`
- `fetchFixtureStatistics(...)` for live matches

This job is acceptable as a provider-ingestion job, but today it writes mainly into active tables and not into a generalized read cache for all consumers.

#### B. Live analysis pipeline

[server-pipeline.ts](../packages/server/src/lib/server-pipeline.ts) directly calls:

- `fetchFixtureStatistics(...)`
- `fetchFixtureEvents(...)`
- `resolveMatchOdds(...)`
- benchmark/fallback provider helpers

This is the most important hot path to redesign. The pipeline is the core consumer that should become cache-first.

#### C. Odds resolution

[odds-resolver.ts](../packages/server/src/lib/odds-resolver.ts) directly calls:

- API-Football live odds
- The Odds API exact-event odds
- API-Football pre-match odds

This is already centralized as a resolver, which is good, but it still performs live provider resolution inline per consumer request.

#### D. Proxy routes

[proxy.routes.ts](../packages/server/src/routes/proxy.routes.ts) still exposes provider-backed reads:

- `/api/proxy/football/live-fixtures`
- `/api/proxy/football/odds`
- `/api/proxy/football/scout`
- `/api/proxy/football/league-fixtures`

These routes are operationally dangerous in a multi-user system because they bypass a shared cache layer.

#### E. Settle and re-evaluate fallback

`auto-settle` and `re-evaluate` still call Football API when local data is incomplete.

This is acceptable as a later-stage fallback, but it should be reduced further by expanding finished-match cache completeness.

### 3.3 Structural Observation

The codebase currently has:

- multiple provider consumers
- some provider instrumentation
- no unified provider insight cache
- no explicit freshness contract per data type
- no single read API for cached provider-backed data

That is the core architecture gap.

## 4. Design Goals

The new architecture must satisfy all of the following.

### 4.1 Scale Goals

- provider call volume should scale primarily with active match count, not user count
- repeated reads for the same match should hit TFI cache, not the provider
- multiple consumers should share the same normalized live state

### 4.2 Product Goals

- live analysis should remain low-latency
- watchlist and UI should still feel near-real-time for live matches
- stale reads must stay within controlled freshness windows

### 4.3 Reliability Goals

- provider degradation should reduce freshness before causing full feature failure
- failed refreshes should preserve the last known good snapshot
- consumers should know whether data is fresh, stale, or degraded

### 4.4 Architecture Goals

- consumers never need provider-specific logic
- provider normalization happens once per refresh cycle
- cache policy is explicit and observable
- ingestion, normalization, and consumption are separate concerns

## 5. Non-Goals

This design does not aim to:

- build a perfect event-streaming system in one phase
- eliminate all direct provider calls on day one
- fully redesign settlement and historical pipelines before the live-cache layer ships
- force all consumers onto Redis-only or Postgres-only storage immediately

The migration must be incremental.

## 6. Proposed Target Architecture

### 6.1 Layer Model

The target model has three layers.

#### Layer A. Provider Ingestion Layer

Only dedicated jobs call external providers.

Responsibilities:

- decide what matches require refresh
- fetch provider data in batches when possible
- normalize raw provider payloads
- publish normalized snapshots into TFI cache/storage
- record refresh metadata and provider telemetry

#### Layer B. TFI Insight Cache Layer

This becomes the internal source of truth for provider-backed runtime reads.

Responsibilities:

- store latest normalized fixture snapshot
- store latest normalized live stats snapshot
- store latest normalized live events snapshot
- store latest resolved odds snapshot and source provenance
- store freshness metadata and cache health
- store last successful provider payload metadata for debugging and sampling

#### Layer C. Consumer Layer

Consumers read only from TFI.

Consumers include:

- server pipeline
- auto scan / check-live-trigger flow
- proxy routes
- UI reads needing live state
- future per-user personalization logic depending on shared live state

Consumers should not know whether the backing data is fresh from 5 seconds ago or 45 seconds ago. They only consume the freshness contract.

### 6.2 Core Principle

The core principle is:

- fetch once per match state window
- read many times per user and per feature

## 7. Data Domains To Cache

Not all provider data has the same volatility. The cache design must separate domains.

### 7.1 Fixture Core Snapshot

Purpose:

- current score
- current minute
- live status
- team and league metadata
- kickoff timestamp
- halftime and final score fragments

Volatility:

- moderate during live matches
- low pre-match
- frozen after FT

### 7.2 Live Statistics Snapshot

Purpose:

- possession
- shots
- shots on target
- corners
- cards
- fouls and other provider-supported stats

Volatility:

- high during live matches

### 7.3 Live Events Snapshot

Purpose:

- goals
- cards
- substitutions
- VAR / incident timeline

Volatility:

- bursty, but high-value for pipeline reasoning

### 7.4 Odds Snapshot

Purpose:

- best current odds view with provenance
- source mix among live odds, The Odds API, and pre-match fallback
- normalized market availability flags

Volatility:

- high during live
- moderate pre-match

### 7.5 Scout / Enrichment Snapshot

Purpose:

- pre-match prediction
- standings
- lineups when available

Volatility:

- low to medium
- should not be refreshed at the same cadence as live stats

## 8. Storage Model

### 8.1 Recommended First Implementation

Use Postgres as the durable system-of-record cache and Redis as an optional low-latency acceleration layer.

Phase 1 recommendation:

- Postgres stores normalized provider insight snapshots and metadata
- Redis stores short-lived hot keys for the most active live matches

This avoids over-optimizing too early while still enabling near-real-time hot reads.

### 8.2 Suggested Tables

The exact schema can be refined later, but the logical storage should include these entities.

#### `provider_match_cache`

One row per match.

Stores:

- `match_id`
- `kickoff_at_utc`
- `fixture_status`
- `current_minute`
- `home_score`
- `away_score`
- `halftime_home`
- `halftime_away`
- `provider_updated_at`
- `cached_at`
- `freshness_class`
- `degraded`
- `last_refresh_error`

#### `provider_match_stats_cache`

One row per match per stats snapshot.

Stores:

- `match_id`
- normalized aggregate stats JSONB
- `provider_updated_at`
- `cached_at`
- `refresh_version`

#### `provider_match_events_cache`

One row per match per events snapshot.

Stores:

- `match_id`
- normalized events JSONB
- `provider_updated_at`
- `cached_at`
- `refresh_version`

#### `provider_match_odds_cache`

One row per match.

Stores:

- `match_id`
- `odds_source`
- normalized odds JSONB
- `odds_fetched_at`
- `cached_at`
- `has_1x2`
- `has_ou`
- `has_ah`
- `has_btts`

#### `provider_refresh_state`

Job control and freshness state.

Stores:

- `match_id`
- `domain` such as `fixture`, `stats`, `events`, `odds`, `scout`
- `next_refresh_at`
- `last_attempt_at`
- `last_success_at`
- `failure_count`
- `backoff_until`

### 8.3 Why Not Redis-Only

Redis-only is not sufficient because TFI needs:

- durable debugging trails
- provider freshness observability
- safe warm restarts without losing all state
- the ability to analyze refresh performance historically

Redis is useful, but not enough as the only store.

## 9. Freshness Strategy

The cache must be adaptive, not fixed-rate.

### 9.1 Freshness Classes

Suggested freshness classes:

- `ultra_hot`
- `hot`
- `warm`
- `cold`
- `frozen`

### 9.2 Match-State Refresh Policy

#### Pre-match, kickoff > 6h

- fixture core: every 30 min
- odds: every 15 min
- scout: every 60 min
- stats/events: not needed

#### Pre-match, kickoff within 6h

- fixture core: every 5 min
- odds: every 2 min
- scout: every 15 min

#### Pre-match, kickoff within 30 min

- fixture core: every 1 min
- odds: every 30 sec to 1 min
- lineups/scout: every 2 min

#### Live, minute 1-75

- fixture core: every 15 to 30 sec
- stats: every 20 to 30 sec
- events: every 10 to 20 sec
- odds: every 15 to 30 sec

#### Live, late phase 75+

- fixture core: every 10 to 15 sec
- stats: every 15 to 20 sec
- events: every 8 to 15 sec
- odds: every 10 to 20 sec

#### Halftime

- fixture core: every 30 sec
- stats: every 30 sec
- odds: every 30 sec

#### Finished

- fixture core: freeze after verification
- stats/events/odds: no regular refresh
- if settlement-critical data is incomplete, allow bounded catch-up refreshes

### 9.3 Importance-Based Modifiers

Refresh cadence should also be affected by:

- count of active user watch subscriptions on the match
- whether a match is top league
- whether a match is inside the analysis window
- whether a match currently has pending recommendation or settlement work

This allows a low-interest match to refresh slower than a high-interest match in the same global state class.

## 10. Scheduling Model

### 10.1 Replace Consumer Pull With Central Scheduler Pull

The scheduler should own provider demand.

Recommended jobs:

- `refresh-provider-fixtures`
- `refresh-provider-stats`
- `refresh-provider-events`
- `refresh-provider-odds`
- `refresh-provider-scout`
- `reconcile-finished-provider-cache`

These may later collapse into one orchestrator, but keeping them logically separate clarifies different refresh cadences and failure handling.

### 10.2 Candidate Selection

Each refresh job should work from an internally computed candidate set:

- active matches from `matches`
- tracked matches from `user_watch_subscriptions`
- recently finished matches still inside settlement window
- matches with overdue or stale provider cache rows

Selection should not come from user requests.

### 10.3 Batching Rules

When provider APIs support batch fetches, use them.

Examples:

- fixtures by multiple ids
- fixtures by date for active slate refresh

When APIs are per-match only, the scheduler must still deduplicate within the refresh cycle and cap concurrency.

## 11. Consumer Contract

### 11.1 Server Pipeline

[server-pipeline.ts](../packages/server/src/lib/server-pipeline.ts) should stop fetching provider data inline.

Instead it should request a single aggregated cached insight object, for example:

- fixture snapshot
- stats snapshot
- events snapshot
- odds snapshot
- freshness metadata

If cache freshness is below the required threshold, the pipeline should either:

- continue with stale-but-acceptable data
- mark the run as degraded
- queue an urgent refresh request

It should not call the provider directly except in explicitly approved emergency fallback paths.

### 11.2 Proxy Routes

[proxy.routes.ts](../packages/server/src/routes/proxy.routes.ts) should become cache-backed read routes.

This means:

- `/api/proxy/football/live-fixtures` reads cached fixture snapshots
- `/api/proxy/football/odds` reads cached odds snapshots
- `/api/proxy/football/scout` reads cached scout snapshots
- direct provider-backed routes become admin/debug-only, not regular runtime endpoints

### 11.3 UI

UI should read only from TFI APIs that already reflect cache freshness.

The UI should not care whether data came from:

- API-Football 12 seconds ago
- The Odds API 45 seconds ago
- a degraded stale snapshot after provider failure

The UI should receive a freshness descriptor and render it if needed.

## 12. Fallback Policy

### 12.1 Default Rule

Default rule:

- stale data is better than no data, within a bounded freshness budget

### 12.2 Degradation Levels

Suggested levels:

- `fresh`
- `stale_ok`
- `stale_degraded`
- `missing`

### 12.3 Emergency Direct Fetch

Direct provider fetch from a consumer should be treated as an exception path only when:

- the cache is missing critical data
- a refresh request is already overdue or failed
- the consumer action is high value enough to justify emergency provider cost

All such emergency fetches must be audited and sampled separately.

## 13. Observability Requirements

This design only works if cache freshness is visible.

Required metrics:

- cache hit rate by domain and consumer
- direct provider fetch count by consumer
- refresh latency p50/p95 by domain
- stale read rate by consumer
- refresh failure rate by provider and domain
- matches by freshness class
- emergency fallback count

Required dashboard cards:

- current hot match count
- provider refresh backlog
- cache freshness distribution
- direct fetch bypass count
- provider quota burn estimate

## 14. Migration Plan

### Phase 0. Architecture Guardrails

- define cache-owned interfaces first
- add explicit freshness metadata types
- identify all current direct provider consumers

### Phase 1. Fixture Core Cache

- make active slate refresh write into provider fixture cache
- add cache-backed read APIs for fixture core
- switch UI and non-critical reads to cache first

### Phase 2. Odds Cache

- extract odds refresh into centralized job logic
- materialize normalized odds snapshots into provider odds cache
- switch `resolveMatchOdds(...)` consumers to cache reads

### Phase 3. Stats And Events Cache

- materialize live stats and events snapshots
- switch server pipeline to aggregated cached insight reads

### Phase 4. Proxy Route Conversion

- remove direct provider reads from runtime proxy routes
- keep provider-direct endpoints only behind admin/debug policy if still needed

### Phase 5. Settlement Catch-Up

- extend finished-match cache completeness to reduce remaining fallback fetches in auto-settle and re-evaluate

## 15. Recommended First Slice

The best first slice is not the entire system. It is:

1. introduce `provider_match_cache` and `provider_match_odds_cache`
2. centralize odds refresh for live and near-live matches
3. make pipeline and proxy odds reads cache-backed
4. expose freshness metadata to consumers

Reasoning:

- odds are one of the most repeated live reads
- odds already have a centralized resolver abstraction
- switching odds first proves the pattern with less schema and parsing complexity than full stats/events cache

## 16. Open Questions

These should be resolved before implementation begins.

1. What is the maximum acceptable staleness per domain for live decisioning?
2. Which consumers, if any, may still bypass cache in production?
3. Should Redis acceleration be introduced in Phase 1 or only after Postgres-backed cache proves stable?
4. Should scout data share the same cache tables or live in a separate enrichment cache domain?
5. Should direct provider proxy routes remain at all after cache-backed equivalents exist?

## 17. Final Recommendation

TFI should move to a cache-first provider architecture where:

- jobs fetch from providers
- TFI stores normalized shared insight snapshots
- all runtime consumers read from TFI cache
- freshness is adaptive and observable
- provider traffic scales with active match complexity, not with user count

This is the correct foundation for multi-user growth. Without it, every additional user increases the probability of rate-limit, latency, and cost failure. With it, TFI becomes a shared real-time intelligence system instead of a thin fan-out wrapper over provider APIs.