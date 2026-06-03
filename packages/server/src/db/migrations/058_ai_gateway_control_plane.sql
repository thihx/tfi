-- ============================================================
-- Migration 058: AI Gateway control plane
-- Tracks LLM policy decisions, cost estimates, breakers, and incidents.
-- ============================================================

BEGIN;

CREATE TABLE IF NOT EXISTS ai_gateway_logs (
  id                       SERIAL PRIMARY KEY,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  app_id                   TEXT NOT NULL DEFAULT 'tfi',
  provider                 TEXT NOT NULL,
  model                    TEXT NOT NULL,
  operation                TEXT NOT NULL,
  feature_key              TEXT NOT NULL,
  mode                     TEXT NOT NULL,
  status                   TEXT NOT NULL,
  decision                 TEXT NOT NULL,
  reason                   TEXT,
  severity                 TEXT NOT NULL DEFAULT 'info',
  match_id                 TEXT,
  run_id                   TEXT,
  prompt_version           TEXT,
  estimated_input_tokens   INTEGER NOT NULL DEFAULT 0,
  estimated_output_tokens  INTEGER NOT NULL DEFAULT 0,
  estimated_cost_usd       NUMERIC(14, 8) NOT NULL DEFAULT 0,
  prompt_chars             INTEGER NOT NULL DEFAULT 0,
  response_chars           INTEGER NOT NULL DEFAULT 0,
  latency_ms               INTEGER,
  metadata                 JSONB,
  error                    TEXT
);

CREATE INDEX IF NOT EXISTS idx_ai_gateway_logs_created
  ON ai_gateway_logs (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_gateway_logs_feature_created
  ON ai_gateway_logs (feature_key, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_gateway_logs_status_created
  ON ai_gateway_logs (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_gateway_logs_match_created
  ON ai_gateway_logs (match_id, created_at DESC)
  WHERE match_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS ai_gateway_breakers (
  id            SERIAL PRIMARY KEY,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  opened_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  closed_at     TIMESTAMPTZ,
  status        TEXT NOT NULL DEFAULT 'open',
  scope_type    TEXT NOT NULL,
  scope_key     TEXT NOT NULL,
  reason        TEXT NOT NULL,
  severity      TEXT NOT NULL DEFAULT 'high',
  opened_by     TEXT NOT NULL DEFAULT 'ai_gateway',
  metadata      JSONB
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_ai_gateway_breakers_open_scope
  ON ai_gateway_breakers (scope_type, scope_key)
  WHERE status = 'open';
CREATE INDEX IF NOT EXISTS idx_ai_gateway_breakers_updated
  ON ai_gateway_breakers (updated_at DESC);

CREATE TABLE IF NOT EXISTS ai_gateway_incidents (
  id              SERIAL PRIMARY KEY,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at     TIMESTAMPTZ,
  status          TEXT NOT NULL DEFAULT 'open',
  severity        TEXT NOT NULL DEFAULT 'medium',
  incident_type   TEXT NOT NULL,
  title           TEXT NOT NULL,
  feature_key     TEXT,
  operation       TEXT,
  provider        TEXT,
  model           TEXT,
  match_id        TEXT,
  run_id          TEXT,
  breaker_id      INTEGER REFERENCES ai_gateway_breakers(id),
  metadata        JSONB
);

CREATE INDEX IF NOT EXISTS idx_ai_gateway_incidents_created
  ON ai_gateway_incidents (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_gateway_incidents_status_created
  ON ai_gateway_incidents (status, created_at DESC);

COMMIT;
