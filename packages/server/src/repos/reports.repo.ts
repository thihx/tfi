// ============================================================
// Reports Repository — Advanced analytics & reporting queries
// ============================================================

import { query } from '../db/pool.js';
import {
  DIRECTIONAL_LOSS_SETTLEMENT_RESULTS_SQL,
  DIRECTIONAL_SETTLEMENT_RESULTS_SQL,
  DIRECTIONAL_WIN_SETTLEMENT_RESULTS_SQL,
  FINAL_SETTLEMENT_RESULTS_SQL,
  PUSH_VOID_SETTLEMENT_RESULTS_SQL,
} from '../lib/settle-types.js';
import {
  summarizeExposureClusters,
  summarizeLateEntryPerformance,
  summarizeMarketFamilyPerformance,
  type AnalyticsRecommendationRow,
  type ExposureSummary,
  type LateEntryPerformanceRow,
  type MarketFamilyPerformanceRow,
} from '../lib/recommendation-quality-metrics.js';

const NOT_DUP = `result IS DISTINCT FROM 'duplicate' AND bet_type IS DISTINCT FROM 'NO_BET'`;
const FINAL_RESULT_SQL = `result IN (${FINAL_SETTLEMENT_RESULTS_SQL})`;
const PENDING_RESULT_SQL = `(result IS NULL OR result = '' OR result NOT IN (${FINAL_SETTLEMENT_RESULTS_SQL}))`;
const DIRECTIONAL_WIN_RESULT_SQL = `result IN (${DIRECTIONAL_WIN_SETTLEMENT_RESULTS_SQL})`;
const DIRECTIONAL_LOSS_RESULT_SQL = `result IN (${DIRECTIONAL_LOSS_SETTLEMENT_RESULTS_SQL})`;
const DIRECTIONAL_RESULT_SQL = `result IN (${DIRECTIONAL_SETTLEMENT_RESULTS_SQL})`;
const PUSH_VOID_RESULT_SQL = `result IN (${PUSH_VOID_SETTLEMENT_RESULTS_SQL})`;

function directionalRate(wins: number, losses: number): number {
  const total = wins + losses;
  return total > 0 ? Math.round((wins / total) * 10000) / 100 : 0;
}

// ── Shared types ──────────────────────────────────────────

interface PeriodFilter {
  dateFrom?: string;   // ISO date 'YYYY-MM-DD'
  dateTo?: string;     // ISO date 'YYYY-MM-DD'
  period?: 'today' | '7d' | '30d' | '90d' | 'this-week' | 'this-month' | 'all';
}

function buildDateCondition(col: string, filter: PeriodFilter): { clause: string; params: unknown[]; nextIdx: number; startIdx: number } {
  const params: unknown[] = [];
  const conditions: string[] = [];
  let idx = 1;

  if (filter.dateFrom) {
    conditions.push(`${col}::date >= $${idx}::date`);
    params.push(filter.dateFrom);
    idx++;
  }
  if (filter.dateTo) {
    conditions.push(`${col}::date <= $${idx}::date`);
    params.push(filter.dateTo);
    idx++;
  }

  if (!filter.dateFrom && !filter.dateTo && filter.period && filter.period !== 'all') {
    switch (filter.period) {
      case 'today':
        conditions.push(`${col}::date = CURRENT_DATE`);
        break;
      case '7d':
        conditions.push(`${col}::date >= CURRENT_DATE - INTERVAL '7 days'`);
        break;
      case '30d':
        conditions.push(`${col}::date >= CURRENT_DATE - INTERVAL '30 days'`);
        break;
      case '90d':
        conditions.push(`${col}::date >= CURRENT_DATE - INTERVAL '90 days'`);
        break;
      case 'this-week':
        conditions.push(`${col}::date >= date_trunc('week', CURRENT_DATE)`);
        break;
      case 'this-month':
        conditions.push(`${col}::date >= date_trunc('month', CURRENT_DATE)`);
        break;
    }
  }

  return {
    clause: conditions.length > 0 ? conditions.join(' AND ') : '1=1',
    params,
    nextIdx: idx,
    startIdx: 1,
  };
}

// ── 1. Overview Report (period-filtered KPIs) ─────────────

export interface OverviewReport {
  total: number;
  settled: number;
  directionalSettled: number;
  pushVoidSettled: number;
  wins: number;
  losses: number;
  pushes: number;
  halfWins: number;
  halfLosses: number;
  voids: number;
  pending: number;
  winRate: number;
  totalPnl: number;
  avgOdds: number;
  avgConfidence: number;
  roi: number;
  bestDay: { date: string; pnl: number } | null;
  worstDay: { date: string; pnl: number } | null;
  exposureConcentration: ExposureSummary;
}

async function getAnalyticsRows(filter: PeriodFilter): Promise<AnalyticsRecommendationRow[]> {
  const dc = buildDateCondition('r.timestamp', filter);
  const res = await query<AnalyticsRecommendationRow>(`
    SELECT
      r.match_id,
      r.home_team,
      r.away_team,
      r.minute,
      r.score,
      r.selection,
      r.bet_market,
      r.stake_percent,
      r.result,
      r.pnl,
      r.odds,
      r.confidence
    FROM recommendations r
    WHERE ${NOT_DUP} AND ${dc.clause}
  `, dc.params);
  return res.rows;
}

export async function getOverviewReport(filter: PeriodFilter): Promise<OverviewReport> {
  const dc = buildDateCondition('r.timestamp', filter);

  const [r, dayRes, analyticsRows] = await Promise.all([
    query<{
      total: string; settled: string; wins: string; losses: string;
      pushes: string; half_wins: string; half_losses: string; voids: string; pending: string; total_pnl: string;
      avg_odds: string; avg_confidence: string; total_staked: string;
    }>(`
      SELECT
        COUNT(*)::text AS total,
        COUNT(*) FILTER (WHERE ${FINAL_RESULT_SQL})::text AS settled,
        COUNT(*) FILTER (WHERE ${DIRECTIONAL_WIN_RESULT_SQL})::text AS wins,
        COUNT(*) FILTER (WHERE ${DIRECTIONAL_LOSS_RESULT_SQL})::text AS losses,
        COUNT(*) FILTER (WHERE result = 'push')::text AS pushes,
        COUNT(*) FILTER (WHERE result = 'half_win')::text AS half_wins,
        COUNT(*) FILTER (WHERE result = 'half_loss')::text AS half_losses,
        COUNT(*) FILTER (WHERE result = 'void')::text AS voids,
        COUNT(*) FILTER (WHERE ${PENDING_RESULT_SQL})::text AS pending,
        COALESCE(SUM(pnl) FILTER (WHERE ${FINAL_RESULT_SQL}), 0)::text AS total_pnl,
        COALESCE(AVG(odds) FILTER (WHERE odds > 0), 0)::text AS avg_odds,
        COALESCE(AVG(confidence) FILTER (WHERE confidence IS NOT NULL), 0)::text AS avg_confidence,
        COALESCE(SUM(COALESCE(stake_percent, 1)) FILTER (WHERE ${FINAL_RESULT_SQL}), 0)::text AS total_staked
      FROM recommendations r
      WHERE ${NOT_DUP} AND ${dc.clause}
    `, dc.params),

    query<{ date: string; daily_pnl: string }>(`
      SELECT TO_CHAR(timestamp::date, 'YYYY-MM-DD') AS date,
             SUM(pnl)::text AS daily_pnl
      FROM recommendations r
      WHERE ${FINAL_RESULT_SQL} AND ${NOT_DUP} AND ${dc.clause}
      GROUP BY timestamp::date
      ORDER BY SUM(pnl) DESC
    `, dc.params),

    getAnalyticsRows(filter),
  ]);

  const s = r.rows[0]!;
  const wins = Number(s.wins);
  const losses = Number(s.losses);
  const pushes = Number(s.pushes);
  const halfWins = Number(s.half_wins);
  const halfLosses = Number(s.half_losses);
  const voids = Number(s.voids);
  const directionalSettled = wins + losses;
  const pushVoidSettled = pushes + voids;
  const totalStaked = Number(s.total_staked);
  const totalPnl = Number(s.total_pnl);

  const days = dayRes.rows.map((d) => ({ date: d.date, pnl: Number(d.daily_pnl) }));

  return {
    total: Number(s.total),
    settled: Number(s.settled),
    directionalSettled,
    pushVoidSettled,
    wins,
    losses,
    pushes,
    halfWins,
    halfLosses,
    voids,
    pending: Number(s.pending),
    winRate: directionalRate(wins, losses),
    totalPnl: Math.round(totalPnl * 100) / 100,
    avgOdds: Math.round(Number(s.avg_odds) * 100) / 100,
    avgConfidence: Math.round(Number(s.avg_confidence) * 10) / 10,
    roi: totalStaked > 0 ? Math.round((totalPnl / totalStaked) * 10000) / 100 : 0,
    bestDay: days.length > 0 ? days[0]! : null,
    worstDay: days.length > 0 ? days[days.length - 1]! : null,
    exposureConcentration: summarizeExposureClusters(analyticsRows, { minCount: 2, limit: 5 }),
  };
}

// ── 2. League Performance Report ──────────────────────────

export interface LeagueRow {
  league: string;
  total: number;
  wins: number;
  losses: number;
  pushVoid: number;
  winRate: number;
  pnl: number;
  avgOdds: number;
  avgConfidence: number;
  roi: number;
}

export async function getLeagueReport(filter: PeriodFilter): Promise<LeagueRow[]> {
  const dc = buildDateCondition('r.timestamp', filter);

  const r = await query<{
    league: string; total: string; wins: string; losses: string;
    push_void: string; pnl: string; avg_odds: string; avg_confidence: string;
    total_staked: string;
  }>(`
    SELECT
      COALESCE(NULLIF(league, ''), 'Unknown') AS league,
      COUNT(*)::text AS total,
      COUNT(*) FILTER (WHERE ${DIRECTIONAL_WIN_RESULT_SQL})::text AS wins,
      COUNT(*) FILTER (WHERE ${DIRECTIONAL_LOSS_RESULT_SQL})::text AS losses,
      COUNT(*) FILTER (WHERE ${PUSH_VOID_RESULT_SQL})::text AS push_void,
      COALESCE(SUM(pnl) FILTER (WHERE ${FINAL_RESULT_SQL}), 0)::text AS pnl,
      COALESCE(AVG(odds) FILTER (WHERE odds > 0), 0)::text AS avg_odds,
      COALESCE(AVG(confidence) FILTER (WHERE confidence IS NOT NULL), 0)::text AS avg_confidence,
      COALESCE(SUM(COALESCE(stake_percent, 1)) FILTER (WHERE ${FINAL_RESULT_SQL}), 0)::text AS total_staked
    FROM recommendations r
    WHERE ${NOT_DUP} AND ${FINAL_RESULT_SQL} AND ${dc.clause}
    GROUP BY COALESCE(NULLIF(league, ''), 'Unknown')
    HAVING COUNT(*) >= 2
    ORDER BY SUM(pnl) DESC
  `, dc.params);

  return r.rows.map((row) => {
    const wins = Number(row.wins);
    const losses = Number(row.losses);
    const totalStaked = Number(row.total_staked);
    const pnl = Number(row.pnl);
    return {
      league: row.league,
      total: Number(row.total),
      wins,
      losses,
      pushVoid: Number(row.push_void),
      winRate: directionalRate(wins, losses),
      pnl: Math.round(pnl * 100) / 100,
      avgOdds: Math.round(Number(row.avg_odds) * 100) / 100,
      avgConfidence: Math.round(Number(row.avg_confidence) * 10) / 10,
      roi: totalStaked > 0 ? Math.round((pnl / totalStaked) * 10000) / 100 : 0,
    };
  });
}

// ── 3. Market Performance Report ──────────────────────────

export interface MarketRow {
  market: string;
  total: number;
  wins: number;
  losses: number;
  pushVoid: number;
  winRate: number;
  pnl: number;
  avgOdds: number;
  roi: number;
}

export async function getMarketReport(filter: PeriodFilter): Promise<MarketRow[]> {
  const dc = buildDateCondition('r.timestamp', filter);

  const r = await query<{
    market: string; total: string; wins: string; losses: string; push_void: string;
    pnl: string; avg_odds: string; total_staked: string;
  }>(`
    SELECT
      COALESCE(NULLIF(bet_market, ''), bet_type) AS market,
      COUNT(*)::text AS total,
      COUNT(*) FILTER (WHERE ${DIRECTIONAL_WIN_RESULT_SQL})::text AS wins,
      COUNT(*) FILTER (WHERE ${DIRECTIONAL_LOSS_RESULT_SQL})::text AS losses,
      COUNT(*) FILTER (WHERE ${PUSH_VOID_RESULT_SQL})::text AS push_void,
      COALESCE(SUM(pnl) FILTER (WHERE ${FINAL_RESULT_SQL}), 0)::text AS pnl,
      COALESCE(AVG(odds) FILTER (WHERE odds > 0), 0)::text AS avg_odds,
      COALESCE(SUM(COALESCE(stake_percent, 1)) FILTER (WHERE ${FINAL_RESULT_SQL}), 0)::text AS total_staked
    FROM recommendations r
    WHERE ${NOT_DUP} AND ${FINAL_RESULT_SQL} AND ${dc.clause}
    GROUP BY COALESCE(NULLIF(bet_market, ''), bet_type)
    HAVING COUNT(*) >= 2
    ORDER BY SUM(pnl) DESC
  `, dc.params);

  return r.rows.map((row) => {
    const wins = Number(row.wins);
    const losses = Number(row.losses);
    const totalStaked = Number(row.total_staked);
    const pnl = Number(row.pnl);
    return {
      market: row.market,
      total: Number(row.total),
      wins,
      losses,
      pushVoid: Number(row.push_void),
      winRate: directionalRate(wins, losses),
      pnl: Math.round(pnl * 100) / 100,
      avgOdds: Math.round(Number(row.avg_odds) * 100) / 100,
      roi: totalStaked > 0 ? Math.round((pnl / totalStaked) * 10000) / 100 : 0,
    };
  });
}

// ── 4. Weekly/Monthly Time Report ─────────────────────────

export interface TimeRow {
  period: string;        // 'W10-2026' or 'Mar 2026'
  periodStart: string;   // ISO date
  total: number;
  wins: number;
  losses: number;
  pushVoid: number;
  winRate: number;
  pnl: number;
  cumPnl: number;        // computed after query
  avgOdds: number;
  roi: number;
}

export async function getWeeklyReport(filter: PeriodFilter): Promise<TimeRow[]> {
  const dc = buildDateCondition('r.timestamp', filter);

  const r = await query<{
    period: string; period_start: string;
    total: string; wins: string; losses: string; push_void: string;
    pnl: string; avg_odds: string; total_staked: string;
  }>(`
    SELECT
      'W' || EXTRACT(WEEK FROM timestamp::date)::int || '-' || EXTRACT(YEAR FROM timestamp::date)::int AS period,
      MIN(timestamp::date)::text AS period_start,
      COUNT(*)::text AS total,
      COUNT(*) FILTER (WHERE ${DIRECTIONAL_WIN_RESULT_SQL})::text AS wins,
      COUNT(*) FILTER (WHERE ${DIRECTIONAL_LOSS_RESULT_SQL})::text AS losses,
      COUNT(*) FILTER (WHERE ${PUSH_VOID_RESULT_SQL})::text AS push_void,
      COALESCE(SUM(pnl) FILTER (WHERE ${FINAL_RESULT_SQL}), 0)::text AS pnl,
      COALESCE(AVG(odds) FILTER (WHERE odds > 0), 0)::text AS avg_odds,
      COALESCE(SUM(COALESCE(stake_percent, 1)) FILTER (WHERE ${FINAL_RESULT_SQL}), 0)::text AS total_staked
    FROM recommendations r
    WHERE ${NOT_DUP} AND ${FINAL_RESULT_SQL} AND ${dc.clause}
    GROUP BY EXTRACT(WEEK FROM timestamp::date), EXTRACT(YEAR FROM timestamp::date)
    ORDER BY MIN(timestamp::date)
  `, dc.params);

  let cumPnl = 0;
  return r.rows.map((row) => {
    const wins = Number(row.wins);
    const losses = Number(row.losses);
    const pnl = Number(row.pnl);
    const totalStaked = Number(row.total_staked);
    cumPnl += pnl;
    return {
      period: row.period,
      periodStart: row.period_start,
      total: Number(row.total),
      wins,
      losses,
      pushVoid: Number(row.push_void),
      winRate: directionalRate(wins, losses),
      pnl: Math.round(pnl * 100) / 100,
      cumPnl: Math.round(cumPnl * 100) / 100,
      avgOdds: Math.round(Number(row.avg_odds) * 100) / 100,
      roi: totalStaked > 0 ? Math.round((pnl / totalStaked) * 10000) / 100 : 0,
    };
  });
}

export async function getMonthlyReport(filter: PeriodFilter): Promise<TimeRow[]> {
  const dc = buildDateCondition('r.timestamp', filter);

  const r = await query<{
    period: string; period_start: string;
    total: string; wins: string; losses: string; push_void: string;
    pnl: string; avg_odds: string; total_staked: string;
  }>(`
    SELECT
      TO_CHAR(timestamp::date, 'Mon YYYY') AS period,
      MIN(timestamp::date)::text AS period_start,
      COUNT(*)::text AS total,
      COUNT(*) FILTER (WHERE ${DIRECTIONAL_WIN_RESULT_SQL})::text AS wins,
      COUNT(*) FILTER (WHERE ${DIRECTIONAL_LOSS_RESULT_SQL})::text AS losses,
      COUNT(*) FILTER (WHERE ${PUSH_VOID_RESULT_SQL})::text AS push_void,
      COALESCE(SUM(pnl) FILTER (WHERE ${FINAL_RESULT_SQL}), 0)::text AS pnl,
      COALESCE(AVG(odds) FILTER (WHERE odds > 0), 0)::text AS avg_odds,
      COALESCE(SUM(COALESCE(stake_percent, 1)) FILTER (WHERE ${FINAL_RESULT_SQL}), 0)::text AS total_staked
    FROM recommendations r
    WHERE ${NOT_DUP} AND ${FINAL_RESULT_SQL} AND ${dc.clause}
    GROUP BY TO_CHAR(timestamp::date, 'Mon YYYY'), date_trunc('month', timestamp::date)
    ORDER BY date_trunc('month', MIN(timestamp::date))
  `, dc.params);

  let cumPnl = 0;
  return r.rows.map((row) => {
    const wins = Number(row.wins);
    const losses = Number(row.losses);
    const pnl = Number(row.pnl);
    const totalStaked = Number(row.total_staked);
    cumPnl += pnl;
    return {
      period: row.period,
      periodStart: row.period_start,
      total: Number(row.total),
      wins,
      losses,
      pushVoid: Number(row.push_void),
      winRate: directionalRate(wins, losses),
      pnl: Math.round(pnl * 100) / 100,
      cumPnl: Math.round(cumPnl * 100) / 100,
      avgOdds: Math.round(Number(row.avg_odds) * 100) / 100,
      roi: totalStaked > 0 ? Math.round((pnl / totalStaked) * 10000) / 100 : 0,
    };
  });
}

// ── 5. Confidence Calibration Report ──────────────────────

export interface ConfidenceBand {
  band: string;
  range: string;            // '1-3', '4-5', '6-7', '8-10'
  total: number;
  wins: number;
  losses: number;
  winRate: number;
  expectedWinRate: number;  // midpoint of confidence band
  pnl: number;
  avgOdds: number;
}

export async function getConfidenceReport(filter: PeriodFilter): Promise<ConfidenceBand[]> {
  const dc = buildDateCondition('r.timestamp', filter);

  const r = await query<{
    band: string; range: string;
    total: string; wins: string; losses: string;
    pnl: string; avg_odds: string; avg_conf: string;
  }>(`
    SELECT
      CASE
        WHEN confidence >= 8 THEN 'High (8-10)'
        WHEN confidence >= 6 THEN 'Medium (6-7)'
        WHEN confidence >= 4 THEN 'Low-Med (4-5)'
        ELSE 'Low (1-3)'
      END AS band,
      CASE
        WHEN confidence >= 8 THEN '8-10'
        WHEN confidence >= 6 THEN '6-7'
        WHEN confidence >= 4 THEN '4-5'
        ELSE '1-3'
      END AS range,
      COUNT(*)::text AS total,
      COUNT(*) FILTER (WHERE ${DIRECTIONAL_WIN_RESULT_SQL})::text AS wins,
      COUNT(*) FILTER (WHERE ${DIRECTIONAL_LOSS_RESULT_SQL})::text AS losses,
      COALESCE(SUM(pnl), 0)::text AS pnl,
      COALESCE(AVG(odds) FILTER (WHERE odds > 0), 0)::text AS avg_odds,
      COALESCE(AVG(confidence), 0)::text AS avg_conf
    FROM recommendations r
    WHERE ${NOT_DUP} AND ${DIRECTIONAL_RESULT_SQL} AND confidence IS NOT NULL AND ${dc.clause}
    GROUP BY
      CASE WHEN confidence >= 8 THEN 'High (8-10)' WHEN confidence >= 6 THEN 'Medium (6-7)' WHEN confidence >= 4 THEN 'Low-Med (4-5)' ELSE 'Low (1-3)' END,
      CASE WHEN confidence >= 8 THEN '8-10' WHEN confidence >= 6 THEN '6-7' WHEN confidence >= 4 THEN '4-5' ELSE '1-3' END
    ORDER BY MIN(confidence) DESC
  `, dc.params);

  const expectedMap: Record<string, number> = { '8-10': 80, '6-7': 65, '4-5': 45, '1-3': 20 };

  return r.rows.map((row) => {
    const wins = Number(row.wins);
    const losses = Number(row.losses);
    return {
      band: row.band,
      range: row.range,
      total: Number(row.total),
      wins,
      losses,
      winRate: directionalRate(wins, losses),
      expectedWinRate: expectedMap[row.range] ?? 50,
      pnl: Math.round(Number(row.pnl) * 100) / 100,
      avgOdds: Math.round(Number(row.avg_odds) * 100) / 100,
    };
  });
}

// ── 6. Odds Range Report ──────────────────────────────────

export interface OddsRangeRow {
  range: string;
  total: number;
  wins: number;
  losses: number;
  winRate: number;
  pnl: number;
  avgConfidence: number;
}

export async function getOddsRangeReport(filter: PeriodFilter): Promise<OddsRangeRow[]> {
  const dc = buildDateCondition('r.timestamp', filter);

  const r = await query<{
    range: string; total: string; wins: string; losses: string;
    pnl: string; avg_conf: string;
  }>(`
    SELECT
      CASE
        WHEN odds < 1.50 THEN '< 1.50 (Heavy Fav)'
        WHEN odds < 1.70 THEN '1.50 - 1.69'
        WHEN odds < 2.00 THEN '1.70 - 1.99'
        WHEN odds < 2.50 THEN '2.00 - 2.49'
        WHEN odds < 3.00 THEN '2.50 - 2.99'
        ELSE '3.00+ (Longshot)'
      END AS range,
      COUNT(*)::text AS total,
      COUNT(*) FILTER (WHERE ${DIRECTIONAL_WIN_RESULT_SQL})::text AS wins,
      COUNT(*) FILTER (WHERE ${DIRECTIONAL_LOSS_RESULT_SQL})::text AS losses,
      COALESCE(SUM(pnl), 0)::text AS pnl,
      COALESCE(AVG(confidence), 0)::text AS avg_conf
    FROM recommendations r
    WHERE ${NOT_DUP} AND ${DIRECTIONAL_RESULT_SQL} AND odds IS NOT NULL AND odds > 0 AND ${dc.clause}
    GROUP BY
      CASE WHEN odds < 1.50 THEN '< 1.50 (Heavy Fav)' WHEN odds < 1.70 THEN '1.50 - 1.69' WHEN odds < 2.00 THEN '1.70 - 1.99' WHEN odds < 2.50 THEN '2.00 - 2.49' WHEN odds < 3.00 THEN '2.50 - 2.99' ELSE '3.00+ (Longshot)' END
    ORDER BY MIN(odds)
  `, dc.params);

  return r.rows.map((row) => {
    const wins = Number(row.wins);
    const losses = Number(row.losses);
    return {
      range: row.range,
      total: Number(row.total),
      wins,
      losses,
      winRate: directionalRate(wins, losses),
      pnl: Math.round(Number(row.pnl) * 100) / 100,
      avgConfidence: Math.round(Number(row.avg_conf) * 10) / 10,
    };
  });
}

// ── 7. Match Minute Timing Report ─────────────────────────

export interface MinuteBandRow {
  band: string;
  total: number;
  wins: number;
  losses: number;
  winRate: number;
  pnl: number;
  avgOdds: number;
}

export async function getMinuteReport(filter: PeriodFilter): Promise<MinuteBandRow[]> {
  const dc = buildDateCondition('r.timestamp', filter);

  const r = await query<{
    band: string; total: string; wins: string; losses: string;
    pnl: string; avg_odds: string;
  }>(`
    SELECT
      CASE
        WHEN minute < 15 THEN '0-14 (Very Early)'
        WHEN minute < 30 THEN '15-29 (Early)'
        WHEN minute < 45 THEN '30-44 (Pre-HT)'
        WHEN minute < 55 THEN '45-54 (Start 2H)'
        WHEN minute < 70 THEN '55-69 (Mid 2H)'
        WHEN minute < 80 THEN '70-79 (Late)'
        ELSE '80+ (Endgame)'
      END AS band,
      COUNT(*)::text AS total,
      COUNT(*) FILTER (WHERE ${DIRECTIONAL_WIN_RESULT_SQL})::text AS wins,
      COUNT(*) FILTER (WHERE ${DIRECTIONAL_LOSS_RESULT_SQL})::text AS losses,
      COALESCE(SUM(pnl), 0)::text AS pnl,
      COALESCE(AVG(odds) FILTER (WHERE odds > 0), 0)::text AS avg_odds
    FROM recommendations r
    WHERE ${NOT_DUP} AND ${DIRECTIONAL_RESULT_SQL} AND minute IS NOT NULL AND ${dc.clause}
    GROUP BY
      CASE WHEN minute < 15 THEN '0-14 (Very Early)' WHEN minute < 30 THEN '15-29 (Early)' WHEN minute < 45 THEN '30-44 (Pre-HT)' WHEN minute < 55 THEN '45-54 (Start 2H)' WHEN minute < 70 THEN '55-69 (Mid 2H)' WHEN minute < 80 THEN '70-79 (Late)' ELSE '80+ (Endgame)' END
    ORDER BY MIN(minute)
  `, dc.params);

  return r.rows.map((row) => {
    const wins = Number(row.wins);
    const losses = Number(row.losses);
    return {
      band: row.band,
      total: Number(row.total),
      wins,
      losses,
      winRate: directionalRate(wins, losses),
      pnl: Math.round(Number(row.pnl) * 100) / 100,
      avgOdds: Math.round(Number(row.avg_odds) * 100) / 100,
    };
  });
}

// ── 8. Daily P/L Heatmap Data ─────────────────────────────

export interface DailyPnlRow {
  date: string; // YYYY-MM-DD
  dayOfWeek: number; // 0=Sun, 6=Sat
  dayName: string;
  total: number;
  wins: number;
  losses: number;
  pushVoid: number;
  pnl: number;
}

export async function getDailyPnlReport(filter: PeriodFilter): Promise<DailyPnlRow[]> {
  const dc = buildDateCondition('r.timestamp', filter);

  const r = await query<{
    date: string; dow: string; day_name: string;
    total: string; wins: string; losses: string; push_void: string; pnl: string;
  }>(`
    SELECT
      TO_CHAR(timestamp::date, 'YYYY-MM-DD') AS date,
      EXTRACT(DOW FROM timestamp::date)::text AS dow,
      TO_CHAR(timestamp::date, 'Dy') AS day_name,
      COUNT(*)::text AS total,
      COUNT(*) FILTER (WHERE ${DIRECTIONAL_WIN_RESULT_SQL})::text AS wins,
      COUNT(*) FILTER (WHERE ${DIRECTIONAL_LOSS_RESULT_SQL})::text AS losses,
      COUNT(*) FILTER (WHERE ${PUSH_VOID_RESULT_SQL})::text AS push_void,
      COALESCE(SUM(pnl), 0)::text AS pnl
    FROM recommendations r
    WHERE ${NOT_DUP} AND ${FINAL_RESULT_SQL} AND ${dc.clause}
    GROUP BY timestamp::date
    ORDER BY timestamp::date
  `, dc.params);

  return r.rows.map((row) => ({
    date: row.date,
    dayOfWeek: Number(row.dow),
    dayName: row.day_name,
    total: Number(row.total),
    wins: Number(row.wins),
    losses: Number(row.losses),
    pushVoid: Number(row.push_void),
    pnl: Math.round(Number(row.pnl) * 100) / 100,
  }));
}

// ── 9. Day-of-Week Aggregate ──────────────────────────────

export interface DayOfWeekRow {
  dayOfWeek: number;
  dayName: string;
  total: number;
  wins: number;
  losses: number;
  pushVoid: number;
  winRate: number;
  pnl: number;
}

export async function getDayOfWeekReport(filter: PeriodFilter): Promise<DayOfWeekRow[]> {
  const dc = buildDateCondition('r.timestamp', filter);

  const r = await query<{
    dow: string; day_name: string;
    total: string; wins: string; losses: string; push_void: string; pnl: string;
  }>(`
    SELECT
      EXTRACT(DOW FROM timestamp::date)::text AS dow,
      TO_CHAR(timestamp::date, 'Dy') AS day_name,
      COUNT(*)::text AS total,
      COUNT(*) FILTER (WHERE ${DIRECTIONAL_WIN_RESULT_SQL})::text AS wins,
      COUNT(*) FILTER (WHERE ${DIRECTIONAL_LOSS_RESULT_SQL})::text AS losses,
      COUNT(*) FILTER (WHERE ${PUSH_VOID_RESULT_SQL})::text AS push_void,
      COALESCE(SUM(pnl), 0)::text AS pnl
    FROM recommendations r
    WHERE ${NOT_DUP} AND ${FINAL_RESULT_SQL} AND ${dc.clause}
    GROUP BY EXTRACT(DOW FROM timestamp::date), TO_CHAR(timestamp::date, 'Dy')
    ORDER BY EXTRACT(DOW FROM timestamp::date)
  `, dc.params);

  return r.rows.map((row) => {
    const wins = Number(row.wins);
    const losses = Number(row.losses);
    return {
      dayOfWeek: Number(row.dow),
      dayName: row.day_name,
      total: Number(row.total),
      wins,
      losses,
      pushVoid: Number(row.push_void),
      winRate: directionalRate(wins, losses),
      pnl: Math.round(Number(row.pnl) * 100) / 100,
    };
  });
}

// ── 10. League × Market Cross Report ──────────────────────

export interface LeagueMarketRow {
  league: string;
  market: string;
  total: number;
  wins: number;
  losses: number;
  pushVoid: number;
  winRate: number;
  pnl: number;
}

export async function getLeagueMarketReport(filter: PeriodFilter): Promise<LeagueMarketRow[]> {
  const dc = buildDateCondition('r.timestamp', filter);

  const r = await query<{
    league: string; market: string;
    total: string; wins: string; losses: string; push_void: string; pnl: string;
  }>(`
    SELECT
      COALESCE(NULLIF(league, ''), 'Unknown') AS league,
      COALESCE(NULLIF(bet_market, ''), bet_type) AS market,
      COUNT(*)::text AS total,
      COUNT(*) FILTER (WHERE ${DIRECTIONAL_WIN_RESULT_SQL})::text AS wins,
      COUNT(*) FILTER (WHERE ${DIRECTIONAL_LOSS_RESULT_SQL})::text AS losses,
      COUNT(*) FILTER (WHERE ${PUSH_VOID_RESULT_SQL})::text AS push_void,
      COALESCE(SUM(pnl), 0)::text AS pnl
    FROM recommendations r
    WHERE ${NOT_DUP} AND ${FINAL_RESULT_SQL} AND ${dc.clause}
    GROUP BY COALESCE(NULLIF(league, ''), 'Unknown'), COALESCE(NULLIF(bet_market, ''), bet_type)
    HAVING COUNT(*) >= 3
    ORDER BY COALESCE(NULLIF(league, ''), 'Unknown'), SUM(pnl) DESC
  `, dc.params);

  return r.rows.map((row) => {
    const wins = Number(row.wins);
    const losses = Number(row.losses);
    return {
      league: row.league,
      market: row.market,
      total: Number(row.total),
      wins,
      losses,
      pushVoid: Number(row.push_void),
      winRate: directionalRate(wins, losses),
      pnl: Math.round(Number(row.pnl) * 100) / 100,
    };
  });
}

// ── 11. AI Insights — High-level analysis data ────────────

export interface AiInsightsData {
  strongLeagues: Array<{ league: string; winRate: number; pnl: number; total: number }>;
  weakLeagues: Array<{ league: string; winRate: number; pnl: number; total: number }>;
  strongMarkets: Array<{ market: string; winRate: number; pnl: number; total: number }>;
  weakMarkets: Array<{ market: string; winRate: number; pnl: number; total: number }>;
  bestTimeSlots: Array<{ band: string; winRate: number; pnl: number; total: number }>;
  worstTimeSlots: Array<{ band: string; winRate: number; pnl: number; total: number }>;
  overconfidentBands: Array<{ band: string; avgConfidence: number; actualWinRate: number; gap: number }>;
  marketFamilies: MarketFamilyPerformanceRow[];
  lateEntries: LateEntryPerformanceRow[];
  sampleFloor: number;
  recentTrend: 'improving' | 'declining' | 'stable';
  recentWinRate: number;
  overallWinRate: number;
  streakInfo: { type: 'win' | 'loss'; count: number };
  valueFinds: number;      // wins where odds >= 2.0
  safeBetAccuracy: number; // win rate for odds < 1.70
  modelPromptCohorts: Array<{ cohort: string; total: number; winRate: number; pnl: number; roi: number }>;
  prematchStrengthCohorts: Array<{ bucket: string; total: number; winRate: number; pnl: number; roi: number }>;
  profileCoverageCohorts: Array<{ bucket: string; total: number; winRate: number; pnl: number; roi: number }>;
  profileScopeCohorts: Array<{ bucket: string; total: number; winRate: number; pnl: number; roi: number }>;
  overlayCoverageCohorts: Array<{ bucket: string; total: number; winRate: number; pnl: number; roi: number }>;
  policyImpactCohorts: Array<{ bucket: string; total: number; winRate: number; pnl: number; roi: number }>;
  underBiasSummary: { total: number; underCount: number; nonUnderCount: number; underShare: number };
  underBiasMinuteBands: Array<{ bucket: string; total: number; underCount: number; underShare: number }>;
  underBiasScoreStates: Array<{ bucket: string; total: number; underCount: number; underShare: number }>;
  underBiasEvidenceModes: Array<{ bucket: string; total: number; underCount: number; underShare: number }>;
  underBiasPrematchStrengths: Array<{ bucket: string; total: number; underCount: number; underShare: number }>;
}

export async function getAiInsights(filter: PeriodFilter): Promise<AiInsightsData> {
  const dc = buildDateCondition('r.timestamp', filter);
  const aiInsightSampleFloor = 5;
  const underGoalsCondition = `COALESCE(NULLIF(r.bet_market, ''), '') LIKE 'under_%'`;

  const [leagueRows, marketRows, minuteRows, confRows, recentTrendRes, overallTrendRes, streakRes, valueRes, safeRes, analyticsRows, modelPromptRows, prematchStrengthRows, profileCoverageRows, profileScopeRows, overlayCoverageRows, policyImpactRows, underBiasSummaryRow, underBiasMinuteRows, underBiasScoreRows, underBiasEvidenceRows, underBiasPrematchRows] = await Promise.all([
    // League performance
    query<{ league: string; wins: string; total: string; pnl: string }>(`
      SELECT COALESCE(NULLIF(league,''),'Unknown') AS league,
             COUNT(*) FILTER (WHERE ${DIRECTIONAL_WIN_RESULT_SQL})::text AS wins,
             COUNT(*)::text AS total,
             COALESCE(SUM(pnl),0)::text AS pnl
      FROM recommendations r
      WHERE ${NOT_DUP} AND ${DIRECTIONAL_RESULT_SQL} AND ${dc.clause}
      GROUP BY COALESCE(NULLIF(league,''),'Unknown') HAVING COUNT(*) >= ${aiInsightSampleFloor}
      ORDER BY SUM(pnl) DESC
    `, dc.params),

    // Market performance
    query<{ market: string; wins: string; total: string; pnl: string }>(`
      SELECT COALESCE(NULLIF(bet_market,''),bet_type) AS market,
             COUNT(*) FILTER (WHERE ${DIRECTIONAL_WIN_RESULT_SQL})::text AS wins,
             COUNT(*)::text AS total,
             COALESCE(SUM(pnl),0)::text AS pnl
      FROM recommendations r
      WHERE ${NOT_DUP} AND ${DIRECTIONAL_RESULT_SQL} AND ${dc.clause}
      GROUP BY COALESCE(NULLIF(bet_market,''),bet_type) HAVING COUNT(*) >= ${aiInsightSampleFloor}
      ORDER BY SUM(pnl) DESC
    `, dc.params),

    // Minute bands
    query<{ band: string; wins: string; total: string; pnl: string }>(`
      SELECT CASE WHEN minute<30 THEN '0-29 (1H early)' WHEN minute<45 THEN '30-44 (Pre-HT)' WHEN minute<60 THEN '45-59 (Start 2H)' WHEN minute<75 THEN '60-74 (Mid 2H)' ELSE '75+ (Late)' END AS band,
             COUNT(*) FILTER (WHERE ${DIRECTIONAL_WIN_RESULT_SQL})::text AS wins,
             COUNT(*)::text AS total,
             COALESCE(SUM(pnl),0)::text AS pnl
      FROM recommendations r
      WHERE ${NOT_DUP} AND ${DIRECTIONAL_RESULT_SQL} AND minute IS NOT NULL AND ${dc.clause}
      GROUP BY CASE WHEN minute<30 THEN '0-29 (1H early)' WHEN minute<45 THEN '30-44 (Pre-HT)' WHEN minute<60 THEN '45-59 (Start 2H)' WHEN minute<75 THEN '60-74 (Mid 2H)' ELSE '75+ (Late)' END
      HAVING COUNT(*) >= ${aiInsightSampleFloor}
      ORDER BY MIN(minute)
    `, dc.params),

    // Confidence calibration
    query<{ band: string; avg_conf: string; wins: string; total: string }>(`
      SELECT CASE WHEN confidence>=8 THEN 'High (8-10)' WHEN confidence>=6 THEN 'Medium (6-7)' ELSE 'Low (1-5)' END AS band,
             AVG(confidence)::text AS avg_conf,
             COUNT(*) FILTER (WHERE ${DIRECTIONAL_WIN_RESULT_SQL})::text AS wins,
             COUNT(*)::text AS total
      FROM recommendations r
      WHERE ${NOT_DUP} AND ${DIRECTIONAL_RESULT_SQL} AND confidence IS NOT NULL AND ${dc.clause}
      GROUP BY CASE WHEN confidence>=8 THEN 'High (8-10)' WHEN confidence>=6 THEN 'Medium (6-7)' ELSE 'Low (1-5)' END
      HAVING COUNT(*) >= ${aiInsightSampleFloor}
    `, dc.params),

    // Recent trend: last 20 directional outcomes inside the selected period
    query<{ recent_wr: string }>(`
      WITH recent AS (
        SELECT CASE
                 WHEN ${DIRECTIONAL_WIN_RESULT_SQL} THEN 'win'
                 WHEN ${DIRECTIONAL_LOSS_RESULT_SQL} THEN 'loss'
               END AS direction
        FROM recommendations r
        WHERE ${NOT_DUP} AND ${DIRECTIONAL_RESULT_SQL} AND ${dc.clause}
        ORDER BY timestamp DESC LIMIT 20
      )
      SELECT
        ROUND(COUNT(*) FILTER (WHERE direction='win')::numeric / GREATEST(COUNT(*),1) * 100, 1)::text AS recent_wr
      FROM recent
    `, dc.params),

    query<{ overall_wr: string }>(`
      SELECT
        ROUND(COUNT(*) FILTER (WHERE ${DIRECTIONAL_WIN_RESULT_SQL})::numeric / GREATEST(COUNT(*),1) * 100, 1)::text AS overall_wr
      FROM recommendations r
      WHERE ${NOT_DUP} AND ${DIRECTIONAL_RESULT_SQL} AND ${dc.clause}
    `, dc.params),

    // Streak
    query<{ result: string }>(`
      SELECT CASE
               WHEN ${DIRECTIONAL_WIN_RESULT_SQL} THEN 'win'
               WHEN ${DIRECTIONAL_LOSS_RESULT_SQL} THEN 'loss'
             END AS result
      FROM recommendations r
      WHERE ${NOT_DUP} AND ${DIRECTIONAL_RESULT_SQL} AND ${dc.clause}
      ORDER BY timestamp DESC LIMIT 30
    `, dc.params),

    // Value finds (odds >= 2.0)
    query<{ wins: string; total: string }>(`
      SELECT COUNT(*) FILTER (WHERE ${DIRECTIONAL_WIN_RESULT_SQL})::text AS wins,
             COUNT(*)::text AS total
      FROM recommendations r
      WHERE ${NOT_DUP} AND ${DIRECTIONAL_RESULT_SQL} AND odds >= 2.0 AND ${dc.clause}
    `, dc.params),

    // Safe bet accuracy (odds < 1.70)
    query<{ wins: string; total: string }>(`
      SELECT COUNT(*) FILTER (WHERE ${DIRECTIONAL_WIN_RESULT_SQL})::text AS wins,
             COUNT(*)::text AS total
      FROM recommendations r
      WHERE ${NOT_DUP} AND ${DIRECTIONAL_RESULT_SQL} AND odds < 1.70 AND odds > 0 AND ${dc.clause}
    `, dc.params),

    getAnalyticsRows(filter),

    query<{ cohort: string; wins: string; total: string; pnl: string; total_staked: string }>(`
      SELECT
        CONCAT(COALESCE(NULLIF(ai_model, ''), 'Unknown model'), ' | ', COALESCE(NULLIF(prompt_version, ''), 'Unknown prompt')) AS cohort,
        COUNT(*) FILTER (WHERE ${DIRECTIONAL_WIN_RESULT_SQL})::text AS wins,
        COUNT(*)::text AS total,
        COALESCE(SUM(pnl), 0)::text AS pnl,
        COALESCE(SUM(COALESCE(stake_percent, 1)), 0)::text AS total_staked
      FROM recommendations r
      WHERE ${NOT_DUP} AND ${DIRECTIONAL_RESULT_SQL} AND ${dc.clause}
      GROUP BY CONCAT(COALESCE(NULLIF(ai_model, ''), 'Unknown model'), ' | ', COALESCE(NULLIF(prompt_version, ''), 'Unknown prompt'))
      HAVING COUNT(*) >= ${aiInsightSampleFloor}
      ORDER BY COUNT(*) DESC, SUM(pnl) DESC
      LIMIT 8
    `, dc.params),

    query<{ bucket: string; wins: string; total: string; pnl: string; total_staked: string }>(`
      SELECT
        COALESCE(NULLIF(decision_context->>'prematchStrength', ''), 'unknown') AS bucket,
        COUNT(*) FILTER (WHERE ${DIRECTIONAL_WIN_RESULT_SQL})::text AS wins,
        COUNT(*)::text AS total,
        COALESCE(SUM(pnl), 0)::text AS pnl,
        COALESCE(SUM(COALESCE(stake_percent, 1)), 0)::text AS total_staked
      FROM recommendations r
      WHERE ${NOT_DUP} AND ${DIRECTIONAL_RESULT_SQL} AND ${dc.clause}
      GROUP BY COALESCE(NULLIF(decision_context->>'prematchStrength', ''), 'unknown')
      HAVING COUNT(*) >= ${aiInsightSampleFloor}
      ORDER BY COUNT(*) DESC, SUM(pnl) DESC
    `, dc.params),

    query<{ bucket: string; wins: string; total: string; pnl: string; total_staked: string }>(`
      SELECT
        COALESCE(NULLIF(decision_context->>'profileCoverageBand', ''), 'unknown') AS bucket,
        COUNT(*) FILTER (WHERE ${DIRECTIONAL_WIN_RESULT_SQL})::text AS wins,
        COUNT(*)::text AS total,
        COALESCE(SUM(pnl), 0)::text AS pnl,
        COALESCE(SUM(COALESCE(stake_percent, 1)), 0)::text AS total_staked
      FROM recommendations r
      WHERE ${NOT_DUP} AND ${DIRECTIONAL_RESULT_SQL} AND ${dc.clause}
      GROUP BY COALESCE(NULLIF(decision_context->>'profileCoverageBand', ''), 'unknown')
      HAVING COUNT(*) >= ${aiInsightSampleFloor}
      ORDER BY COUNT(*) DESC, SUM(pnl) DESC
    `, dc.params),

    query<{ bucket: string; wins: string; total: string; pnl: string; total_staked: string }>(`
      SELECT
        COALESCE(NULLIF(decision_context->>'profileScopeBand', ''), 'unknown') AS bucket,
        COUNT(*) FILTER (WHERE ${DIRECTIONAL_WIN_RESULT_SQL})::text AS wins,
        COUNT(*)::text AS total,
        COALESCE(SUM(pnl), 0)::text AS pnl,
        COALESCE(SUM(COALESCE(stake_percent, 1)), 0)::text AS total_staked
      FROM recommendations r
      WHERE ${NOT_DUP} AND ${DIRECTIONAL_RESULT_SQL} AND ${dc.clause}
      GROUP BY COALESCE(NULLIF(decision_context->>'profileScopeBand', ''), 'unknown')
      HAVING COUNT(*) >= ${aiInsightSampleFloor}
      ORDER BY COUNT(*) DESC, SUM(pnl) DESC
    `, dc.params),

    query<{ bucket: string; wins: string; total: string; pnl: string; total_staked: string }>(`
      SELECT
        COALESCE(NULLIF(decision_context->>'overlayCoverageBand', ''), 'unknown') AS bucket,
        COUNT(*) FILTER (WHERE ${DIRECTIONAL_WIN_RESULT_SQL})::text AS wins,
        COUNT(*)::text AS total,
        COALESCE(SUM(pnl), 0)::text AS pnl,
        COALESCE(SUM(COALESCE(stake_percent, 1)), 0)::text AS total_staked
      FROM recommendations r
      WHERE ${NOT_DUP} AND ${DIRECTIONAL_RESULT_SQL} AND ${dc.clause}
      GROUP BY COALESCE(NULLIF(decision_context->>'overlayCoverageBand', ''), 'unknown')
      HAVING COUNT(*) >= ${aiInsightSampleFloor}
      ORDER BY COUNT(*) DESC, SUM(pnl) DESC
    `, dc.params),

    query<{ bucket: string; wins: string; total: string; pnl: string; total_staked: string }>(`
      SELECT
        COALESCE(NULLIF(decision_context->>'policyImpactBand', ''), 'unknown') AS bucket,
        COUNT(*) FILTER (WHERE ${DIRECTIONAL_WIN_RESULT_SQL})::text AS wins,
        COUNT(*)::text AS total,
        COALESCE(SUM(pnl), 0)::text AS pnl,
        COALESCE(SUM(COALESCE(stake_percent, 1)), 0)::text AS total_staked
      FROM recommendations r
      WHERE ${NOT_DUP} AND ${DIRECTIONAL_RESULT_SQL} AND ${dc.clause}
      GROUP BY COALESCE(NULLIF(decision_context->>'policyImpactBand', ''), 'unknown')
      HAVING COUNT(*) >= ${aiInsightSampleFloor}
      ORDER BY COUNT(*) DESC, SUM(pnl) DESC
    `, dc.params),

    query<{ total: string; under_count: string }>(`
      SELECT
        COUNT(*)::text AS total,
        COUNT(*) FILTER (WHERE ${underGoalsCondition})::text AS under_count
      FROM recommendations r
      WHERE ${NOT_DUP} AND ${dc.clause}
    `, dc.params),

    query<{ bucket: string; total: string; under_count: string }>(`
      SELECT
        CASE
          WHEN minute IS NULL THEN 'unknown'
          WHEN minute < 30 THEN '0-29 (1H early)'
          WHEN minute < 45 THEN '30-44 (Pre-HT)'
          WHEN minute < 60 THEN '45-59 (Start 2H)'
          WHEN minute < 75 THEN '60-74 (Mid 2H)'
          ELSE '75+ (Late)'
        END AS bucket,
        COUNT(*)::text AS total,
        COUNT(*) FILTER (WHERE ${underGoalsCondition})::text AS under_count
      FROM recommendations r
      WHERE ${NOT_DUP} AND ${dc.clause}
      GROUP BY 1
      HAVING COUNT(*) >= ${aiInsightSampleFloor}
      ORDER BY COUNT(*) FILTER (WHERE ${underGoalsCondition}) DESC, COUNT(*) DESC
    `, dc.params),

    query<{ bucket: string; total: string; under_count: string }>(`
      WITH base AS (
        SELECT
          r.*,
          regexp_replace(COALESCE(r.score, ''), '\\s', '', 'g') AS normalized_score
        FROM recommendations r
        WHERE ${NOT_DUP} AND ${dc.clause}
      ),
      scored AS (
        SELECT
          *,
          CASE
            WHEN normalized_score ~ '^\\d+[-:]\\d+$'
              THEN split_part(replace(normalized_score, ':', '-'), '-', 1)::int
            ELSE NULL
          END AS home_goals,
          CASE
            WHEN normalized_score ~ '^\\d+[-:]\\d+$'
              THEN split_part(replace(normalized_score, ':', '-'), '-', 2)::int
            ELSE NULL
          END AS away_goals
        FROM base
      )
      SELECT
        CASE
          WHEN home_goals IS NULL OR away_goals IS NULL THEN 'unknown'
          WHEN home_goals = 0 AND away_goals = 0 THEN '0-0'
          WHEN home_goals = away_goals THEN 'level (scored draw)'
          WHEN ABS(home_goals - away_goals) = 1 THEN 'one-goal margin'
          ELSE 'multi-goal margin'
        END AS bucket,
        COUNT(*)::text AS total,
        COUNT(*) FILTER (WHERE COALESCE(NULLIF(bet_market, ''), '') LIKE 'under_%')::text AS under_count
      FROM scored
      GROUP BY 1
      HAVING COUNT(*) >= ${aiInsightSampleFloor}
      ORDER BY COUNT(*) FILTER (WHERE COALESCE(NULLIF(bet_market, ''), '') LIKE 'under_%') DESC, COUNT(*) DESC
    `, dc.params),

    query<{ bucket: string; total: string; under_count: string }>(`
      SELECT
        COALESCE(NULLIF(decision_context->>'evidenceMode', ''), 'unknown') AS bucket,
        COUNT(*)::text AS total,
        COUNT(*) FILTER (WHERE ${underGoalsCondition})::text AS under_count
      FROM recommendations r
      WHERE ${NOT_DUP} AND ${dc.clause}
      GROUP BY COALESCE(NULLIF(decision_context->>'evidenceMode', ''), 'unknown')
      HAVING COUNT(*) >= ${aiInsightSampleFloor}
      ORDER BY COUNT(*) FILTER (WHERE ${underGoalsCondition}) DESC, COUNT(*) DESC
    `, dc.params),

    query<{ bucket: string; total: string; under_count: string }>(`
      SELECT
        COALESCE(NULLIF(decision_context->>'prematchStrength', ''), 'unknown') AS bucket,
        COUNT(*)::text AS total,
        COUNT(*) FILTER (WHERE ${underGoalsCondition})::text AS under_count
      FROM recommendations r
      WHERE ${NOT_DUP} AND ${dc.clause}
      GROUP BY COALESCE(NULLIF(decision_context->>'prematchStrength', ''), 'unknown')
      HAVING COUNT(*) >= ${aiInsightSampleFloor}
      ORDER BY COUNT(*) FILTER (WHERE ${underGoalsCondition}) DESC, COUNT(*) DESC
    `, dc.params),
  ]);

  // Process leagues
  const leagues = leagueRows.rows.map((r) => ({
    league: r.league,
    winRate: directionalRate(Number(r.wins), Number(r.total) - Number(r.wins)),
    pnl: Math.round(Number(r.pnl) * 100) / 100,
    total: Number(r.total),
  }));

  // Process markets
  const markets = marketRows.rows.map((r) => ({
    market: r.market,
    winRate: directionalRate(Number(r.wins), Number(r.total) - Number(r.wins)),
    pnl: Math.round(Number(r.pnl) * 100) / 100,
    total: Number(r.total),
  }));

  // Process minute bands
  const minutes = minuteRows.rows.map((r) => ({
    band: r.band,
    winRate: directionalRate(Number(r.wins), Number(r.total) - Number(r.wins)),
    pnl: Math.round(Number(r.pnl) * 100) / 100,
    total: Number(r.total),
  }));

  // Confidence calibration gaps
  const overconfidentBands = confRows.rows
    .map((r) => {
      const avgConf = Number(r.avg_conf);
      const actualWR = directionalRate(Number(r.wins), Number(r.total) - Number(r.wins));
      return {
        band: r.band,
        avgConfidence: Math.round(avgConf * 10) / 10,
        actualWinRate: actualWR,
        gap: Math.round((avgConf * 10 - actualWR) * 10) / 10,
      };
    })
    .filter((b) => b.gap > 10); // only report significant gaps

  // Trend
  const recentWR = Number(recentTrendRes.rows[0]?.recent_wr ?? 0);
  const overallWR = Number(overallTrendRes.rows[0]?.overall_wr ?? 0);
  const trend: 'improving' | 'declining' | 'stable' =
    recentWR > overallWR + 5 ? 'improving' : recentWR < overallWR - 5 ? 'declining' : 'stable';

  // Streak
  let streakType: 'win' | 'loss' = 'win';
  let streakCount = 0;
  if (streakRes.rows.length > 0) {
    streakType = streakRes.rows[0]!.result as 'win' | 'loss';
    for (const row of streakRes.rows) {
      if (row.result === streakType) streakCount++;
      else break;
    }
  }

  // Value & safe
  const valueWins = Number(valueRes.rows[0]?.wins ?? 0);
  const safeTotal = Number(safeRes.rows[0]?.total ?? 0);
  const safeWins = Number(safeRes.rows[0]?.wins ?? 0);
  const settledAnalyticsRows = analyticsRows.filter((row) => row.result !== '' && row.result != null);

  const mapCohorts = (rows: Array<{ bucket?: string; cohort?: string; wins: string; total: string; pnl: string; total_staked: string }>) =>
    rows.map((row) => {
      const wins = Number(row.wins);
      const total = Number(row.total);
      const losses = Math.max(total - wins, 0);
      const pnl = Math.round(Number(row.pnl) * 100) / 100;
      const totalStaked = Number(row.total_staked);
      return {
        bucket: row.bucket,
        cohort: row.cohort,
        total,
        winRate: directionalRate(wins, losses),
        pnl,
        roi: totalStaked > 0 ? Math.round((pnl / totalStaked) * 10000) / 100 : 0,
      };
    });

  const mapUnderBiasRows = (rows: Array<{ bucket: string; total: string; under_count: string }>) =>
    rows.map((row) => {
      const total = Number(row.total);
      const underCount = Number(row.under_count);
      return {
        bucket: row.bucket,
        total,
        underCount,
        underShare: total > 0 ? Math.round((underCount / total) * 10000) / 100 : 0,
      };
    });

  const underTotal = Number(underBiasSummaryRow.rows[0]?.total ?? 0);
  const underCount = Number(underBiasSummaryRow.rows[0]?.under_count ?? 0);

  return {
    strongLeagues: leagues.filter((l) => l.pnl > 0).slice(0, 5),
    weakLeagues: leagues.filter((l) => l.pnl < 0).slice(-5).reverse(),
    strongMarkets: markets.filter((m) => m.pnl > 0).slice(0, 5),
    weakMarkets: markets.filter((m) => m.pnl < 0).slice(-5).reverse(),
    bestTimeSlots: minutes.filter((m) => m.pnl > 0).slice(0, 3),
    worstTimeSlots: minutes.filter((m) => m.pnl < 0).slice(-3).reverse(),
    overconfidentBands,
    marketFamilies: summarizeMarketFamilyPerformance(settledAnalyticsRows),
    lateEntries: summarizeLateEntryPerformance(settledAnalyticsRows),
    sampleFloor: aiInsightSampleFloor,
    recentTrend: trend,
    recentWinRate: recentWR,
    overallWinRate: overallWR,
    streakInfo: { type: streakType, count: streakCount },
    valueFinds: valueWins,
    safeBetAccuracy: safeTotal > 0 ? Math.round((safeWins / safeTotal) * 10000) / 100 : 0,
    modelPromptCohorts: mapCohorts(modelPromptRows.rows).map((row) => ({
      cohort: row.cohort ?? 'Unknown',
      total: row.total,
      winRate: row.winRate,
      pnl: row.pnl,
      roi: row.roi,
    })),
    prematchStrengthCohorts: mapCohorts(prematchStrengthRows.rows).map((row) => ({
      bucket: row.bucket ?? 'unknown',
      total: row.total,
      winRate: row.winRate,
      pnl: row.pnl,
      roi: row.roi,
    })),
    profileCoverageCohorts: mapCohorts(profileCoverageRows.rows).map((row) => ({
      bucket: row.bucket ?? 'unknown',
      total: row.total,
      winRate: row.winRate,
      pnl: row.pnl,
      roi: row.roi,
    })),
    profileScopeCohorts: mapCohorts(profileScopeRows.rows).map((row) => ({
      bucket: row.bucket ?? 'unknown',
      total: row.total,
      winRate: row.winRate,
      pnl: row.pnl,
      roi: row.roi,
    })),
    overlayCoverageCohorts: mapCohorts(overlayCoverageRows.rows).map((row) => ({
      bucket: row.bucket ?? 'unknown',
      total: row.total,
      winRate: row.winRate,
      pnl: row.pnl,
      roi: row.roi,
    })),
    policyImpactCohorts: mapCohorts(policyImpactRows.rows).map((row) => ({
      bucket: row.bucket ?? 'unknown',
      total: row.total,
      winRate: row.winRate,
      pnl: row.pnl,
      roi: row.roi,
    })),
    underBiasSummary: {
      total: underTotal,
      underCount,
      nonUnderCount: Math.max(underTotal - underCount, 0),
      underShare: underTotal > 0 ? Math.round((underCount / underTotal) * 10000) / 100 : 0,
    },
    underBiasMinuteBands: mapUnderBiasRows(underBiasMinuteRows.rows),
    underBiasScoreStates: mapUnderBiasRows(underBiasScoreRows.rows),
    underBiasEvidenceModes: mapUnderBiasRows(underBiasEvidenceRows.rows),
    underBiasPrematchStrengths: mapUnderBiasRows(underBiasPrematchRows.rows),
  };
}
