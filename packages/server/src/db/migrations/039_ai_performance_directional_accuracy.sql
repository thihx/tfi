-- ============================================================
-- 039. Align ai_performance directional correctness with business logic
-- half_win => correct, half_loss => incorrect
-- push/void remain neutral
-- ============================================================

UPDATE ai_performance
SET was_correct = CASE
  WHEN actual_result IN ('win', 'half_win') THEN TRUE
  WHEN actual_result IN ('loss', 'half_loss') THEN FALSE
  WHEN actual_result IN ('push', 'void') THEN NULL
  ELSE was_correct
END
WHERE actual_result IN ('win', 'loss', 'push', 'half_win', 'half_loss', 'void');
