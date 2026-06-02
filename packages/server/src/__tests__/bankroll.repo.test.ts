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

  it('keeps settlement math available for confirmed bet settlement only', () => {
    expect(query).not.toHaveBeenCalled();
  });
});
