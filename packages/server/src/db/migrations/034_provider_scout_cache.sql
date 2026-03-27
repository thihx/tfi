CREATE TABLE IF NOT EXISTS provider_fixture_lineups_cache (
  match_id TEXT PRIMARY KEY,
  lineups_payload JSONB NOT NULL DEFAULT '[]'::jsonb,
  coverage_flags JSONB NOT NULL DEFAULT '{}'::jsonb,
  lineups_fetched_at TIMESTAMPTZ NULL,
  cached_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  match_status TEXT NOT NULL DEFAULT '',
  match_minute INTEGER NULL,
  freshness TEXT NOT NULL DEFAULT 'missing',
  degraded BOOLEAN NOT NULL DEFAULT FALSE,
  last_refresh_error TEXT NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_provider_fixture_lineups_cache_cached_at
  ON provider_fixture_lineups_cache (cached_at DESC);

CREATE TABLE IF NOT EXISTS provider_fixture_prediction_cache (
  match_id TEXT PRIMARY KEY,
  prediction_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  prediction_fetched_at TIMESTAMPTZ NULL,
  cached_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  match_status TEXT NOT NULL DEFAULT '',
  freshness TEXT NOT NULL DEFAULT 'missing',
  degraded BOOLEAN NOT NULL DEFAULT FALSE,
  last_refresh_error TEXT NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_provider_fixture_prediction_cache_cached_at
  ON provider_fixture_prediction_cache (cached_at DESC);

CREATE TABLE IF NOT EXISTS provider_league_standings_cache (
  league_id INTEGER NOT NULL,
  season INTEGER NOT NULL,
  standings_payload JSONB NOT NULL DEFAULT '[]'::jsonb,
  standings_fetched_at TIMESTAMPTZ NULL,
  cached_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  freshness TEXT NOT NULL DEFAULT 'missing',
  degraded BOOLEAN NOT NULL DEFAULT FALSE,
  last_refresh_error TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (league_id, season)
);

CREATE INDEX IF NOT EXISTS idx_provider_league_standings_cache_cached_at
  ON provider_league_standings_cache (cached_at DESC);