CREATE TABLE IF NOT EXISTS provider_fixture_cache (
  match_id TEXT PRIMARY KEY,
  fixture_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  fixture_fetched_at TIMESTAMPTZ NULL,
  cached_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  match_status TEXT NOT NULL DEFAULT '',
  match_minute INTEGER NULL,
  freshness TEXT NOT NULL DEFAULT 'missing',
  degraded BOOLEAN NOT NULL DEFAULT FALSE,
  last_refresh_error TEXT NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_provider_fixture_cache_cached_at
  ON provider_fixture_cache (cached_at DESC);

CREATE TABLE IF NOT EXISTS provider_fixture_stats_cache (
  match_id TEXT PRIMARY KEY,
  statistics_payload JSONB NOT NULL DEFAULT '[]'::jsonb,
  coverage_flags JSONB NOT NULL DEFAULT '{}'::jsonb,
  stats_fetched_at TIMESTAMPTZ NULL,
  cached_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  match_status TEXT NOT NULL DEFAULT '',
  match_minute INTEGER NULL,
  freshness TEXT NOT NULL DEFAULT 'missing',
  degraded BOOLEAN NOT NULL DEFAULT FALSE,
  last_refresh_error TEXT NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_provider_fixture_stats_cache_cached_at
  ON provider_fixture_stats_cache (cached_at DESC);

CREATE TABLE IF NOT EXISTS provider_fixture_events_cache (
  match_id TEXT PRIMARY KEY,
  events_payload JSONB NOT NULL DEFAULT '[]'::jsonb,
  coverage_flags JSONB NOT NULL DEFAULT '{}'::jsonb,
  events_fetched_at TIMESTAMPTZ NULL,
  cached_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  match_status TEXT NOT NULL DEFAULT '',
  match_minute INTEGER NULL,
  freshness TEXT NOT NULL DEFAULT 'missing',
  degraded BOOLEAN NOT NULL DEFAULT FALSE,
  last_refresh_error TEXT NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_provider_fixture_events_cache_cached_at
  ON provider_fixture_events_cache (cached_at DESC);