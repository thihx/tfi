-- ============================================================
-- Migration 011: settlement auditability and trust metadata
-- Tracks settlement status/method/prompt provenance so later
-- audits can distinguish pending vs unresolved vs corrected.
-- ============================================================

BEGIN;

ALTER TABLE recommendations
  ADD COLUMN IF NOT EXISTS settlement_status TEXT NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS settlement_method TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS settle_prompt_version TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS settlement_note TEXT NOT NULL DEFAULT '';

ALTER TABLE bets
  ADD COLUMN IF NOT EXISTS settlement_status TEXT NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS settlement_method TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS settle_prompt_version TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS settlement_note TEXT NOT NULL DEFAULT '';

ALTER TABLE ai_performance
  ADD COLUMN IF NOT EXISTS settlement_status TEXT NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS settlement_method TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS settle_prompt_version TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS settlement_trusted BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS settlement_note TEXT NOT NULL DEFAULT '';

UPDATE recommendations
SET
  settlement_status = CASE
    WHEN result = 'duplicate' THEN 'resolved'
    WHEN result IN ('win','loss','push','half_win','half_loss','void') THEN 'resolved'
    ELSE settlement_status
  END,
  settlement_method = CASE
    WHEN result = 'duplicate' THEN CASE WHEN settlement_method = '' THEN 'legacy' ELSE settlement_method END
    WHEN result IN ('win','loss','push','half_win','half_loss','void') THEN CASE WHEN settlement_method = '' THEN 'legacy' ELSE settlement_method END
    ELSE settlement_method
  END,
  settlement_note = CASE
    WHEN settlement_note = '' THEN COALESCE(actual_outcome, '')
    ELSE settlement_note
  END;

UPDATE bets
SET
  settlement_status = CASE
    WHEN result IN ('win','loss','push','half_win','half_loss','void') THEN 'resolved'
    ELSE settlement_status
  END,
  settlement_method = CASE
    WHEN result IN ('win','loss','push','half_win','half_loss','void') AND settlement_method = '' THEN 'legacy'
    ELSE settlement_method
  END,
  settlement_note = CASE
    WHEN settlement_note = '' THEN COALESCE(final_score, '')
    ELSE settlement_note
  END;

UPDATE ai_performance ap
SET
  settlement_status = CASE
    WHEN ap.actual_result IN ('win','loss','push','half_win','half_loss','void') THEN
      CASE
        WHEN r.result IN ('win','loss','push','half_win','half_loss','void') AND COALESCE(r.settlement_status, 'resolved') = 'corrected'
          THEN 'corrected'
        ELSE 'resolved'
      END
    ELSE ap.settlement_status
  END,
  settlement_method = CASE
    WHEN ap.actual_result IN ('win','loss','push','half_win','half_loss','void') AND ap.settlement_method = ''
      THEN COALESCE(NULLIF(r.settlement_method, ''), 'legacy')
    ELSE ap.settlement_method
  END,
  settle_prompt_version = CASE
    WHEN ap.settle_prompt_version = '' THEN COALESCE(r.settle_prompt_version, '')
    ELSE ap.settle_prompt_version
  END,
  settlement_trusted = CASE
    WHEN ap.actual_result IN ('win','loss','push','half_win','half_loss','void')
      AND COALESCE(r.result, '') <> 'duplicate'
      THEN TRUE
    ELSE ap.settlement_trusted
  END,
  settlement_note = CASE
    WHEN ap.settlement_note = '' THEN COALESCE(r.settlement_note, '')
    ELSE ap.settlement_note
  END
FROM recommendations r
WHERE r.id = ap.recommendation_id;

CREATE INDEX IF NOT EXISTS idx_rec_settlement_status ON recommendations (settlement_status);
CREATE INDEX IF NOT EXISTS idx_bets_settlement_status ON bets (settlement_status);
CREATE INDEX IF NOT EXISTS idx_aiperf_settlement_status ON ai_performance (settlement_status);
CREATE INDEX IF NOT EXISTS idx_aiperf_trusted ON ai_performance (settlement_trusted);

COMMIT;
