-- ============================================================
-- TFI PostgreSQL Schema - V009 Provider Samples
-- ============================================================
-- Append-only provider-level samples used to compare odds/stats
-- coverage, latency, and error rates without overwriting the
-- canonical pipeline state stored in match_snapshots/odds_movements.
-- ============================================================

BEGIN;

CREATE TABLE provider_stats_samples (
  id                 SERIAL PRIMARY KEY,
  match_id           TEXT        NOT NULL,
  captured_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  match_minute       SMALLINT,
  match_status       TEXT        NOT NULL DEFAULT '',
  provider           TEXT        NOT NULL,
  consumer           TEXT        NOT NULL DEFAULT 'unknown',
  success            BOOLEAN     NOT NULL DEFAULT FALSE,
  latency_ms         INTEGER,
  status_code        INTEGER,
  error              TEXT        NOT NULL DEFAULT '',
  raw_payload        JSONB       NOT NULL DEFAULT '{}'::jsonb,
  normalized_payload JSONB       NOT NULL DEFAULT '{}'::jsonb,
  coverage_flags     JSONB       NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX idx_provider_stats_match_time
  ON provider_stats_samples (match_id, captured_at DESC);
CREATE INDEX idx_provider_stats_provider_time
  ON provider_stats_samples (provider, captured_at DESC);
CREATE INDEX idx_provider_stats_consumer_time
  ON provider_stats_samples (consumer, captured_at DESC);

CREATE TABLE provider_odds_samples (
  id                 SERIAL PRIMARY KEY,
  match_id           TEXT        NOT NULL,
  captured_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  match_minute       SMALLINT,
  match_status       TEXT        NOT NULL DEFAULT '',
  provider           TEXT        NOT NULL,
  source             TEXT        NOT NULL DEFAULT '',
  consumer           TEXT        NOT NULL DEFAULT 'unknown',
  success            BOOLEAN     NOT NULL DEFAULT FALSE,
  usable             BOOLEAN     NOT NULL DEFAULT FALSE,
  latency_ms         INTEGER,
  status_code        INTEGER,
  error              TEXT        NOT NULL DEFAULT '',
  raw_payload        JSONB       NOT NULL DEFAULT '{}'::jsonb,
  normalized_payload JSONB       NOT NULL DEFAULT '{}'::jsonb,
  coverage_flags     JSONB       NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX idx_provider_odds_match_time
  ON provider_odds_samples (match_id, captured_at DESC);
CREATE INDEX idx_provider_odds_provider_time
  ON provider_odds_samples (provider, captured_at DESC);
CREATE INDEX idx_provider_odds_source_time
  ON provider_odds_samples (source, captured_at DESC);
CREATE INDEX idx_provider_odds_consumer_time
  ON provider_odds_samples (consumer, captured_at DESC);

COMMIT;
