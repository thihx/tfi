import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockQuery } = vi.hoisted(() => ({
  mockQuery: vi.fn(),
}));

vi.mock('../db/pool.js', () => ({
  query: mockQuery,
  transaction: vi.fn(async (fn: (client: { query: typeof mockQuery }) => Promise<unknown>) =>
    fn({ query: mockQuery }),
  ),
}));

import { investFromRecommendation, settleBet } from '../repos/bets.repo.js';

const userId = '11111111-1111-1111-1111-111111111111';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('bets repository bankroll integration', () => {
  it('creates an invested bet and debits stake from the user bankroll', async () => {
    vi.mocked(mockQuery)
      .mockResolvedValueOnce({ rows: [], rowCount: 0 } as never)
      .mockResolvedValueOnce({
        rows: [{
          id: 42,
          match_id: '9001',
          status: 'LIVE',
          minute: 64,
          score: '1-0',
          selection: 'Over 1.5',
          bet_market: 'over_1.5',
          odds: '1.85',
          stake_percent: '3',
          result: '',
          settlement_status: 'pending',
        }],
        rowCount: 1,
      } as never)
      .mockResolvedValueOnce({
        rows: [{ user_id: userId, currency: 'VND', current_balance: '1000' }],
        rowCount: 1,
      } as never)
      .mockResolvedValueOnce({
        rows: [{
          id: 77,
          user_id: userId,
          recommendation_id: 42,
          delivery_id: 9,
          match_id: '9001',
          placed_at: '2026-06-01T00:00:00.000Z',
          bet_market: 'over_1.5',
          selection: 'Over 1.5',
          odds: 1.85,
          stake_percent: 3,
          stake_amount: 30,
          bookmaker: '',
          match_minute: 64,
          match_score: '1-0',
          match_status: 'LIVE',
          result: '',
          pnl: 0,
          settled_at: null,
          settled_by: '',
          final_score: '',
          settlement_status: 'pending',
          settlement_method: '',
          settle_prompt_version: '',
          settlement_note: '',
          notes: 'Invested from recommendation',
          created_by: userId,
        }],
        rowCount: 1,
      } as never)
      .mockResolvedValueOnce({ rows: [], rowCount: 1 } as never)
      .mockResolvedValueOnce({ rows: [], rowCount: 1 } as never);

    const bet = await investFromRecommendation({
      userId,
      recommendationId: 42,
      deliveryId: 9,
    });

    expect(bet.id).toBe(77);
    expect(bet.stake_amount).toBe(30);
    expect(mockQuery.mock.calls[4]?.[1]).toEqual([userId, 970]);
    const ledgerParams = mockQuery.mock.calls[5]?.[1] as unknown[];
    expect(ledgerParams[0]).toBe(userId);
    expect(ledgerParams[1]).toBe(42);
    expect(ledgerParams[2]).toBe(9);
    expect(ledgerParams[3]).toBe(77);
    expect(ledgerParams[4]).toBe(-30);
    expect(ledgerParams[5]).toBe(1000);
    expect(ledgerParams[6]).toBe(970);
  });

  it('credits settlement payout to bankroll for invested bets', async () => {
    vi.mocked(mockQuery)
      .mockResolvedValueOnce({
        rows: [{
          id: 77,
          user_id: userId,
          recommendation_id: 42,
          delivery_id: 9,
          match_id: '9001',
          placed_at: '2026-06-01T00:00:00.000Z',
          bet_market: 'over_1.5',
          selection: 'Over 1.5',
          odds: 2,
          stake_percent: 3,
          stake_amount: 30,
          bookmaker: '',
          match_minute: 64,
          match_score: '1-0',
          match_status: 'LIVE',
          result: '',
          pnl: 0,
          settled_at: null,
          settled_by: '',
          final_score: '',
          settlement_status: 'pending',
          settlement_method: '',
          settle_prompt_version: '',
          settlement_note: '',
          notes: '',
          created_by: userId,
        }],
        rowCount: 1,
      } as never)
      .mockResolvedValueOnce({
        rows: [{
          id: 77,
          user_id: userId,
          recommendation_id: 42,
          delivery_id: 9,
          match_id: '9001',
          placed_at: '2026-06-01T00:00:00.000Z',
          bet_market: 'over_1.5',
          selection: 'Over 1.5',
          odds: 2,
          stake_percent: 3,
          stake_amount: 30,
          bookmaker: '',
          match_minute: 64,
          match_score: '1-0',
          match_status: 'LIVE',
          result: 'win',
          pnl: 30,
          settled_at: '2026-06-01T01:00:00.000Z',
          settled_by: 'auto',
          final_score: '2-0',
          settlement_status: 'resolved',
          settlement_method: 'auto',
          settle_prompt_version: '',
          settlement_note: '2-0',
          notes: '',
          created_by: userId,
        }],
        rowCount: 1,
      } as never)
      .mockResolvedValueOnce({
        rows: [{ currency: 'VND', current_balance: '970' }],
        rowCount: 1,
      } as never)
      .mockResolvedValueOnce({ rows: [], rowCount: 0 } as never)
      .mockResolvedValueOnce({ rows: [], rowCount: 1 } as never)
      .mockResolvedValueOnce({ rows: [], rowCount: 1 } as never);

    const bet = await settleBet(77, 'win', 0, '2-0', 'auto', {
      status: 'resolved',
      method: 'auto',
      note: '2-0',
    });

    expect(bet?.pnl).toBe(30);
    expect(mockQuery.mock.calls[4]?.[1]).toEqual([userId, 1030]);
    const ledgerParams = mockQuery.mock.calls[5]?.[1] as unknown[];
    expect(ledgerParams[0]).toBe(userId);
    expect(ledgerParams[1]).toBe(42);
    expect(ledgerParams[2]).toBe(9);
    expect(ledgerParams[3]).toBe(77);
    expect(ledgerParams[4]).toBe(60);
    expect(ledgerParams[5]).toBe(970);
    expect(ledgerParams[6]).toBe(1030);
    expect(JSON.parse(String(ledgerParams[9]))).toMatchObject({
      result: 'win',
      stakeAmount: 30,
      pnl: 30,
      delta: 60,
    });
  });
});
