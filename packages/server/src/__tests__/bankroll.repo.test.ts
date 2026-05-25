import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockQuery } = vi.hoisted(() => ({
  mockQuery: vi.fn(),
}));

vi.mock('../db/pool.js', () => ({
  query: mockQuery,
  transaction: vi.fn(async (fn: (client: { query: typeof mockQuery }) => Promise<unknown>) => fn({ query: mockQuery })),
}));

import { query } from '../db/pool.js';
import {
  applyRecommendationSettlementToBankroll,
  calculateSettlementPnlAmount,
  calculateStakeAmount,
} from '../repos/bankroll.repo.js';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('bankroll repository', () => {
  it('calculates stake amount from current bankroll and AI stake percent', () => {
    expect(calculateStakeAmount(1000, 3)).toBe(30);
    expect(calculateStakeAmount(1234.56, 2.5)).toBe(30.86);
    expect(calculateStakeAmount(1000, 0)).toBe(0);
  });

  it('calculates money P/L from settlement result and saved stake amount', () => {
    expect(calculateSettlementPnlAmount({ result: 'win', odds: 1.85, stakeAmount: 30 })).toBe(25.5);
    expect(calculateSettlementPnlAmount({ result: 'loss', odds: 1.85, stakeAmount: 30 })).toBe(-30);
    expect(calculateSettlementPnlAmount({ result: 'half_win', odds: 2, stakeAmount: 30 })).toBe(15);
    expect(calculateSettlementPnlAmount({ result: 'half_loss', odds: 2, stakeAmount: 30 })).toBe(-15);
    expect(calculateSettlementPnlAmount({ result: 'push', odds: 2, stakeAmount: 30 })).toBe(0);
  });

  it('applies only the settlement delta when a recommendation is corrected', async () => {
    vi.mocked(query)
      .mockResolvedValueOnce({ rows: [], rowCount: 1 } as never)
      .mockResolvedValueOnce({
        rows: [{
          delivery_id: 9,
          user_id: '11111111-1111-1111-1111-111111111111',
          currency: 'VND',
          current_balance: '1030',
          stake_amount: '30',
          existing_ledger_id: 77,
          existing_amount: '30',
        }],
        rowCount: 1,
      } as never)
      .mockResolvedValueOnce({ rows: [], rowCount: 1 } as never)
      .mockResolvedValueOnce({ rows: [], rowCount: 1 } as never);

    const updated = await applyRecommendationSettlementToBankroll({
      recommendationId: 42,
      result: 'loss',
      odds: 2,
      note: 'corrected',
    });

    expect(updated).toBe(1);
    expect(vi.mocked(query).mock.calls[2]?.[1]).toEqual([
      '11111111-1111-1111-1111-111111111111',
      970,
    ]);
    const ledgerParams = vi.mocked(query).mock.calls[3]?.[1] as unknown[];
    expect(ledgerParams[3]).toBe(-30);
    expect(ledgerParams[4]).toBe(1030);
    expect(ledgerParams[5]).toBe(970);
    expect(JSON.parse(String(ledgerParams[8]))).toMatchObject({
      previousAmount: 30,
      delta: -60,
    });
  });
});
