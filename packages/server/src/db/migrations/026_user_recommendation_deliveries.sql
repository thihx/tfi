-- ============================================================
-- Migration 026: User recommendation deliveries
-- Adds per-user delivery history derived from canonical recommendations
-- and active user watch subscriptions.
-- ============================================================

BEGIN;

CREATE TABLE IF NOT EXISTS user_recommendation_deliveries (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  recommendation_id INTEGER NOT NULL REFERENCES recommendations(id) ON DELETE CASCADE,
  match_id TEXT NOT NULL,
  matched_condition BOOLEAN NOT NULL DEFAULT FALSE,
  eligibility_status TEXT NOT NULL DEFAULT 'pending',
  delivery_status TEXT NOT NULL DEFAULT 'pending',
  delivery_channels JSONB NOT NULL DEFAULT '[]'::jsonb,
  delivered_at TIMESTAMPTZ,
  hidden BOOLEAN NOT NULL DEFAULT FALSE,
  dismissed BOOLEAN NOT NULL DEFAULT FALSE,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_user_recommendation_deliveries_user_rec UNIQUE (user_id, recommendation_id)
);

CREATE INDEX IF NOT EXISTS idx_user_recommendation_deliveries_user_created_at
  ON user_recommendation_deliveries (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_user_recommendation_deliveries_delivery_status_created_at
  ON user_recommendation_deliveries (delivery_status, created_at);

CREATE INDEX IF NOT EXISTS idx_user_recommendation_deliveries_match_id
  ON user_recommendation_deliveries (match_id);

COMMIT;