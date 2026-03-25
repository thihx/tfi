-- ============================================================
-- Migration 025: Watch subscriptions registry
-- Introduces monitored_matches + user_watch_subscriptions while
-- keeping legacy watchlist available during the transition.
-- ============================================================

BEGIN;

CREATE TABLE IF NOT EXISTS monitored_matches (
  match_id TEXT PRIMARY KEY,
  subscriber_count INTEGER NOT NULL DEFAULT 0,
  runtime_status TEXT NOT NULL DEFAULT 'idle',
  last_interest_at TIMESTAMPTZ,
  last_analysis_at TIMESTAMPTZ,
  next_analysis_due_at TIMESTAMPTZ,
  lock_version BIGINT NOT NULL DEFAULT 0,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_monitored_matches_subscriber_count
  ON monitored_matches (subscriber_count);

CREATE INDEX IF NOT EXISTS idx_monitored_matches_runtime_status
  ON monitored_matches (runtime_status);

CREATE TABLE IF NOT EXISTS user_watch_subscriptions (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  match_id TEXT NOT NULL,
  mode TEXT NOT NULL DEFAULT 'B',
  priority SMALLINT NOT NULL DEFAULT 0,
  custom_condition_text TEXT NOT NULL DEFAULT '',
  compiled_condition JSONB NOT NULL DEFAULT '{}'::jsonb,
  compiled_condition_status TEXT NOT NULL DEFAULT 'empty',
  auto_apply_recommended_condition BOOLEAN NOT NULL DEFAULT FALSE,
  notify_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  status TEXT NOT NULL DEFAULT 'active',
  source TEXT NOT NULL DEFAULT 'manual',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_user_watch_subscriptions_user_match UNIQUE (user_id, match_id)
);

CREATE INDEX IF NOT EXISTS idx_user_watch_subscriptions_match_id
  ON user_watch_subscriptions (match_id);

CREATE INDEX IF NOT EXISTS idx_user_watch_subscriptions_user_status
  ON user_watch_subscriptions (user_id, status);

COMMIT;