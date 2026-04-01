import { describe, expect, test } from 'vitest';
import { calcSettlementPnl, settlementWasCorrect } from '../lib/settle-types.js';
import { resolveSettlementScore } from '../lib/settle-context.js';

describe('settle types helpers', () => {
  test('calculates PnL for standard and half outcomes', () => {
    expect(calcSettlementPnl('win', 1.85, 4)).toBe(3.4);
    expect(calcSettlementPnl('loss', 1.85, 4)).toBe(-4);
    expect(calcSettlementPnl('push', 1.85, 4)).toBe(0);
    expect(calcSettlementPnl('half_win', 1.85, 4)).toBe(1.7);
    expect(calcSettlementPnl('half_loss', 1.85, 4)).toBe(-2);
    expect(calcSettlementPnl('void', 1.85, 4)).toBe(0);
  });

  test('maps business scoring outcomes to correctness', () => {
    expect(settlementWasCorrect('win')).toBe(true);
    expect(settlementWasCorrect('loss')).toBe(false);
    expect(settlementWasCorrect('push')).toBeNull();
    expect(settlementWasCorrect('half_win')).toBe(true);
    expect(settlementWasCorrect('half_loss')).toBe(false);
    expect(settlementWasCorrect('void')).toBeNull();
  });

  test('uses regular-time score for AET/PEN and refuses ambiguous non-standard finals', () => {
    expect(resolveSettlementScore('FT', 2, 1, null)).toEqual({ home: 2, away: 1 });
    expect(resolveSettlementScore('AET', 3, 2, { home: 2, away: 2 })).toEqual({ home: 2, away: 2 });
    expect(resolveSettlementScore('PEN', 4, 3, { home: 1, away: 1 })).toEqual({ home: 1, away: 1 });
    expect(resolveSettlementScore('AET', 3, 2, null)).toBeNull();
    expect(resolveSettlementScore('WO', 3, 0, null)).toBeNull();
  });
});
