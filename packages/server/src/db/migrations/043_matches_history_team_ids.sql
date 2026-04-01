-- Migration 043: persist team ids in matches_history for cross-competition profile sync

ALTER TABLE matches_history
  ADD COLUMN IF NOT EXISTS home_team_id INTEGER,
  ADD COLUMN IF NOT EXISTS away_team_id INTEGER;

CREATE INDEX IF NOT EXISTS idx_mh_home_team_id ON matches_history (home_team_id);
CREATE INDEX IF NOT EXISTS idx_mh_away_team_id ON matches_history (away_team_id);
