-- ============================================================
-- Migration 005: Add top_league column to leagues
-- Top Leagues: matches auto-added to watchlist by fetch-matches job
-- ============================================================

ALTER TABLE leagues ADD COLUMN IF NOT EXISTS top_league BOOLEAN DEFAULT FALSE;

-- Create index for quick lookups
CREATE INDEX IF NOT EXISTS idx_leagues_top_league ON leagues (top_league) WHERE top_league = TRUE;
