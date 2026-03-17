-- ============================================================
-- Migration 007: audit_logs — System-wide audit trail
-- Tracks pipeline runs, scheduler events, job executions,
-- AI analysis calls, notifications, and key user actions.
-- ============================================================

BEGIN;

CREATE TABLE audit_logs (
  id          SERIAL PRIMARY KEY,
  timestamp   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  category    TEXT NOT NULL,        -- 'PIPELINE' | 'SCHEDULER' | 'JOB' | 'AI' | 'NOTIFICATION' | 'USER_ACTION' | 'SYSTEM'
  action      TEXT NOT NULL,        -- 'PIPELINE_START' | 'PIPELINE_COMPLETE' | 'AI_CALL' | etc.
  outcome     TEXT NOT NULL DEFAULT 'SUCCESS',  -- 'SUCCESS' | 'FAILURE' | 'SKIPPED'
  actor       TEXT NOT NULL DEFAULT 'system',   -- 'system' | 'user' | 'scheduler'
  match_id    TEXT,                 -- Related match (nullable)
  duration_ms INTEGER,              -- How long the action took
  metadata    JSONB,                -- Flexible extra data
  error       TEXT                  -- Error message if failed
);

CREATE INDEX idx_audit_logs_timestamp ON audit_logs (timestamp DESC);
CREATE INDEX idx_audit_logs_category ON audit_logs (category, timestamp DESC);
CREATE INDEX idx_audit_logs_action ON audit_logs (action, timestamp DESC);
CREATE INDEX idx_audit_logs_match ON audit_logs (match_id, timestamp DESC) WHERE match_id IS NOT NULL;

COMMIT;
