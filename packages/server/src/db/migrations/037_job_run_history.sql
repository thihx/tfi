BEGIN;

CREATE TABLE IF NOT EXISTS job_run_history (
  id               BIGSERIAL PRIMARY KEY,
  job_name         TEXT        NOT NULL,
  scheduled_at     TIMESTAMPTZ NOT NULL,
  started_at       TIMESTAMPTZ NOT NULL,
  completed_at     TIMESTAMPTZ,
  status           TEXT        NOT NULL,
  skip_reason      TEXT,
  lock_policy      TEXT        NOT NULL,
  degraded_locking BOOLEAN     NOT NULL DEFAULT FALSE,
  instance_id      TEXT        NOT NULL,
  lag_ms           INTEGER,
  duration_ms      INTEGER,
  error            TEXT,
  summary          JSONB       NOT NULL DEFAULT '{}'::jsonb,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_job_run_history_job_started
  ON job_run_history (job_name, started_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_job_run_history_started
  ON job_run_history (started_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_job_run_history_status_started
  ON job_run_history (status, started_at DESC, id DESC);

COMMENT ON TABLE job_run_history IS
  'Persistent scheduler run history for observability, SLA tracking, degraded lock visibility, and job-level audit trails.';

COMMIT;
