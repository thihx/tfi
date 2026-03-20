-- ============================================================
-- Migration 010: Add home_logo / away_logo to watchlist
-- Logos are now stored on the watchlist entry itself so they
-- remain available even after the match is removed from the
-- live matches table.
-- ============================================================

ALTER TABLE watchlist
  ADD COLUMN IF NOT EXISTS home_logo TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS away_logo TEXT NOT NULL DEFAULT '';

-- Backfill logos from the matches table for entries that are
-- still present in matches.
UPDATE watchlist w
SET home_logo = m.home_logo,
    away_logo = m.away_logo
FROM matches m
WHERE w.match_id = m.match_id::text
  AND (w.home_logo = '' OR w.away_logo = '');
