// ============================================================
// Bets Repository — User betting decisions
// ============================================================

import { query } from '../db/pool.js';
import {
  FINAL_SETTLEMENT_RESULTS_SQL,
  type SettlementPersistenceMeta,
} from '../lib/settle-types.js';

const FINAL_RESULT_SQL = `result IN (${FINAL_SETTLEMENT_RESULTS_SQL})`;
const PENDING_RESULT_SQL = `(result IS NULL OR result = '' OR result NOT IN (${FINAL_SETTLEMENT_RESULTS_SQL}))`;

export interface BetRow {
  id: number;
  recommendation_id: number | null;
  match_id: string;
  placed_at: string;
  bet_market: string;
  selection: string;
  odds: number;
  stake_percent: number;
  stake_amount: number | null;
  bookmaker: string;
  match_minute: number | null;
  match_score: string;
  match_status: string;
  result: string;
  pnl: number;
  settled_at: string | null;
  settled_by: string;
  final_score: string;
  settlement_status?: string;
  settlement_method?: string;
  settle_prompt_version?: string;
  settlement_note?: string;
  notes: string;
  created_by: string;
}

export type BetCreate = Omit<BetRow, 'id' | 'placed_at'>;

// ── Queries ───────────────────────────────────────────────

export async function getAllBets(opts: { limit?: number; offset?: number } = {}): Promise<{
  rows: BetRow[];
  total: number;
}> {
  const limit = opts.limit ?? 50;
  const offset = opts.offset ?? 0;

  const [data, countRes] = await Promise.all([
    query<BetRow>('SELECT * FROM bets ORDER BY placed_at DESC LIMIT $1 OFFSET $2', [
      limit,
      offset,
    ]),
    query<{ count: string }>('SELECT COUNT(*)::text as count FROM bets'),
  ]);

  return { rows: data.rows, total: Number(countRes.rows[0]?.count ?? 0) };
}

export async function getBetsByMatchId(matchId: string): Promise<BetRow[]> {
  const r = await query<BetRow>(
    'SELECT * FROM bets WHERE match_id = $1 ORDER BY placed_at DESC',
    [matchId],
  );
  return r.rows;
}

export async function getUnsettledBets(): Promise<BetRow[]> {
  const r = await query<BetRow>(
    `SELECT * FROM bets WHERE ${PENDING_RESULT_SQL} ORDER BY placed_at`,
  );
  return r.rows;
}

export async function createBet(bet: Partial<BetCreate>): Promise<BetRow> {
  const r = await query<BetRow>(
    `INSERT INTO bets (
       recommendation_id, match_id, bet_market, selection, odds,
       stake_percent, stake_amount, bookmaker,
       match_minute, match_score, match_status,
       result, pnl, settled_at, settled_by, final_score,
       settlement_status, settlement_method, settle_prompt_version, settlement_note,
       notes, created_by
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22)
     RETURNING *`,
    [
      bet.recommendation_id ?? null,
      bet.match_id,
      bet.bet_market ?? '',
      bet.selection ?? '',
      bet.odds ?? 0,
      bet.stake_percent ?? 0,
      bet.stake_amount ?? null,
      bet.bookmaker ?? '',
      bet.match_minute ?? null,
      bet.match_score ?? '',
      bet.match_status ?? '',
      bet.result ?? '',
      bet.pnl ?? 0,
      bet.settled_at ?? null,
      bet.settled_by ?? '',
      bet.final_score ?? '',
      bet.settlement_status ?? 'pending',
      bet.settlement_method ?? '',
      bet.settle_prompt_version ?? '',
      bet.settlement_note ?? '',
      bet.notes ?? '',
      bet.created_by ?? 'system',
    ],
  );
  return r.rows[0]!;
}

export async function settleBet(
  id: number,
  result: string,
  pnl: number,
  finalScore: string,
  settledBy: 'auto' | 'manual' = 'manual',
  meta: SettlementPersistenceMeta = {},
): Promise<BetRow | null> {
  const r = await query<BetRow>(
    `UPDATE bets
     SET result = $2,
         pnl = $3,
         final_score = $4,
         settled_by = $5,
         settled_at = NOW(),
         settlement_status = $6,
         settlement_method = $7,
         settle_prompt_version = $8,
         settlement_note = $9
     WHERE id = $1 AND (result = '' OR result IS NULL) RETURNING *`,
    [
      id,
      result,
      pnl,
      finalScore,
      settledBy,
      meta.status ?? 'resolved',
      meta.method ?? '',
      meta.settlePromptVersion ?? '',
      meta.note ?? finalScore,
    ],
  );
  return r.rows[0] ?? null;
}

export async function markBetUnresolved(
  id: number,
  meta: SettlementPersistenceMeta = {},
): Promise<BetRow | null> {
  const r = await query<BetRow>(
    `UPDATE bets
     SET settlement_status = 'unresolved',
         settlement_method = $2,
         settle_prompt_version = $3,
         settlement_note = $4
     WHERE id = $1 AND (result = '' OR result IS NULL)
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

// ── Stats ─────────────────────────────────────────────────

export interface BetStats {
  total: number;
  won: number;
  lost: number;
  pending: number;
  wins: number;
  losses: number;
  pushes: number;
  unsettled: number;
  total_pnl: number;
  win_rate: number;
  roi: number;
}

export async function getBetStats(): Promise<BetStats> {
  const r = await query<{
    total: string;
    wins: string;
    losses: string;
    pushes: string;
    unsettled: string;
    total_pnl: string;
    total_staked: string;
  }>(
    `SELECT
       COUNT(*)::text AS total,
       COUNT(*) FILTER (WHERE result = 'win')::text AS wins,
       COUNT(*) FILTER (WHERE result = 'loss')::text AS losses,
       COUNT(*) FILTER (WHERE result = 'push')::text AS pushes,
       COUNT(*) FILTER (WHERE ${PENDING_RESULT_SQL})::text AS unsettled,
       COALESCE(SUM(pnl), 0)::text AS total_pnl,
       COALESCE(SUM(stake_amount) FILTER (WHERE ${FINAL_RESULT_SQL}), 0)::text AS total_staked
     FROM bets`,
  );

  const row = r.rows[0]!;
  const total = Number(row.total);
  const wins = Number(row.wins);
  const settled = total - Number(row.unsettled);
  const totalStaked = Number(row.total_staked);

  return {
    total,
    won: wins,
    lost: Number(row.losses),
    pending: Number(row.unsettled),
    wins,
    losses: Number(row.losses),
    pushes: Number(row.pushes),
    unsettled: Number(row.unsettled),
    total_pnl: Number(row.total_pnl),
    win_rate: settled > 0 ? Math.round((wins / settled) * 10000) / 100 : 0,
    roi: totalStaked > 0 ? Math.round((Number(row.total_pnl) / totalStaked) * 10000) / 100 : 0,
  };
}

export async function getBetStatsByMarket(): Promise<
  Array<{
    market: string;
    total: number;
    wins: number;
    losses: number;
    pushes: number;
    unsettled: number;
    total_pnl: number;
    win_rate: number;
    roi: number;
  }>
> {
  const r = await query<{
    market: string;
    total: string;
    wins: string;
    losses: string;
    pushes: string;
    unsettled: string;
    total_pnl: string;
    settled: string;
    total_staked: string;
  }>(
    `SELECT
       bet_market AS market,
       COUNT(*)::text AS total,
       COUNT(*) FILTER (WHERE result = 'win')::text AS wins,
       COUNT(*) FILTER (WHERE result = 'loss')::text AS losses,
       COUNT(*) FILTER (WHERE result = 'push')::text AS pushes,
       COUNT(*) FILTER (WHERE ${PENDING_RESULT_SQL})::text AS unsettled,
       COALESCE(SUM(pnl) FILTER (WHERE ${FINAL_RESULT_SQL}), 0)::text AS total_pnl,
       COUNT(*) FILTER (WHERE ${FINAL_RESULT_SQL})::text AS settled,
       COALESCE(SUM(stake_amount) FILTER (WHERE ${FINAL_RESULT_SQL}), 0)::text AS total_staked
     FROM bets
     GROUP BY bet_market
     ORDER BY COUNT(*) DESC`,
  );

  return r.rows.map((row) => ({
    market: row.market,
    total: Number(row.total),
    wins: Number(row.wins),
    losses: Number(row.losses),
    pushes: Number(row.pushes),
    unsettled: Number(row.unsettled),
    total_pnl: Number(row.total_pnl),
    win_rate:
      Number(row.settled) > 0
        ? Math.round((Number(row.wins) / Number(row.settled)) * 10000) / 100
        : 0,
    roi:
      Number(row.total_staked) > 0
        ? Math.round((Number(row.total_pnl) / Number(row.total_staked)) * 10000) / 100
        : 0,
  }));
}
