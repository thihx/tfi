-- ============================================================
-- Migration 021: Team catalog + league-team directory cache
-- Standardized local-first source for low-churn provider-backed team data
-- ============================================================

CREATE TABLE IF NOT EXISTS teams (
  team_id         INTEGER PRIMARY KEY,
  team_name       TEXT        NOT NULL DEFAULT '',
  team_logo       TEXT        NOT NULL DEFAULT '',
  country         TEXT        NOT NULL DEFAULT '',
  founded         INTEGER,
  venue_id        INTEGER,
  venue_name      TEXT        NOT NULL DEFAULT '',
  venue_city      TEXT        NOT NULL DEFAULT '',
  source_provider TEXT        NOT NULL DEFAULT 'api-football',
  last_synced_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_teams_name ON teams (team_name);

CREATE TABLE IF NOT EXISTS league_team_directory (
  league_id        INTEGER     NOT NULL REFERENCES leagues(league_id) ON DELETE CASCADE,
  team_id          INTEGER     NOT NULL REFERENCES teams(team_id) ON DELETE CASCADE,
  season           INTEGER     NOT NULL,
  rank             INTEGER,
  source_provider  TEXT        NOT NULL DEFAULT 'api-football',
  fetched_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at       TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (league_id, team_id)
);

CREATE INDEX IF NOT EXISTS idx_league_team_directory_lookup
  ON league_team_directory (league_id, expires_at);

CREATE INDEX IF NOT EXISTS idx_league_team_directory_team
  ON league_team_directory (team_id);