-- ============================================================
-- Migration 012: extend matches_history for local-first settlement
-- Stores regular-time score and final statistics so auto-settle /
-- re-evaluate can avoid Football API calls when data is already cached.
-- ============================================================

BEGIN;

ALTER TABLE matches_history
  ADD COLUMN IF NOT EXISTS regular_home_score SMALLINT,
  ADD COLUMN IF NOT EXISTS regular_away_score SMALLINT,
  ADD COLUMN IF NOT EXISTS result_provider TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS settlement_stats JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS settlement_stats_provider TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS settlement_stats_updated_at TIMESTAMPTZ;

UPDATE matches_history
SET result_provider = 'api-football'
WHERE result_provider = '';

CREATE INDEX IF NOT EXISTS idx_mh_final_status ON matches_history (final_status);

COMMIT;
