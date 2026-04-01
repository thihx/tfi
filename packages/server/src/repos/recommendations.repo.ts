// ============================================================
// Recommendations Repository
// ============================================================

import { query, transaction } from '../db/pool.js';
import { normalizeMarket, buildDedupKey } from '../lib/normalize-market.js';
import {
  DIRECTIONAL_LOSS_SETTLEMENT_RESULTS_SQL,
  DIRECTIONAL_SETTLEMENT_RESULTS_SQL,
  DIRECTIONAL_WIN_SETTLEMENT_RESULTS_SQL,
  FINAL_SETTLEMENT_RESULTS_SQL,
  type SettlementPersistenceMeta,
} from '../lib/settle-types.js';
import {
  summarizeExposureClusters,
  type AnalyticsRecommendationRow,
  type ExposureSummary,
} from '../lib/recommendation-quality-metrics.js';
import {
  evaluateRecommendationDeliveryConditions,
  stageRecommendationDeliveries,
} from './recommendation-deliveries.repo.js';

export { normalizeMarket, buildDedupKey };

/** SQL fragment: exclude duplicate-marked rows (IS DISTINCT FROM handles NULLs) */
const NOT_DUP = `result IS DISTINCT FROM 'duplicate'`;
const ACTIONABLE_REC_SQL = `bet_type IS DISTINCT FROM 'NO_BET'`;
const ACTIONABLE_NOT_DUP = `${NOT_DUP} AND ${ACTIONABLE_REC_SQL}`;
const FINAL_RESULT_SQL = `result IN (${FINAL_SETTLEMENT_RESULTS_SQL})`;
const PENDING_RESULT_SQL = `(result IS NULL OR result = '' OR result NOT IN (${FINAL_SETTLEMENT_RESULTS_SQL}))`;
const DIRECTIONAL_WIN_RESULT_SQL = `result IN (${DIRECTIONAL_WIN_SETTLEMENT_RESULTS_SQL})`;
const DIRECTIONAL_LOSS_RESULT_SQL = `result IN (${DIRECTIONAL_LOSS_SETTLEMENT_RESULTS_SQL})`;
const DIRECTIONAL_RESULT_SQL = `result IN (${DIRECTIONAL_SETTLEMENT_RESULTS_SQL})`;
function directionalRate(wins: number, losses: number): number {
  const total = wins + losses;
  return total > 0 ? Math.round((wins / total) * 10000) / 100 : 0;
}

function toJsonb(val: unknown): string {
  if (!val || val === '') return '{}';
  if (typeof val === 'string') return val;
  return JSON.stringify(val);
}

export interface RecommendationRow {
  id: number;
  unique_key: string;
  match_id: string;
  timestamp: string;
  league: string;
  home_team: string;
  away_team: string;
  status: string;
  condition_triggered_suggestion: string;
  custom_condition_raw: string;
  execution_id: string;
  odds_snapshot: Record<string, unknown> | string;
  stats_snapshot: Record<string, unknown> | string;
  decision_context: Record<string, unknown> | string;
  pre_match_prediction_summary: string;
  prompt_version: string;
  custom_condition_matched: boolean;
  minute: number | null;
  score: string;
  bet_type: string;
  selection: string;
  odds: number | null;
  confidence: number | null;
  value_percent: number | null;
  risk_level: string;
  stake_percent: number | null;
  stake_amount: number | null;
  reasoning: string;
  reasoning_vi: string;
  key_factors: string;
  warnings: string;
  ai_model: string;
  mode: string;
  bet_market: string;
  notified: string;
  notification_channels: string;
  result: string;
  actual_outcome: string;
  pnl: number;
  settled_at: string | null;
  settlement_status?: string;
  settlement_method?: string;
  settle_prompt_version?: string;
  settlement_note?: string;
  _was_overridden: boolean;
}

export type RecommendationCreate = Omit<RecommendationRow, 'id'>;

interface PaginationOpts {
  limit?: number;
  offset?: number;
  result?: string;       // 'win' | 'loss' | 'push' | 'pending'
  bet_type?: string;
  league?: string;
  date_from?: string;    // ISO date 'YYYY-MM-DD'
  date_to?: string;      // ISO date 'YYYY-MM-DD'
  risk_level?: string;   // 'LOW' | 'MEDIUM' | 'HIGH'
  search?: string;
  sort_by?: string;      // 'time' | 'odds' | 'confidence' | 'pnl' | 'league'
  sort_dir?: string;     // 'asc' | 'desc'
}

export async function getAllRecommendations(opts: PaginationOpts = {}): Promise<{
  rows: RecommendationRow[];
  total: number;
}> {
  const limit = opts.limit ?? 50;
  const offset = opts.offset ?? 0;

  const conditions: string[] = [];
  const params: unknown[] = [];
  let paramIdx = 1;

  // Result filter
  if (opts.result) {
    if (opts.result === 'correct') {
      conditions.push(`r.result IN ('win', 'half_win')`);
    } else if (opts.result === 'incorrect') {
      conditions.push(`r.result IN ('loss', 'half_loss')`);
    } else if (opts.result === 'neutral') {
      conditions.push(`r.result IN ('push', 'void')`);
    } else if (opts.result === 'pending') {
      conditions.push(`(r.result IS NULL OR r.result = '' OR r.result NOT IN (${FINAL_SETTLEMENT_RESULTS_SQL}))`);
    } else if (opts.result === 'review') {
      conditions.push(`COALESCE(r.settlement_status, 'pending') = 'unresolved' AND r.result IN (${FINAL_SETTLEMENT_RESULTS_SQL})`);
    } else if (opts.result === 'duplicate') {
      conditions.push(`r.result = 'duplicate'`);
    } else {
      conditions.push(`r.result = $${paramIdx}`);
      params.push(opts.result);
      paramIdx++;
    }
  }

  // By default, exclude duplicates unless specifically filtering for them
  if (opts.result !== 'duplicate') {
    conditions.push(`r.${NOT_DUP}`);
  }

  // Bet type filter
  if (opts.bet_type) {
    conditions.push(`r.bet_type = $${paramIdx}`);
    params.push(opts.bet_type);
    paramIdx++;
  } else {
    conditions.push(`r.${ACTIONABLE_REC_SQL}`);
  }

  // Search filter
  if (opts.search) {
    conditions.push(`(
      r.home_team ILIKE $${paramIdx} OR r.away_team ILIKE $${paramIdx} OR r.selection ILIKE $${paramIdx}
    )`);
    params.push(`%${opts.search}%`);
    paramIdx++;
  }

  // League filter
  if (opts.league) {
    conditions.push(`r.league = $${paramIdx}`);
    params.push(opts.league);
    paramIdx++;
  }

  // Date range filters
  if (opts.date_from) {
    conditions.push(`r.timestamp::date >= $${paramIdx}::date`);
    params.push(opts.date_from);
    paramIdx++;
  }
  if (opts.date_to) {
    conditions.push(`r.timestamp::date <= $${paramIdx}::date`);
    params.push(opts.date_to);
    paramIdx++;
  }

  // Risk level filter
  if (opts.risk_level) {
    conditions.push(`r.risk_level = $${paramIdx}`);
    params.push(opts.risk_level);
    paramIdx++;
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  // Sort
  const sortMap: Record<string, string> = {
    time: 'r.timestamp',
    odds: 'r.odds',
    confidence: 'r.confidence',
    pnl: 'r.pnl',
    league: 'r.league',
  };
  const sortCol = sortMap[opts.sort_by ?? ''] ?? 'r.timestamp';
  const sortDir = opts.sort_dir === 'asc' ? 'ASC' : 'DESC';
  const orderClause = `ORDER BY ${sortCol} ${sortDir} NULLS LAST`;

  const limitParam = paramIdx;
  const offsetParam = paramIdx + 1;
  params.push(limit, offset);

  const [data, countRes] = await Promise.all([
    query<RecommendationRow & { ft_score: string | null }>(
      `SELECT r.*, CASE WHEN mh.home_score IS NOT NULL THEN mh.home_score || '-' || mh.away_score ELSE NULL END AS ft_score
       FROM recommendations r
       LEFT JOIN matches_history mh ON r.match_id = mh.match_id
       ${whereClause}
       ${orderClause}
       LIMIT $${limitParam} OFFSET $${offsetParam}`,
      params,
    ),
    query<{ count: string }>(
      `SELECT COUNT(*)::text as count FROM recommendations r ${whereClause}`,
      params.slice(0, -2), // exclude limit/offset
    ),
  ]);

  return { rows: data.rows, total: Number(countRes.rows[0]?.count ?? 0) };
}

export async function getRecommendationsByMatchId(matchId: string): Promise<RecommendationRow[]> {
  const r = await query<RecommendationRow>(
    `SELECT * FROM recommendations
     WHERE match_id = $1
       AND ${ACTIONABLE_REC_SQL}
     ORDER BY timestamp DESC`,
    [matchId],
  );
  return r.rows;
}

export async function getLatestRecommendationsForMatches(matchIds: string[]): Promise<Map<string, RecommendationRow>> {
  if (matchIds.length === 0) return new Map();
  const r = await query<RecommendationRow>(
    `SELECT DISTINCT ON (match_id) *
     FROM recommendations
     WHERE match_id = ANY($1)
       AND ${ACTIONABLE_REC_SQL}
     ORDER BY match_id, timestamp DESC, id DESC`,
    [matchIds],
  );
  return new Map(r.rows.map((row) => [row.match_id, row] as const));
}

export async function createRecommendation(
  rec: Partial<RecommendationCreate>,
): Promise<RecommendationRow> {
  const normalizedBetMarket = normalizeMarket(rec.selection ?? '', rec.bet_market);
  const storedBetMarket = normalizedBetMarket === 'unknown' && !(rec.bet_market ?? '').trim()
    ? ''
    : normalizedBetMarket;
  const dedupKey = rec.unique_key
    ?? buildDedupKey(rec.match_id ?? '', rec.selection ?? '', storedBetMarket);
  return transaction(async (client) => {
    const r = await client.query<RecommendationRow>(
      `INSERT INTO recommendations (
       unique_key, match_id, timestamp, league, home_team, away_team, status,
       condition_triggered_suggestion, custom_condition_raw, execution_id,
       odds_snapshot, stats_snapshot, decision_context, pre_match_prediction_summary, prompt_version, custom_condition_matched,
       minute, score, bet_type, selection, odds, confidence, value_percent, risk_level,
       stake_percent, stake_amount, reasoning, reasoning_vi, key_factors, warnings,
       ai_model, mode, bet_market, notified, notification_channels,
       result, actual_outcome, pnl, settled_at,
       settlement_status, settlement_method, settle_prompt_version, settlement_note,
       _was_overridden
     ) VALUES (
       $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,
       $21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33,$34,$35,$36,$37,$38,
       $39,$40,$41,$42,$43,$44
     )
     ON CONFLICT (unique_key) DO UPDATE SET
       minute = EXCLUDED.minute,
       score = EXCLUDED.score,
       odds = EXCLUDED.odds,
       odds_snapshot = EXCLUDED.odds_snapshot,
       stats_snapshot = EXCLUDED.stats_snapshot,
       decision_context = EXCLUDED.decision_context,
       confidence = EXCLUDED.confidence,
       value_percent = EXCLUDED.value_percent,
       risk_level = EXCLUDED.risk_level,
       stake_percent = EXCLUDED.stake_percent,
       reasoning = EXCLUDED.reasoning,
       reasoning_vi = EXCLUDED.reasoning_vi,
       key_factors = EXCLUDED.key_factors,
       warnings = EXCLUDED.warnings,
       prompt_version = EXCLUDED.prompt_version,
       timestamp = EXCLUDED.timestamp
     RETURNING *`,
      [
        dedupKey,
        rec.match_id,
        rec.timestamp,
        rec.league ?? '',
        rec.home_team ?? '',
        rec.away_team ?? '',
        rec.status ?? '',
        rec.condition_triggered_suggestion ?? '',
        rec.custom_condition_raw ?? '',
        rec.execution_id ?? '',
        toJsonb(rec.odds_snapshot),
        toJsonb(rec.stats_snapshot),
        toJsonb(rec.decision_context),
        rec.pre_match_prediction_summary ?? '',
        rec.prompt_version ?? '',
        rec.custom_condition_matched ?? false,
        rec.minute ?? null,
        rec.score ?? '',
        rec.bet_type ?? '',
        rec.selection ?? '',
        rec.odds ?? null,
        rec.confidence ?? null,
        rec.value_percent ?? null,
        rec.risk_level ?? 'HIGH',
        rec.stake_percent ?? null,
        rec.stake_amount ?? null,
        rec.reasoning ?? '',
        rec.reasoning_vi ?? '',
        rec.key_factors ?? '',
        rec.warnings ?? '',
        rec.ai_model ?? '',
        rec.mode ?? 'B',
        storedBetMarket,
        rec.notified ?? '',
        rec.notification_channels ?? '',
        rec.result ?? '',
        rec.actual_outcome ?? '',
        rec.pnl ?? 0,
        rec.settled_at || null,
        rec.settlement_status ?? 'pending',
        rec.settlement_method ?? '',
        rec.settle_prompt_version ?? '',
        rec.settlement_note ?? '',
        rec._was_overridden ?? false,
      ],
    );
    const created = r.rows[0]!;
    await stageRecommendationDeliveries(client, created);
    await evaluateRecommendationDeliveryConditions(client, created);
    return created;
  });
}

export async function bulkCreateRecommendations(
  recs: Partial<RecommendationCreate>[],
): Promise<number> {
  return transaction(async (client) => {
    let upserted = 0;
    for (const rec of recs) {
      const normalizedBetMarket = normalizeMarket(rec.selection ?? '', rec.bet_market);
      const storedBetMarket = normalizedBetMarket === 'unknown' && !(rec.bet_market ?? '').trim()
        ? ''
        : normalizedBetMarket;
      const dedupKey = rec.unique_key
        ?? buildDedupKey(rec.match_id ?? '', rec.selection ?? '', storedBetMarket);
      const result = await client.query<RecommendationRow>(
        `INSERT INTO recommendations (
           unique_key, match_id, timestamp, league, home_team, away_team, status,
           condition_triggered_suggestion, custom_condition_raw, execution_id,
           odds_snapshot, stats_snapshot, decision_context, pre_match_prediction_summary, prompt_version, custom_condition_matched,
           minute, score, bet_type, selection, odds, confidence, value_percent, risk_level,
           stake_percent, stake_amount, reasoning, reasoning_vi, key_factors, warnings,
           ai_model, mode, bet_market, notified, notification_channels,
           result, actual_outcome, pnl, settled_at,
           settlement_status, settlement_method, settle_prompt_version, settlement_note,
           _was_overridden
         ) VALUES (
           $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,
           $21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33,$34,$35,$36,$37,$38,
           $39,$40,$41,$42,$43,$44
         )
         ON CONFLICT (unique_key) DO UPDATE SET
           minute = EXCLUDED.minute,
           score = EXCLUDED.score,
           odds = EXCLUDED.odds,
           odds_snapshot = EXCLUDED.odds_snapshot,
           stats_snapshot = EXCLUDED.stats_snapshot,
           decision_context = EXCLUDED.decision_context,
           confidence = EXCLUDED.confidence,
           value_percent = EXCLUDED.value_percent,
           risk_level = EXCLUDED.risk_level,
           stake_percent = EXCLUDED.stake_percent,
           reasoning = EXCLUDED.reasoning,
           reasoning_vi = EXCLUDED.reasoning_vi,
           key_factors = EXCLUDED.key_factors,
           warnings = EXCLUDED.warnings,
           prompt_version = EXCLUDED.prompt_version,
           timestamp = EXCLUDED.timestamp
         RETURNING *`,
        [
          dedupKey,
          rec.match_id,
          rec.timestamp,
          rec.league ?? '',
          rec.home_team ?? '',
          rec.away_team ?? '',
          rec.status ?? '',
          rec.condition_triggered_suggestion ?? '',
          rec.custom_condition_raw ?? '',
          rec.execution_id ?? '',
          toJsonb(rec.odds_snapshot),
          toJsonb(rec.stats_snapshot),
          toJsonb(rec.decision_context),
          rec.pre_match_prediction_summary ?? '',
          rec.prompt_version ?? '',
          rec.custom_condition_matched ?? false,
          rec.minute ?? null,
          rec.score ?? '',
          rec.bet_type ?? '',
          rec.selection ?? '',
          rec.odds ?? null,
          rec.confidence ?? null,
          rec.value_percent ?? null,
          rec.risk_level ?? 'HIGH',
          rec.stake_percent ?? null,
          rec.stake_amount ?? null,
          rec.reasoning ?? '',
          rec.reasoning_vi ?? '',
          rec.key_factors ?? '',
          rec.warnings ?? '',
          rec.ai_model ?? '',
          rec.mode ?? 'B',
          storedBetMarket,
          rec.notified ?? '',
          rec.notification_channels ?? '',
          rec.result ?? '',
          rec.actual_outcome ?? '',
          rec.pnl ?? 0,
          rec.settled_at ?? null,
          rec.settlement_status ?? 'pending',
          rec.settlement_method ?? '',
          rec.settle_prompt_version ?? '',
          rec.settlement_note ?? '',
          rec._was_overridden ?? false,
        ],
      );
      if ((result.rowCount ?? 0) > 0 && result.rows[0]) {
        upserted++;
        await stageRecommendationDeliveries(client, result.rows[0]);
        await evaluateRecommendationDeliveryConditions(client, result.rows[0]);
      }
    }
    return upserted;
  });
}

export async function settleRecommendation(
  id: number,
  result: string,
  pnl: number,
  actualOutcome: string = '',
  meta: SettlementPersistenceMeta = {},
): Promise<RecommendationRow | null> {
  const r = await query<RecommendationRow>(
    `UPDATE recommendations
     SET result = $2,
         pnl = $3,
         actual_outcome = $4,
         settled_at = NOW(),
         settlement_status = $5,
         settlement_method = $6,
         settle_prompt_version = $7,
         settlement_note = $8
     WHERE id = $1 RETURNING *`,
    [
      id,
      result,
      pnl,
      actualOutcome,
      meta.status ?? 'resolved',
      meta.method ?? '',
      meta.settlePromptVersion ?? '',
      meta.note ?? actualOutcome,
    ],
  );
  return r.rows[0] ?? null;
}

export async function markRecommendationUnresolved(
  id: number,
  meta: SettlementPersistenceMeta = {},
): Promise<RecommendationRow | null> {
  const r = await query<RecommendationRow>(
    `UPDATE recommendations
     SET settlement_status = 'unresolved',
         settlement_method = $2,
         settle_prompt_version = $3,
         settlement_note = $4
     WHERE id = $1
     RETURNING *`,
    [
      id,
      meta.method ?? '',
      meta.settlePromptVersion ?? '',
      meta.note ?? '',
    ],
  );
  return r.rows[0] ?? null;
}

export async function markRecommendationNotified(
  id: number,
  channels: string | string[],
): Promise<RecommendationRow | null> {
  const normalizedChannels = Array.isArray(channels)
    ? Array.from(new Set(channels.map((value) => String(value).trim()).filter(Boolean))).join(',')
    : String(channels).trim();
  const r = await query<RecommendationRow>(
    `UPDATE recommendations
     SET notified = $2,
         notification_channels = $3
     WHERE id = $1
     RETURNING *`,
    [
      id,
      normalizedChannels ? 'yes' : '',
      normalizedChannels,
    ],
  );
  return r.rows[0] ?? null;
}

interface RecStats {
  total: number;
  wins: number;
  losses: number;
  pushes: number;
  half_wins: number;
  half_losses: number;
  voids: number;
  push_void_settled: number;
  duplicates: number;
  unsettled: number;
  total_pnl: number;
  win_rate: number;
}

export async function getStats(): Promise<RecStats> {
  const r = await query<{
    total: string;
    wins: string;
    losses: string;
    pushes: string;
    half_wins: string;
    half_losses: string;
    voids: string;
    duplicates: string;
    unsettled: string;
    total_pnl: string;
  }>(
    `SELECT
       COUNT(*)::text AS total,
       COUNT(*) FILTER (WHERE ${DIRECTIONAL_WIN_RESULT_SQL})::text AS wins,
       COUNT(*) FILTER (WHERE ${DIRECTIONAL_LOSS_RESULT_SQL})::text AS losses,
       COUNT(*) FILTER (WHERE result = 'push')::text AS pushes,
       COUNT(*) FILTER (WHERE result = 'half_win')::text AS half_wins,
       COUNT(*) FILTER (WHERE result = 'half_loss')::text AS half_losses,
       COUNT(*) FILTER (WHERE result = 'void')::text AS voids,
       COUNT(*) FILTER (WHERE result = 'duplicate')::text AS duplicates,
       COUNT(*) FILTER (WHERE ${PENDING_RESULT_SQL})::text AS unsettled,
       COALESCE(SUM(pnl), 0)::text AS total_pnl
     FROM recommendations WHERE ${ACTIONABLE_NOT_DUP}`,
  );

  const row = r.rows[0]!;
  const total = Number(row.total);
  const wins = Number(row.wins);
  const losses = Number(row.losses);
  const pushes = Number(row.pushes);
  const halfWins = Number(row.half_wins);
  const halfLosses = Number(row.half_losses);
  const voids = Number(row.voids);

  return {
    total,
    wins,
    losses,
    pushes,
    half_wins: halfWins,
    half_losses: halfLosses,
    voids,
    push_void_settled: pushes + voids,
    duplicates: Number(row.duplicates),
    unsettled: Number(row.unsettled),
    total_pnl: Number(row.total_pnl),
    win_rate: directionalRate(wins, losses),
  };
}

// ==================== Dashboard Summary ====================

export interface DashboardSummary {
  totalBets: number;
  wins: number;
  losses: number;
  pushes: number;
  halfWins: number;
  halfLosses: number;
  voids: number;
  directionalSettled: number;
  pushVoidSettled: number;
  pending: number;
  winRate: number;
  totalPnl: number;
  totalStaked: number;
  roi: number;
  streak: string;
  matchCount: number;
  watchlistCount: number;
  recCount: number;
  openExposureConcentration: ExposureSummary;
  pnlTrend: Array<{ date: string; pnl: number; cumulative: number }>;
  recentRecs: RecommendationRow[];
}

export async function getDashboardSummary(): Promise<DashboardSummary> {
  // All aggregation done in SQL — no loading 5000 rows client-side
  const [statsRes, pnlRes, recentRes, streakRes, countsRes, openExposureRes] = await Promise.all([
    query<{
      total: string; wins: string; losses: string; pushes: string; half_wins: string; half_losses: string; voids: string; pending: string;
      total_pnl: string; total_staked: string;
    }>(`SELECT
         COUNT(*) FILTER (WHERE ${FINAL_RESULT_SQL})::text AS total,
         COUNT(*) FILTER (WHERE ${DIRECTIONAL_WIN_RESULT_SQL})::text AS wins,
         COUNT(*) FILTER (WHERE ${DIRECTIONAL_LOSS_RESULT_SQL})::text AS losses,
         COUNT(*) FILTER (WHERE result = 'push')::text AS pushes,
         COUNT(*) FILTER (WHERE result = 'half_win')::text AS half_wins,
         COUNT(*) FILTER (WHERE result = 'half_loss')::text AS half_losses,
         COUNT(*) FILTER (WHERE result = 'void')::text AS voids,
         COUNT(*) FILTER (WHERE ${PENDING_RESULT_SQL})::text AS pending,
         COALESCE(SUM(pnl) FILTER (WHERE ${FINAL_RESULT_SQL}), 0)::text AS total_pnl,
         COALESCE(SUM(COALESCE(stake_percent, 1)) FILTER (WHERE ${FINAL_RESULT_SQL}), 0)::text AS total_staked
       FROM recommendations WHERE ${ACTIONABLE_NOT_DUP}`),

    // P/L by date (aggregated)
    query<{ date: string; daily_pnl: string }>(`
      SELECT TO_CHAR(timestamp::date, 'DD/MM') AS date,
             SUM(pnl)::text AS daily_pnl
      FROM recommendations
      WHERE ${FINAL_RESULT_SQL} AND timestamp IS NOT NULL AND ${ACTIONABLE_NOT_DUP}
      GROUP BY timestamp::date
      ORDER BY timestamp::date`),

    // Recent 8 recommendations (with FT score from matches_history)
    query<RecommendationRow & { ft_score: string | null }>(
      `SELECT r.*, CASE WHEN mh.home_score IS NOT NULL THEN mh.home_score || '-' || mh.away_score ELSE NULL END AS ft_score
       FROM recommendations r
       LEFT JOIN matches_history mh ON r.match_id = mh.match_id
       WHERE r.${ACTIONABLE_NOT_DUP}
       ORDER BY r.timestamp DESC LIMIT 8`,
    ),

    // Streak
    query<{ result: string }>(`
      SELECT CASE
               WHEN ${DIRECTIONAL_WIN_RESULT_SQL} THEN 'win'
               WHEN ${DIRECTIONAL_LOSS_RESULT_SQL} THEN 'loss'
             END AS result
      FROM recommendations
      WHERE ${DIRECTIONAL_RESULT_SQL} AND ${ACTIONABLE_NOT_DUP}
      ORDER BY timestamp DESC
      LIMIT 50`),

    // Counts
    query<{ match_count: string; watchlist_count: string; rec_count: string }>(`
      SELECT
        (SELECT COUNT(*)::text FROM matches) AS match_count,
        (
          SELECT COUNT(*)::text
          FROM (
            SELECT match_id FROM monitored_matches
            UNION
            SELECT match_id FROM watchlist
          ) operational_watch_matches
        ) AS watchlist_count,
        (SELECT COUNT(*)::text FROM recommendations WHERE ${ACTIONABLE_NOT_DUP}) AS rec_count`),

    query<AnalyticsRecommendationRow>(`
      SELECT
        match_id,
        home_team,
        away_team,
        minute,
        score,
        selection,
        bet_market,
        stake_percent,
        result,
        pnl,
        odds,
        confidence
      FROM recommendations
      WHERE ${ACTIONABLE_NOT_DUP}
        AND ${PENDING_RESULT_SQL}
    `),
  ]);

  const s = statsRes.rows[0]!;
  const total = Number(s.total);
  const wins = Number(s.wins);
  const losses = Number(s.losses);
  const pushes = Number(s.pushes);
  const halfWins = Number(s.half_wins);
  const halfLosses = Number(s.half_losses);
  const voids = Number(s.voids);
  const directionalSettled = wins + losses;
  const pushVoidSettled = pushes + voids;
  const winRate = directionalRate(wins, losses);
  const totalStaked = Number(s.total_staked);
  const totalPnl = Number(s.total_pnl);
  const roi = totalStaked > 0 ? Math.round((totalPnl / totalStaked) * 10000) / 100 : 0;

  // Build cumulative P/L
  let cumulative = 0;
  const pnlTrend = pnlRes.rows.map((r) => {
    const dailyPnl = parseFloat(r.daily_pnl);
    cumulative += dailyPnl;
    return {
      date: r.date,
      pnl: Math.round(dailyPnl * 100) / 100,
      cumulative: Math.round(cumulative * 100) / 100,
    };
  });

  // Compute streak
  let streak = '';
  if (streakRes.rows.length > 0) {
    const first = streakRes.rows[0]!.result;
    let count = 0;
    for (const r of streakRes.rows) {
      if (r.result === first) count++;
      else break;
    }
    if (count > 1) {
      streak = first === 'win' ? `${count}W streak` : `${count}L streak`;
    }
  }

  const c = countsRes.rows[0]!;

  return {
    totalBets: total,
    wins,
    losses,
    pushes,
    halfWins,
    halfLosses,
    voids,
    directionalSettled,
    pushVoidSettled,
    pending: Number(s.pending),
    winRate,
    totalPnl,
    totalStaked,
    roi,
    streak,
    matchCount: Number(c.match_count),
    watchlistCount: Number(c.watchlist_count),
    recCount: Number(c.rec_count),
    openExposureConcentration: summarizeExposureClusters(openExposureRes.rows, { minCount: 2, limit: 5 }),
    pnlTrend,
    recentRecs: recentRes.rows,
  };
}

/** Get distinct bet_types for filter dropdown */
export async function getDistinctBetTypes(): Promise<string[]> {
  const r = await query<{ bet_type: string }>(
    `SELECT DISTINCT bet_type
     FROM recommendations
     WHERE bet_type != ''
       AND ${ACTIONABLE_REC_SQL}
     ORDER BY bet_type`,
  );
  return r.rows.map((row) => row.bet_type);
}

/** Get distinct leagues for filter dropdown */
export async function getDistinctLeagues(): Promise<string[]> {
  const r = await query<{ league: string }>(
    `SELECT DISTINCT league
     FROM recommendations
     WHERE league != ''
       AND ${ACTIONABLE_NOT_DUP}
     ORDER BY league`,
  );
  return r.rows.map((row) => row.league);
}

/**
 * Mark legacy duplicates: for each (match_id, normalized_market) group,
 * keep the OLDEST record (MIN id) and mark the rest as result='duplicate', pnl=0.
 * Also backfill bet_market from selection text where empty.
 * Returns number of records marked as duplicate.
 */
export async function markLegacyDuplicates(): Promise<{
  backfilledMarkets: number;
  markedDuplicates: number;
}> {
  // Step 1: Backfill empty bet_market using normalizeMarket on selection text
  const allEmpty = await query<{ id: number; selection: string; bet_market: string }>(
    `SELECT id, selection, bet_market FROM recommendations WHERE bet_market = '' OR bet_market IS NULL`,
  );
  let backfilledMarkets = 0;
  for (const row of allEmpty.rows) {
    const mkt = normalizeMarket(row.selection, row.bet_market);
    if (mkt && mkt !== 'unknown') {
      await query(`UPDATE recommendations SET bet_market = $2 WHERE id = $1`, [row.id, mkt]);
      backfilledMarkets++;
    }
  }

  // Step 2: For each group of (match_id, normalizeMarket(selection, bet_market)),
  // keep the first (MIN id) and mark rest as duplicate.
  const result = await query<{ cnt: string }>(
    `WITH normalized AS (
       SELECT id, match_id,
              CASE
                WHEN selection ~* 'over\\s+[\\d.]+'  THEN 'over_'  || (regexp_match(selection, '(\\d+\\.?\\d*)'))[1]
                WHEN selection ~* 'under\\s+[\\d.]+' THEN 'under_' || (regexp_match(selection, '(\\d+\\.?\\d*)'))[1]
                WHEN selection ~* 'btts|both.?teams?.?to.?score' THEN
                  CASE WHEN selection ~* 'no' THEN 'btts_no' ELSE 'btts_yes' END
                WHEN selection ~* '\\bdraw\\b' THEN '1x2_draw'
                WHEN selection ~* '\\baway\\b' OR bet_market = '1x2_away' THEN '1x2_away'
                WHEN selection ~* '\\b(home|win)\\b' OR bet_market = '1x2_home' THEN '1x2_home'
                WHEN selection ~* 'asian.?handicap|ah\\s' THEN 'asian_handicap'
                WHEN selection ~* 'corner' THEN 'corners'
                WHEN bet_market != '' AND bet_market IS NOT NULL THEN lower(bet_market)
                ELSE lower(regexp_replace(selection, '[^a-z0-9]+', '_', 'gi'))
              END AS norm_market
       FROM recommendations
       WHERE result != 'duplicate'
     ),
     keepers AS (
       SELECT MIN(id) AS keep_id
       FROM normalized
       GROUP BY match_id, norm_market
     )
     UPDATE recommendations
     SET result = 'duplicate', pnl = 0
     WHERE id NOT IN (SELECT keep_id FROM keepers)
       AND result != 'duplicate'
     RETURNING id`,
  );

  return {
    backfilledMarkets,
    markedDuplicates: result.rowCount ?? 0,
  };
}

/**
 * Strip heavy JSONB text fields (reasoning, key_factors, warnings) from
 * recommendations older than keepDays while preserving all core bet data.
 * Sets is_slim=TRUE and slimmed_at=NOW() so the operation is idempotent.
 */
export async function slimOldRecommendations(keepDays: number): Promise<number> {
  if (keepDays <= 0) return 0;
  const result = await query(
    `UPDATE recommendations
        SET reasoning    = NULL,
            reasoning_vi = NULL,
            key_factors  = NULL,
            warnings     = NULL,
            is_slim      = TRUE,
            slimmed_at   = NOW()
      WHERE timestamp < NOW() - INTERVAL '1 day' * $1
        AND is_slim = FALSE`,
    [keepDays],
  );
  return result.rowCount ?? 0;
}
