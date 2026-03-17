// ============================================================
// AI Performance Repository — Track AI model accuracy
// ============================================================

import { query } from '../db/pool.js';

export interface AiPerformanceRow {
  id: number;
  recommendation_id: number;
  bet_id: number | null;
  match_id: string;
  created_at: string;
  ai_model: string;
  prompt_version: string;
  ai_confidence: number | null;
  ai_should_push: boolean;
  predicted_market: string;
  predicted_selection: string;
  predicted_odds: number | null;
  actual_result: string;
  actual_pnl: number;
  was_correct: boolean | null;
  confidence_calibrated: boolean | null;
  match_minute: number | null;
  match_score: string;
  league: string;
}

export async function createAiPerformanceRecord(rec: {
  recommendation_id: number;
  bet_id?: number | null;
  match_id: string;
  ai_model?: string;
  prompt_version?: string;
  ai_confidence?: number | null;
  ai_should_push?: boolean;
  predicted_market?: string;
  predicted_selection?: string;
  predicted_odds?: number | null;
  match_minute?: number | null;
  match_score?: string;
  league?: string;
}): Promise<AiPerformanceRow> {
  const r = await query<AiPerformanceRow>(
    `INSERT INTO ai_performance (
       recommendation_id, bet_id, match_id,
       ai_model, prompt_version, ai_confidence, ai_should_push,
       predicted_market, predicted_selection, predicted_odds,
       match_minute, match_score, league
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
     RETURNING *`,
    [
      rec.recommendation_id,
      rec.bet_id ?? null,
      rec.match_id,
      rec.ai_model ?? '',
      rec.prompt_version ?? '',
      rec.ai_confidence ?? null,
      rec.ai_should_push ?? false,
      rec.predicted_market ?? '',
      rec.predicted_selection ?? '',
      rec.predicted_odds ?? null,
      rec.match_minute ?? null,
      rec.match_score ?? '',
      rec.league ?? '',
    ],
  );
  return r.rows[0]!;
}

export async function settleAiPerformance(
  recommendationId: number,
  result: string,
  pnl: number,
  wasCorrect: boolean,
): Promise<AiPerformanceRow | null> {
  const r = await query<AiPerformanceRow>(
    `UPDATE ai_performance
     SET actual_result = $2, actual_pnl = $3, was_correct = $4
     WHERE recommendation_id = $1
     RETURNING *`,
    [recommendationId, result, pnl, wasCorrect],
  );
  return r.rows[0] ?? null;
}

export async function getAccuracyStats(): Promise<{
  total: number;
  correct: number;
  incorrect: number;
  pending: number;
  accuracy: number;
}> {
  // Use recommendations as single source of truth for pending status
  // (ai_performance.was_correct can get out of sync with recommendations.result)
  const r = await query<{
    total: string;
    correct: string;
    incorrect: string;
    pending: string;
  }>(
    `SELECT
       COUNT(*)::text AS total,
       COUNT(*) FILTER (WHERE ap.was_correct = TRUE)::text AS correct,
       COUNT(*) FILTER (WHERE ap.was_correct = FALSE)::text AS incorrect,
       COUNT(*) FILTER (WHERE r.result IS NULL OR r.result NOT IN ('win','loss','push'))::text AS pending
     FROM ai_performance ap
     JOIN recommendations r ON r.id = ap.recommendation_id
     WHERE r.result IS DISTINCT FROM 'duplicate'`,
  );

  const row = r.rows[0]!;
  const correct = Number(row.correct);
  const settled = correct + Number(row.incorrect);

  return {
    total: Number(row.total),
    correct,
    incorrect: Number(row.incorrect),
    pending: Number(row.pending),
    accuracy: settled > 0 ? Math.round((correct / settled) * 10000) / 100 : 0,
  };
}

/**
 * Backfill ai_performance from recommendations that have no corresponding record.
 */
export async function backfillFromRecommendations(): Promise<number> {
  const r = await query<{ cnt: string }>(
    `WITH inserted AS (
       INSERT INTO ai_performance (
         recommendation_id, match_id, created_at,
         ai_model, prompt_version, ai_confidence, ai_should_push,
         predicted_market, predicted_selection, predicted_odds,
         actual_result, actual_pnl, was_correct,
         match_minute, match_score, league
       )
       SELECT
         r.id, r.match_id, r.timestamp,
         r.ai_model, COALESCE(r.prompt_version,''), r.confidence, false,
         COALESCE(r.bet_market,''), r.selection, r.odds::numeric,
         CASE WHEN r.result IN ('win','loss','push') THEN r.result ELSE '' END,
         r.pnl::numeric,
         CASE
           WHEN r.result = 'win'  THEN true
           WHEN r.result = 'loss' THEN false
           ELSE NULL
         END,
         r.minute, COALESCE(r.score,''), COALESCE(r.league,'')
       FROM recommendations r
       WHERE NOT EXISTS (
         SELECT 1 FROM ai_performance ap WHERE ap.recommendation_id = r.id
       )
       AND r.ai_model <> ''
       AND r.result != 'duplicate'
       RETURNING 1
     )
     SELECT COUNT(*)::text AS cnt FROM inserted`,
  );
  return Number(r.rows[0]?.cnt ?? 0);
}

export async function getAccuracyByModel(): Promise<
  Array<{ model: string; total: number; correct: number; accuracy: number }>
> {
  const r = await query<{ model: string; total: string; correct: string; settled: string }>(
    `SELECT
       ai_model AS model,
       COUNT(*)::text AS total,
       COUNT(*) FILTER (WHERE was_correct = TRUE)::text AS correct,
       COUNT(*) FILTER (WHERE was_correct IS NOT NULL)::text AS settled
     FROM ai_performance ap
     WHERE NOT EXISTS (
       SELECT 1 FROM recommendations r
       WHERE r.id = ap.recommendation_id AND r.result = 'duplicate'
     )
     GROUP BY ai_model
     ORDER BY COUNT(*) DESC`,
  );

  return r.rows.map((row) => ({
    model: row.model,
    total: Number(row.total),
    correct: Number(row.correct),
    accuracy:
      Number(row.settled) > 0
        ? Math.round((Number(row.correct) / Number(row.settled)) * 10000) / 100
        : 0,
  }));
}

/**
 * Remove ai_performance records that belong to duplicate recommendations,
 * then re-sync from non-duplicate recommendations.
 */
export async function cleanAndResync(): Promise<{ deleted: number; backfilled: number }> {
  // Delete records pointing to duplicates
  const del = await query<{ cnt: string }>(
    `WITH deleted AS (
       DELETE FROM ai_performance ap
       WHERE EXISTS (
         SELECT 1 FROM recommendations r
         WHERE r.id = ap.recommendation_id AND r.result = 'duplicate'
       )
       RETURNING 1
     ) SELECT COUNT(*)::text AS cnt FROM deleted`,
  );
  const deleted = Number(del.rows[0]?.cnt ?? 0);

  // Re-sync: update existing records with current recommendation results
  await query(
    `UPDATE ai_performance ap SET
       actual_result = CASE WHEN r.result IN ('win','loss','push') THEN r.result ELSE '' END,
       actual_pnl = r.pnl::numeric,
       was_correct = CASE
         WHEN r.result = 'win' THEN true
         WHEN r.result = 'loss' THEN false
         ELSE NULL
       END
     FROM recommendations r
     WHERE r.id = ap.recommendation_id
       AND r.result != 'duplicate'
       AND r.result IN ('win','loss','push')`,
  );

  // Backfill any missing records
  const backfilled = await backfillFromRecommendations();

  return { deleted, backfilled };
}
