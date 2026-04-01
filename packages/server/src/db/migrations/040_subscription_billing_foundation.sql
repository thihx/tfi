-- ============================================================
-- Migration 040: Subscription + billing foundation
-- Adds configurable plans, per-user subscriptions, and usage tracking
-- for entitlement-based access control.
-- ============================================================

BEGIN;

CREATE TABLE IF NOT EXISTS subscription_plans (
  plan_code TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  billing_interval TEXT NOT NULL DEFAULT 'manual',
  price_amount NUMERIC(12, 2) NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'USD',
  active BOOLEAN NOT NULL DEFAULT TRUE,
  public BOOLEAN NOT NULL DEFAULT FALSE,
  display_order INTEGER NOT NULL DEFAULT 0,
  entitlements JSONB NOT NULL DEFAULT '{}'::jsonb,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_subscription_plans_billing_interval
    CHECK (billing_interval IN ('manual', 'month', 'year')),
  CONSTRAINT chk_subscription_plans_entitlements_object
    CHECK (jsonb_typeof(entitlements) = 'object'),
  CONSTRAINT chk_subscription_plans_metadata_object
    CHECK (jsonb_typeof(metadata) = 'object')
);

CREATE INDEX IF NOT EXISTS idx_subscription_plans_active_order
  ON subscription_plans (active, display_order, plan_code);

CREATE TABLE IF NOT EXISTS user_subscriptions (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  plan_code TEXT NOT NULL REFERENCES subscription_plans(plan_code) ON DELETE RESTRICT,
  status TEXT NOT NULL DEFAULT 'active',
  provider TEXT NOT NULL DEFAULT 'manual',
  provider_customer_id TEXT NULL,
  provider_subscription_id TEXT NULL,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  current_period_start TIMESTAMPTZ NULL,
  current_period_end TIMESTAMPTZ NULL,
  trial_ends_at TIMESTAMPTZ NULL,
  cancel_at_period_end BOOLEAN NOT NULL DEFAULT FALSE,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_user_subscriptions_status
    CHECK (status IN ('trialing', 'active', 'past_due', 'canceled', 'expired', 'paused')),
  CONSTRAINT chk_user_subscriptions_metadata_object
    CHECK (jsonb_typeof(metadata) = 'object')
);

CREATE INDEX IF NOT EXISTS idx_user_subscriptions_user_id
  ON user_subscriptions (user_id, updated_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS uq_user_subscriptions_current_user
  ON user_subscriptions (user_id)
  WHERE status IN ('trialing', 'active', 'past_due', 'paused');

CREATE TABLE IF NOT EXISTS entitlement_usage_counters (
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  entitlement_key TEXT NOT NULL,
  period_key TEXT NOT NULL,
  used_count INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, entitlement_key, period_key),
  CONSTRAINT chk_entitlement_usage_counters_used_count
    CHECK (used_count >= 0)
);

CREATE INDEX IF NOT EXISTS idx_entitlement_usage_counters_lookup
  ON entitlement_usage_counters (entitlement_key, period_key);

CREATE TABLE IF NOT EXISTS entitlement_usage_events (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  entitlement_key TEXT NOT NULL,
  period_key TEXT NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 1,
  source TEXT NOT NULL DEFAULT 'runtime',
  context JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_entitlement_usage_events_quantity
    CHECK (quantity > 0),
  CONSTRAINT chk_entitlement_usage_events_context_object
    CHECK (jsonb_typeof(context) = 'object')
);

CREATE INDEX IF NOT EXISTS idx_entitlement_usage_events_user_created
  ON entitlement_usage_events (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_entitlement_usage_events_lookup
  ON entitlement_usage_events (entitlement_key, period_key, created_at DESC);

CREATE TABLE IF NOT EXISTS billing_events (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  provider TEXT NOT NULL,
  event_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'received',
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  error TEXT NULL,
  processed_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_billing_events_provider_event UNIQUE (provider, event_id),
  CONSTRAINT chk_billing_events_payload_object
    CHECK (jsonb_typeof(payload) = 'object')
);

INSERT INTO subscription_plans (
  plan_code,
  display_name,
  description,
  billing_interval,
  price_amount,
  currency,
  active,
  public,
  display_order,
  entitlements,
  metadata
)
VALUES
  (
    'free',
    'Free',
    'Entry plan for discovery and lightweight manual interaction.',
    'manual',
    0,
    'USD',
    TRUE,
    TRUE,
    0,
    '{
      "ai.manual.ask.enabled": true,
      "ai.manual.ask.daily_limit": 3,
      "watchlist.active_matches.limit": 5,
      "notifications.channels.allowed_types": ["web_push"],
      "notifications.channels.max_active": 1,
      "recommendations.proactive.feed.enabled": true,
      "recommendations.proactive.feed.daily_limit": 2,
      "watchlist.favorite_teams.limit": 0,
      "watchlist.custom_conditions.limit": 1,
      "reports.advanced.enabled": false,
      "reports.export.enabled": false,
      "history.retention.days": 14
    }'::jsonb,
    '{"seeded": true}'::jsonb
  ),
  (
    'pro',
    'Pro',
    'Core paid plan for active manual analysis and richer delivery.',
    'month',
    29,
    'USD',
    TRUE,
    TRUE,
    1,
    '{
      "ai.manual.ask.enabled": true,
      "ai.manual.ask.daily_limit": 20,
      "watchlist.active_matches.limit": 30,
      "notifications.channels.allowed_types": ["web_push", "telegram", "email"],
      "notifications.channels.max_active": 2,
      "recommendations.proactive.feed.enabled": true,
      "recommendations.proactive.feed.daily_limit": 15,
      "watchlist.favorite_teams.limit": 10,
      "watchlist.custom_conditions.limit": 10,
      "reports.advanced.enabled": true,
      "reports.export.enabled": false,
      "history.retention.days": 90
    }'::jsonb,
    '{"seeded": true}'::jsonb
  ),
  (
    'premium',
    'Premium',
    'High-touch plan for power users and richer delivery access.',
    'month',
    79,
    'USD',
    TRUE,
    TRUE,
    2,
    '{
      "ai.manual.ask.enabled": true,
      "ai.manual.ask.daily_limit": 100,
      "watchlist.active_matches.limit": 100,
      "notifications.channels.allowed_types": ["web_push", "telegram", "email", "zalo"],
      "notifications.channels.max_active": 4,
      "recommendations.proactive.feed.enabled": true,
      "recommendations.proactive.feed.daily_limit": 100,
      "watchlist.favorite_teams.limit": 30,
      "watchlist.custom_conditions.limit": 30,
      "reports.advanced.enabled": true,
      "reports.export.enabled": true,
      "history.retention.days": 365
    }'::jsonb,
    '{"seeded": true}'::jsonb
  )
ON CONFLICT (plan_code) DO UPDATE
SET display_name = EXCLUDED.display_name,
    description = EXCLUDED.description,
    billing_interval = EXCLUDED.billing_interval,
    price_amount = EXCLUDED.price_amount,
    currency = EXCLUDED.currency,
    active = EXCLUDED.active,
    public = EXCLUDED.public,
    display_order = EXCLUDED.display_order,
    entitlements = EXCLUDED.entitlements,
    metadata = EXCLUDED.metadata,
    updated_at = NOW();

COMMIT;
