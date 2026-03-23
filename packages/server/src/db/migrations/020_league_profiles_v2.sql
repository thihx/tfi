-- ============================================================
-- Migration 020: league_profiles v2
-- Replaces flat-column table with JSONB profile column.
-- All 7 qualitative tiers now use 3 levels: low | balanced | high
-- No data migration — existing profiles are dropped.
-- ============================================================

DROP TABLE IF EXISTS league_profiles;

CREATE TABLE league_profiles (
  league_id  INTEGER PRIMARY KEY REFERENCES leagues(league_id) ON DELETE CASCADE,
  profile    JSONB    NOT NULL DEFAULT '{}',
  notes_en   TEXT     NOT NULL DEFAULT '',
  notes_vi   TEXT     NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_league_profiles_updated_at ON league_profiles (updated_at DESC);
CREATE INDEX idx_league_profiles_profile    ON league_profiles USING GIN (profile);
