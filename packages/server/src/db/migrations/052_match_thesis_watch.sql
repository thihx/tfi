-- Migration 052: pending thesis watch for Line Ladder Patience Phase 2 (defer across analyze cycles)

BEGIN;

CREATE TABLE IF NOT EXISTS match_thesis_watch (
  id                SERIAL PRIMARY KEY,
  match_id          TEXT        NOT NULL,
  watch_key         TEXT        NOT NULL,
  status            TEXT        NOT NULL DEFAULT 'pending',
  gate_type         TEXT        NOT NULL,
  gate_payload      JSONB       NOT NULL DEFAULT '{}'::jsonb,
  selection         TEXT        NOT NULL DEFAULT '',
  bet_market        TEXT        NOT NULL DEFAULT '',
  confidence        SMALLINT    NOT NULL DEFAULT 0,
  value_percent     NUMERIC(6,2) NOT NULL DEFAULT 0,
  stake_percent     NUMERIC(6,2) NOT NULL DEFAULT 0,
  risk_level        TEXT        NOT NULL DEFAULT 'MEDIUM',
  reasoning_en      TEXT        NOT NULL DEFAULT '',
  reasoning_vi      TEXT        NOT NULL DEFAULT '',
  source            TEXT        NOT NULL DEFAULT 'llp_defer',
  last_block_reason TEXT        NOT NULL DEFAULT '',
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at        TIMESTAMPTZ NOT NULL,
  promoted_at       TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_match_thesis_watch_pending_unique
  ON match_thesis_watch (match_id, watch_key)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_match_thesis_watch_match_pending
  ON match_thesis_watch (match_id)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_match_thesis_watch_expires
  ON match_thesis_watch (expires_at)
  WHERE status = 'pending';

COMMIT;
