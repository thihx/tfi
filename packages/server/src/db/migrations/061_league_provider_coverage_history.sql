CREATE TABLE IF NOT EXISTS league_provider_coverage_history (
  id BIGSERIAL PRIMARY KEY,
  league_id INTEGER NOT NULL REFERENCES leagues(league_id) ON DELETE CASCADE,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  provider_coverage_season INTEGER NULL,
  provider_coverage JSONB NOT NULL DEFAULT '{}'::jsonb,
  coverage_fixtures_events BOOLEAN NULL,
  coverage_fixtures_lineups BOOLEAN NULL,
  coverage_fixtures_statistics BOOLEAN NULL,
  coverage_fixtures_players BOOLEAN NULL,
  coverage_standings BOOLEAN NULL,
  coverage_players BOOLEAN NULL,
  coverage_predictions BOOLEAN NULL,
  coverage_odds BOOLEAN NULL,
  coverage_hash TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_league_provider_coverage_history_hash
  ON league_provider_coverage_history (league_id, COALESCE(provider_coverage_season, 0), coverage_hash);

CREATE INDEX IF NOT EXISTS idx_league_provider_coverage_history_lookup
  ON league_provider_coverage_history (league_id, synced_at DESC);
