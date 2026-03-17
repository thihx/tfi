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

// ============================================================
// Historical Performance Context for AI Prompt (Feedback Loop)
// ============================================================

export interface HistoricalPerformanceContext {
  overall: { settled: number; correct: number; accuracy: number };
  byMarket: Array<{ market: string; settled: number; correct: number; accuracy: number }>;
  byConfidenceBand: Array<{ band: string; settled: number; correct: number; accuracy: number }>;
  byMinuteBand: Array<{ band: string; settled: number; correct: number; accuracy: number }>;
  byOddsRange: Array<{ range: string; settled: number; correct: number; accuracy: number }>;
  byLeague: Array<{ league: string; settled: number; correct: number; accuracy: number }>;
  generatedAt: string;
}

/**
 * Aggregated historical performance data for injection into the AI prompt.
 * Uses a single SQL call with multiple CTEs for efficiency.
 * Caller should cache this result (data changes infrequently).
 */
export async function getHistoricalPerformanceContext(): Promise<HistoricalPerformanceContext> {
  const r = await query<{
    section: string;
    label: string;
    settled: string;
    correct: string;
  }>(
    `WITH base AS (
       SELECT ap.predicted_market, ap.ai_confidence, ap.match_minute,
              ap.was_correct, ap.league
       FROM ai_performance ap
       JOIN recommendations r ON r.id = ap.recommendation_id
       WHERE r.result IS DISTINCT FROM 'duplicate'
         AND ap.was_correct IS NOT NULL
         AND ap.ai_should_push = true
     ),
     overall AS (
       SELECT 'overall' AS section, 'all' AS label,
              COUNT(*)::text AS settled,
              COUNT(*) FILTER (WHERE was_correct)::text AS correct
       FROM base
     ),
     by_market AS (
       SELECT 'market' AS section, predicted_market AS label,
              COUNT(*)::text AS settled,
              COUNT(*) FILTER (WHERE was_correct)::text AS correct
       FROM base
       WHERE predicted_market <> ''
       GROUP BY predicted_market
       HAVING COUNT(*) >= 3
       ORDER BY COUNT(*) DESC
       LIMIT 10
     ),
     by_confidence AS (
       SELECT 'confidence' AS section,
              CASE
                WHEN ai_confidence >= 8 THEN '8-10 (high)'
                WHEN ai_confidence >= 6 THEN '6-7 (medium)'
                ELSE '1-5 (low)'
              END AS label,
              COUNT(*)::text AS settled,
              COUNT(*) FILTER (WHERE was_correct)::text AS correct
       FROM base
       WHERE ai_confidence IS NOT NULL
       GROUP BY label
     ),
     by_minute AS (
       SELECT 'minute' AS section,
              CASE
                WHEN match_minute < 30 THEN '0-29 (early)'
                WHEN match_minute < 60 THEN '30-59 (mid)'
                WHEN match_minute < 75 THEN '60-74 (late)'
                ELSE '75+ (endgame)'
              END AS label,
              COUNT(*)::text AS settled,
              COUNT(*) FILTER (WHERE was_correct)::text AS correct
       FROM base
       WHERE match_minute IS NOT NULL
       GROUP BY label
     ),
     by_odds AS (
       SELECT 'odds' AS section,
              CASE
                WHEN predicted_odds < 1.50 THEN '<1.50'
                WHEN predicted_odds < 1.70 THEN '1.50-1.69'
                WHEN predicted_odds < 2.00 THEN '1.70-1.99'
                WHEN predicted_odds < 2.50 THEN '2.00-2.49'
                ELSE '2.50+'
              END AS label,
              COUNT(*)::text AS settled,
              COUNT(*) FILTER (WHERE was_correct)::text AS correct
       FROM base
       WHERE predicted_odds IS NOT NULL
       GROUP BY label
     ),
     by_league AS (
       SELECT 'league' AS section, league AS label,
              COUNT(*)::text AS settled,
              COUNT(*) FILTER (WHERE was_correct)::text AS correct
       FROM base
       WHERE league <> ''
       GROUP BY league
       HAVING COUNT(*) >= 3
       ORDER BY COUNT(*) DESC
       LIMIT 8
     )
     SELECT * FROM overall
     UNION ALL SELECT * FROM by_market
     UNION ALL SELECT * FROM by_confidence
     UNION ALL SELECT * FROM by_minute
     UNION ALL SELECT * FROM by_odds
     UNION ALL SELECT * FROM by_league`,
  );

  const rows = r.rows;

  const findSection = (section: string) =>
    rows.filter((row) => row.section === section).map((row) => ({
      label: row.label,
      settled: Number(row.settled),
      correct: Number(row.correct),
      accuracy: Number(row.settled) > 0
        ? Math.round((Number(row.correct) / Number(row.settled)) * 10000) / 100
        : 0,
    }));

  const overallRow = findSection('overall')[0];

  return {
    overall: overallRow
      ? { settled: overallRow.settled, correct: overallRow.correct, accuracy: overallRow.accuracy }
      : { settled: 0, correct: 0, accuracy: 0 },
    byMarket: findSection('market').map((r) => ({ market: r.label, ...r })),
    byConfidenceBand: findSection('confidence').map((r) => ({ band: r.label, ...r })),
    byMinuteBand: findSection('minute').map((r) => ({ band: r.label, ...r })),
    byOddsRange: findSection('odds').map((r) => ({ range: r.label, ...r })),
    byLeague: findSection('league').map((r) => ({ league: r.label, ...r })),
    generatedAt: new Date().toISOString(),
  };
}
