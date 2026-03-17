-- ============================================================
-- Migration 006: user_settings — Per-user configuration
-- Stores Monitor Config and other user-level settings as JSONB.
-- Designed for multi-user expansion.
-- ============================================================

BEGIN;

CREATE TABLE user_settings (
  user_id     TEXT PRIMARY KEY DEFAULT 'default',
  settings    JSONB NOT NULL DEFAULT '{}',
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMIT;
