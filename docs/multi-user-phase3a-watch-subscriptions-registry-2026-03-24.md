# Multi-User Phase 3A: Watch Subscriptions Registry

Date: 2026-03-24

## 1. Scope

This slice starts phase 3 from the design doc with the smallest safe cut:

- add `monitored_matches`
- add `user_watch_subscriptions`
- move self-service `/api/watchlist` reads and writes to user-owned subscriptions
- preserve job compatibility through monitored-first operational repo entrypoints while legacy rows are backfilled during the transition

This slice does not yet implement `user_recommendation_deliveries`.

## 2. Why Phase 3 Is Split

The full phase 3 design combines two separate concerns:

1. replacing global watch ownership with user subscriptions
2. adding a per-user delivery history/evaluation layer

Doing both at once would create a high-risk blast radius across watchlist routes, enrichment jobs, live-trigger jobs, recommendation notification logic, and the UI state model.

Phase 3A therefore only establishes the shared-demand registry and user-owned watch subscriptions first.

## 3. Data Model

### 3.1 New Tables

- `monitored_matches`
  - shared runtime registry keyed by `match_id`
  - stores subscriber count and shared watch metadata used by jobs
- `user_watch_subscriptions`
  - per-user watch ownership
  - one row per `(user_id, match_id)`

### 3.2 Legacy Compatibility

The legacy `watchlist` table remains in place temporarily.

It is still used for:

1. legacy job-created global rows such as top-league and favorite-team auto-add flows
2. compatibility and backfill seeding while the registry migration is still in progress

Conformance note:

- self-service user-scoped repo reads and mutations no longer fall back to legacy `watchlist` rows
- legacy fallback remains only for global and job compatibility paths during the remaining migration window
- global and job callers now use explicit operational repo entrypoints so self-service semantics are no longer reused implicitly in backend job code
- fetch-time auto-add flows now seed monitored operational rows instead of creating new legacy `watchlist` rows
- refresh-time backfill now seeds monitored rows for existing active legacy watchlist entries
- operational bulk reads and single-match lookups now mirror active legacy rows into monitored rows on access when needed
- operational validation tooling and summary counting are being moved off direct legacy `watchlist` assumptions toward operational/shared-demand semantics
- enrich-watchlist kickoff-window resolution now uses `matches` plus monitored metadata fallback instead of reading legacy `watchlist` rows directly
- check-live-trigger counter updates now write only to monitored metadata instead of updating legacy `watchlist` counters
- operational updates from enrich, prediction, and validation flows now persist to monitored metadata without mutating legacy `watchlist` runtime fields
- fetch-refresh now backfills legacy active rows first and then synchronizes date/kickoff on monitored metadata, removing another legacy-first operational step
- active operational bulk reads for enrich, live-trigger, validation, and prediction jobs now resolve from monitored rows only after backfill
- single-match operational lookups now mirror accessed legacy rows into monitored state even when the legacy row is non-active
- all-status operational bulk reads now also treat legacy watchlist as backfill-only and read monitored state after the backfill step
- expire-watchlist now backfills first and then removes completed user subscriptions, pruning monitored rows when no subscribers remain, removing legacy watchlist status writes from the operational lifecycle
- self-service create, update, delete, and match lookup paths are now explicitly user-scoped only; legacy no-userId helper branches have been removed from the main repo surface
- frontend match-detail watch lookup now resolves through canonical watch-subscription list data instead of relying on the retired legacy `/api/watchlist/:matchId` route
- the watchlist UI no longer treats `expired` as a normal user-facing filter state because completed watches are cleanup targets, not durable history

## 4. Route Behavior

### 4.1 Self-Service Watchlist

Conformance note:

- this slice intentionally started from the legacy `/api/watchlist` route contract during the transition
- the design-aligned `/api/me/watch-subscriptions` contract is now the only self-service path in the repo
- the legacy `/api/watchlist` self-service bridge has been retired

Current canonical self-service contract:

- `GET /api/me/watch-subscriptions`
- `GET /api/me/watch-subscriptions/:id`
- `POST /api/me/watch-subscriptions`
- `PUT /api/me/watch-subscriptions/:id`
- `PATCH /api/me/watch-subscriptions/:id`
- `DELETE /api/me/watch-subscriptions/:id`

Client migration note:

- the frontend service layer now prefers the canonical `/api/me/watch-subscriptions` path for authenticated watch subscription reads and creates
- update and delete flows are now canonical subscription-ID flows in the current repo frontend/backend path
- the remaining legacy `/api/watchlist` surface in this repo is now operational admin only

Repo isolation note:

- authenticated user-scoped repository reads and mutations no longer fall back to legacy `watchlist` rows when no `user_watch_subscriptions` row exists
- this prevents self-service consumers from silently reading or mutating shared global watch rows

New writes create or update `user_watch_subscriptions` and ensure a `monitored_matches` row exists.

### 4.2 Operational Endpoints

The following remain operational endpoints and require `admin` or `owner`:

- `POST /api/watchlist/:matchId/check`
- `POST /api/watchlist/expire`

## 5. Job Compatibility Strategy

During phase 3A, repo reads used by jobs now resolve from monitored state after backfill and mirroring.

Legacy `watchlist` rows remain as a transitional source for:

- backfill into `monitored_matches`
- last-resort compatibility when a legacy row still cannot be mirrored on demand

User-scoped self-service reads and mutations remain isolated to `user_watch_subscriptions`.

Implementation note:

- backend jobs and pipeline runtime now call explicit operational repo entrypoints for aggregated watch metadata and legacy-bridge updates
- this is an intermediate architecture step that keeps compatibility behavior intact while making the remaining migration surface explicit and auditable
- monitored operational rows now participate in expiry-state maintenance so auto-added shared-demand rows do not remain implicitly active forever
- fetch-matches now also backfills active legacy rows into monitored rows so operational reads can progressively stop depending on legacy-only rows
- operational access-path mirroring now shrinks legacy-only reads further during normal runtime, especially for pipeline and job lookups by `match_id`
- enrich-watchlist kickoff-window evaluation no longer depends on legacy watchlist rows after monitored backfill/mirroring
- check-live-trigger now also treats monitored metadata as the sole counter state for operational live-check increments
- updateOperationalWatchlistEntry is now monitored-first, so operational runtime mutations no longer depend on legacy watchlist row updates
- fetch-matches refresh now uses monitored-first date/kickoff synchronization after backfill instead of syncing legacy watchlist rows
- active-job read paths no longer merge legacy active rows after backfill, narrowing the remaining hybrid surface to non-active compatibility paths
- getOperationalWatchlistByMatchId now mirrors non-active legacy rows as well, shrinking raw legacy fallback to true last-resort cases
- getAllOperationalWatchlist now reads monitored state only after backfilling all legacy rows, shrinking the remaining hybrid surface to expiry/status bridge behavior
- expireOldEntries now performs cleanup deletion for completed subscriptions and prunes monitored rows without remaining subscribers, so watchlist state stays temporary while recommendations remain the durable history
- frontend app-state now re-resolves canonical subscription IDs before update/delete when local state is missing them, so normal UI edit/remove flows stay on `/api/me/watch-subscriptions/:id`
- frontend update/delete service calls are now canonical-ID only; the current repo frontend no longer relies on `/api/watchlist/:matchId` for self-service watch mutations

This keeps these job families functional without forcing an immediate full delivery-layer rewrite:

- `check-live-trigger`
- `enrich-watchlist`
- `update-predictions`
- `expire-watchlist`
- `fetch-matches` auto-add flows

## 6. Deferred To Phase 3B

Still deferred after this slice:

1. `user_recommendation_deliveries`
2. delivery eligibility evaluation per user
3. notification fanout based on delivery rows instead of global reads
4. removal of legacy `watchlist` fallback paths
5. eventual retirement or renaming of `/api/watchlist` operational admin endpoints after monitored/admin contracts are finalized