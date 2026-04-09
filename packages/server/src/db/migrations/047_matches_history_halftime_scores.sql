-- H1 settlement: half-time scores on matches_history (UTF-8; avoid UTF-16).
ALTER TABLE matches_history ADD COLUMN IF NOT EXISTS halftime_home SMALLINT, ADD COLUMN IF NOT EXISTS halftime_away SMALLINT;
