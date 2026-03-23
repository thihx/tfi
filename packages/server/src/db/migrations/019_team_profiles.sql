-- ============================================================
-- Migration 019: team_profiles (1:1 with favorite_teams)
-- Profile stored as JSONB for flexibility — fields can evolve
-- without additional migrations.
-- ============================================================

CREATE TABLE IF NOT EXISTS team_profiles (
  team_id    TEXT        PRIMARY KEY REFERENCES favorite_teams(team_id) ON DELETE CASCADE,
  profile    JSONB       NOT NULL DEFAULT '{}',
  notes_en   TEXT        NOT NULL DEFAULT '',
  notes_vi   TEXT        NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_team_profiles_updated_at ON team_profiles (updated_at DESC);

-- GIN index for querying JSONB fields (e.g. WHERE profile->>'attack_style' = 'counter')
CREATE INDEX IF NOT EXISTS idx_team_profiles_profile ON team_profiles USING GIN (profile);
