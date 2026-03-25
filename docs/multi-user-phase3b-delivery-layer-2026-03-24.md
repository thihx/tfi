# Multi-User Phase 3B: Recommendation Delivery Layer

Date: 2026-03-24

## 1. Scope

This slice completes the first usable version of per-user delivery history on top of the canonical shared recommendation model.

Implemented in this slice:

- `user_recommendation_deliveries` persistence is used when recommendations are created
- users can list their own delivery history via `/api/me/recommendation-deliveries`
- users can update basic local delivery state (`hidden`, `dismissed`)
- Web Push delivery now closes the loop by marking successful user deliveries as `delivered`

## 2. What Is Now Working

### 2.1 Delivery Staging

When a canonical recommendation is created, active watch subscribers for the same `match_id` are staged into `user_recommendation_deliveries`.

Current coarse eligibility rules:

1. `notify_enabled = false` -> `notifications_disabled`
2. `auto_apply_recommended_condition = true` -> `eligible`
3. blank `custom_condition_text` -> `eligible`
4. otherwise -> `pending_condition`

### 2.2 Delivery Read API

- `GET /api/me/recommendation-deliveries`
- supports pagination and filtering by `matchId`, `eligibilityStatus`, `deliveryStatus`, `includeHidden`, `dismissed`, `result`, `bet_type`, `search`, `league`, `date_from`, `date_to`, and `risk_level`
- supports shared-feed-compatible sorting via `sort_by` and `sort_dir`, so the frontend can switch between canonical shared recommendations and user delivery history without losing the main analyst filters

### 2.3 User-Facing UI Alignment

The frontend recommendations experience now reflects the intended model more explicitly:

1. canonical recommendations remain a shared feed
2. user-scoped delivery history is exposed as a separate personal view backed by `/api/me/recommendation-deliveries`
3. both views reuse the same core filtering and sorting affordances so the user does not have to learn two unrelated recommendation screens

### 2.4 Delivery State API

- `PATCH /api/me/recommendation-deliveries/:id`
- supports self-service updates for:
  - `hidden`
  - `dismissed`

### 2.5 Web Push Delivery Status

When Web Push succeeds, the pipeline now:

1. filters target subscriptions to users with `eligible` delivery rows for that recommendation
2. records successful user ids
3. marks those delivery rows as `delivered`
4. appends `web_push` to `delivery_channels`

## 3. Pending Work Still Not Solved

These items remain intentionally deferred and must be handled in a later slice.

### 3.1 Telegram Is Still Global, Not User-Level

Recommendation-backed Telegram delivery now resolves eligible per-user Telegram channel records from the channel registry and writes successful sends back into user delivery rows.

The remaining transitional behavior is limited to the legacy global fallback path.

That means:

1. condition-only notifications still rely on the shared/global fallback
2. recommendation notifications without any configured user Telegram recipient may still rely on the shared/global fallback
3. per-user Telegram channel verification and richer recipient setup UX are still incomplete

### 3.2 Condition Evaluation Is Still Coarse

Recommendation-backed delivery rows now re-evaluate a deterministic subset of machine-readable conditions at persistence time.

Supported today:

1. `Minute` comparisons
2. `Total goals` comparisons
3. `Draw`, `Home leading`, `Away leading`, and `NOT` score-state atoms
4. common side-specific stat comparisons such as `shots_on_target_home >= 4` and `Home shots on target >= 4`

Still pending:

1. broader structured condition compilation for unsupported free-text or richer logical expressions
2. first-class handling for unsupported condition syntax instead of leaving those rows transitional
3. extending deterministic evaluation beyond the currently supported machine-condition grammar

### 3.3 Condition-Only Alerts Still Lack First-Class Delivery Rows

The current delivery table is recommendation-centric.

Because condition-only alerts do not always create a canonical recommendation row, they are not yet represented as a first-class per-user delivery history record.

### 3.4 Legacy Global Notification Paths Still Exist

Current Web Push is now filtered by eligible user delivery rows when a recommendation row exists, but broader notification plumbing still carries legacy assumptions.

Still pending:

1. remove remaining global notification fanout assumptions
2. unify delivery routing fully around delivery rows
3. eliminate transitional fallback behavior where no recommendation-backed delivery exists

### 3.5 Delivery Records Are Still Recommendation-Centric Render Targets

The current frontend personal-delivery view maps delivery rows onto the shared recommendation card/table presentation.

That is acceptable for this slice because:

1. the product decision is to keep old recommendations shared
2. the main semantic gap was visibility of personal delivery history, not invention of a wholly new visual language

Still pending if desired later:

1. dedicated delivery badges for `eligibility_status` and `delivery_status`
2. explicit hidden and dismissed controls in the recommendations UI
3. dedicated personal-history summaries separate from canonical recommendation analytics

## 4. Files Added Or Updated In This Slice

- [packages/server/src/repos/recommendation-deliveries.repo.ts](packages/server/src/repos/recommendation-deliveries.repo.ts)
- [packages/server/src/routes/recommendation-deliveries.routes.ts](packages/server/src/routes/recommendation-deliveries.routes.ts)
- [packages/server/src/lib/server-pipeline.ts](packages/server/src/lib/server-pipeline.ts)