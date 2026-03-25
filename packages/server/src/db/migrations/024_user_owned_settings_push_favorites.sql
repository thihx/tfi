-- ============================================================
-- Migration 024: User-owned settings, push subscriptions, favorites
-- Scopes self-service data to authenticated users while preserving
-- shared operational reads for jobs and notification fanout.
-- ============================================================

BEGIN;

ALTER TABLE user_settings
  ALTER COLUMN user_id DROP DEFAULT;

CREATE TABLE IF NOT EXISTS user_notification_settings (
  user_id TEXT PRIMARY KEY,
  web_push_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  telegram_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  notification_language TEXT NOT NULL DEFAULT 'vi',
  minimum_confidence SMALLINT,
  minimum_odds NUMERIC(8,3),
  quiet_hours JSONB NOT NULL DEFAULT '{}'::jsonb,
  channel_policy JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE push_subscriptions
  ADD COLUMN IF NOT EXISTS user_id TEXT;

UPDATE push_subscriptions
SET user_id = 'default'
WHERE user_id IS NULL;

ALTER TABLE push_subscriptions
  ALTER COLUMN user_id SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_push_subscriptions_user_id
  ON push_subscriptions (user_id);

ALTER TABLE favorite_teams
  ADD COLUMN IF NOT EXISTS user_id TEXT;

UPDATE favorite_teams
SET user_id = 'default'
WHERE user_id IS NULL;

ALTER TABLE favorite_teams
  ALTER COLUMN user_id SET NOT NULL;

ALTER TABLE team_profiles
  DROP CONSTRAINT IF EXISTS team_profiles_team_id_fkey;

ALTER TABLE favorite_teams
  DROP CONSTRAINT IF EXISTS favorite_teams_pkey;

ALTER TABLE favorite_teams
  ADD CONSTRAINT favorite_teams_pkey PRIMARY KEY (user_id, team_id);

CREATE INDEX IF NOT EXISTS idx_favorite_teams_user_id
  ON favorite_teams (user_id);

CREATE INDEX IF NOT EXISTS idx_favorite_teams_team_id
  ON favorite_teams (team_id);

COMMIT;