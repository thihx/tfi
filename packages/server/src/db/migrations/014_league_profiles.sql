-- ============================================================
-- Migration 014: league_profiles (1:1 with leagues)
-- One unique betting profile per league.
-- ============================================================

CREATE TABLE IF NOT EXISTS league_profiles (
  league_id                INTEGER PRIMARY KEY REFERENCES leagues(league_id) ON DELETE CASCADE,
  tempo_tier               TEXT NOT NULL DEFAULT 'balanced' CHECK (tempo_tier IN ('very_low', 'low', 'balanced', 'high', 'very_high')),
  goal_tendency            TEXT NOT NULL DEFAULT 'balanced' CHECK (goal_tendency IN ('very_low', 'low', 'balanced', 'high', 'very_high')),
  home_advantage_tier      TEXT NOT NULL DEFAULT 'normal' CHECK (home_advantage_tier IN ('low', 'normal', 'high')),
  corners_tendency         TEXT NOT NULL DEFAULT 'balanced' CHECK (corners_tendency IN ('very_low', 'low', 'balanced', 'high', 'very_high')),
  cards_tendency           TEXT NOT NULL DEFAULT 'balanced' CHECK (cards_tendency IN ('very_low', 'low', 'balanced', 'high', 'very_high')),
  volatility_tier          TEXT NOT NULL DEFAULT 'medium' CHECK (volatility_tier IN ('low', 'medium', 'high')),
  data_reliability_tier    TEXT NOT NULL DEFAULT 'medium' CHECK (data_reliability_tier IN ('low', 'medium', 'high')),
  avg_goals                NUMERIC(5,2),
  over_2_5_rate            NUMERIC(5,2) CHECK (over_2_5_rate IS NULL OR (over_2_5_rate >= 0 AND over_2_5_rate <= 100)),
  btts_rate                NUMERIC(5,2) CHECK (btts_rate IS NULL OR (btts_rate >= 0 AND btts_rate <= 100)),
  late_goal_rate_75_plus   NUMERIC(5,2) CHECK (late_goal_rate_75_plus IS NULL OR (late_goal_rate_75_plus >= 0 AND late_goal_rate_75_plus <= 100)),
  avg_corners              NUMERIC(5,2),
  avg_cards                NUMERIC(5,2),
  notes_en                 TEXT NOT NULL DEFAULT '',
  notes_vi                 TEXT NOT NULL DEFAULT '',
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_league_profiles_updated_at ON league_profiles (updated_at DESC);
