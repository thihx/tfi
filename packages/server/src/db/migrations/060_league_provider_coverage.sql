ALTER TABLE leagues
  ADD COLUMN IF NOT EXISTS provider_coverage JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS provider_coverage_season INTEGER NULL,
  ADD COLUMN IF NOT EXISTS coverage_fixtures_events BOOLEAN NULL,
  ADD COLUMN IF NOT EXISTS coverage_fixtures_lineups BOOLEAN NULL,
  ADD COLUMN IF NOT EXISTS coverage_fixtures_statistics BOOLEAN NULL,
  ADD COLUMN IF NOT EXISTS coverage_fixtures_players BOOLEAN NULL,
  ADD COLUMN IF NOT EXISTS coverage_standings BOOLEAN NULL,
  ADD COLUMN IF NOT EXISTS coverage_players BOOLEAN NULL,
  ADD COLUMN IF NOT EXISTS coverage_predictions BOOLEAN NULL,
  ADD COLUMN IF NOT EXISTS coverage_odds BOOLEAN NULL;

CREATE INDEX IF NOT EXISTS idx_leagues_coverage_odds
  ON leagues (coverage_odds);

CREATE INDEX IF NOT EXISTS idx_leagues_coverage_stats
  ON leagues (coverage_fixtures_statistics);

CREATE INDEX IF NOT EXISTS idx_leagues_provider_coverage_gin
  ON leagues USING GIN (provider_coverage);
