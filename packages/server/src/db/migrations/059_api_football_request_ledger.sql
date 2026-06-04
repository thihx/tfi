CREATE TABLE IF NOT EXISTS api_football_request_ledger (
  id BIGSERIAL PRIMARY KEY,
  requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  job_name TEXT NULL,
  consumer TEXT NULL,
  endpoint TEXT NOT NULL,
  params JSONB NOT NULL DEFAULT '{}'::jsonb,
  attempt SMALLINT NOT NULL DEFAULT 1,
  success BOOLEAN NOT NULL DEFAULT FALSE,
  daily_limit BOOLEAN NOT NULL DEFAULT FALSE,
  status_code INTEGER NULL,
  latency_ms INTEGER NULL,
  result_count INTEGER NULL,
  quota_current INTEGER NULL,
  quota_limit INTEGER NULL,
  error TEXT NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_api_football_request_ledger_requested_at
  ON api_football_request_ledger (requested_at DESC);

CREATE INDEX IF NOT EXISTS idx_api_football_request_ledger_job_requested_at
  ON api_football_request_ledger (job_name, requested_at DESC);

CREATE INDEX IF NOT EXISTS idx_api_football_request_ledger_endpoint_requested_at
  ON api_football_request_ledger (endpoint, requested_at DESC);

CREATE INDEX IF NOT EXISTS idx_api_football_request_ledger_daily_limit
  ON api_football_request_ledger (daily_limit, requested_at DESC);
