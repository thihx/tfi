# Multi-User Phase 1 Implementation Map

Date: 2026-03-24

## 1. Purpose

This document translates the product architecture in [docs/multi-user-subscription-payment-design-2026-03-24.md](docs/multi-user-subscription-payment-design-2026-03-24.md) into concrete repository-level implementation steps.

The goal of phase 1 is narrow:

- introduce internal user identities
- introduce basic role and user status support
- propagate authenticated principal into backend request context
- keep current product behavior working while creating a safe foundation for later per-user refactors

This phase does not implement subscription billing, payment, entitlements, per-user watch subscriptions, or per-user bets yet.

## 2. Current File Mapping

### 2.1 Auth Core

Current files:

- [packages/server/src/routes/auth.routes.ts](packages/server/src/routes/auth.routes.ts)
- [packages/server/src/lib/jwt.ts](packages/server/src/lib/jwt.ts)
- [packages/server/src/index.ts](packages/server/src/index.ts)

Phase 1 target:

- JWT `sub` becomes internal `user_id`
- JWT includes `email` and `role`
- backend auth callback resolves or creates a durable internal user
- request lifecycle attaches `currentUser`

### 2.2 New Persistence Layer

New files or modules:

- `users` table
- `user_auth_identities` table
- [packages/server/src/repos/users.repo.ts](packages/server/src/repos/users.repo.ts)
- [packages/server/src/lib/request-user.ts](packages/server/src/lib/request-user.ts)
- [packages/server/src/types/fastify.d.ts](packages/server/src/types/fastify.d.ts)

### 2.3 Frontend Auth Surface

Current files:

- [src/lib/services/auth.ts](src/lib/services/auth.ts)
- [src/hooks/useAuth.ts](src/hooks/useAuth.ts)

Phase 1 target:

- frontend accepts `userId` and `role`
- `email`, `name`, and `picture` remain available for existing UI
- `/api/auth/me` remains backward-friendly while exposing new fields

## 3. Migration Order

### Step 1. Add Internal Identity Tables

Migration:

- `023_auth_users.sql`

Adds:

- `users`
- `user_auth_identities`

Rules:

- first created user becomes `owner`
- subsequent users default to `member`
- users can later be promoted by admin tooling in a future phase

### Step 2. Add User Resolution Repo

Module:

- [packages/server/src/repos/users.repo.ts](packages/server/src/repos/users.repo.ts)

Responsibilities:

- find user by id
- resolve user from provider identity
- link future auth providers without rewriting auth routes

### Step 3. Upgrade JWT Payload

Module:

- [packages/server/src/lib/jwt.ts](packages/server/src/lib/jwt.ts)

Change:

- `sub` changes from email to internal user id
- payload also carries `email` and `role`

Reason:

- email is not a durable principal key
- future provider expansion requires stable internal identity

### Step 4. Attach Principal To Requests

Modules:

- [packages/server/src/index.ts](packages/server/src/index.ts)
- [packages/server/src/types/fastify.d.ts](packages/server/src/types/fastify.d.ts)
- [packages/server/src/lib/request-user.ts](packages/server/src/lib/request-user.ts)

Change:

- authenticated requests resolve `req.currentUser`

Principal shape:

- `userId`
- `email`
- `role`
- `status`
- `displayName`
- `avatarUrl`

### Step 5. Keep `/api/auth/me` As Compatibility Bridge

Module:

- [packages/server/src/routes/auth.routes.ts](packages/server/src/routes/auth.routes.ts)

Response should include both:

- current UI fields: `email`, `name`, `picture`
- new fields: `userId`, `displayName`, `avatarUrl`, `role`, `status`

This avoids forcing a broad frontend refactor immediately.

## 4. File-By-File Follow-Up Plan

### 4.1 Settings Refactor

Current file:

- [packages/server/src/routes/settings.routes.ts](packages/server/src/routes/settings.routes.ts)

Current issue:

- still uses global default settings

Next phase change:

- replace calls to `getSettings()` with `getSettings(req.currentUser.userId)`
- same for `saveSettings`

### 4.2 Push Refactor

Current files:

- [packages/server/src/routes/push.routes.ts](packages/server/src/routes/push.routes.ts)
- current global subscription table

Next phase change:

- replace with `user_push_endpoints`
- use `req.currentUser.userId`

### 4.3 Favorite Teams Refactor

Current files:

- [packages/server/src/routes/favorite-teams.routes.ts](packages/server/src/routes/favorite-teams.routes.ts)
- current global favorite teams table

Next phase change:

- move to `user_favorite_teams`
- scope all queries to `req.currentUser.userId`

### 4.4 Watchlist Refactor

Current files:

- [packages/server/src/repos/watchlist.repo.ts](packages/server/src/repos/watchlist.repo.ts)
- [packages/server/src/routes/watchlist.routes.ts](packages/server/src/routes/watchlist.routes.ts)
- [packages/server/src/jobs/check-live-trigger.job.ts](packages/server/src/jobs/check-live-trigger.job.ts)

Next phase change:

- replace global watchlist with `monitored_matches` plus `user_watch_subscriptions`
- aggregate active user demand before shared analysis

### 4.5 Recommendations Delivery Layer

Current files:

- [packages/server/src/repos/recommendations.repo.ts](packages/server/src/repos/recommendations.repo.ts)
- [packages/server/src/routes/recommendations.routes.ts](packages/server/src/routes/recommendations.routes.ts)

Keep in place:

- canonical shared recommendation storage

Add later:

- `user_recommendation_deliveries`

### 4.6 Bets Refactor

Current files:

- [packages/server/src/repos/bets.repo.ts](packages/server/src/repos/bets.repo.ts)
- [packages/server/src/routes/bets.routes.ts](packages/server/src/routes/bets.routes.ts)

Next phase change:

- migrate to `user_bets`
- add admin global view endpoints separately

### 4.7 Billing And Payment

Current state:

- not implemented

Planned modules:

- `plans.repo.ts`
- `billing.repo.ts`
- `payments/` provider adapters
- `billing.routes.ts`

Planned migration blocks:

- plans
- prices
- entitlements
- user billing subscriptions
- payment customers
- checkout sessions
- payment transactions
- webhook event log

## 5. Validation Strategy For Phase 1

Required checks after implementation:

1. auth route tests pass
2. backend typecheck passes
3. root typecheck passes
4. `/api/auth/me` returns internal identity fields without breaking current UI shape

## 6. Acceptance Criteria For Phase 1

Phase 1 is considered complete when:

1. new users are stored in an internal `users` table
2. auth provider identity is linked through `user_auth_identities`
3. JWT `sub` contains internal user id
4. authenticated requests have `req.currentUser`
5. frontend can still render auth state without breaking existing header/login flow

## 7. What Should Not Be Changed In Phase 1

1. shared recommendation generation logic
2. prompt logic and recommendation reasoning path
3. pipeline orchestration semantics beyond auth identity propagation
4. payment and entitlement enforcement runtime behavior

This keeps phase 1 small enough to ship as a foundation instead of blending identity migration with business-feature migration.