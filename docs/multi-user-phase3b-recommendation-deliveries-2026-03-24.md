# Multi-User Phase 3B: Recommendation Deliveries

Date: 2026-03-24

## 1. Scope

This slice continues phase 3 with the smallest delivery-focused cut:

- add `user_recommendation_deliveries`
- stage per-user delivery rows from active `user_watch_subscriptions`
- expose authenticated `GET /api/me/recommendation-deliveries`
- keep canonical `recommendations` generation shared across all users

This slice does not yet replace the existing global notification fanout path.

## 2. What Changed

### 2.1 New Table

`user_recommendation_deliveries` stores the per-user delivery view for a canonical recommendation.

- one row per `(user_id, recommendation_id)`
- tracks eligibility and current delivery status
- keeps room for future dispatch history via `delivery_channels`, `delivered_at`, `hidden`, and `dismissed`

### 2.2 Central Staging Point

Delivery rows are now staged inside the recommendation repository when recommendations are created.

That means phase 3B covers both creation paths:

1. HTTP route driven recommendation creation
2. pipeline or job driven recommendation creation that already writes through the same repository

### 2.3 Eligibility Heuristic In This Slice

This phase uses a conservative transitional rule:

- `notify_enabled = false` => `delivery_status = suppressed`, `eligibility_status = notifications_disabled`
- `auto_apply_recommended_condition = true` => eligible immediately
- blank `custom_condition_text` => eligible immediately
- non-empty custom condition text without compiler/evaluator support => `eligibility_status = pending_condition`

This keeps a correct backlog of who should be considered for a recommendation without pretending we already support full custom-condition evaluation.

## 3. Route Behavior

`GET /api/me/recommendation-deliveries` is now available for authenticated users.

Current filters:

- `limit`
- `offset`
- `matchId`
- `eligibilityStatus`
- `deliveryStatus`
- `includeHidden`
- `dismissed`

The response includes delivery rows joined with canonical recommendation fields so the client can render a user-scoped feed without re-deriving the recommendation context.

## 4. Pending Follow-Ups

Still intentionally deferred after this slice:

1. compiled evaluation of `custom_condition_text`
2. actual per-user channel dispatch execution and `delivery_channels` history updates
3. fanout rewrite so notification jobs dispatch from delivery rows instead of global recommendation reads
4. user actions for `hidden` and `dismissed`
5. final removal of remaining hybrid/global transition paths introduced in phase 3A

## 5. Why This Cut

The goal of phase 3B is to establish the user delivery ledger first.

Without that ledger, later notification and entitlement work has no stable per-user target.

With it in place, later phases can safely add:

- richer eligibility evaluation
- per-channel dispatch state
- subscription-aware monetization and limits