-- Migration 054: persist thesis-watch entry and promotion snapshots for audit/replay

BEGIN;

ALTER TABLE match_thesis_watch
  ADD COLUMN IF NOT EXISTS initial_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS promote_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS promote_reason JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS promoted_recommendation_id INTEGER;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'fk_match_thesis_watch_promoted_recommendation'
  ) THEN
    ALTER TABLE match_thesis_watch
      ADD CONSTRAINT fk_match_thesis_watch_promoted_recommendation
      FOREIGN KEY (promoted_recommendation_id)
      REFERENCES recommendations(id)
      ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_match_thesis_watch_promoted_recommendation
  ON match_thesis_watch (promoted_recommendation_id)
  WHERE promoted_recommendation_id IS NOT NULL;

COMMIT;
