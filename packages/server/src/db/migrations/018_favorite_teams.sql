-- ============================================================
-- Migration 018: Favorite Teams
-- Stores user's favorite teams for auto-watchlist triggering
-- ============================================================

CREATE TABLE IF NOT EXISTS favorite_teams (
  team_id    TEXT        NOT NULL PRIMARY KEY,   -- API-Sports team ID (string)
  team_name  TEXT        NOT NULL,
  team_logo  TEXT        NOT NULL DEFAULT '',
  added_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
