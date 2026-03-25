# Multi-User Phase 2A: Settings, Push, Favorites

Date: 2026-03-24

## 1. Scope

This slice starts phase 2 with the smallest useful user-owned surface area:

- self-service settings are read and written by `currentUser`
- push subscription endpoints are owned by `currentUser`
- favorite teams are owned by `currentUser`
- shared jobs and notification fanout keep their global operational reads for now

This is intentionally not the full phase 2 described in [docs/multi-user-subscription-payment-design-2026-03-24.md](docs/multi-user-subscription-payment-design-2026-03-24.md).

## 2. Why This Slice Comes First

These three areas are the lowest-risk move from global state to user-owned state because:

1. endpoint contracts can stay unchanged
2. UI changes are minimal
3. shared recommendation and pipeline logic do not need to change yet
4. they reduce the largest remaining single-user assumptions in user-facing data

## 3. Implementation Rules

### 3.1 Settings

- routes use `req.currentUser.userId`
- reads allow fallback to the legacy `default` row during the transition
- writes persist to the real user id

### 3.2 Push Subscriptions

- rows are owned by `user_id`
- self-service status, subscribe, and unsubscribe are scoped to current user
- global notification fanout still uses the full subscription table until delivery logic is refactored later

### 3.3 Favorite Teams

- rows are owned by `user_id`
- self-service favorite-team APIs are scoped to current user
- global favorite-team aggregation for match auto-add remains shared for now through distinct team-id reads

## 4. Transitional Note

This slice introduces user ownership without fully migrating legacy single-user rows into per-user records. That is acceptable because compatibility for settings, push, and favorites is lower priority than recommendation-history preservation.

The only transition aid included in this slice is settings fallback from user row to `default` row.

## 5. Files Touched In This Slice

- [packages/server/src/db/migrations/024_user_owned_settings_push_favorites.sql](packages/server/src/db/migrations/024_user_owned_settings_push_favorites.sql)
- [packages/server/src/lib/authz.ts](packages/server/src/lib/authz.ts)
- [packages/server/src/repos/settings.repo.ts](packages/server/src/repos/settings.repo.ts)
- [packages/server/src/repos/push-subscriptions.repo.ts](packages/server/src/repos/push-subscriptions.repo.ts)
- [packages/server/src/repos/favorite-teams.repo.ts](packages/server/src/repos/favorite-teams.repo.ts)
- [packages/server/src/routes/settings.routes.ts](packages/server/src/routes/settings.routes.ts)
- [packages/server/src/routes/push.routes.ts](packages/server/src/routes/push.routes.ts)
- [packages/server/src/routes/favorite-teams.routes.ts](packages/server/src/routes/favorite-teams.routes.ts)

## 6. API Contract Note

At the time this slice was first implemented, self-service routes remained on compatibility paths such as `/api/settings` and `/api/favorite-teams` to minimize frontend churn.

Design-aligned `/api/me/*` aliases were added later as part of implementation conformance maintenance.

## 7. Deferred Work

Still deferred after this slice:

1. user notification settings API
2. role-based admin route enforcement
3. user watch subscriptions
4. user recommendation deliveries
5. user bets
6. billing and entitlements