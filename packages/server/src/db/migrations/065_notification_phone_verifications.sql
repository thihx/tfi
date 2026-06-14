BEGIN;

CREATE TABLE IF NOT EXISTS user_notification_phone_verifications (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  channel_type TEXT NOT NULL,
  phone_number TEXT NOT NULL,
  code_hash TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_user_notification_phone_verifications_channel
    CHECK (channel_type IN ('sms', 'voice_call'))
);

CREATE INDEX IF NOT EXISTS idx_user_notification_phone_verifications_lookup
  ON user_notification_phone_verifications (user_id, channel_type, phone_number, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_user_notification_phone_verifications_expiry
  ON user_notification_phone_verifications (expires_at);

COMMIT;
