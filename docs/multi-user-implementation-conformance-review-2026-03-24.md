# Multi-User Implementation Conformance Review

Date: 2026-03-24

## 1. Purpose

This document is the running comparison point between the target architecture in [docs/multi-user-subscription-payment-design-2026-03-24.md](docs/multi-user-subscription-payment-design-2026-03-24.md) and the code currently implemented in the repository.

Rule for ongoing development:

1. every implementation slice must be checked against the target design before moving on
2. if code intentionally deviates for compatibility or staged rollout reasons, that deviation must be recorded here and in the relevant phase document
3. if new design-relevant constraints are discovered during implementation, the target design document must be updated in the same development slice

## 2. Areas Already Aligned

### 2.1 Phase 1 Identity And Roles

Aligned in code:

1. internal `users` and `user_auth_identities` exist
2. JWT `sub` carries internal `user_id`
3. request principal is attached as `req.currentUser`
4. role-based guards are implemented for admin and owner protected operational routes

### 2.2 Phase 2 User-Owned Self-Service State

Aligned in code:

1. user settings are read and written per authenticated user with default-row fallback during transition
2. push subscriptions are owned by `user_id`
3. favorite teams are owned by `user_id`
4. dedicated notification settings are stored in `user_notification_settings`
5. if a dedicated notification-settings row is missing, first authenticated read now bootstraps and persists that row instead of repeatedly resolving legacy fallback state

API alignment status:

1. design-aligned aliases now exist for:
   - `GET/PUT /api/me/settings`
   - `GET/PUT /api/me/notification-settings`
   - `GET/POST/DELETE /api/me/favorite-teams`
   - `GET/PUT /api/me/notification-channels`
   - `GET /api/me/push/status`
   - `POST/DELETE /api/me/push/subscribe`
2. compatibility paths remain in place for current frontend consumers:
   - `/api/settings`
   - `/api/notification-settings`
   - `/api/favorite-teams`

### 2.3 Phase 3 Shared Demand And Delivery Ledger

Aligned in code:

1. `monitored_matches` exists
2. `user_watch_subscriptions` exists
3. `user_recommendation_deliveries` exists
4. recommendation creation stages delivery rows
5. users can read and update their own recommendation deliveries
6. Web Push success updates delivery rows for eligible users only
7. design-aligned watch subscription routes now exist under `/api/me/watch-subscriptions`
8. frontend service-layer watchlist reads and creates now use the canonical watch-subscriptions path, while update and delete prefer subscription IDs and retain fallback behavior during transition
9. user-scoped watch subscription repo reads and mutations no longer fall back to legacy `watchlist` rows
10. shared jobs and pipeline runtime now use explicit operational watchlist repo entrypoints instead of reusing self-service repo semantics
11. auto-add flows now seed monitored operational rows instead of creating new legacy `watchlist` rows, and monitored operational rows participate in expiry state updates
12. refresh-time backfill now seeds monitored rows for active legacy operational entries so shared-demand coverage increases without waiting for manual cleanup
13. operational bulk reads and single-match lookups now proactively mirror active legacy rows into monitored matches on access
14. operational validation tooling and dashboard watchlist counts no longer assume raw legacy `watchlist` is the primary source of truth
15. the enrich-watchlist kickoff window helper now resolves from `matches` plus `monitored_matches` metadata, not legacy `watchlist` rows
16. live-trigger check counters now update monitored metadata only, instead of writing operational counters back into legacy `watchlist` rows
17. operational watch updates for prediction, mode, priority, and strategic context now persist through `monitored_matches` metadata without writing runtime changes back into legacy `watchlist` rows
18. fetch-refresh date and kickoff synchronization now updates monitored watch metadata after legacy backfill, instead of synchronizing legacy `watchlist` rows first
19. active operational watch bulk reads now resolve from monitored rows only after backfill, so enrich, live-trigger, validation, and prediction jobs no longer merge legacy active rows at read time
20. single-match operational lookups now mirror any accessed legacy row into `monitored_matches`, including non-active rows, before falling back to raw legacy data
21. all-rows operational bulk reads now backfill legacy rows regardless of status and then resolve from monitored state only, eliminating non-active legacy merge fallback
22. expiry cleanup now backfills first and then removes completed `user_watch_subscriptions`, pruning `monitored_matches` once no subscribers remain, without writing status changes back into legacy `watchlist` rows
23. frontend single-item watch detail lookup now resolves from the canonical `/api/me/watch-subscriptions` list instead of calling the legacy `/api/watchlist/:matchId` GET route
24. frontend app-state update/delete flows now re-resolve canonical watch-subscription IDs before mutating when local state is missing them, so real UI traffic stays on `/api/me/watch-subscriptions/:id` except for last-resort unresolved compatibility cases
25. the watchlist UI now treats watch subscriptions as temporary operational state and no longer exposes `expired` as a normal user-facing filter/badge state
26. the recommendations UI now distinguishes between shared canonical recommendations and user-scoped delivery history instead of treating the shared feed as the only user-facing interpretation
27. the delivery read API now supports shared-feed-compatible filters and sorting, allowing the frontend to switch between shared and personal views without losing analyst affordances

### 2.4 Notification Channel Preparation

Aligned in code:

1. `user_notification_channel_configs` exists for `telegram`, `zalo`, `web_push`, and `email`
2. Telegram runtime chat destination is DB-backed, not env-fallback backed
3. shared operational jobs use the DB-backed Telegram runtime helper
4. design-aligned self-service aliases now exist for notification channel config reads and writes under `/api/me/notification-channels`
5. the settings UI now exposes the per-user notification channel registry instead of leaving multi-channel setup entirely backend-only

## 3. Intentional Transitional Deviations

These are known deviations from the final target design, but they are currently intentional and documented.

### 3.1 Watch Subscriptions API Shape

Current state:

1. authenticated self-service watch management is available only on `/api/me/watch-subscriptions`
2. `/api/watchlist` is now limited to operational admin endpoints only

What is now aligned:

1. the target design path now exists in code
2. resource addressing for the canonical path is subscription-ID based
3. the remaining legacy self-service `/api/watchlist` list/create bridge has been retired

What remains transitional:

1. legacy watchlist storage still exists as a compatibility and backfill source for operational migration work
2. operational admin endpoints still live under `/api/watchlist/:matchId/check` and `/api/watchlist/expire`

Required next-step outcome:

1. remove remaining legacy watchlist fallback behavior in repo and jobs
2. decide whether operational admin endpoints should eventually move under a more explicit monitored/admin namespace

### 3.2 Legacy Watchlist Fallback Reads

Current state:

1. user-scoped self-service repo reads and mutations no longer fall back to legacy `watchlist` rows
2. global and job code now read operational watch state from monitored rows after backfill and mirroring, rather than directly from legacy `watchlist`
3. those global and job paths remain explicitly separated behind operational repo entrypoints, reducing semantic drift between self-service and operational code
4. new runtime auto-add flows no longer introduce additional legacy `watchlist` rows, and legacy rows now function mainly as compatibility/backfill artifacts rather than live operational state
5. refresh-time backfill plus access-time mirroring now ensure older legacy rows are seeded into monitored state before operational reads rely on them
6. operational kickoff-window calculation, counters, updates, refresh sync, and expiry lifecycle no longer require legacy `watchlist` reads or writes once monitored state is available
7. single-match compatibility fallback remains only as a last resort if a legacy row cannot be mirrored into monitored state during access
8. bulk compatibility fallback now remains only as a backfill source, not a read source, for operational all-status views
9. current repo frontend self-service read/update/delete flows now all resolve against canonical `/api/me/watch-subscriptions` resources; the remaining `/api/watchlist` bridge in this repo is limited to legacy list/create paths plus operational admin endpoints
10. completed watch subscriptions are now treated as ephemeral operational rows that are removed by cleanup rather than retained as durable `expired` history; durable history remains in recommendations and recommendation deliveries

Why this exists:

1. preserves job compatibility while shared-demand migration is incomplete
2. avoids breaking auto-add and older operational flows in the middle of phase 3

Removal condition:

1. all job families must operate only from `monitored_matches` plus `user_watch_subscriptions`
2. no user-facing or job-facing fallback to legacy `watchlist` should remain
3. operational repo entrypoints should then collapse to shared-demand sources only, or be retired if no longer needed

### 3.3 Transitional Schema Types

Current state:

1. some transitional tables still use legacy `TEXT`-typed `user_id` columns rather than the target UUID foreign-key shape described in the target design
2. examples include `user_settings`, `push_subscriptions`, `favorite_teams`, and `user_notification_settings`

Interpretation rule:

1. the design document describes the target end-state schema
2. the current migrations represent a staged compatibility path, not full schema convergence yet
3. schema convergence work must be documented when scheduled so the target-vs-transitional distinction stays explicit

## 4. Pending Work Not Yet Fully Implemented

### 4.1 Phase 3 Pending

Still pending:

1. broader structured condition compilation beyond the current deterministic machine-condition subset
2. full removal of the legacy global Telegram fallback for condition-only and no-recipient cases
3. full removal of legacy global delivery assumptions
4. final removal of legacy watchlist storage/fallbacks after monitored/subscription migration is complete

### 4.2 Phase 4 And Beyond

Still pending:

1. `user_bets` refactor and admin/global bet views
2. billing foundation
3. entitlements and usage enforcement
4. condition compilation service

### 4.3 Multi-Channel Sender Work

Still pending:

1. actual `zalo` sender
2. actual `email` sender
3. first-class UI for system notification settings
4. richer per-channel setup UX beyond the current registry/editor surface

## 5. Maintenance Rule Going Forward

For every next implementation slice:

1. update the target design doc if a new architectural decision is introduced
2. update the relevant phase doc if a transitional bridge or staged rollout choice is introduced
3. update this conformance review if the slice changes the alignment status between design and implementation

This document is not optional bookkeeping. It is part of the implementation artifact set and must stay current with the code.