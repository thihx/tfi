BEGIN;

ALTER TABLE user_watch_subscriptions
  ADD COLUMN IF NOT EXISTS mode TEXT NOT NULL DEFAULT 'B',
  ADD COLUMN IF NOT EXISTS priority SMALLINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active';

CREATE INDEX IF NOT EXISTS idx_user_watch_subscriptions_user_status
  ON user_watch_subscriptions (user_id, status);

COMMIT;
