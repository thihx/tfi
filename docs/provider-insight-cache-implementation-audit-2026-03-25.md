# Provider Insight Cache Implementation Audit

Date: 2026-03-25
Reference: [provider-insight-cache-architecture-2026-03-25.md](./provider-insight-cache-architecture-2026-03-25.md)

## Scope Implemented

This implementation now delivers the main cache-first runtime slice of the architecture:

- durable Postgres odds cache via `provider_odds_cache`
- durable Postgres fixture/stats/events cache via `provider_fixture_cache`, `provider_fixture_stats_cache`, and `provider_fixture_events_cache`
- durable scout-domain cache via `provider_fixture_lineups_cache`, `provider_fixture_prediction_cache`, and `provider_league_standings_cache`
- cache-first odds resolution in the server insight layer
- cache-first fixture/scout reads through `provider-insight-cache.ts`
- scheduler-owned refresh via `refresh-provider-insights`
- pipeline, proxy, and frontend consumer compatibility with semantic source values

## What Now Matches The Design

### 1. Consumer contract is no longer provider-specific for odds

Implemented:

- external consumers now receive semantic `odds_source` values:
  - `live`
  - `fallback-live`
  - `reference-prematch`
  - `none`
- provider-specific source names are retained only inside the insight/cache layer metadata

Result:

- changing live odds providers later should not require prompt/business/UI changes as long as the semantic source contract remains stable

### 2. Resolver is now cache-first

Implemented:

- `resolveMatchOdds(...)` checks durable cached odds first
- fresh cache hits avoid direct provider calls
- stale cache can be used as degraded fallback when fresh refresh returns no usable odds

Result:

- runtime demand is less tightly coupled to provider round-trips for odds

### 3. Cache metadata is now explicit

Implemented:

- freshness classes returned to consumers:
  - `fresh`
  - `stale_ok`
  - `stale_degraded`
  - `missing`
- cache status returned to consumers:
  - `hit`
  - `refreshed`
  - `stale_fallback`
  - `miss`

Result:

- callers can reason about whether they are seeing fresh, refreshed, or degraded cached data

### 4. Proxy contract is now semantically truthful

Implemented:

- `/api/proxy/football/odds` no longer lies that `none` is `pre-match`
- route now returns actual semantic source plus freshness/cache metadata

Result:

- cache behavior is debuggable
- downstream consumers can distinguish no-odds from prematch-reference odds

## Gaps Versus Full Design

### 1. Most hot runtime domains are now implemented, but not every provider domain

Implemented now:

- fixture core cache
- live statistics cache
- live events cache
- scout lineups cache
- scout prediction cache
- scout standings cache
- aggregated insight object for pipeline and scout reads

Still missing:

- broader reference-data cache coverage outside scout/live paths
- a unified cache-first boundary for every remaining provider-backed route such as `league-fixtures`

Impact:

- runtime hot paths no longer need direct provider calls for odds, fixtures, stats, events, or core scout reads
- some colder routes and auxiliary enrichment paths still remain partially provider-backed

### 2. Scheduler-driven refresh ownership is now partial but real

Implemented:

- dedicated `refresh-provider-insights` job is registered in the scheduler
- refresh job warms fixture, stats, events, lineups, prediction, standings, and odds caches for live and watched matches

Still missing:

- richer overdue refresh prioritization / backlog orchestration
- more explicit separation between refresh cadence classes per domain beyond current adaptive TTLs

Impact:

- the system now has a supply-side cache warming owner for core live/scout domains
- some cache refresh still remains demand-assisted instead of fully queue-owned

### 3. Observability is partial

Still missing:

- cache hit-rate metrics
- direct bypass metrics
- freshness dashboards
- backlog dashboards

Current behavior:

- provider sampling still exists, but cache-specific operational visibility is not implemented yet

### 4. Business logic is decoupled for the main live/scout domains, not odds only

Implemented:

- provider-specific odds naming no longer leaks into business logic/UI contracts
- pipeline fixture/stats/events reads now go through the insight layer
- proxy live-fixtures and proxy scout reads now go through the insight layer

Still missing:

- the same abstraction treatment for every remaining provider-backed auxiliary route and job

## Validation Completed

Focused validation passed:

- server odds resolver tests
- proxy scout route tests
- proxy route odds contract tests
- frontend match merger odds handling tests
- server pipeline runtime tests for prematch and fallback-live paths
- replay pipeline runtime tests for semantic odds source handling
- server TypeScript typecheck after cache-layer expansion

## Recommended Next Phase

The next implementation phase should be:

1. move remaining provider-backed auxiliary routes such as `league-fixtures` behind the same local-first abstraction where it materially helps
2. add cache-specific observability: hit rate, refresh latency, stale-fallback volume, per-domain freshness age
3. decide whether prematch `update-predictions` should converge into the same scout prediction cache instead of maintaining a parallel watchlist-only store
4. tighten refresh orchestration with clearer backlog or priority ownership

## Bottom Line

This implementation materially advances the architecture, but it is still a first slice.

Achieved now:

- odds consumers are shielded from provider identity
- live runtime reads for odds, fixtures, stats, events, and scout core domains are cache-first
- scheduler-owned refresh exists for the main provider insight domains
- cache freshness is explicit across the implemented domains

Not achieved yet:

- full provider-call decoupling for every provider-backed route and maintenance path
- end-to-end observability promised in the target architecture
- deeper refresh orchestration and freshness dashboards