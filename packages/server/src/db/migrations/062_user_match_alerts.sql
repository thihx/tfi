BEGIN;

CREATE TABLE IF NOT EXISTS user_match_alert_settings (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  match_start_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  manual_match_start_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  favorite_team_match_start_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  favorite_league_match_start_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  condition_alerts_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  favorite_team_condition_alerts_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  favorite_league_condition_alerts_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  kickoff_lead_minutes INTEGER NOT NULL DEFAULT 0,
  default_cooldown_minutes INTEGER NOT NULL DEFAULT 10,
  channel_policy JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_user_match_alert_settings_kickoff_lead
    CHECK (kickoff_lead_minutes IN (0, 5, 10, 15, 30)),
  CONSTRAINT chk_user_match_alert_settings_cooldown
    CHECK (default_cooldown_minutes >= 0 AND default_cooldown_minutes <= 240)
);

CREATE TABLE IF NOT EXISTS user_match_alert_rules (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  match_id TEXT,
  alert_kind TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  source TEXT NOT NULL DEFAULT 'manual',
  source_ref JSONB NOT NULL DEFAULT '{}'::jsonb,
  rule_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  compiled_status TEXT NOT NULL DEFAULT 'compiled',
  cooldown_minutes INTEGER NOT NULL DEFAULT 0,
  once_per_match BOOLEAN NOT NULL DEFAULT TRUE,
  channel_policy JSONB NOT NULL DEFAULT '{}'::jsonb,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_user_match_alert_rules_kind
    CHECK (alert_kind IN ('match_start', 'condition_signal')),
  CONSTRAINT chk_user_match_alert_rules_compiled_status
    CHECK (compiled_status IN ('compiled', 'draft', 'unsupported', 'error')),
  CONSTRAINT chk_user_match_alert_rules_cooldown
    CHECK (cooldown_minutes >= 0 AND cooldown_minutes <= 240)
);

CREATE INDEX IF NOT EXISTS idx_user_match_alert_rules_match_kind
  ON user_match_alert_rules (match_id, alert_kind, enabled);

CREATE INDEX IF NOT EXISTS idx_user_match_alert_rules_user_kind
  ON user_match_alert_rules (user_id, alert_kind, enabled);

CREATE INDEX IF NOT EXISTS idx_user_match_alert_rules_source
  ON user_match_alert_rules (source, alert_kind, enabled);

CREATE UNIQUE INDEX IF NOT EXISTS uq_user_match_alert_rules_match_source
  ON user_match_alert_rules (user_id, match_id, alert_kind, source)
  WHERE match_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS user_match_alert_deliveries (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  rule_id BIGINT NOT NULL REFERENCES user_match_alert_rules(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  match_id TEXT NOT NULL,
  alert_kind TEXT NOT NULL,
  trigger_key TEXT NOT NULL,
  trigger_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
  delivery_status TEXT NOT NULL DEFAULT 'pending',
  delivered_at TIMESTAMPTZ,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_user_match_alert_deliveries_trigger UNIQUE (rule_id, trigger_key),
  CONSTRAINT chk_user_match_alert_deliveries_kind
    CHECK (alert_kind IN ('match_start', 'condition_signal')),
  CONSTRAINT chk_user_match_alert_deliveries_status
    CHECK (delivery_status IN ('pending', 'delivered', 'failed', 'suppressed'))
);

CREATE INDEX IF NOT EXISTS idx_user_match_alert_deliveries_pending
  ON user_match_alert_deliveries (delivery_status, created_at);

CREATE INDEX IF NOT EXISTS idx_user_match_alert_deliveries_user_match
  ON user_match_alert_deliveries (user_id, match_id, created_at DESC);

CREATE TABLE IF NOT EXISTS user_match_alert_delivery_channels (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  delivery_id BIGINT NOT NULL REFERENCES user_match_alert_deliveries(id) ON DELETE CASCADE,
  channel_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  attempt_count INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  last_attempt_at TIMESTAMPTZ,
  delivered_at TIMESTAMPTZ,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_user_match_alert_delivery_channels UNIQUE (delivery_id, channel_type),
  CONSTRAINT chk_user_match_alert_delivery_channels_type
    CHECK (channel_type IN ('web_push', 'telegram')),
  CONSTRAINT chk_user_match_alert_delivery_channels_status
    CHECK (status IN ('pending', 'delivered', 'failed', 'suppressed'))
);

CREATE INDEX IF NOT EXISTS idx_user_match_alert_delivery_channels_pending
  ON user_match_alert_delivery_channels (channel_type, status, delivery_id);

CREATE TABLE IF NOT EXISTS user_condition_alert_presets (
  id TEXT NOT NULL,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL DEFAULT 'custom',
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  rule_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  default_cooldown_minutes INTEGER NOT NULL DEFAULT 10,
  default_once_per_match BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, id)
);

COMMIT;
