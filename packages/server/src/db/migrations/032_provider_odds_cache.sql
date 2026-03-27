-- ============================================================
-- TFI PostgreSQL Schema - V032 Provider Odds Cache
-- ============================================================
-- Canonical cache-first odds layer. Business logic and UI should
-- consume semantic odds_source values from this table instead of
-- binding to any provider-specific source naming.
-- ============================================================

BEGIN;

CREATE TABLE provider_odds_cache (
  match_id            TEXT PRIMARY KEY,
  odds_source         TEXT        NOT NULL DEFAULT 'none',
  provider_source     TEXT        NOT NULL DEFAULT 'none',
  response            JSONB       NOT NULL DEFAULT '[]'::jsonb,
  coverage_flags      JSONB       NOT NULL DEFAULT '{}'::jsonb,
  provider_trace      JSONB       NOT NULL DEFAULT '{}'::jsonb,
  odds_fetched_at     TIMESTAMPTZ,
  cached_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  match_status        TEXT        NOT NULL DEFAULT '',
  match_minute        SMALLINT,
  freshness           TEXT        NOT NULL DEFAULT 'missing',
  degraded            BOOLEAN     NOT NULL DEFAULT FALSE,
  last_refresh_error  TEXT        NOT NULL DEFAULT '',
  has_1x2             BOOLEAN     NOT NULL DEFAULT FALSE,
  has_ou              BOOLEAN     NOT NULL DEFAULT FALSE,
  has_ah              BOOLEAN     NOT NULL DEFAULT FALSE,
  has_btts            BOOLEAN     NOT NULL DEFAULT FALSE,
  CHECK (jsonb_typeof(response) = 'array'),
  CHECK (jsonb_typeof(coverage_flags) = 'object'),
  CHECK (jsonb_typeof(provider_trace) = 'object')
);

CREATE INDEX idx_provider_odds_cache_cached_at
  ON provider_odds_cache (cached_at DESC);

CREATE INDEX idx_provider_odds_cache_freshness
  ON provider_odds_cache (freshness, cached_at DESC);

CREATE INDEX idx_provider_odds_cache_provider_source
  ON provider_odds_cache (provider_source, cached_at DESC);

COMMIT;