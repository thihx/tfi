-- ============================================================
-- Migration 035: track when settlement stats were last fetched
--
-- settlement_stats_updated_at only records when non-empty stats
-- were stored, so empty-stats matches (API returned []) were
-- indistinguishable from never-fetched and got re-fetched on
-- every job run indefinitely.
--
-- settlement_stats_fetched_at records every fetch attempt,
-- empty or not, so the fetch-matches job can skip matches
-- that were already attempted.
-- ============================================================

BEGIN;

ALTER TABLE matches_history
  ADD COLUMN IF NOT EXISTS settlement_stats_fetched_at TIMESTAMPTZ;

-- Backfill: rows that already have non-empty stats were clearly fetched
UPDATE matches_history
  SET settlement_stats_fetched_at = COALESCE(settlement_stats_updated_at, archived_at)
  WHERE jsonb_array_length(settlement_stats) > 0;

COMMIT;
