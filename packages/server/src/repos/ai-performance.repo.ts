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
  const r = await query<{
    total: string;
    correct: string;
    incorrect: string;
    pending: string;
  }>(
    `SELECT
       COUNT(*)::text AS total,
       COUNT(*) FILTER (WHERE was_correct = TRUE)::text AS correct,
       COUNT(*) FILTER (WHERE was_correct = FALSE)::text AS incorrect,
       COUNT(*) FILTER (WHERE was_correct IS NULL)::text AS pending
     FROM ai_performance`,
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

export async function getAccuracyByModel(): Promise<
  Array<{ model: string; total: number; correct: number; accuracy: number }>
> {
  const r = await query<{ model: string; total: string; correct: string; settled: string }>(
    `SELECT
       ai_model AS model,
       COUNT(*)::text AS total,
       COUNT(*) FILTER (WHERE was_correct = TRUE)::text AS correct,
       COUNT(*) FILTER (WHERE was_correct IS NOT NULL)::text AS settled
     FROM ai_performance
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
