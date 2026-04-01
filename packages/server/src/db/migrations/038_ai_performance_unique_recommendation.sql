-- ============================================================
-- 038. ai_performance should be 1 row per recommendation
-- Deduplicate legacy rows, keep the latest snapshot, then enforce uniqueness.
-- ============================================================

WITH ranked AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY recommendation_id
      ORDER BY created_at DESC, id DESC
    ) AS rn
  FROM ai_performance
)
DELETE FROM ai_performance
WHERE id IN (
  SELECT id
  FROM ranked
  WHERE rn > 1
);

DROP INDEX IF EXISTS idx_aiperf_rec;

CREATE UNIQUE INDEX IF NOT EXISTS uidx_aiperf_recommendation_id
  ON ai_performance (recommendation_id);
