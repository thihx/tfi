BEGIN;

ALTER TABLE user_notification_channel_configs
  DROP CONSTRAINT IF EXISTS chk_user_notification_channel_type;

ALTER TABLE user_notification_channel_configs
  ADD CONSTRAINT chk_user_notification_channel_type
    CHECK (channel_type IN ('telegram', 'zalo', 'web_push', 'native_push', 'email', 'sms', 'voice_call'));

CREATE TABLE IF NOT EXISTS native_push_devices (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  device_id TEXT NOT NULL,
  platform TEXT NOT NULL,
  provider TEXT NOT NULL,
  token TEXT NOT NULL,
  app_version TEXT,
  device_name TEXT,
  timezone TEXT,
  local_notifications_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ,
  CONSTRAINT uq_native_push_devices_user_device UNIQUE (user_id, device_id),
  CONSTRAINT uq_native_push_devices_provider_token UNIQUE (provider, token),
  CONSTRAINT chk_native_push_devices_platform CHECK (platform IN ('ios', 'android')),
  CONSTRAINT chk_native_push_devices_provider CHECK (provider IN ('fcm', 'apns'))
);

CREATE INDEX IF NOT EXISTS idx_native_push_devices_user_id
  ON native_push_devices (user_id);

CREATE INDEX IF NOT EXISTS idx_native_push_devices_active
  ON native_push_devices (user_id, updated_at DESC);

ALTER TABLE user_match_alert_delivery_channels
  DROP CONSTRAINT IF EXISTS chk_user_match_alert_delivery_channels_type;

ALTER TABLE user_match_alert_delivery_channels
  ADD CONSTRAINT chk_user_match_alert_delivery_channels_type
    CHECK (channel_type IN ('web_push', 'native_push', 'telegram', 'sms', 'voice_call'));

UPDATE subscription_plans
   SET entitlements = jsonb_set(
     entitlements,
     '{notifications.channels.allowed_types}',
     '["web_push", "native_push", "telegram", "email"]'::jsonb
   )
 WHERE plan_code = 'pro';

UPDATE subscription_plans
   SET entitlements = jsonb_set(
     entitlements,
     '{notifications.channels.allowed_types}',
     '["web_push", "native_push", "telegram", "email", "zalo", "sms", "voice_call"]'::jsonb
   )
 WHERE plan_code = 'premium';

COMMIT;
