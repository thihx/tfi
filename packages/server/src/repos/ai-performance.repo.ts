// ============================================================
// AI Performance Repository — Track AI model accuracy
// ============================================================

import { query } from '../db/pool.js';
import {
  FINAL_SETTLEMENT_RESULTS_SQL,
  type SettlementPersistenceMeta,
} from '../lib/settle-types.js';
import { normalizeMarket } from '../lib/normalize-market.js';

const PENDING_RESULT_SQL = `(r.result IS NULL OR r.result = '' OR r.result NOT IN (${FINAL_SETTLEMENT_RESULTS_SQL}))`;
const ACTIONABLE_REC_SQL = `r.bet_type IS DISTINCT FROM 'NO_BET'`;
const ACTIONABLE_NOT_DUP_SQL = `r.result IS DISTINCT FROM 'duplicate' AND ${ACTIONABLE_REC_SQL}`;
const LATEST_AI_PERFORMANCE_CTE = `WITH latest_ai_performance AS (
  SELECT DISTINCT ON (ap.recommendation_id)
    ap.*
  FROM ai_performance ap
  ORDER BY ap.recommendation_id, ap.created_at DESC, ap.id DESC
)`;

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
  settlement_status?: string;
  settlement_method?: string;
  settle_prompt_version?: string;
  settlement_trusted?: boolean;
  settlement_note?: string;
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
     ON CONFLICT (recommendation_id) DO UPDATE SET
       bet_id = COALESCE(EXCLUDED.bet_id, ai_performance.bet_id),
       match_id = EXCLUDED.match_id,
       ai_model = EXCLUDED.ai_model,
       prompt_version = EXCLUDED.prompt_version,
       ai_confidence = EXCLUDED.ai_confidence,
       ai_should_push = EXCLUDED.ai_should_push,
       predicted_market = EXCLUDED.predicted_market,
       predicted_selection = EXCLUDED.predicted_selection,
       predicted_odds = EXCLUDED.predicted_odds,
       match_minute = EXCLUDED.match_minute,
       match_score = EXCLUDED.match_score,
       league = EXCLUDED.league
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
  wasCorrect: boolean | null,
  meta: SettlementPersistenceMeta = {},
): Promise<AiPerformanceRow | null> {
  const r = await query<AiPerformanceRow>(
    `UPDATE ai_performance
     SET actual_result = $2,
         actual_pnl = $3,
         was_correct = $4,
         settlement_status = $5,
         settlement_method = $6,
         settlement_trusted = $7,
         settle_prompt_version = $8,
         settlement_note = $9
     WHERE recommendation_id = $1
     RETURNING *`,
    [
      recommendationId,
      result,
      pnl,
      wasCorrect,
      meta.status ?? 'resolved',
      meta.method ?? '',
      meta.trusted ?? true,
      meta.settlePromptVersion ?? '',
      meta.note ?? '',
    ],
  );
  return r.rows[0] ?? null;
}

export async function markAiPerformanceSettlementState(
  recommendationId: number,
  meta: SettlementPersistenceMeta = {},
): Promise<AiPerformanceRow | null> {
  const r = await query<AiPerformanceRow>(
    `UPDATE ai_performance
     SET settlement_status = $2,
         settlement_method = $3,
         settlement_trusted = $4,
         settle_prompt_version = $5,
         settlement_note = $6
     WHERE recommendation_id = $1
     RETURNING *`,
    [
      recommendationId,
      meta.status ?? 'unresolved',
      meta.method ?? '',
      meta.trusted ?? false,
      meta.settlePromptVersion ?? '',
      meta.note ?? '',
    ],
  );
  return r.rows[0] ?? null;
}

export async function getAccuracyStats(): Promise<{
  total: number;
  correct: number;
  incorrect: number;
  push: number;
  void: number;
  neutral: number;
  pending: number;
  pendingResult: number;
  reviewRequired: number;
  accuracy: number;
}> {
  const r = await query<{
    total: string;
    correct: string;
    incorrect: string;
    push: string;
    void: string;
    neutral: string;
    pending: string;
    pending_result: string;
    review_required: string;
  }>(
    `${LATEST_AI_PERFORMANCE_CTE}
     SELECT
       COUNT(*)::text AS total,
       COUNT(*) FILTER (WHERE ap.settlement_trusted = TRUE AND ap.was_correct = TRUE)::text AS correct,
       COUNT(*) FILTER (WHERE ap.settlement_trusted = TRUE AND ap.was_correct = FALSE)::text AS incorrect,
       COUNT(*) FILTER (
         WHERE ap.settlement_trusted = TRUE
           AND ap.settlement_status IN ('resolved', 'corrected')
           AND r.result = 'push'
       )::text AS push,
       COUNT(*) FILTER (
         WHERE ap.settlement_trusted = TRUE
           AND ap.settlement_status IN ('resolved', 'corrected')
           AND r.result = 'void'
       )::text AS void,
       COUNT(*) FILTER (
         WHERE ap.settlement_trusted = TRUE
           AND ap.settlement_status IN ('resolved', 'corrected')
           AND ap.was_correct IS NULL
           AND r.result IN (${FINAL_SETTLEMENT_RESULTS_SQL})
       )::text AS neutral,
       COUNT(*) FILTER (
         WHERE ${PENDING_RESULT_SQL}
       )::text AS pending_result,
       COUNT(*) FILTER (
         WHERE (
           ap.settlement_status IN ('pending', 'unresolved')
           OR ap.settlement_trusted = FALSE
         )
           AND r.result IN (${FINAL_SETTLEMENT_RESULTS_SQL})
       )::text AS review_required,
       COUNT(*) FILTER (
         WHERE ap.settlement_status IN ('pending', 'unresolved')
           OR ap.settlement_trusted = FALSE
           OR ${PENDING_RESULT_SQL}
       )::text AS pending
     FROM latest_ai_performance ap
     JOIN recommendations r ON r.id = ap.recommendation_id
     WHERE ${ACTIONABLE_NOT_DUP_SQL}`,
  );

  const row = r.rows[0]!;
  const correct = Number(row.correct);
  const settled = correct + Number(row.incorrect);

  return {
    total: Number(row.total),
    correct,
    incorrect: Number(row.incorrect),
    push: Number(row.push),
    void: Number(row.void),
    neutral: Number(row.neutral),
    pending: Number(row.pending),
    pendingResult: Number(row.pending_result),
    reviewRequired: Number(row.review_required),
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
         settlement_status, settlement_method, settle_prompt_version, settlement_trusted, settlement_note,
         match_minute, match_score, league
       )
       SELECT
         r.id, r.match_id, r.timestamp,
         r.ai_model, COALESCE(r.prompt_version,''), r.confidence,
         CASE WHEN r.bet_type = 'AI' THEN true ELSE false END,
         COALESCE(r.bet_market,''), r.selection, r.odds::numeric,
         CASE WHEN r.result IN (${FINAL_SETTLEMENT_RESULTS_SQL}) THEN r.result ELSE '' END,
         r.pnl::numeric,
         CASE WHEN r.result IN (${FINAL_SETTLEMENT_RESULTS_SQL}) THEN
           CASE
             WHEN r.result IN ('win', 'half_win') THEN true
             WHEN r.result IN ('loss', 'half_loss') THEN false
             ELSE NULL
           END
         ELSE NULL END,
         COALESCE(r.settlement_status, CASE WHEN r.result IN (${FINAL_SETTLEMENT_RESULTS_SQL}) THEN 'resolved' ELSE 'pending' END),
         COALESCE(NULLIF(r.settlement_method, ''), CASE WHEN r.result IN (${FINAL_SETTLEMENT_RESULTS_SQL}) THEN 'legacy' ELSE '' END),
         COALESCE(r.settle_prompt_version, ''),
         CASE
           WHEN r.result IN (${FINAL_SETTLEMENT_RESULTS_SQL}) AND COALESCE(r.result, '') <> 'duplicate' THEN true
           ELSE false
         END,
         COALESCE(r.settlement_note, ''),
         r.minute, COALESCE(r.score,''), COALESCE(r.league,'')
       FROM recommendations r
       WHERE NOT EXISTS (
         SELECT 1 FROM ai_performance ap WHERE ap.recommendation_id = r.id
       )
       AND r.ai_model <> ''
       AND r.result != 'duplicate'
       AND r.bet_type IS DISTINCT FROM 'NO_BET'
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
    `${LATEST_AI_PERFORMANCE_CTE}
     SELECT
       ai_model AS model,
       COUNT(*)::text AS total,
       COUNT(*) FILTER (WHERE was_correct = TRUE)::text AS correct,
       COUNT(*) FILTER (WHERE was_correct IS NOT NULL)::text AS settled
     FROM latest_ai_performance ap
     WHERE NOT EXISTS (
       SELECT 1 FROM recommendations r
       WHERE r.id = ap.recommendation_id
         AND (
           r.result = 'duplicate'
           OR r.bet_type = 'NO_BET'
         )
     )
       AND ap.settlement_trusted = TRUE
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
 * Remove ai_performance records that belong to duplicate or non-actionable
 * recommendations, then re-sync from actionable recommendations only.
 */
export async function cleanAndResync(): Promise<{ deleted: number; backfilled: number }> {
  // Delete records pointing to duplicates or legacy NO_BET rows.
  const del = await query<{ cnt: string }>(
    `WITH deleted AS (
       DELETE FROM ai_performance ap
       WHERE EXISTS (
         SELECT 1 FROM recommendations r
         WHERE r.id = ap.recommendation_id
           AND (
             r.result = 'duplicate'
             OR r.bet_type = 'NO_BET'
           )
       )
       RETURNING 1
     ) SELECT COUNT(*)::text AS cnt FROM deleted`,
  );
  const deleted = Number(del.rows[0]?.cnt ?? 0);

  // Re-sync: update existing records with current recommendation results
  await query(
    `UPDATE ai_performance ap SET
       actual_result = CASE WHEN r.result IN (${FINAL_SETTLEMENT_RESULTS_SQL}) THEN r.result ELSE '' END,
       actual_pnl = r.pnl::numeric,
       was_correct = CASE
         WHEN r.result IN ('win', 'half_win') THEN true
         WHEN r.result IN ('loss', 'half_loss') THEN false
         ELSE NULL
       END,
       settlement_status = CASE
         WHEN COALESCE(r.settlement_status, '') <> '' THEN r.settlement_status
         WHEN r.result IN (${FINAL_SETTLEMENT_RESULTS_SQL}) THEN 'resolved'
         ELSE 'pending'
       END,
       settlement_method = CASE
         WHEN COALESCE(r.settlement_method, '') <> '' THEN r.settlement_method
         WHEN r.result IN (${FINAL_SETTLEMENT_RESULTS_SQL}) THEN 'legacy'
         ELSE ''
       END,
       settle_prompt_version = COALESCE(r.settle_prompt_version, ''),
       settlement_trusted = CASE
         WHEN r.result IN (${FINAL_SETTLEMENT_RESULTS_SQL}) THEN TRUE
         ELSE FALSE
       END,
       settlement_note = COALESCE(r.settlement_note, '')
     FROM recommendations r
     WHERE r.id = ap.recommendation_id
       AND r.result != 'duplicate'
       AND r.bet_type IS DISTINCT FROM 'NO_BET'
      `,
  );

  // Backfill any missing records
  const backfilled = await backfillFromRecommendations();

  return { deleted, backfilled };
}

/**
 * Aggregate completed months of ai_performance rows into ai_performance_monthly,
 * then delete the detail rows. Only processes months where the entire month is
 * older than keepDays (i.e., month_end < NOW() - keepDays), ensuring idempotent
 * ON CONFLICT updates don't double-count partial months.
 */
export async function aggregateAndPurgeOldAiPerformance(
  keepDays: number,
): Promise<{ aggregated: number; deleted: number }> {
  if (keepDays <= 0) return { aggregated: 0, deleted: 0 };

  const aggResult = await query<{ cnt: string }>(
    `WITH to_agg AS (
       SELECT *
       FROM ai_performance
       WHERE DATE_TRUNC('month', created_at) + INTERVAL '1 month' <= NOW() - INTERVAL '1 day' * $1
     ),
     monthly AS (
       SELECT
         DATE_TRUNC('month', created_at)::date                               AS month,
         COALESCE(NULLIF(predicted_market, ''), 'unknown')                    AS bet_market,
         COALESCE(NULLIF(league, ''), '')                                     AS league,
         COUNT(*)::int                                                        AS total,
         COUNT(*) FILTER (WHERE was_correct = TRUE)::int                     AS wins,
         COUNT(*) FILTER (WHERE was_correct = FALSE)::int                    AS losses,
         COUNT(*) FILTER (
           WHERE settlement_status IN ('resolved','corrected') AND was_correct IS NULL
         )::int                                                               AS pushes,
         ROUND(AVG(ai_confidence)::numeric, 2)                               AS avg_confidence,
         ROUND(AVG(predicted_odds)::numeric, 3)                              AS avg_odds,
         ROUND(
           CASE WHEN COUNT(*) > 0 THEN SUM(actual_pnl) / COUNT(*) * 100 ELSE 0 END::numeric, 4
         )                                                                    AS roi_pct
       FROM to_agg
       GROUP BY 1, 2, 3
     ),
     inserted AS (
       INSERT INTO ai_performance_monthly
         (month, bet_market, league, total, wins, losses, pushes, avg_confidence, avg_odds, roi_pct)
       SELECT month, bet_market, league, total, wins, losses, pushes, avg_confidence, avg_odds, roi_pct
       FROM monthly
       ON CONFLICT (month, bet_market, league) DO UPDATE SET
         total          = EXCLUDED.total,
         wins           = EXCLUDED.wins,
         losses         = EXCLUDED.losses,
         pushes         = EXCLUDED.pushes,
         avg_confidence = EXCLUDED.avg_confidence,
         avg_odds       = EXCLUDED.avg_odds,
         roi_pct        = EXCLUDED.roi_pct
       RETURNING 1
     )
     SELECT COUNT(*)::text AS cnt FROM inserted`,
    [keepDays],
  );
  const aggregated = Number(aggResult.rows[0]?.cnt ?? 0);

  const delResult = await query(
    `DELETE FROM ai_performance
     WHERE DATE_TRUNC('month', created_at) + INTERVAL '1 month' <= NOW() - INTERVAL '1 day' * $1`,
    [keepDays],
  );
  const deleted = delResult.rowCount ?? 0;

  return { aggregated, deleted };
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
    `${LATEST_AI_PERFORMANCE_CTE},
     base AS (
       SELECT ap.predicted_market, ap.ai_confidence, ap.match_minute, ap.predicted_odds,
              ap.was_correct, ap.league
       FROM latest_ai_performance ap
       JOIN recommendations r ON r.id = ap.recommendation_id
       WHERE ${ACTIONABLE_NOT_DUP_SQL}
         AND ap.settlement_trusted = TRUE
         AND ap.settlement_status IN ('resolved', 'corrected')
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

// ============================================================
// Performance Memory Layer (combination-key feedback loop)
// ============================================================

export type PerformanceMinuteBand = '00-29' | '30-44' | '45-59' | '60-74' | '75+' | 'unknown';
export type PerformanceScoreState = '0-0' | 'level' | 'one-goal-margin' | 'two-plus-margin' | 'unknown';

export interface PerformanceMemoryRecord {
  key: string;
  canonicalMarket: string;
  minuteBand: PerformanceMinuteBand;
  scoreState: PerformanceScoreState;
  total: number;
  wins: number;
  losses: number;
  halfWins: number;
  halfLosses: number;
  pushes: number;
  empiricalWinRate: number;
  sampleReliable: boolean;
  lastUpdated: string;
}

export interface PerformanceMemoryLookupResult {
  status: 'found' | 'no_history';
  record?: PerformanceMemoryRecord;
}

export interface PerformanceMemoryCandidateRule {
  key: string;
  canonicalMarket: string;
  minuteBand: PerformanceMinuteBand;
  scoreState: PerformanceScoreState;
  total: number;
  empiricalWinRate: number;
  suggestedAction: 'block' | 'raise_threshold';
}

let performanceMemoryTableEnsured = false;

type PerformanceMemoryRow = {
  key: string;
  canonical_market: string;
  minute_band: string;
  score_state: string;
  total: string;
  wins: string;
  losses: string;
  half_wins: string;
  half_losses: string;
  pushes: string;
  empirical_win_rate: string;
  sample_reliable: boolean;
  last_updated: string;
};

function toPerformanceMemoryRecord(row: PerformanceMemoryRow): PerformanceMemoryRecord {
  return {
    key: row.key,
    canonicalMarket: row.canonical_market,
    minuteBand: row.minute_band as PerformanceMinuteBand,
    scoreState: row.score_state as PerformanceScoreState,
    total: Number(row.total),
    wins: Number(row.wins),
    losses: Number(row.losses),
    halfWins: Number(row.half_wins),
    halfLosses: Number(row.half_losses),
    pushes: Number(row.pushes),
    empiricalWinRate: Number(row.empirical_win_rate),
    sampleReliable: Boolean(row.sample_reliable),
    lastUpdated: row.last_updated,
  };
}

async function ensurePerformanceMemoryTable(): Promise<void> {
  if (performanceMemoryTableEnsured) return;
  await query(`
    CREATE TABLE IF NOT EXISTS recommendation_performance_memory (
      key text PRIMARY KEY,
      canonical_market text NOT NULL,
      minute_band text NOT NULL,
      score_state text NOT NULL,
      total integer NOT NULL DEFAULT 0,
      wins integer NOT NULL DEFAULT 0,
      losses integer NOT NULL DEFAULT 0,
      half_wins integer NOT NULL DEFAULT 0,
      half_losses integer NOT NULL DEFAULT 0,
      pushes integer NOT NULL DEFAULT 0,
      empirical_win_rate numeric NOT NULL DEFAULT 0,
      sample_reliable boolean NOT NULL DEFAULT false,
      last_updated timestamptz NOT NULL DEFAULT NOW()
    )
  `);
  performanceMemoryTableEnsured = true;
}

export function deriveMinuteBand(minute: number | null | undefined): PerformanceMinuteBand {
  const m = Number(minute);
  if (!Number.isFinite(m) || m < 0) return 'unknown';
  if (m <= 29) return '00-29';
  if (m <= 44) return '30-44';
  if (m <= 59) return '45-59';
  if (m <= 74) return '60-74';
  return '75+';
}

export function deriveScoreState(score: string | null | undefined): PerformanceScoreState {
  const match = String(score || '').trim().match(/^(\d+)\s*[-:]\s*(\d+)$/);
  if (!match) return 'unknown';
  const home = Number(match[1] ?? 0);
  const away = Number(match[2] ?? 0);
  if (!Number.isFinite(home) || !Number.isFinite(away)) return 'unknown';
  if (home === 0 && away === 0) return '0-0';
  const diff = Math.abs(home - away);
  if (diff === 0) return 'level';
  if (diff === 1) return 'one-goal-margin';
  return 'two-plus-margin';
}

function buildPerformanceMemoryKey(canonicalMarket: string, minuteBand: PerformanceMinuteBand, scoreState: PerformanceScoreState): string {
  return `${canonicalMarket}|${minuteBand}|${scoreState}`;
}

function settlementVector(result: string): { wins: number; losses: number; halfWins: number; halfLosses: number; pushes: number } {
  const normalized = String(result || '').trim().toLowerCase();
  if (normalized === 'win') return { wins: 1, losses: 0, halfWins: 0, halfLosses: 0, pushes: 0 };
  if (normalized === 'loss') return { wins: 0, losses: 1, halfWins: 0, halfLosses: 0, pushes: 0 };
  if (normalized === 'half_win') return { wins: 0, losses: 0, halfWins: 1, halfLosses: 0, pushes: 0 };
  if (normalized === 'half_loss') return { wins: 0, losses: 0, halfWins: 0, halfLosses: 1, pushes: 0 };
  if (normalized === 'push' || normalized === 'void') return { wins: 0, losses: 0, halfWins: 0, halfLosses: 0, pushes: 1 };
  return { wins: 0, losses: 0, halfWins: 0, halfLosses: 0, pushes: 0 };
}

export async function writePerformanceMemoryFromSettlement(input: {
  selection: string;
  betMarket: string;
  minute: number | null;
  score: string;
  result: string;
}): Promise<void> {
  const canonicalMarket = normalizeMarket(input.selection ?? '', input.betMarket ?? '');
  if (!canonicalMarket || canonicalMarket === 'unknown') return;
  const minuteBand = deriveMinuteBand(input.minute);
  const scoreState = deriveScoreState(input.score);
  const key = buildPerformanceMemoryKey(canonicalMarket, minuteBand, scoreState);
  const vec = settlementVector(input.result);

  await ensurePerformanceMemoryTable();
  await query(
    `
    INSERT INTO recommendation_performance_memory (
      key, canonical_market, minute_band, score_state,
      total, wins, losses, half_wins, half_losses, pushes,
      empirical_win_rate, sample_reliable, last_updated
    )
    VALUES (
      $1, $2, $3, $4,
      1, $5, $6, $7, $8, $9,
      CASE WHEN 1 > 0 THEN (($5 + $7 * 0.5)::numeric / 1) ELSE 0 END,
      false,
      NOW()
    )
    ON CONFLICT (key) DO UPDATE
    SET total = recommendation_performance_memory.total + 1,
        wins = recommendation_performance_memory.wins + EXCLUDED.wins,
        losses = recommendation_performance_memory.losses + EXCLUDED.losses,
        half_wins = recommendation_performance_memory.half_wins + EXCLUDED.half_wins,
        half_losses = recommendation_performance_memory.half_losses + EXCLUDED.half_losses,
        pushes = recommendation_performance_memory.pushes + EXCLUDED.pushes,
        empirical_win_rate =
          CASE
            WHEN recommendation_performance_memory.total + 1 > 0 THEN (
              (recommendation_performance_memory.wins + EXCLUDED.wins)
              + (recommendation_performance_memory.half_wins + EXCLUDED.half_wins) * 0.5
            )::numeric / (recommendation_performance_memory.total + 1)
            ELSE 0
          END,
        sample_reliable = (recommendation_performance_memory.total + 1) >= 10,
        last_updated = NOW()
    `,
    [key, canonicalMarket, minuteBand, scoreState, vec.wins, vec.losses, vec.halfWins, vec.halfLosses, vec.pushes],
  );
}

export async function lookupPerformanceMemory(input: {
  canonicalMarket: string;
  minuteBand: PerformanceMinuteBand;
  scoreState: PerformanceScoreState;
}): Promise<PerformanceMemoryLookupResult> {
  await ensurePerformanceMemoryTable();
  const key = buildPerformanceMemoryKey(input.canonicalMarket, input.minuteBand, input.scoreState);
  const r = await query<PerformanceMemoryRow>(
    `
    SELECT key, canonical_market, minute_band, score_state, total, wins, losses,
           half_wins, half_losses, pushes, empirical_win_rate, sample_reliable, last_updated
      FROM recommendation_performance_memory
     WHERE key = $1
     LIMIT 1
    `,
    [key],
  );
  const row = r.rows[0];
  if (!row) return { status: 'no_history' };
  return { status: 'found', record: toPerformanceMemoryRecord(row) };
}

export async function getPerformanceMemoryPromptContext(input: {
  minuteBand: PerformanceMinuteBand;
  scoreState: PerformanceScoreState;
  limit?: number;
}): Promise<PerformanceMemoryRecord[]> {
  await ensurePerformanceMemoryTable();
  const limit = Math.max(1, Math.min(10, input.limit ?? 5));
  const r = await query<PerformanceMemoryRow>(
    `
    SELECT key, canonical_market, minute_band, score_state, total, wins, losses,
           half_wins, half_losses, pushes, empirical_win_rate, sample_reliable, last_updated
      FROM recommendation_performance_memory
     WHERE minute_band = $1
       AND score_state = $2
     ORDER BY sample_reliable DESC, empirical_win_rate ASC, total DESC
     LIMIT $3
    `,
    [input.minuteBand, input.scoreState, limit],
  );
  return r.rows.map(toPerformanceMemoryRecord);
}

export async function autoGeneratePerformanceMemoryRules(input?: {
  minSamples?: number;
  maxWinRate?: number;
}): Promise<PerformanceMemoryCandidateRule[]> {
  await ensurePerformanceMemoryTable();
  const minSamples = Math.max(1, Math.floor(input?.minSamples ?? 15));
  const maxWinRate = Number.isFinite(input?.maxWinRate) ? Number(input?.maxWinRate) : 0.4;
  const r = await query<{
    key: string;
    canonical_market: string;
    minute_band: string;
    score_state: string;
    total: string;
    empirical_win_rate: string;
  }>(
    `
    SELECT key, canonical_market, minute_band, score_state, total, empirical_win_rate
      FROM recommendation_performance_memory
     WHERE total >= $1
       AND empirical_win_rate <= $2
     ORDER BY empirical_win_rate ASC, total DESC
    `,
    [minSamples, maxWinRate],
  );

  return r.rows.map((row) => {
    const winRate = Number(row.empirical_win_rate);
    return {
      key: row.key,
      canonicalMarket: row.canonical_market,
      minuteBand: row.minute_band as PerformanceMinuteBand,
      scoreState: row.score_state as PerformanceScoreState,
      total: Number(row.total),
      empiricalWinRate: winRate,
      suggestedAction: winRate < 0.35 ? 'block' : 'raise_threshold',
    };
  });
}
