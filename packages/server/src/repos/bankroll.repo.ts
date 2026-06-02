import { query, transaction } from '../db/pool.js';
import type { FinalSettlementResult } from '../lib/settle-types.js';

interface QueryResultRow {
  [column: string]: unknown;
}

interface QueryExecutor {
  query<T extends QueryResultRow = QueryResultRow>(
    text: string,
    params?: unknown[],
  ): Promise<{ rows: T[]; rowCount: number | null }>;
}

export interface BankrollAccountRow {
  user_id: string;
  currency: string;
  unit_multiplier: number;
  initial_balance: number;
  current_balance: number;
  active: boolean;
  created_at: string;
  updated_at: string;
}

export interface BankrollLedgerRow {
  id: number;
  user_id: string;
  recommendation_id: number | null;
  delivery_id: number | null;
  bet_id?: number | null;
  entry_type: string;
  amount: number;
  balance_before: number;
  balance_after: number;
  currency: string;
  note: string;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface BankrollSnapshot {
  account: BankrollAccountRow;
  recentLedger: BankrollLedgerRow[];
}

const DEFAULT_CURRENCY = 'VND';
const DEFAULT_UNIT_MULTIPLIER = 1000;
const DEFAULT_INITIAL_BALANCE = 1000;

function toMoney(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.round(parsed * 100) / 100;
}

function normalizeCurrency(value: unknown): string {
  const raw = typeof value === 'string' ? value.trim().toUpperCase() : '';
  return raw || DEFAULT_CURRENCY;
}

function normalizeUnitMultiplier(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_UNIT_MULTIPLIER;
  return Math.round(parsed);
}

function mapAccount(row: Record<string, unknown>): BankrollAccountRow {
  return {
    user_id: String(row.user_id ?? ''),
    currency: String(row.currency ?? DEFAULT_CURRENCY),
    unit_multiplier: Number(row.unit_multiplier ?? DEFAULT_UNIT_MULTIPLIER),
    initial_balance: toMoney(row.initial_balance, DEFAULT_INITIAL_BALANCE),
    current_balance: toMoney(row.current_balance, DEFAULT_INITIAL_BALANCE),
    active: row.active !== false,
    created_at: String(row.created_at ?? ''),
    updated_at: String(row.updated_at ?? ''),
  };
}

function mapLedger(row: Record<string, unknown>): BankrollLedgerRow {
  return {
    id: Number(row.id ?? 0),
    user_id: String(row.user_id ?? ''),
    recommendation_id: row.recommendation_id == null ? null : Number(row.recommendation_id),
    delivery_id: row.delivery_id == null ? null : Number(row.delivery_id),
    bet_id: row.bet_id == null ? null : Number(row.bet_id),
    entry_type: String(row.entry_type ?? ''),
    amount: toMoney(row.amount),
    balance_before: toMoney(row.balance_before),
    balance_after: toMoney(row.balance_after),
    currency: String(row.currency ?? DEFAULT_CURRENCY),
    note: String(row.note ?? ''),
    metadata: (row.metadata ?? {}) as Record<string, unknown>,
    created_at: String(row.created_at ?? ''),
  };
}

export function calculateStakeAmount(balance: number, stakePercent: number | null | undefined): number {
  const pct = Number(stakePercent ?? 0);
  if (!Number.isFinite(balance) || !Number.isFinite(pct) || balance <= 0 || pct <= 0) return 0;
  return Math.round((balance * pct / 100) * 100) / 100;
}

export function calculateSettlementPnlAmount(args: {
  result: FinalSettlementResult | string;
  odds: number | null | undefined;
  stakeAmount: number;
}): number {
  const stake = toMoney(args.stakeAmount);
  const odds = Number(args.odds ?? 0);
  if (stake <= 0) return 0;
  switch (args.result) {
    case 'win':
      return Number.isFinite(odds) && odds > 1 ? toMoney(stake * (odds - 1)) : 0;
    case 'loss':
      return -stake;
    case 'half_win':
      return Number.isFinite(odds) && odds > 1 ? toMoney((stake * (odds - 1)) / 2) : 0;
    case 'half_loss':
      return toMoney(-stake / 2);
    case 'push':
    case 'void':
    default:
      return 0;
  }
}

export async function ensureUserBankroll(userId: string): Promise<BankrollAccountRow> {
  const result = await query<BankrollAccountRow>(
    `INSERT INTO user_bankroll_accounts (user_id)
     VALUES ($1::uuid)
     ON CONFLICT (user_id) DO UPDATE SET updated_at = user_bankroll_accounts.updated_at
     RETURNING *`,
    [userId],
  );
  return mapAccount((result.rows[0] ?? { user_id: userId }) as unknown as Record<string, unknown>);
}

export async function getUserBankroll(userId: string): Promise<BankrollSnapshot> {
  const account = await ensureUserBankroll(userId);
  const ledger = await query<BankrollLedgerRow>(
    `SELECT *
       FROM user_bankroll_ledger
      WHERE user_id = $1::uuid
      ORDER BY created_at DESC, id DESC
      LIMIT 20`,
    [userId],
  );
  return {
    account,
    recentLedger: ledger.rows.map((row) => mapLedger(row as unknown as Record<string, unknown>)),
  };
}

export async function resetUserBankroll(
  userId: string,
  input: { balance: number; currency?: string; unitMultiplier?: number; note?: string },
): Promise<BankrollSnapshot> {
  const nextBalance = Math.max(0, toMoney(input.balance, DEFAULT_INITIAL_BALANCE));
  const currency = normalizeCurrency(input.currency);
  const unitMultiplier = normalizeUnitMultiplier(input.unitMultiplier);
  await transaction(async (client) => {
    const existing = await client.query<BankrollAccountRow>(
      `INSERT INTO user_bankroll_accounts (user_id, currency, unit_multiplier, initial_balance, current_balance)
       VALUES ($1::uuid, $2, $3, $4, $4)
       ON CONFLICT (user_id) DO UPDATE SET updated_at = user_bankroll_accounts.updated_at
       RETURNING *`,
      [userId, currency, unitMultiplier, nextBalance],
    );
    const before = toMoney(existing.rows[0]?.current_balance, DEFAULT_INITIAL_BALANCE);
    await client.query(
      `UPDATE user_bankroll_accounts
          SET currency = $2,
              unit_multiplier = $3,
              initial_balance = $4,
              current_balance = $4,
              active = TRUE,
              updated_at = NOW()
        WHERE user_id = $1::uuid`,
      [userId, currency, unitMultiplier, nextBalance],
    );
    await client.query(
      `INSERT INTO user_bankroll_ledger (
         user_id, entry_type, amount, balance_before, balance_after, currency, note, metadata
       ) VALUES (
         $1::uuid, 'reset', $2, $3, $4, $5, $6, '{}'::jsonb
       )`,
      [userId, toMoney(nextBalance - before), before, nextBalance, currency, input.note ?? 'Bankroll reset'],
    );
  });
  return getUserBankroll(userId);
}

export async function addUserBankrollFunds(
  userId: string,
  input: { amount: number; note?: string },
): Promise<BankrollSnapshot> {
  const amount = toMoney(input.amount);
  if (amount <= 0) throw new Error('Amount must be greater than 0');
  await transaction(async (client) => {
    const account = await client.query<BankrollAccountRow>(
      `INSERT INTO user_bankroll_accounts (user_id)
       VALUES ($1::uuid)
       ON CONFLICT (user_id) DO UPDATE SET updated_at = user_bankroll_accounts.updated_at
       RETURNING *`,
      [userId],
    );
    const before = toMoney(account.rows[0]?.current_balance, DEFAULT_INITIAL_BALANCE);
    const after = toMoney(before + amount);
    const currency = String(account.rows[0]?.currency ?? DEFAULT_CURRENCY);
    await client.query(
      `UPDATE user_bankroll_accounts
          SET current_balance = $2,
              updated_at = NOW()
        WHERE user_id = $1::uuid`,
      [userId, after],
    );
    await client.query(
      `INSERT INTO user_bankroll_ledger (
         user_id, entry_type, amount, balance_before, balance_after, currency, note, metadata
       ) VALUES (
         $1::uuid, 'deposit', $2, $3, $4, $5, $6, '{}'::jsonb
       )`,
      [userId, amount, before, after, currency, input.note ?? 'Bankroll deposit'],
    );
  });
  return getUserBankroll(userId);
}

export async function withdrawUserBankrollFunds(
  userId: string,
  input: { amount: number; note?: string },
): Promise<BankrollSnapshot> {
  const amount = toMoney(input.amount);
  if (amount <= 0) throw new Error('Amount must be greater than 0');
  await transaction(async (client) => {
    const account = await client.query<BankrollAccountRow>(
      `INSERT INTO user_bankroll_accounts (user_id)
       VALUES ($1::uuid)
       ON CONFLICT (user_id) DO UPDATE SET updated_at = user_bankroll_accounts.updated_at
       RETURNING *`,
      [userId],
    );
    const before = toMoney(account.rows[0]?.current_balance, DEFAULT_INITIAL_BALANCE);
    if (amount > before) {
      throw new Error('Withdrawal exceeds current bankroll');
    }
    const after = toMoney(before - amount);
    const currency = String(account.rows[0]?.currency ?? DEFAULT_CURRENCY);
    await client.query(
      `UPDATE user_bankroll_accounts
          SET current_balance = $2,
              updated_at = NOW()
        WHERE user_id = $1::uuid`,
      [userId, after],
    );
    await client.query(
      `INSERT INTO user_bankroll_ledger (
         user_id, entry_type, amount, balance_before, balance_after, currency, note, metadata
       ) VALUES (
         $1::uuid, 'withdrawal', $2, $3, $4, $5, $6, '{}'::jsonb
       )`,
      [userId, -amount, before, after, currency, input.note ?? 'Bankroll withdrawal'],
    );
  });
  return getUserBankroll(userId);
}

export async function attachBankrollMetadataForDeliveryIds(
  db: QueryExecutor,
  deliveryIds: number[],
): Promise<void> {
  const ids = deliveryIds.filter((id) => Number.isInteger(id) && id > 0);
  if (ids.length === 0) return;

  await db.query(
    `INSERT INTO user_bankroll_accounts (user_id)
     SELECT DISTINCT d.user_id
       FROM user_recommendation_deliveries d
      WHERE d.id = ANY($1::bigint[])
     ON CONFLICT (user_id) DO NOTHING`,
    [ids],
  );

  await db.query(
    `UPDATE user_recommendation_deliveries d
        SET metadata = d.metadata || jsonb_strip_nulls(jsonb_build_object(
          'bankroll_currency', a.currency,
          'bankroll_unit_multiplier', a.unit_multiplier,
          'bankroll_balance_before', a.current_balance,
          'bankroll_balance_display', a.current_balance,
          'bankroll_balance_full', ROUND((a.current_balance * a.unit_multiplier)::numeric, 2),
          'stake_percent', COALESCE(r.stake_percent, NULLIF(d.metadata->>'recommendation_stake_percent', '')::numeric, 0),
          'stake_amount', ROUND((
            a.current_balance * COALESCE(r.stake_percent, NULLIF(d.metadata->>'recommendation_stake_percent', '')::numeric, 0) / 100
          )::numeric, 2),
          'stake_amount_display', ROUND((
            a.current_balance * COALESCE(r.stake_percent, NULLIF(d.metadata->>'recommendation_stake_percent', '')::numeric, 0) / 100
          )::numeric, 2),
          'stake_amount_full', ROUND((
            a.current_balance * COALESCE(r.stake_percent, NULLIF(d.metadata->>'recommendation_stake_percent', '')::numeric, 0) / 100 * a.unit_multiplier
          )::numeric, 2)
        ))
       FROM user_bankroll_accounts a
       LEFT JOIN recommendations r ON r.id = d.recommendation_id
      WHERE d.id = ANY($1::bigint[])
        AND a.user_id = d.user_id`,
    [ids],
  );
}

export async function attachBankrollMetadataForRecommendation(
  db: QueryExecutor,
  recommendationId: number,
): Promise<void> {
  const rows = await db.query<{ id: number }>(
    `SELECT id FROM user_recommendation_deliveries WHERE recommendation_id = $1`,
    [recommendationId],
  );
  await attachBankrollMetadataForDeliveryIds(
    db,
    Array.isArray(rows.rows) ? rows.rows.map((row) => Number(row.id)) : [],
  );
}
