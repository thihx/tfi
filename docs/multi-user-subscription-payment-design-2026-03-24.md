# Multi-User, Subscription, And Payment Design

Date: 2026-03-24

## 1. Executive Summary

This document defines the target architecture for evolving the current single-user system into a multi-user product with:

- independent personal accounts
- role-based access control with `owner`, `admin`, and `member`
- shared recommendation generation to preserve provider and LLM efficiency
- user-specific watch subscriptions, settings, bets, and notification behavior
- plan-based entitlement control
- payment processing through international intermediary gateways

This is a greenfield product-level redesign for the next implementation phase. Backward compatibility is not a primary constraint, except that historical recommendations must be preserved and the current prompt logic must not be changed.

## 2. Product Decisions Already Fixed

The following decisions are now treated as product requirements:

1. Multi-user means independent personal accounts, not shared workspaces.
2. Roles in phase 1 are `owner`, `admin`, and `member`.
3. Recommendations should remain shareable across users.
4. Shared analysis is acceptable when multiple users watch the same match.
5. Bets are personal data, but admins can view global aggregate data.
6. Push configuration is product-level per user.
7. Additional auth providers will be needed later.
8. Historical recommendations must be retained.
9. Current prompt decision logic should remain intact.

## 3. Current-System Problem Statement

The current implementation is globally scoped in most business-critical areas:

- auth validates access but does not propagate a durable internal principal
- settings are effectively global at route and job level
- watchlist is globally keyed by `match_id`
- recommendations are globally stored and globally consumed
- push subscriptions are global
- favorite teams are global
- bets are global except for free-text provenance fields
- jobs and pipeline scan one shared operational state

If multi-user is implemented by simply adding `user_id` to existing tables and flows, the system will duplicate provider calls and LLM work across users, which is explicitly undesirable.

## 4. Design Goals

### 4.1 Primary Goals

1. Isolate user-owned data correctly.
2. Preserve shared recommendation generation where possible.
3. Support role-based operational visibility.
4. Introduce subscription plans and entitlements without coupling product limits into prompt logic.
5. Allow payment gateway replacement without redesigning the billing domain.

### 4.2 Non-Goals For Phase 1

1. Team or organization workspaces.
2. Revenue recognition or accounting-grade finance logic.
3. Marketplace-style multi-vendor payment flows.
4. Real-time entitlement synchronization across multiple external billing providers.
5. Personalized per-user prompt variants as the default runtime path.

## 5. Architectural Principle

The target system must separate four concerns:

1. shared market data
2. shared recommendation generation
3. user-specific consumption and actions
4. billing and entitlement control

This leads to four planes.

### 5.1 Shared Market Data Plane

This plane contains data fetched from data providers and internal derived telemetry.

Examples:

- leagues
- teams
- matches
- matches_history
- match_snapshots
- provider sample tables
- prompt shadow runs
- team and league profiles

This plane remains global.

### 5.2 Shared Recommendation Plane

This plane contains canonical recommendation artifacts produced from shared match state and the existing prompt logic.

The `recommendations` concept remains global because:

- recommendations are shareable by requirement
- the current prompt logic should remain unchanged
- shared analysis is required to control LLM and provider cost

### 5.3 User Consumption Plane

This plane contains everything that is personal to a user:

- profile
- settings
- watch subscriptions
- notification preferences
- favorite teams
- bets
- recommendation delivery history
- usage counters and quota consumption

### 5.4 Billing And Entitlement Plane

This plane determines what a user is allowed to do and how that allowance is monetized.

It contains:

- plans
- prices
- subscriptions
- payment attempts
- gateway events
- entitlement snapshots
- usage ledger

## 6. Core Product Model

### 6.1 Roles

Roles are global system roles for phase 1.

- `owner`
  - full system control
  - billing and gateway configuration visibility
  - user and plan administration
- `admin`
  - global system visibility
  - can view all users, bets, subscriptions, operational dashboards
  - cannot perform owner-only platform actions unless explicitly granted later
- `member`
  - can only access own profile, settings, subscriptions, bets, entitlements, and deliveries

### 6.2 Shared Recommendation Model

Recommendations remain global artifacts.

Users do not own recommendations directly. Users own:

- subscriptions to matches
- filters and notification preferences
- delivery history derived from recommendations
- personal betting actions taken from recommendations

### 6.3 Subscription Model

The word "subscription" is overloaded and must be separated into two product concepts.

1. Match subscription
   - a user chooses to track a match
   - includes mode, personal free-text condition, notification preferences, and priority

2. Billing subscription
   - a user purchases access to a product plan
   - defines entitlement limits and renewal status

The implementation must keep these two concepts in separate tables, separate services, and separate route groups.

## 7. Plan And Entitlement Design

### 7.1 Design Requirement

Plans must be general enough to support future pricing changes without schema redesign.

The example "Plan 1 gets 3 Ask AI per day" is one entitlement among many, not a special-case field.

### 7.2 Recommended Plan Model

Use four layers:

1. `plans`
   - product-level plan definition such as Free, Basic, Pro, Premium

2. `plan_prices`
   - billable price point, currency, interval, amount, trial days, gateway mapping

3. `plan_entitlements`
   - machine-readable limits and features granted by a plan

4. `user_plan_subscriptions`
   - a user's current and historical plan enrollment

### 7.3 Entitlement Taxonomy

Entitlements should be modeled as typed capabilities, not as hardcoded columns.

Recommended categories:

- feature flags
  - `feature.ask_ai`
  - `feature.web_push`
  - `feature.telegram_push`
  - `feature.multi_device`
  - `feature.advanced_filters`
  - `feature.priority_analysis`

- rate limits
  - `limit.ask_ai.per_day`
  - `limit.manual_force.per_day`
  - `limit.watch_subscriptions.active`
  - `limit.favorite_teams.count`
  - `limit.saved_bets.per_month`

- concurrency or throughput controls
  - `limit.background_jobs.priority_weight`
  - `limit.notification_fanout.per_hour`

- retention controls
  - `limit.bet_history.retention_days`
  - `limit.audit_view.retention_days`

### 7.4 Entitlement Value Types

Entitlements should support:

- boolean
- integer
- numeric
- string
- JSON object for structured policy

Examples:

- `feature.ask_ai = true`
- `limit.ask_ai.per_day = 3`
- `limit.watch_subscriptions.active = 20`
- `feature.delivery.channels = { "web_push": true, "telegram": false }`

### 7.5 Entitlement Resolution

At runtime, the effective entitlement for a user is resolved from:

1. active billing subscription
2. plan entitlements
3. optional admin override
4. optional promotional grant or manual support adjustment

The resolved result should be cached as an `effective_entitlements` snapshot for fast policy checks.

## 8. Usage Metering Design

### 8.1 Why A Usage Ledger Is Required

Daily plan limits like "Ask AI 3 times per day" must not be enforced by scanning business tables ad hoc. That approach becomes inconsistent, slow, and difficult to audit.

Use a dedicated `usage_ledger` and optionally a pre-aggregated `usage_counters` table.

### 8.2 Metered Events

Recommended usage event keys:

- `ask_ai.request`
- `ask_ai.success`
- `ask_ai.failure`
- `manual_force.request`
- `watch_subscription.create`
- `bet.create`
- `notification.sent`

### 8.3 Quota Windows

Support these windows generically:

- per day
- per week
- per month
- rolling 24 hours

Phase 1 can implement fixed UTC-day windows for simplicity if product accepts that behavior.

### 8.4 Enforcement Rule

When a metered action is requested:

1. resolve effective entitlements
2. check current usage count for the applicable window
3. reject if the action exceeds entitlement
4. reserve or consume usage atomically

This must happen before the expensive action begins.

For Ask AI specifically, quota checks must run before any LLM call is made.

## 9. Payment Architecture

### 9.1 Business Requirement

Payments are processed through international intermediary gateways rather than direct card processing.

The system therefore needs a gateway abstraction layer.

### 9.2 Recommended Gateway Strategy

Implement an internal payment provider interface and keep the domain model gateway-neutral.

Suggested initial provider class examples:

- Stripe Billing
- Paddle
- Lemon Squeezy
- 2Checkout or equivalent intermediary

The system should support one active provider initially, but the domain model must allow future additions.

### 9.3 Payment Domain Objects

Recommended objects:

1. `payment_providers`
   - provider config metadata

2. `checkout_sessions`
   - server-generated checkout intents linked to a user and target price

3. `payment_customers`
   - mapping between internal user and provider customer id

4. `payment_transactions`
   - payment attempt history

5. `billing_invoices`
   - invoice state synchronized from provider events

6. `user_plan_subscriptions`
   - active and historical billing subscriptions

7. `billing_webhook_events`
   - append-only raw webhook log for traceability and replay

### 9.4 Payment Lifecycle

Recommended lifecycle:

1. user selects plan price
2. backend creates checkout session with payment provider
3. provider redirects user to hosted checkout
4. provider sends webhook events
5. backend verifies webhook signature
6. backend upserts invoice and subscription state
7. backend recomputes effective entitlements
8. backend exposes updated plan status to frontend

### 9.5 Why Hosted Checkout Is Preferred

For phase 1, hosted checkout is preferred over custom card entry because it:

- reduces PCI scope
- simplifies international payment methods
- offloads tax and payment UX concerns to the gateway where supported
- makes subscription renewal handling easier

## 10. Data Model

### 10.1 Identity Tables

#### `users`

- `id UUID PRIMARY KEY`
- `email TEXT NOT NULL`
- `display_name TEXT NOT NULL`
- `avatar_url TEXT NOT NULL DEFAULT ''`
- `role TEXT NOT NULL CHECK (role IN ('owner','admin','member'))`
- `status TEXT NOT NULL CHECK (status IN ('active','disabled','invited'))`
- `created_at TIMESTAMPTZ NOT NULL DEFAULT now()`
- `updated_at TIMESTAMPTZ NOT NULL DEFAULT now()`

Indexes:

- unique on `lower(email)`
- index on `role`
- index on `status`

#### `user_auth_identities`

- `id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY`
- `user_id UUID NOT NULL REFERENCES users(id)`
- `provider TEXT NOT NULL`
- `provider_subject TEXT NOT NULL`
- `provider_email TEXT NOT NULL DEFAULT ''`
- `created_at TIMESTAMPTZ NOT NULL DEFAULT now()`
- unique on `(provider, provider_subject)`
- index on `user_id`

### 10.2 User Profile And Preference Tables

#### `user_settings`

Replace the current pseudo-multi-user design with real ownership:

- `user_id UUID PRIMARY KEY REFERENCES users(id)`
- `settings JSONB NOT NULL DEFAULT '{}'::jsonb`
- `updated_at TIMESTAMPTZ NOT NULL DEFAULT now()`

#### `user_notification_settings`

- `user_id UUID PRIMARY KEY REFERENCES users(id)`
- `web_push_enabled BOOLEAN NOT NULL DEFAULT false`
- `telegram_enabled BOOLEAN NOT NULL DEFAULT false`
- `notification_language TEXT NOT NULL DEFAULT 'vi'`
- `minimum_confidence SMALLINT`
- `minimum_odds NUMERIC(8,3)`
- `quiet_hours JSONB NOT NULL DEFAULT '{}'::jsonb`
- `channel_policy JSONB NOT NULL DEFAULT '{}'::jsonb`
- `updated_at TIMESTAMPTZ NOT NULL DEFAULT now()`

#### `user_push_endpoints`

- `id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY`
- `user_id UUID NOT NULL REFERENCES users(id)`
- `endpoint TEXT NOT NULL`
- `p256dh TEXT NOT NULL`
- `auth TEXT NOT NULL`
- `user_agent TEXT NOT NULL DEFAULT ''`
- `active BOOLEAN NOT NULL DEFAULT true`
- `created_at TIMESTAMPTZ NOT NULL DEFAULT now()`
- `last_used_at TIMESTAMPTZ`

Indexes:

- unique on `endpoint`
- index on `user_id`
- partial index on `(user_id)` where `active = true`

#### `user_favorite_teams`

- `id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY`
- `user_id UUID NOT NULL REFERENCES users(id)`
- `team_id TEXT NOT NULL`
- `team_name TEXT NOT NULL`
- `team_logo TEXT NOT NULL DEFAULT ''`
- `created_at TIMESTAMPTZ NOT NULL DEFAULT now()`
- unique on `(user_id, team_id)`

### 10.3 Watching And Delivery Tables

#### `monitored_matches`

Shared runtime registry of matches that currently have at least one active subscriber.

- `match_id TEXT PRIMARY KEY`
- `subscriber_count INTEGER NOT NULL DEFAULT 0`
- `runtime_status TEXT NOT NULL DEFAULT 'idle'`
- `last_interest_at TIMESTAMPTZ`
- `last_analysis_at TIMESTAMPTZ`
- `next_analysis_due_at TIMESTAMPTZ`
- `lock_version BIGINT NOT NULL DEFAULT 0`
- `metadata JSONB NOT NULL DEFAULT '{}'::jsonb`

#### `user_watch_subscriptions`

- `id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY`
- `user_id UUID NOT NULL REFERENCES users(id)`
- `match_id TEXT NOT NULL`
- `mode TEXT NOT NULL DEFAULT 'B'`
- `priority SMALLINT NOT NULL DEFAULT 0`
- `custom_condition_text TEXT NOT NULL DEFAULT ''`
- `compiled_condition JSONB NOT NULL DEFAULT '{}'::jsonb`
- `compiled_condition_status TEXT NOT NULL DEFAULT 'empty'`
- `auto_apply_recommended_condition BOOLEAN NOT NULL DEFAULT false`
- `notify_enabled BOOLEAN NOT NULL DEFAULT true`
- `status TEXT NOT NULL DEFAULT 'active'`
- `source TEXT NOT NULL DEFAULT 'manual'`
- `created_at TIMESTAMPTZ NOT NULL DEFAULT now()`
- `updated_at TIMESTAMPTZ NOT NULL DEFAULT now()`

Operational semantics note:

- `user_watch_subscriptions` is temporary operational state, not historical storage
- `status` is for live user workflow states such as `active` and `pending`, not long-term completed retention
- once a match is completed and outside the monitoring window, cleanup should remove the watch subscription instead of retaining a durable `expired` history row
- durable history belongs in `recommendations`, `user_recommendation_deliveries`, and user betting records

Indexes:

- unique on `(user_id, match_id)`
- index on `match_id`
- index on `(user_id, status)`

#### `user_recommendation_deliveries`

- `id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY`
- `user_id UUID NOT NULL REFERENCES users(id)`
- `recommendation_id INTEGER NOT NULL REFERENCES recommendations(id)`
- `match_id TEXT NOT NULL`
- `matched_condition BOOLEAN NOT NULL DEFAULT false`
- `eligibility_status TEXT NOT NULL DEFAULT 'pending'`
- `delivery_status TEXT NOT NULL DEFAULT 'pending'`
- `delivery_channels JSONB NOT NULL DEFAULT '[]'::jsonb`
- `delivered_at TIMESTAMPTZ`
- `hidden BOOLEAN NOT NULL DEFAULT false`
- `dismissed BOOLEAN NOT NULL DEFAULT false`
- `metadata JSONB NOT NULL DEFAULT '{}'::jsonb`
- `created_at TIMESTAMPTZ NOT NULL DEFAULT now()`

Indexes:

- unique on `(user_id, recommendation_id)`
- index on `(user_id, created_at DESC)`
- index on `(delivery_status, created_at)`

### 10.4 Betting Tables

#### `user_bets`

- `id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY`
- `user_id UUID NOT NULL REFERENCES users(id)`
- `recommendation_id INTEGER REFERENCES recommendations(id)`
- `match_id TEXT NOT NULL`
- `placed_at TIMESTAMPTZ NOT NULL DEFAULT now()`
- `bet_market TEXT NOT NULL DEFAULT ''`
- `selection TEXT NOT NULL DEFAULT ''`
- `odds NUMERIC(8,3) NOT NULL`
- `stake_percent NUMERIC(6,2) NOT NULL DEFAULT 0`
- `stake_amount NUMERIC(12,2)`
- `bookmaker TEXT NOT NULL DEFAULT ''`
- `match_minute INTEGER`
- `match_score TEXT NOT NULL DEFAULT ''`
- `match_status TEXT NOT NULL DEFAULT ''`
- `result TEXT NOT NULL DEFAULT ''`
- `pnl NUMERIC(12,2) NOT NULL DEFAULT 0`
- `settled_at TIMESTAMPTZ`
- `settled_by TEXT NOT NULL DEFAULT ''`
- `final_score TEXT NOT NULL DEFAULT ''`
- `settlement_status TEXT NOT NULL DEFAULT 'pending'`
- `settlement_method TEXT NOT NULL DEFAULT ''`
- `settle_prompt_version TEXT NOT NULL DEFAULT ''`
- `settlement_note TEXT NOT NULL DEFAULT ''`
- `notes TEXT NOT NULL DEFAULT ''`

Indexes:

- index on `user_id`
- index on `(user_id, placed_at DESC)`
- index on `(user_id, result)`
- index on `match_id`

### 10.5 Billing Tables

#### `plans`

- `id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY`
- `code TEXT NOT NULL`
- `name TEXT NOT NULL`
- `description TEXT NOT NULL DEFAULT ''`
- `active BOOLEAN NOT NULL DEFAULT true`
- `visibility TEXT NOT NULL DEFAULT 'public'`
- `created_at TIMESTAMPTZ NOT NULL DEFAULT now()`
- `updated_at TIMESTAMPTZ NOT NULL DEFAULT now()`

Indexes:

- unique on `code`
- index on `active`

#### `plan_prices`

- `id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY`
- `plan_id BIGINT NOT NULL REFERENCES plans(id)`
- `provider TEXT NOT NULL`
- `provider_price_id TEXT NOT NULL DEFAULT ''`
- `currency TEXT NOT NULL`
- `billing_interval TEXT NOT NULL`
- `billing_interval_count INTEGER NOT NULL DEFAULT 1`
- `amount NUMERIC(12,2) NOT NULL`
- `trial_days INTEGER NOT NULL DEFAULT 0`
- `active BOOLEAN NOT NULL DEFAULT true`
- `created_at TIMESTAMPTZ NOT NULL DEFAULT now()`

Indexes:

- index on `plan_id`
- unique on `(provider, provider_price_id)`

#### `plan_entitlements`

- `id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY`
- `plan_id BIGINT NOT NULL REFERENCES plans(id)`
- `entitlement_key TEXT NOT NULL`
- `value_type TEXT NOT NULL`
- `bool_value BOOLEAN`
- `int_value BIGINT`
- `numeric_value NUMERIC(18,6)`
- `text_value TEXT`
- `json_value JSONB`
- `created_at TIMESTAMPTZ NOT NULL DEFAULT now()`

Indexes:

- unique on `(plan_id, entitlement_key)`
- index on `plan_id`

#### `user_plan_subscriptions`

- `id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY`
- `user_id UUID NOT NULL REFERENCES users(id)`
- `plan_id BIGINT NOT NULL REFERENCES plans(id)`
- `plan_price_id BIGINT REFERENCES plan_prices(id)`
- `provider TEXT NOT NULL`
- `provider_subscription_id TEXT NOT NULL DEFAULT ''`
- `status TEXT NOT NULL`
- `current_period_start TIMESTAMPTZ`
- `current_period_end TIMESTAMPTZ`
- `cancel_at_period_end BOOLEAN NOT NULL DEFAULT false`
- `trial_ends_at TIMESTAMPTZ`
- `started_at TIMESTAMPTZ NOT NULL DEFAULT now()`
- `ended_at TIMESTAMPTZ`
- `metadata JSONB NOT NULL DEFAULT '{}'::jsonb`

Indexes:

- index on `user_id`
- index on `(user_id, status)`
- unique on `(provider, provider_subscription_id)`

#### `payment_customers`

- `id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY`
- `user_id UUID NOT NULL REFERENCES users(id)`
- `provider TEXT NOT NULL`
- `provider_customer_id TEXT NOT NULL`
- `created_at TIMESTAMPTZ NOT NULL DEFAULT now()`
- unique on `(provider, provider_customer_id)`
- unique on `(user_id, provider)`

#### `checkout_sessions`

- `id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY`
- `user_id UUID NOT NULL REFERENCES users(id)`
- `plan_price_id BIGINT NOT NULL REFERENCES plan_prices(id)`
- `provider TEXT NOT NULL`
- `provider_session_id TEXT NOT NULL DEFAULT ''`
- `status TEXT NOT NULL DEFAULT 'created'`
- `checkout_url TEXT NOT NULL DEFAULT ''`
- `expires_at TIMESTAMPTZ`
- `created_at TIMESTAMPTZ NOT NULL DEFAULT now()`
- `completed_at TIMESTAMPTZ`
- `metadata JSONB NOT NULL DEFAULT '{}'::jsonb`

#### `payment_transactions`

- `id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY`
- `user_id UUID REFERENCES users(id)`
- `provider TEXT NOT NULL`
- `provider_payment_id TEXT NOT NULL DEFAULT ''`
- `provider_invoice_id TEXT NOT NULL DEFAULT ''`
- `amount NUMERIC(12,2) NOT NULL DEFAULT 0`
- `currency TEXT NOT NULL DEFAULT ''`
- `status TEXT NOT NULL`
- `paid_at TIMESTAMPTZ`
- `created_at TIMESTAMPTZ NOT NULL DEFAULT now()`
- `metadata JSONB NOT NULL DEFAULT '{}'::jsonb`

#### `billing_webhook_events`

- `id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY`
- `provider TEXT NOT NULL`
- `event_id TEXT NOT NULL`
- `event_type TEXT NOT NULL`
- `received_at TIMESTAMPTZ NOT NULL DEFAULT now()`
- `processed_at TIMESTAMPTZ`
- `status TEXT NOT NULL DEFAULT 'received'`
- `payload JSONB NOT NULL DEFAULT '{}'::jsonb`
- `error TEXT NOT NULL DEFAULT ''`
- unique on `(provider, event_id)`

### 10.6 Entitlement And Usage Tables

#### `user_entitlement_overrides`

- `id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY`
- `user_id UUID NOT NULL REFERENCES users(id)`
- `entitlement_key TEXT NOT NULL`
- `value_type TEXT NOT NULL`
- value columns same shape as `plan_entitlements`
- `reason TEXT NOT NULL DEFAULT ''`
- `expires_at TIMESTAMPTZ`
- `created_at TIMESTAMPTZ NOT NULL DEFAULT now()`

#### `effective_entitlements`

- `user_id UUID PRIMARY KEY REFERENCES users(id)`
- `snapshot JSONB NOT NULL DEFAULT '{}'::jsonb`
- `computed_at TIMESTAMPTZ NOT NULL DEFAULT now()`
- `source_version BIGINT NOT NULL DEFAULT 0`

#### `usage_ledger`

- `id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY`
- `user_id UUID NOT NULL REFERENCES users(id)`
- `usage_key TEXT NOT NULL`
- `window_key TEXT NOT NULL`
- `quantity INTEGER NOT NULL DEFAULT 1`
- `occurred_at TIMESTAMPTZ NOT NULL DEFAULT now()`
- `reference_type TEXT NOT NULL DEFAULT ''`
- `reference_id TEXT NOT NULL DEFAULT ''`
- `metadata JSONB NOT NULL DEFAULT '{}'::jsonb`

Indexes:

- index on `(user_id, usage_key, occurred_at DESC)`
- index on `(user_id, usage_key, window_key)`

## 11. API Design

### 11.1 General Rules

- resource-oriented endpoints
- plural nouns
- owner and admin APIs clearly separated from self-service APIs
- collection endpoints paginated by default
- authorization enforced server-side using resolved current user context

### 11.2 Auth APIs

- `GET /api/auth/me`
- `POST /api/auth/logout`
- future: `POST /api/auth/providers/:provider/link`

Response from `GET /api/auth/me` should include:

- `userId`
- `email`
- `displayName`
- `role`
- `status`
- `subscription`
- `entitlementsSummary`

### 11.3 Self-Service User APIs

Canonical target paths for self-service APIs use the `/api/me/*` namespace.

Transitional compatibility note:

- some implemented slices still expose compatibility routes outside `/api/me/*` to avoid unnecessary frontend breakage during migration
- compatibility routes are transitional aliases, not the intended long-term contract
- any intentional deviation from the target path shape must be recorded in both the relevant phase document and the implementation conformance review

- `GET /api/me/settings`
- `PUT /api/me/settings`
- `GET /api/me/notification-settings`
- `PUT /api/me/notification-settings`
- `GET /api/me/favorite-teams`
- `POST /api/me/favorite-teams`
- `DELETE /api/me/favorite-teams/:teamId`
- `GET /api/me/watch-subscriptions`
- `POST /api/me/watch-subscriptions`
- `PUT /api/me/watch-subscriptions/:id`
- `DELETE /api/me/watch-subscriptions/:id`
- `GET /api/me/bets`
- `POST /api/me/bets`
- `GET /api/me/recommendation-deliveries`
- `GET /api/me/subscription`
- `GET /api/me/usage`

### 11.4 Shared Recommendation APIs

- `GET /api/recommendations`
  - shared, filtered feed visible to authenticated users
- `GET /api/recommendations/:id`
- `GET /api/recommendations/match/:matchId`

Shared recommendation visibility rules:

- members can view shared recommendations that are part of the public authenticated product experience
- admins can additionally query global operational views and moderation views

### 11.5 Billing APIs

- `GET /api/billing/plans`
- `POST /api/billing/checkout-sessions`
- `GET /api/billing/subscription`
- `POST /api/billing/subscription/cancel`
- `POST /api/billing/webhooks/:provider`
- `GET /api/billing/invoices`

### 11.6 Admin APIs

- `GET /api/admin/users`
- `GET /api/admin/users/:userId`
- `PUT /api/admin/users/:userId/role`
- `PUT /api/admin/users/:userId/status`
- `GET /api/admin/bets`
- `GET /api/admin/subscriptions`
- `GET /api/admin/payments`
- `GET /api/admin/usage`
- `GET /api/admin/ops/*`

## 12. Authorization Model

### 12.1 Request Context

Every authenticated request must resolve a current principal:

- `user_id`
- `role`
- `email`
- `status`

The request context must be attached at the Fastify layer and consumed downstream by route handlers, repos, and policy checks.

### 12.2 Access Rules

#### Member

- read shared recommendations
- manage own settings, watch subscriptions, favorite teams, deliveries, and bets
- read own billing and usage
- cannot access global user, payment, or ops data

#### Admin

- all member permissions
- read all users
- read global bets
- read global billing state
- read global usage and ops metrics
- can manage member status within defined admin limits

#### Owner

- all admin permissions
- manage plans, gateway configuration, owner-level user actions, and platform settings

## 13. Shared Analysis Strategy

### 13.1 Constraint

Prompt logic must remain unchanged.

### 13.2 Allowed Change

Pipeline orchestration may change as long as the prompt decision path for a match remains logically equivalent.

### 13.3 Strategy

1. keep recommendation generation shared per match state
2. do not run the same match analysis separately for each user by default
3. evaluate user-specific free-text conditions outside the core recommendation prompt path
4. use a separate compilation step to convert free-text conditions into structured rules whenever possible

### 13.4 Free-Text Personal Conditions

Users should still be allowed to enter free text, but runtime should not depend on re-sending that free text into the expensive LLM path for every user.

Recommended model:

1. store raw free text as product input
2. compile it asynchronously into structured rules
3. evaluate the compiled rule against shared recommendation and match data
4. if compilation fails, mark the subscription for review or fall back to a restricted safe evaluator

This keeps the UI flexible without turning every user into a separate prompt variant.

## 14. Payment Provider Abstraction

### 14.1 Interface

Define an internal provider interface with methods such as:

- `ensureCustomer(user)`
- `createCheckoutSession(user, planPrice)`
- `cancelSubscription(subscription)`
- `parseWebhook(request)`
- `verifyWebhookSignature(request)`
- `mapWebhookToDomainEvents(payload)`

### 14.2 Domain Event Mapping

Map external provider events into internal normalized events such as:

- `checkout.completed`
- `invoice.paid`
- `invoice.payment_failed`
- `subscription.activated`
- `subscription.renewed`
- `subscription.canceled`
- `subscription.expired`

This prevents gateway-specific terminology from leaking into business logic.

## 15. Operational Flows

### 15.1 User Signup And Access

1. user authenticates through provider
2. backend resolves or creates `users` row
3. backend issues JWT with `sub = user_id`
4. backend returns current profile and effective entitlements

### 15.2 Buying A Plan

1. user requests checkout session for selected `plan_price`
2. backend validates plan visibility and user eligibility
3. backend creates or reuses provider customer
4. backend creates hosted checkout session
5. user completes payment at provider
6. webhook confirms payment and subscription activation
7. backend updates `user_plan_subscriptions`
8. backend recomputes `effective_entitlements`

### 15.3 Ask AI Request

1. user invokes Ask AI
2. backend resolves effective entitlements
3. backend checks usage quota for `limit.ask_ai.per_day`
4. backend consumes usage atomically
5. backend runs Ask AI logic
6. backend records usage outcome

### 15.4 Shared Live Recommendation Flow

1. ingestion jobs update shared match state
2. aggregate active user watch subscriptions into `monitored_matches`
3. shared pipeline generates canonical recommendations
4. delivery evaluator determines which users should receive the result
5. notification sender uses user notification settings and user push endpoints
6. cleanup removes completed watch subscriptions after the monitoring window so watch state remains temporary while recommendations remain durable

## 16. Implementation Phasing

### Phase 1. Identity And Roles

- create `users` and `user_auth_identities`
- switch JWT `sub` to internal `user_id`
- attach principal to request context
- implement role checks

### Phase 2. User-Owned Settings And Notification State

- replace global settings access with per-user settings
- add `user_notification_settings`
- add `user_push_endpoints`
- add `user_favorite_teams`

### Phase 3. Watch Subscriptions And Delivery Layer

- add `monitored_matches`
- add `user_watch_subscriptions`
- add `user_recommendation_deliveries`
- refactor jobs to aggregate demand before analysis

Implementation note:

- phase 3 is being delivered incrementally as:
   - phase 3a: watch subscription registry
   - phase 3b: delivery staging, read API, and Web Push delivery status loop
- phase 3c: notification channel registry and DB-backed Telegram runtime configuration
- remaining pending work after phase 3b includes compiled condition evaluation, true user-level Telegram delivery, and full removal of legacy global delivery assumptions

Additional decision:

- channel setup must be prepared for multiple delivery forms (`telegram`, `zalo`, `web_push`, `email`) even if sender implementations are staged later
- Telegram runtime delivery target must come from DB-backed operational settings, not environment fallback

Implementation conformance note as of 2026-03-24:

- `settings`, `notification-settings`, `favorite-teams`, `recommendation-deliveries`, and `watch-subscriptions` have design-aligned self-service paths available
- legacy compatibility reads from `watchlist` and fallback reads from `user_settings` remain transitional behavior and must stay documented until removed

### Phase 4. Bets Refactor

- replace global bets with `user_bets`
- add admin global views

### Phase 5. Billing Foundation

- add `plans`, `plan_prices`, `plan_entitlements`
- add `payment_customers`, `checkout_sessions`, `payment_transactions`, `billing_webhook_events`
- add `user_plan_subscriptions`

### Phase 6. Entitlements And Usage Enforcement

- add `effective_entitlements`
- add `usage_ledger`
- enforce Ask AI quota checks before LLM execution

### Phase 7. Condition Compilation

- compile user free-text conditions into structured rules
- keep raw text for UX and audit
- evaluate compiled rules in delivery stage

## 17. Risks And Mitigations

### 17.1 Risk: Provider Or LLM Cost Multiplies By User Count

Mitigation:

- keep recommendation generation shared
- move user-specific evaluation into delivery stage

### 17.2 Risk: Billing Logic Pollutes Product Logic

Mitigation:

- centralize entitlement resolution
- expose business capabilities as entitlement checks rather than plan-name checks

### 17.3 Risk: Payment Provider Lock-In

Mitigation:

- normalize provider entities
- use internal domain events
- isolate provider adapters

### 17.4 Risk: Free-Text Conditions Become Operationally Expensive

Mitigation:

- keep free-text as input only
- compile to structured rules
- avoid per-user prompt specialization by default

### 17.5 Risk: Authorization Regressions

Mitigation:

- standardize request principal
- separate self-service routes from admin routes
- enforce ownership in repos and service layer, not only in UI

## 18. Open Design Choices To Lock Before Implementation

1. Which payment gateway should be first: Stripe, Paddle, Lemon Squeezy, or another intermediary.
2. Whether plan intervals start with monthly only or monthly plus annual.
3. Whether free users are allowed and, if yes, what default entitlements they receive.
4. Whether Ask AI daily quota resets in UTC or user-local timezone.
5. Whether admin can grant manual entitlement overrides from UI in phase 1.
6. Whether Telegram delivery is available only on paid tiers or also on free tier.
7. Whether recommendation feed visibility is fully shared to all authenticated users or partially filtered by plan tier.

## 19. Final Recommendation

Implementation should begin only after the following architectural commitments are accepted:

1. recommendations remain a shared canonical artifact
2. user-specific behavior is modeled as subscription, delivery, and personal action state
3. plans are defined through entitlements, not hardcoded per-feature columns
4. quota enforcement happens before expensive work starts
5. payments are integrated through a gateway abstraction with hosted checkout and webhooks

This design preserves the existing prompt logic, supports independent personal accounts, adds monetization cleanly, and keeps the future cost model under control.