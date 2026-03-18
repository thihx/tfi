// ============================================================
// Bets Repository — User betting decisions
// ============================================================

import { query } from '../db/pool.js';

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
    `SELECT * FROM bets WHERE result = '' OR result IS NULL ORDER BY placed_at`,
  );
  return r.rows;
}

export async function createBet(bet: Partial<BetCreate>): Promise<BetRow> {
  const r = await query<BetRow>(
    `INSERT INTO bets (
       recommendation_id, match_id, bet_market, selection, odds,
       stake_percent, stake_amount, bookmaker,
       match_minute, match_score, match_status,
       result, pnl, settled_at, settled_by, final_score, notes, created_by
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
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
): Promise<BetRow | null> {
  const r = await query<BetRow>(
    `UPDATE bets SET result = $2, pnl = $3, final_score = $4, settled_by = $5, settled_at = NOW()
     WHERE id = $1 AND (result = '' OR result IS NULL) RETURNING *`,
    [id, result, pnl, finalScore, settledBy],
  );
  return r.rows[0] ?? null;
}

// ── Stats ─────────────────────────────────────────────────

export interface BetStats {
  total: number;
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
       COUNT(*) FILTER (WHERE result = '' OR result IS NULL)::text AS unsettled,
       COALESCE(SUM(pnl), 0)::text AS total_pnl,
       COALESCE(SUM(stake_amount) FILTER (WHERE result IN ('win','loss','push')), 0)::text AS total_staked
     FROM bets`,
  );

  const row = r.rows[0]!;
  const total = Number(row.total);
  const wins = Number(row.wins);
  const settled = total - Number(row.unsettled);
  const totalStaked = Number(row.total_staked);

  return {
    total,
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
  Array<{ market: string; total: number; wins: number; pnl: number; win_rate: number }>
> {
  const r = await query<{
    market: string;
    total: string;
    wins: string;
    pnl: string;
    settled: string;
  }>(
    `SELECT
       bet_market AS market,
       COUNT(*)::text AS total,
       COUNT(*) FILTER (WHERE result = 'win')::text AS wins,
       COALESCE(SUM(pnl), 0)::text AS pnl,
       COUNT(*) FILTER (WHERE result IN ('win','loss','push'))::text AS settled
     FROM bets
     GROUP BY bet_market
     ORDER BY COUNT(*) DESC`,
  );

  return r.rows.map((row) => ({
    market: row.market,
    total: Number(row.total),
    wins: Number(row.wins),
    pnl: Number(row.pnl),
    win_rate:
      Number(row.settled) > 0
        ? Math.round((Number(row.wins) / Number(row.settled)) * 10000) / 100
        : 0,
  }));
}
