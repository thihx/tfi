// ============================================================
// Bets Repository — User betting decisions
// ============================================================

import { query, transaction } from '../db/pool.js';
import {
  FINAL_SETTLEMENT_RESULTS_SQL,
  isFinalSettlementResult,
  type SettlementPersistenceMeta,
} from '../lib/settle-types.js';
import {
  calculateSettlementPnlAmount,
  calculateStakeAmount,
} from './bankroll.repo.js';

const FINAL_RESULT_SQL = `result IN (${FINAL_SETTLEMENT_RESULTS_SQL})`;
const PENDING_RESULT_SQL = `(result IS NULL OR result = '' OR result NOT IN (${FINAL_SETTLEMENT_RESULTS_SQL}))`;

export interface BetRow {
  id: number;
  user_id?: string | null;
  recommendation_id: number | null;
  delivery_id?: number | null;
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

export interface InvestFromRecommendationInput {
  userId: string;
  recommendationId: number;
  deliveryId?: number | null;
  odds?: number | null;
  stakePercent?: number | null;
  stakeAmount?: number | null;
  bookmaker?: string | null;
}

function toMoney(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.round(parsed * 100) / 100;
}

function mapBet(row: BetRow): BetRow {
  return {
    ...row,
    id: Number(row.id),
    recommendation_id: row.recommendation_id == null ? null : Number(row.recommendation_id),
    delivery_id: row.delivery_id == null ? null : Number(row.delivery_id),
    odds: Number(row.odds ?? 0),
    stake_percent: Number(row.stake_percent ?? 0),
    stake_amount: row.stake_amount == null ? null : Number(row.stake_amount),
    match_minute: row.match_minute == null ? null : Number(row.match_minute),
    pnl: Number(row.pnl ?? 0),
  };
}

function calculateSettlementReturnAmount(args: {
  result: string;
  odds: number;
  stakeAmount: number;
}): number {
  const stake = toMoney(args.stakeAmount);
  const odds = Number(args.odds ?? 0);
  if (stake <= 0) return 0;
  switch (args.result) {
    case 'win':
      return Number.isFinite(odds) && odds > 1 ? toMoney(stake * odds) : stake;
    case 'half_win':
      return Number.isFinite(odds) && odds > 1 ? toMoney(stake + (stake * (odds - 1)) / 2) : stake;
    case 'half_loss':
      return toMoney(stake / 2);
    case 'push':
    case 'void':
      return stake;
    case 'loss':
    default:
      return 0;
  }
}

// ── Queries ───────────────────────────────────────────────

export async function getAllBets(opts: { limit?: number; offset?: number; userId?: string | null } = {}): Promise<{
  rows: BetRow[];
  total: number;
}> {
  const limit = opts.limit ?? 50;
  const offset = opts.offset ?? 0;
  const userFilter = opts.userId ? 'WHERE user_id = $3::uuid' : '';
  const params = opts.userId ? [limit, offset, opts.userId] : [limit, offset];
  const countParams = opts.userId ? [opts.userId] : [];

  const [data, countRes] = await Promise.all([
    query<BetRow>(`SELECT * FROM bets ${userFilter} ORDER BY placed_at DESC LIMIT $1 OFFSET $2`, params),
    query<{ count: string }>(
      `SELECT COUNT(*)::text as count FROM bets ${opts.userId ? 'WHERE user_id = $1::uuid' : ''}`,
      countParams,
    ),
  ]);

  return { rows: data.rows.map(mapBet), total: Number(countRes.rows[0]?.count ?? 0) };
}

export async function getBetsByMatchId(matchId: string, userId?: string | null): Promise<BetRow[]> {
  const r = await query<BetRow>(
    `SELECT * FROM bets
      WHERE match_id = $1
        ${userId ? 'AND user_id = $2::uuid' : ''}
      ORDER BY placed_at DESC`,
    userId ? [matchId, userId] : [matchId],
  );
  return r.rows.map(mapBet);
}

export async function getUnsettledBets(): Promise<BetRow[]> {
  const r = await query<BetRow>(
    `SELECT *
       FROM bets
      WHERE ${PENDING_RESULT_SQL}
        AND COALESCE(settlement_status, 'pending') <> 'unresolved'
      ORDER BY placed_at`,
  );
  return r.rows;
}

export async function createBet(bet: Partial<BetCreate>): Promise<BetRow> {
  const r = await query<BetRow>(
    `INSERT INTO bets (
       user_id, recommendation_id, delivery_id, match_id, bet_market, selection, odds,
       stake_percent, stake_amount, bookmaker,
       match_minute, match_score, match_status,
       result, pnl, settled_at, settled_by, final_score,
       settlement_status, settlement_method, settle_prompt_version, settlement_note,
       notes, created_by
     ) VALUES ($1::uuid,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24)
     RETURNING *`,
    [
      bet.user_id ?? null,
      bet.recommendation_id ?? null,
      bet.delivery_id ?? null,
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
  return mapBet(r.rows[0]!);
}

export async function createBetWithBankrollStake(bet: Partial<BetCreate> & { user_id: string }): Promise<BetRow> {
  return transaction(async (client) => {
    const account = await client.query<{
      user_id: string;
      currency: string;
      current_balance: string;
    }>(
      `INSERT INTO user_bankroll_accounts (user_id)
       VALUES ($1::uuid)
       ON CONFLICT (user_id) DO UPDATE SET updated_at = user_bankroll_accounts.updated_at
       RETURNING user_id::text, currency, current_balance::text`,
      [bet.user_id],
    );
    const accountRow = account.rows[0];
    const balanceBefore = toMoney(accountRow?.current_balance, 1000);
    const stakeAmount = toMoney(bet.stake_amount ?? 0);
    if (stakeAmount <= 0) {
      throw new Error('Stake amount must be greater than 0');
    }
    if (stakeAmount > balanceBefore) {
      throw new Error('Stake amount exceeds current bankroll');
    }
    const stakePercent = Number(bet.stake_percent ?? 0);
    const effectiveStakePercent = Number.isFinite(stakePercent) && stakePercent > 0
      ? toMoney(stakePercent)
      : balanceBefore > 0
        ? toMoney((stakeAmount / balanceBefore) * 100)
        : 0;

    const inserted = await client.query<BetRow>(
      `INSERT INTO bets (
         user_id, recommendation_id, delivery_id, match_id, bet_market, selection, odds,
         stake_percent, stake_amount, bookmaker,
         match_minute, match_score, match_status,
         result, pnl, settled_at, settled_by, final_score,
         settlement_status, settlement_method, settle_prompt_version, settlement_note,
         notes, created_by
       ) VALUES ($1::uuid,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24)
       RETURNING *`,
      [
        bet.user_id,
        bet.recommendation_id ?? null,
        bet.delivery_id ?? null,
        bet.match_id,
        bet.bet_market ?? '',
        bet.selection ?? '',
        bet.odds ?? 0,
        effectiveStakePercent,
        stakeAmount,
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
        bet.created_by ?? bet.user_id,
      ],
    );
    const insertedBet = inserted.rows[0]!;
    const balanceAfter = toMoney(balanceBefore - stakeAmount);
    await client.query(
      `UPDATE user_bankroll_accounts
          SET current_balance = $2,
              updated_at = NOW()
        WHERE user_id = $1::uuid`,
      [bet.user_id, balanceAfter],
    );
    await client.query(
      `INSERT INTO user_bankroll_ledger (
         user_id, recommendation_id, delivery_id, bet_id, entry_type, amount,
         balance_before, balance_after, currency, note, metadata
       ) VALUES (
         $1::uuid, $2, $3, $4, 'bet_stake', $5,
         $6, $7, $8, $9, $10::jsonb
       )`,
      [
        bet.user_id,
        bet.recommendation_id ?? null,
        bet.delivery_id ?? null,
        insertedBet.id,
        -stakeAmount,
        balanceBefore,
        balanceAfter,
        accountRow?.currency ?? 'VND',
        'Manual investment logged',
        JSON.stringify({
          odds: bet.odds ?? 0,
          stakePercent: effectiveStakePercent,
          stakeAmount,
          selection: bet.selection ?? '',
          betMarket: bet.bet_market ?? '',
        }),
      ],
    );
    return mapBet(insertedBet);
  });
}

export async function investFromRecommendation(input: InvestFromRecommendationInput): Promise<BetRow> {
  return transaction(async (client) => {
    const existing = await client.query<BetRow>(
      `SELECT * FROM bets
        WHERE user_id = $1::uuid
          AND recommendation_id = $2
        LIMIT 1`,
      [input.userId, input.recommendationId],
    );
    if (existing.rows[0]) {
      throw new Error('You already invested in this recommendation');
    }

    const recResult = await client.query<{
      id: number;
      match_id: string;
      status: string;
      minute: number | null;
      score: string | null;
      selection: string;
      bet_market: string;
      odds: string | null;
      stake_percent: string | null;
      result: string | null;
      settlement_status: string | null;
    }>(
      `SELECT id, match_id, status, minute, score, selection, bet_market, odds::text,
              stake_percent::text, result, settlement_status
         FROM recommendations
        WHERE id = $1
          AND bet_type IS DISTINCT FROM 'NO_BET'`,
      [input.recommendationId],
    );
    const rec = recResult.rows[0];
    if (!rec) throw new Error('Recommendation not found');
    if (rec.result && isFinalSettlementResult(rec.result)) {
      throw new Error('Recommendation is already settled');
    }

    const account = await client.query<{
      user_id: string;
      currency: string;
      current_balance: string;
    }>(
      `INSERT INTO user_bankroll_accounts (user_id)
       VALUES ($1::uuid)
       ON CONFLICT (user_id) DO UPDATE SET updated_at = user_bankroll_accounts.updated_at
       RETURNING user_id::text, currency, current_balance::text`,
      [input.userId],
    );
    const accountRow = account.rows[0];
    const balanceBefore = toMoney(accountRow?.current_balance, 1000);
    const odds = Number(input.odds ?? rec.odds ?? 0);
    if (!Number.isFinite(odds) || odds <= 1) throw new Error('Odds must be above 1.00');

    const stakePercent = Number(input.stakePercent ?? rec.stake_percent ?? 0);
    const requestedStakeAmount = input.stakeAmount == null ? null : toMoney(input.stakeAmount);
    const stakeAmount = requestedStakeAmount != null && requestedStakeAmount > 0
      ? requestedStakeAmount
      : calculateStakeAmount(balanceBefore, stakePercent);
    if (!Number.isFinite(stakeAmount) || stakeAmount <= 0) {
      throw new Error('Stake amount must be greater than 0');
    }
    if (stakeAmount > balanceBefore) {
      throw new Error('Stake amount exceeds current bankroll');
    }
    const effectiveStakePercent = stakePercent > 0
      ? stakePercent
      : balanceBefore > 0
        ? toMoney((stakeAmount / balanceBefore) * 100)
        : 0;

    const inserted = await client.query<BetRow>(
      `INSERT INTO bets (
         user_id, recommendation_id, delivery_id, match_id, bet_market, selection, odds,
         stake_percent, stake_amount, bookmaker,
         match_minute, match_score, match_status,
         result, pnl, settled_at, settled_by, final_score,
         settlement_status, settlement_method, settle_prompt_version, settlement_note,
         notes, created_by
       ) VALUES (
         $1::uuid, $2, $3, $4, $5, $6, $7,
         $8, $9, $10,
         $11, $12, $13,
         '', 0, NULL, '', '',
         'pending', '', '', '',
         $14, $15
       )
       RETURNING *`,
      [
        input.userId,
        input.recommendationId,
        input.deliveryId ?? null,
        rec.match_id,
        rec.bet_market,
        rec.selection,
        odds,
        effectiveStakePercent,
        stakeAmount,
        input.bookmaker?.trim() || '',
        rec.minute,
        rec.score ?? '',
        rec.status ?? '',
        'Invested from recommendation',
        input.userId,
      ],
    );
    const bet = inserted.rows[0]!;
    const balanceAfter = toMoney(balanceBefore - stakeAmount);
    await client.query(
      `UPDATE user_bankroll_accounts
          SET current_balance = $2,
              updated_at = NOW()
        WHERE user_id = $1::uuid`,
      [input.userId, balanceAfter],
    );
    await client.query(
      `INSERT INTO user_bankroll_ledger (
         user_id, recommendation_id, delivery_id, bet_id, entry_type, amount,
         balance_before, balance_after, currency, note, metadata
       ) VALUES (
         $1::uuid, $2, $3, $4, 'bet_stake', $5,
         $6, $7, $8, $9, $10::jsonb
       )`,
      [
        input.userId,
        input.recommendationId,
        input.deliveryId ?? null,
        bet.id,
        -stakeAmount,
        balanceBefore,
        balanceAfter,
        accountRow?.currency ?? 'VND',
        'Invested from recommendation',
        JSON.stringify({
          odds,
          stakePercent: effectiveStakePercent,
          stakeAmount,
          selection: rec.selection,
          betMarket: rec.bet_market,
        }),
      ],
    );
    return mapBet(bet);
  });
}

export async function settleBet(
  id: number,
  result: string,
  pnl: number,
  finalScore: string,
  settledBy: 'auto' | 'manual' = 'manual',
  meta: SettlementPersistenceMeta = {},
): Promise<BetRow | null> {
  return transaction(async (client) => {
    const existing = await client.query<BetRow>(
      `SELECT * FROM bets WHERE id = $1 FOR UPDATE`,
      [id],
    );
    const current = existing.rows[0];
    if (!current) return null;
    if (current.result && isFinalSettlementResult(current.result)) return null;

    const stakeAmount = current.stake_amount == null ? null : toMoney(current.stake_amount);
    const effectivePnl = stakeAmount != null && stakeAmount > 0 && isFinalSettlementResult(result)
      ? calculateSettlementPnlAmount({ result, odds: current.odds, stakeAmount })
      : pnl;

    const updated = await client.query<BetRow>(
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
       WHERE id = $1
       RETURNING *`,
      [
        id,
        result,
        effectivePnl,
        finalScore,
        settledBy,
        meta.status ?? 'resolved',
        meta.method ?? '',
        meta.settlePromptVersion ?? '',
        meta.note ?? finalScore,
      ],
    );
    const bet = updated.rows[0];
    if (!bet?.user_id || stakeAmount == null || stakeAmount <= 0 || !isFinalSettlementResult(result)) {
      return bet ? mapBet(bet) : null;
    }

    const account = await client.query<{
      currency: string;
      current_balance: string;
    }>(
      `INSERT INTO user_bankroll_accounts (user_id)
       VALUES ($1::uuid)
       ON CONFLICT (user_id) DO UPDATE SET updated_at = user_bankroll_accounts.updated_at
       RETURNING currency, current_balance::text`,
      [bet.user_id],
    );
    const accountRow = account.rows[0];
    const payoutAmount = calculateSettlementReturnAmount({
      result,
      odds: bet.odds,
      stakeAmount,
    });
    const previous = await client.query<{ amount: string | null }>(
      `SELECT amount::text
         FROM user_bankroll_ledger
        WHERE user_id = $1::uuid
          AND bet_id = $2
          AND entry_type = 'bet_payout'
        LIMIT 1`,
      [bet.user_id, bet.id],
    );
    const previousPayout = toMoney(previous.rows[0]?.amount);
    const delta = toMoney(payoutAmount - previousPayout);
    const balanceBefore = toMoney(accountRow?.current_balance);
    const balanceAfter = toMoney(balanceBefore + delta);
    if (delta !== 0 || previous.rows.length === 0) {
      await client.query(
        `UPDATE user_bankroll_accounts
            SET current_balance = $2,
                updated_at = NOW()
          WHERE user_id = $1::uuid`,
        [bet.user_id, balanceAfter],
      );
      await client.query(
        `INSERT INTO user_bankroll_ledger (
           user_id, recommendation_id, delivery_id, bet_id, entry_type, amount,
           balance_before, balance_after, currency, note, metadata
         ) VALUES (
           $1::uuid, $2, $3, $4, 'bet_payout', $5,
           $6, $7, $8, $9, $10::jsonb
         )
         ON CONFLICT (user_id, bet_id, entry_type)
         WHERE bet_id IS NOT NULL AND entry_type IN ('bet_stake', 'bet_payout')
         DO UPDATE SET
           recommendation_id = EXCLUDED.recommendation_id,
           delivery_id = EXCLUDED.delivery_id,
           amount = EXCLUDED.amount,
           balance_before = EXCLUDED.balance_before,
           balance_after = EXCLUDED.balance_after,
           currency = EXCLUDED.currency,
           note = EXCLUDED.note,
           metadata = EXCLUDED.metadata,
           created_at = NOW()`,
        [
          bet.user_id,
          bet.recommendation_id ?? null,
          bet.delivery_id ?? null,
          bet.id,
          payoutAmount,
          balanceBefore,
          balanceAfter,
          accountRow?.currency ?? 'VND',
          meta.note ?? `Settlement ${result}`,
          JSON.stringify({
            result,
            odds: bet.odds,
            stakeAmount,
            pnl: effectivePnl,
            previousPayout,
            delta,
          }),
        ],
      );
    }
    return mapBet(bet);
  });
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

export async function getBetStats(userId?: string | null): Promise<BetStats> {
  const userFilter = userId ? 'WHERE user_id = $1::uuid' : '';
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
     FROM bets
     ${userFilter}`,
    userId ? [userId] : [],
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

export async function getBetStatsByMarket(userId?: string | null): Promise<
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
  const userFilter = userId ? 'WHERE user_id = $1::uuid' : '';
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
     ${userFilter}
     GROUP BY bet_market
     ORDER BY COUNT(*) DESC`,
    userId ? [userId] : [],
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
