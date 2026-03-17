// ============================================================
// Unit tests — auto-settle evaluateBet logic
// ============================================================

import { describe, test, expect } from 'vitest';
import { evaluateBet } from '../jobs/auto-settle.job.js';

describe('evaluateBet', () => {
  describe('Over/Under', () => {
    test('over 2.5 wins when 3+ goals', () => {
      const { result, pnl } = evaluateBet('ou2.5', 'over', 1.85, 1, 2, 1);
      expect(result).toBe('win');
      expect(pnl).toBeCloseTo(0.85);
    });

    test('over 2.5 loses when < 3 goals', () => {
      const { result, pnl } = evaluateBet('ou2.5', 'over', 1.85, 1, 1, 0);
      expect(result).toBe('loss');
      expect(pnl).toBe(-1);
    });

    test('under 2.5 wins when < 3 goals', () => {
      const { result, pnl } = evaluateBet('ou2.5', 'under', 2.0, 1, 1, 1);
      expect(result).toBe('win');
      expect(pnl).toBe(1);
    });

    test('under 2.5 loses when 3+ goals', () => {
      const { result, pnl } = evaluateBet('ou2.5', 'under', 2.0, 1, 2, 1);
      expect(result).toBe('loss');
      expect(pnl).toBe(-1);
    });

    test('push when total equals line', () => {
      const { result, pnl } = evaluateBet('ou2.0', 'over', 1.85, 1, 1, 1);
      expect(result).toBe('push');
      expect(pnl).toBe(0);
    });
  });

  describe('BTTS', () => {
    test('BTTS yes wins when both score', () => {
      const { result } = evaluateBet('btts', 'yes', 1.7, 1, 1, 1);
      expect(result).toBe('win');
    });

    test('BTTS yes loses when one team blank', () => {
      const { result } = evaluateBet('btts', 'yes', 1.7, 1, 2, 0);
      expect(result).toBe('loss');
    });

    test('BTTS no wins when one team blank', () => {
      const { result } = evaluateBet('btts', 'no', 2.1, 1, 0, 0);
      expect(result).toBe('win');
    });

    test('BTTS no loses when both score', () => {
      const { result } = evaluateBet('both_teams_to_score', 'no', 2.1, 1, 1, 2);
      expect(result).toBe('loss');
    });
  });

  describe('1X2 (Match Result)', () => {
    test('home win', () => {
      const { result } = evaluateBet('1x2', 'home', 2.5, 1, 2, 0);
      expect(result).toBe('win');
    });

    test('home pick loses on away win', () => {
      const { result } = evaluateBet('1x2', '1', 2.5, 1, 0, 1);
      expect(result).toBe('loss');
    });

    test('draw pick wins on draw', () => {
      const { result } = evaluateBet('match_result', 'draw', 3.2, 1, 1, 1);
      expect(result).toBe('win');
    });

    test('away pick wins on away win', () => {
      const { result } = evaluateBet('1x2', 'away', 2.8, 1, 0, 2);
      expect(result).toBe('win');
    });

    test('away pick loses on home win', () => {
      const { result } = evaluateBet('1x2', '2', 2.8, 1, 3, 1);
      expect(result).toBe('loss');
    });
  });

  describe('Asian Handicap', () => {
    test('home -1 wins when 2+ goal lead', () => {
      const { result } = evaluateBet('ah-1.0', 'home', 1.9, 1, 3, 1);
      expect(result).toBe('win');
    });

    test('home -1 pushes when exactly 1 goal lead', () => {
      const { result, pnl } = evaluateBet('ah-1.0', 'home', 1.9, 1, 2, 1);
      expect(result).toBe('push');
      expect(pnl).toBe(0);
    });

    test('home -1 loses when no lead', () => {
      const { result } = evaluateBet('ah-1.0', 'home', 1.9, 1, 1, 1);
      expect(result).toBe('loss');
    });
  });

  describe('Unknown market', () => {
    test('returns push for unrecognized market', () => {
      const { result, pnl } = evaluateBet('exotic_market', 'something', 2.0, 1, 1, 0);
      expect(result).toBe('push');
      expect(pnl).toBe(0);
    });
  });

  describe('stake multiplier', () => {
    test('pnl scales with stake percent', () => {
      const { pnl } = evaluateBet('ou2.5', 'over', 2.0, 0.5, 2, 1);
      expect(pnl).toBeCloseTo(0.5);
    });

    test('loss scales with stake percent', () => {
      const { pnl } = evaluateBet('ou2.5', 'over', 2.0, 0.5, 0, 0);
      expect(pnl).toBeCloseTo(-0.5);
    });
  });

  describe('edge cases — normalized market keys', () => {
    test('1x2_home market + "Team Win" selection works', () => {
      const { result } = evaluateBet('1x2_home', 'Arsenal Win (1x2 Home)', 2.0, 1, 2, 0);
      expect(result).toBe('win');
    });

    test('1x2_home market + home pick on draw is loss', () => {
      const { result } = evaluateBet('1x2_home', 'Home Win', 2.0, 1, 1, 1);
      expect(result).toBe('loss');
    });

    test('over_2.5 market + "Over 2.5" selection', () => {
      const { result } = evaluateBet('over_2.5', 'Over 2.5 goals @ 1.85', 1.85, 1, 2, 1);
      expect(result).toBe('win');
    });

    test('btts_yes market + "BTTS (Yes)" selection', () => {
      const { result } = evaluateBet('btts_yes', 'BTTS (Yes) @ 1.75', 1.75, 1, 1, 1);
      expect(result).toBe('win');
    });

    test('btts_yes market loses when one team blank', () => {
      const { result } = evaluateBet('btts_yes', 'BTTS (Yes)', 1.75, 1, 2, 0);
      expect(result).toBe('loss');
    });

    test('1x2_draw market + "Draw" selection wins on draw', () => {
      const { result } = evaluateBet('1x2_draw', 'Draw @ 2.75', 2.75, 1, 0, 0);
      expect(result).toBe('win');
    });

    test('1x2_away market + "Away Win" selection', () => {
      const { result } = evaluateBet('1x2_away', 'Away Win', 2.50, 1, 0, 1);
      expect(result).toBe('win');
    });

    test('under_1.5 market + "Under 1.5" selection', () => {
      const { result } = evaluateBet('under_1.5', 'Under 1.5', 2.10, 1, 1, 0);
      expect(result).toBe('win');
    });

    test('over 1.5 on match with 1 goal loses', () => {
      const { result } = evaluateBet('over_1.5', 'Over 1.5', 1.50, 1, 1, 0);
      expect(result).toBe('loss');
    });

    test('Asian handicap -0.5 home wins with 1 goal lead', () => {
      const { result } = evaluateBet('ah-0.5', 'home', 1.95, 1, 1, 0);
      expect(result).toBe('win');
    });
  });

  describe('PnL calculations', () => {
    test('win PnL = (odds - 1) * stakePercent', () => {
      const { pnl } = evaluateBet('1x2', 'home', 2.50, 3, 2, 0);
      expect(pnl).toBeCloseTo(4.5); // (2.5-1) * 3 = 4.5
    });

    test('loss PnL = -stakePercent', () => {
      const { pnl } = evaluateBet('1x2', 'home', 2.50, 3, 0, 2);
      expect(pnl).toBe(-3);
    });

    test('push PnL = 0', () => {
      const { pnl } = evaluateBet('ou2.0', 'over', 1.85, 3, 1, 1);
      expect(pnl).toBe(0);
    });
  });
});
