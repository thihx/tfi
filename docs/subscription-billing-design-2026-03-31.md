# Subscription And Billing Design

Date: 2026-03-31

## Goal

Add a commercial subscription foundation to TFI without overloading the existing internal role system.

This phase intentionally delivers:

- configurable subscription plans
- per-user subscription assignment
- a server-side entitlement engine
- hard enforcement on high-value capabilities
- admin management UI and APIs

This phase intentionally does not claim:

- public checkout
- external payment provider integration
- invoice rendering
- customer billing portal

Those items depend on a later provider decision.

## Non-Goals

- Do not repurpose `owner/admin/member` into product tiers.
- Do not make entitlement checks frontend-only.
- Do not hardcode Free/Pro/Premium behavior directly into feature routes.

## Separation Of Concerns

### Internal role

Existing user role continues to mean operational authority:

- `owner`
- `admin`
- `member`

Role decides who can manage users, jobs, settings, and manual settlement.

### Commercial subscription

Subscription decides what a signed-in user may consume:

- manual AI quota
- active watchlist capacity
- notification channel access
- proactive recommendation access
- report depth
- future export or advanced scout features

## V1 Data Model

### `subscription_plans`

Stores versionless plan definitions for the first rollout.

Important fields:

- `plan_code`
- `display_name`
- `description`
- `billing_interval`
- `price_amount`
- `currency`
- `active`
- `public`
- `display_order`
- `entitlements JSONB`
- `metadata JSONB`

`entitlements` is JSONB on purpose in V1.

This keeps plan editing flexible enough for fast rollout while still allowing typed validation in application code.

### `user_subscriptions`

Stores the effective plan assigned to a user.

Important fields:

- `user_id`
- `plan_code`
- `status`
- `provider`
- `provider_customer_id`
- `provider_subscription_id`
- period dates
- `cancel_at_period_end`
- `metadata`

Only one current subscription row is allowed per user for statuses that still grant an active commercial relationship:

- `trialing`
- `active`
- `past_due`
- `paused`

### `entitlement_usage_counters`

Aggregated counters for quota-backed features such as manual AI asks.

Composite identity:

- `user_id`
- `entitlement_key`
- `period_key`

### `entitlement_usage_events`

Append-only audit trail for usage consumption.

This is important for:

- support investigation
- future billing reconciliation
- quota debugging

### `billing_events`

Raw external billing webhook/event storage is included now so the later payment provider phase has an audit landing zone.

V1 does not actively consume external provider events yet.

## Entitlement Catalog V1

The catalog is code-defined and validated by the backend.

### Enforced now

- `ai.manual.ask.enabled`
- `ai.manual.ask.daily_limit`
- `watchlist.active_matches.limit`
- `notifications.channels.allowed_types`
- `notifications.channels.max_active`

### Configured now, reserved for follow-up enforcement

- `recommendations.proactive.feed.enabled`
- `recommendations.proactive.feed.daily_limit`
- `watchlist.favorite_teams.limit`
- `watchlist.custom_conditions.limit`
- `reports.advanced.enabled`
- `reports.export.enabled`
- `history.retention.days`

## Enforcement Points

### Manual AI

Route:

- `POST /api/proxy/ai/analyze`

Rules:

- feature must be enabled
- request consumes daily quota on accepted AI execution path
- unsupported plans receive a structured entitlement error

### Watchlist capacity

Route:

- `POST /api/me/watch-subscriptions`

Rules:

- active watch count must stay below `watchlist.active_matches.limit`

### Notification channels

Routes:

- `PUT /api/notification-channels/:channelType`
- `PUT /api/me/notification-channels/:channelType`

Rules:

- channel type must be in `notifications.channels.allowed_types`
- enabling another channel cannot exceed `notifications.channels.max_active`

## Why JSONB Plan Entitlements In V1

This repo needs configurability sooner than it needs a fully normalized entitlement authoring system.

JSONB plus a typed catalog gives:

- fast rollout
- versionable keys in code
- admin editability
- future path to normalization if plan complexity grows

The backend remains the source of truth because every value is normalized and validated through the entitlement catalog before use.

## Default Plan Matrix

### Free

- manual AI: enabled, 3/day
- active watchlist matches: 5
- notification channels: `web_push`
- max active channels: 1
- proactive feed: basic, limited

### Pro

- manual AI: 20/day
- active watchlist matches: 30
- notification channels: `web_push`, `telegram`, `email`
- max active channels: 2
- proactive feed: enabled

### Premium

- manual AI: 100/day
- active watchlist matches: 100
- notification channels: all supported channels
- max active channels: 4
- proactive feed: enabled

## API Surface V1

### Self-service

- `GET /api/me/subscription`

Returns:

- resolved current plan
- resolved entitlements
- selected usage counters

### Admin

- `GET /api/settings/subscription/catalog`
- `GET /api/settings/subscription/plans`
- `PATCH /api/settings/subscription/plans/:planCode`
- `GET /api/settings/subscription/users`
- `PUT /api/settings/subscription/users/:userId`

## Admin UI Scope

The first admin UI lives in `Settings > System`.

It includes:

- plan list with editable metadata and raw entitlement JSON
- user subscription assignment table
- clear separation from internal role management

This is enough to operate the system before public checkout exists.

## Payment Provider Phase Later

Once the business chooses a provider such as Stripe, the next phase should add:

- checkout session creation
- portal session creation
- webhook processing
- external subscription sync
- invoice/payment history

The current schema already leaves room for provider identifiers and raw billing events.
