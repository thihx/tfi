-- ============================================================
-- Migration 008: Enrich matches table with live stats & fixture detail
--
-- Adds columns populated directly from the football API each minute:
--   • home/away_team_id  — team IDs for future lookups
--   • round              — league round (e.g. "Regular Season - 27")
--   • halftime_home/away — half-time score
--   • referee            — match referee
--   • home/away_reds     — red card counts (from /fixtures/statistics, live only)
--   • home/away_yellows  — yellow card counts (from /fixtures/statistics, live only)
-- ============================================================

ALTER TABLE matches
  ADD COLUMN IF NOT EXISTS home_team_id  INTEGER,
  ADD COLUMN IF NOT EXISTS away_team_id  INTEGER,
  ADD COLUMN IF NOT EXISTS round         TEXT    NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS halftime_home SMALLINT,
  ADD COLUMN IF NOT EXISTS halftime_away SMALLINT,
  ADD COLUMN IF NOT EXISTS referee       TEXT,
  ADD COLUMN IF NOT EXISTS home_reds     SMALLINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS away_reds     SMALLINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS home_yellows  SMALLINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS away_yellows  SMALLINT NOT NULL DEFAULT 0;
