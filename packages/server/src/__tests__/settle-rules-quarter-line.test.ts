import { describe, expect, test } from 'vitest';
import { settleByRule } from '../lib/settle-rules.js';

const CORNER_STATS = [{ type: 'Corner Kicks', home: 2, away: 11 }]; // total 13

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

  describe('corner markets', () => {
    test('returns null when corner stats are missing — AI fallback must handle it', () => {
      const result = settleByRule({
        market: 'corners_over_8.5',
        selection: 'Corners Over 8.5 @1.93',
        homeScore: 1,
        awayScore: 0,
        statistics: [], // empty — mimics K League 2 with no Football API stats
      });
      expect(result).toBeNull();
    });

    test('returns null when statistics field is undefined', () => {
      const result = settleByRule({
        market: 'corners_over_8.5',
        selection: 'Corners Over 8.5 @1.93',
        homeScore: 1,
        awayScore: 0,
      });
      expect(result).toBeNull();
    });

    test('corners over 8.5 wins when total is 13 (TFI live data)', () => {
      const result = settleByRule({
        market: 'corners_over_8.5',
        selection: 'Corners Over 8.5 @1.93',
        homeScore: 1,
        awayScore: 0,
        statistics: CORNER_STATS,
      });
      expect(result).not.toBeNull();
      expect(result!.result).toBe('win');
    });

    test('corners over 8.5 loses when total is 7', () => {
      const result = settleByRule({
        market: 'corners_over_8.5',
        selection: 'Corners Over 8.5',
        homeScore: 0,
        awayScore: 0,
        statistics: [{ type: 'Corner Kicks', home: 3, away: 4 }],
      });
      expect(result).not.toBeNull();
      expect(result!.result).toBe('loss');
    });

    test('corners under 9.5 wins when total is 8', () => {
      const result = settleByRule({
        market: 'corners_under_9.5',
        selection: 'Corners Under 9.5',
        homeScore: 1,
        awayScore: 1,
        statistics: [{ type: 'Corner Kicks', home: 3, away: 5 }],
      });
      expect(result).not.toBeNull();
      expect(result!.result).toBe('win');
    });

    test('corners over 8.25 (quarter-line) with 8 total is half_loss', () => {
      const result = settleByRule({
        market: 'corners_over_8.25',
        selection: 'Corners Over 8.25',
        homeScore: 1,
        awayScore: 0,
        statistics: [{ type: 'Corner Kicks', home: 3, away: 5 }], // total 8
      });
      expect(result).not.toBeNull();
      expect(result!.result).toBe('half_loss');
    });

    test('corners over 8.75 (quarter-line) with 9 total is half_win', () => {
      const result = settleByRule({
        market: 'corners_over_8.75',
        selection: 'Corners Over 8.75',
        homeScore: 1,
        awayScore: 0,
        statistics: [{ type: 'Corner Kicks', home: 4, away: 5 }], // total 9
      });
      expect(result).not.toBeNull();
      expect(result!.result).toBe('half_win');
    });
  });

  describe('card markets', () => {
    test('always returns null regardless of stats — AI fallback required', () => {
      const result = settleByRule({
        market: 'cards_over_4.5',
        selection: 'Cards Over 4.5',
        homeScore: 1,
        awayScore: 0,
        statistics: [{ type: 'Yellow Cards', home: 3, away: 2 }],
      });
      expect(result).toBeNull();
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
