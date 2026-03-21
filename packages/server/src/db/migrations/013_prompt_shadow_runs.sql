CREATE TABLE IF NOT EXISTS prompt_shadow_runs (
  id BIGSERIAL PRIMARY KEY,
  analysis_run_id TEXT NOT NULL,
  match_id TEXT NOT NULL,
  captured_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  execution_role TEXT NOT NULL CHECK (execution_role IN ('active', 'shadow')),
  active_prompt_version TEXT NOT NULL DEFAULT '',
  prompt_version TEXT NOT NULL DEFAULT '',
  analysis_mode TEXT NOT NULL DEFAULT '',
  evidence_mode TEXT NOT NULL DEFAULT '',
  success BOOLEAN NOT NULL DEFAULT TRUE,
  error TEXT NOT NULL DEFAULT '',
  should_push BOOLEAN NOT NULL DEFAULT FALSE,
  ai_should_push BOOLEAN NOT NULL DEFAULT FALSE,
  selection TEXT NOT NULL DEFAULT '',
  bet_market TEXT NOT NULL DEFAULT '',
  confidence SMALLINT NOT NULL DEFAULT 0 CHECK (confidence >= 0 AND confidence <= 10),
  warnings JSONB NOT NULL DEFAULT '[]'::jsonb,
  odds_source TEXT NOT NULL DEFAULT '',
  stats_source TEXT NOT NULL DEFAULT '',
  prompt_estimated_tokens INTEGER,
  response_estimated_tokens INTEGER,
  llm_latency_ms INTEGER,
  total_latency_ms INTEGER
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_prompt_shadow_runs_unique
  ON prompt_shadow_runs (analysis_run_id, execution_role, prompt_version);

CREATE INDEX IF NOT EXISTS idx_prompt_shadow_runs_match_captured
  ON prompt_shadow_runs (match_id, captured_at DESC);

CREATE INDEX IF NOT EXISTS idx_prompt_shadow_runs_prompt_captured
  ON prompt_shadow_runs (prompt_version, captured_at DESC);
