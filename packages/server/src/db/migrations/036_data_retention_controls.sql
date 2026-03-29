BEGIN;

-- ============================================================
-- Migration 036: Comprehensive data retention controls
-- ============================================================

-- 1. Mark recommendations as "slimmed" once heavy JSONB fields
--    (reasoning text, warnings, key_factors) have been stripped.
--    This preserves core bet data (match, selection, odds, result,
--    pnl) while reclaiming storage from rows older than 90 days.
ALTER TABLE recommendations
  ADD COLUMN IF NOT EXISTS is_slim    BOOLEAN     NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS slimmed_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_recommendations_slim
  ON recommendations (is_slim, timestamp)
  WHERE is_slim = FALSE;

-- 2. Monthly aggregate table for ai_performance.
--    After 90 days, detail rows are deleted and rolled up here.
CREATE TABLE IF NOT EXISTS ai_performance_monthly (
  month          DATE    NOT NULL,
  bet_market     TEXT    NOT NULL,
  league         TEXT    NOT NULL DEFAULT '',
  total          INT     NOT NULL DEFAULT 0,
  wins           INT     NOT NULL DEFAULT 0,
  losses         INT     NOT NULL DEFAULT 0,
  pushes         INT     NOT NULL DEFAULT 0,
  avg_confidence NUMERIC(4,2),
  avg_odds       NUMERIC(6,3),
  roi_pct        NUMERIC(7,4),
  PRIMARY KEY (month, bet_market, league)
);

COMMENT ON TABLE ai_performance_monthly IS
  'Monthly roll-up of ai_performance detail rows older than 90 days.
   Used to track AI accuracy trends without keeping every detail row forever.';

COMMIT;
