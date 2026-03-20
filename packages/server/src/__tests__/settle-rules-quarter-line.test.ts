import { describe, expect, test } from 'vitest';
import { settleByRule } from '../lib/settle-rules.js';

describe('settleByRule quarter-line settlement', () => {
  describe('asian handicap', () => {
    test('home -0.25 draw is half_loss', () => {
      const result = settleByRule({
        market: 'asian_handicap_home_-0.25',
        selection: 'Home -0.25',
        homeScore: 1,
        awayScore: 1,
      });

      expect(result).not.toBeNull();
      expect(result!.result).toBe('half_loss');
    });

    test('away +0.25 draw is half_win', () => {
      const result = settleByRule({
        market: 'asian_handicap_away_+0.25',
        selection: 'Away +0.25',
        homeScore: 1,
        awayScore: 1,
      });

      expect(result).not.toBeNull();
      expect(result!.result).toBe('half_win');
    });

    test('home -0.75 one-goal win is half_win', () => {
      const result = settleByRule({
        market: 'asian_handicap_home_-0.75',
        selection: 'Home -0.75',
        homeScore: 2,
        awayScore: 1,
      });

      expect(result).not.toBeNull();
      expect(result!.result).toBe('half_win');
    });

    test('away +0.75 one-goal loss is half_loss', () => {
      const result = settleByRule({
        market: 'asian_handicap_away_+0.75',
        selection: 'Away +0.75',
        homeScore: 2,
        awayScore: 1,
      });

      expect(result).not.toBeNull();
      expect(result!.result).toBe('half_loss');
    });
  });

  describe('goal totals', () => {
    test('over 2.25 with exactly 2 goals is half_loss', () => {
      const result = settleByRule({
        market: 'over_2.25',
        selection: 'Over 2.25',
        homeScore: 1,
        awayScore: 1,
      });

      expect(result).not.toBeNull();
      expect(result!.result).toBe('half_loss');
    });

    test('over 2.75 with exactly 3 goals is half_win', () => {
      const result = settleByRule({
        market: 'over_2.75',
        selection: 'Over 2.75',
        homeScore: 2,
        awayScore: 1,
      });

      expect(result).not.toBeNull();
      expect(result!.result).toBe('half_win');
    });

    test('under 2.75 with exactly 3 goals is half_loss', () => {
      const result = settleByRule({
        market: 'under_2.75',
        selection: 'Under 2.75',
        homeScore: 2,
        awayScore: 1,
      });

      expect(result).not.toBeNull();
      expect(result!.result).toBe('half_loss');
    });

    test('under 2.25 with exactly 2 goals is half_win', () => {
      const result = settleByRule({
        market: 'under_2.25',
        selection: 'Under 2.25',
        homeScore: 1,
        awayScore: 1,
      });

      expect(result).not.toBeNull();
      expect(result!.result).toBe('half_win');
    });
  });
});
