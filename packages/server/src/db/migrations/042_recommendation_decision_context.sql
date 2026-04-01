-- Migration 042: persist decision context for recommendation cohort analysis

ALTER TABLE recommendations
  ADD COLUMN IF NOT EXISTS decision_context JSONB NOT NULL DEFAULT '{}'::jsonb;

UPDATE recommendations
SET decision_context = '{}'::jsonb
WHERE decision_context IS NULL;

CREATE INDEX IF NOT EXISTS idx_recommendations_decision_context
  ON recommendations
  USING GIN (decision_context);
