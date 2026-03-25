-- Migration 028: user_notification_channel_configs
-- Setup-ready channel registry for Telegram, Zalo, Web Push, and Email.

CREATE TABLE IF NOT EXISTS user_notification_channel_configs (
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  channel_type TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT FALSE,
  status TEXT NOT NULL DEFAULT 'draft',
  address TEXT NULL,
  config JSONB NOT NULL DEFAULT '{}'::jsonb,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, channel_type),
  CONSTRAINT chk_user_notification_channel_type
    CHECK (channel_type IN ('telegram', 'zalo', 'web_push', 'email')),
  CONSTRAINT chk_user_notification_channel_status
    CHECK (status IN ('draft', 'pending', 'verified', 'disabled'))
);

CREATE INDEX IF NOT EXISTS idx_user_notification_channel_configs_user_id
  ON user_notification_channel_configs (user_id);