BEGIN;

CREATE TABLE IF NOT EXISTS provider_request_ledger (
  id BIGSERIAL PRIMARY KEY,
  requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  provider TEXT NOT NULL,
  job_name TEXT NULL,
  consumer TEXT NULL,
  endpoint TEXT NOT NULL,
  params JSONB NOT NULL DEFAULT '{}'::jsonb,
  attempt SMALLINT NOT NULL DEFAULT 1,
  success BOOLEAN NOT NULL DEFAULT FALSE,
  rate_limited BOOLEAN NOT NULL DEFAULT FALSE,
  status_code INTEGER NULL,
  latency_ms INTEGER NULL,
  result_count INTEGER NULL,
  quota_current INTEGER NULL,
  quota_limit INTEGER NULL,
  error TEXT NOT NULL DEFAULT '',
  response_meta JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_provider_request_ledger_provider_requested_at
  ON provider_request_ledger (provider, requested_at DESC);

CREATE INDEX IF NOT EXISTS idx_provider_request_ledger_consumer_requested_at
  ON provider_request_ledger (consumer, requested_at DESC);

CREATE INDEX IF NOT EXISTS idx_provider_request_ledger_endpoint_requested_at
  ON provider_request_ledger (endpoint, requested_at DESC);

CREATE INDEX IF NOT EXISTS idx_provider_request_ledger_rate_limited
  ON provider_request_ledger (rate_limited, requested_at DESC);

CREATE TABLE IF NOT EXISTS provider_fixture_mappings (
  id BIGSERIAL PRIMARY KEY,
  match_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  provider_fixture_id TEXT NOT NULL,
  confidence TEXT NOT NULL DEFAULT 'unknown',
  mapping_method TEXT NOT NULL DEFAULT 'manual',
  evidence JSONB NOT NULL DEFAULT '{}'::jsonb,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (match_id, provider),
  UNIQUE (provider, provider_fixture_id)
);

CREATE INDEX IF NOT EXISTS idx_provider_fixture_mappings_match
  ON provider_fixture_mappings (match_id);

CREATE INDEX IF NOT EXISTS idx_provider_fixture_mappings_provider_fixture
  ON provider_fixture_mappings (provider, provider_fixture_id);

CREATE TABLE IF NOT EXISTS provider_fixture_samples (
  id BIGSERIAL PRIMARY KEY,
  match_id TEXT NULL,
  provider_fixture_id TEXT NOT NULL,
  captured_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  provider TEXT NOT NULL,
  consumer TEXT NOT NULL DEFAULT 'unknown',
  success BOOLEAN NOT NULL DEFAULT FALSE,
  latency_ms INTEGER NULL,
  status_code INTEGER NULL,
  error TEXT NOT NULL DEFAULT '',
  raw_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  normalized_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  coverage_flags JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_provider_fixture_samples_provider_time
  ON provider_fixture_samples (provider, captured_at DESC);

CREATE INDEX IF NOT EXISTS idx_provider_fixture_samples_match_time
  ON provider_fixture_samples (match_id, captured_at DESC);

CREATE INDEX IF NOT EXISTS idx_provider_fixture_samples_provider_fixture_time
  ON provider_fixture_samples (provider, provider_fixture_id, captured_at DESC);

CREATE TABLE IF NOT EXISTS provider_event_samples (
  id BIGSERIAL PRIMARY KEY,
  match_id TEXT NULL,
  provider_fixture_id TEXT NOT NULL,
  captured_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  match_minute SMALLINT NULL,
  match_status TEXT NOT NULL DEFAULT '',
  provider TEXT NOT NULL,
  consumer TEXT NOT NULL DEFAULT 'unknown',
  success BOOLEAN NOT NULL DEFAULT FALSE,
  latency_ms INTEGER NULL,
  status_code INTEGER NULL,
  error TEXT NOT NULL DEFAULT '',
  raw_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  normalized_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  coverage_flags JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_provider_event_samples_provider_time
  ON provider_event_samples (provider, captured_at DESC);

CREATE INDEX IF NOT EXISTS idx_provider_event_samples_match_time
  ON provider_event_samples (match_id, captured_at DESC);

CREATE INDEX IF NOT EXISTS idx_provider_event_samples_provider_fixture_time
  ON provider_event_samples (provider, provider_fixture_id, captured_at DESC);

COMMIT;
