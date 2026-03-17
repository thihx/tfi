// ============================================================
// Unit tests — normalizeMarket & buildDedupKey
// ============================================================

import { describe, test, expect } from 'vitest';
import { normalizeMarket, buildDedupKey } from '../lib/normalize-market.js';

describe('normalizeMarket', () => {
  describe('Over/Under', () => {
    test('parses "Over 2.5" from selection', () => {
      expect(normalizeMarket('Over 2.5', '')).toBe('over_2.5');
    });

    test('parses "Under 1.5" from selection', () => {
      expect(normalizeMarket('Under 1.5', '')).toBe('under_1.5');
    });

    test('parses over with match context', () => {
      expect(normalizeMarket('Over 2.5 goals @ 1.85', '')).toBe('over_2.5');
    });

    test('parses under with extra text', () => {
      expect(normalizeMarket('Under 3.5 Goals', '')).toBe('under_3.5');
    });

    test('handles over_1.5 from bet_market', () => {
      expect(normalizeMarket('Over 1.5', 'over_1.5')).toBe('over_1.5');
    });
  });

  describe('BTTS', () => {
    test('parses "BTTS (Yes)"', () => {
      expect(normalizeMarket('BTTS (Yes) @ 1.75', '')).toBe('btts_yes');
    });

    test('parses "BTTS (No)"', () => {
      expect(normalizeMarket('BTTS (No) @ 2.10', '')).toBe('btts_no');
    });

    test('parses "Both Teams To Score - Yes"', () => {
      expect(normalizeMarket('Both Teams To Score - Yes', '')).toBe('btts_yes');
    });

    test('parses BTTS without yes/no defaults to yes', () => {
      expect(normalizeMarket('BTTS @ 1.80', '')).toBe('btts_yes');
    });
  });

  describe('1X2 (Match Result)', () => {
    test('parses "Home Win"', () => {
      expect(normalizeMarket('Manchester United Win', '')).toBe('1x2_home');
    });

    test('parses "Arsenal Win (1x2 Home)"', () => {
      expect(normalizeMarket('Arsenal Win (1x2 Home)', '')).toBe('1x2_home');
    });

    test('parses "Draw @ 2.75"', () => {
      expect(normalizeMarket('Draw @ 2.75', '')).toBe('1x2_draw');
    });

    test('parses "Away Win"', () => {
      expect(normalizeMarket('Away Win @ 3.50', '')).toBe('1x2_away');
    });

    test('uses bet_market for away', () => {
      expect(normalizeMarket('Liverpool', '1x2_away')).toBe('1x2_away');
    });

    test('uses bet_market for home', () => {
      expect(normalizeMarket('Chelsea', '1x2_home')).toBe('1x2_home');
    });
  });

  describe('Asian Handicap', () => {
    test('parses "Asian Handicap -1.5"', () => {
      expect(normalizeMarket('Asian Handicap -1.5', '')).toBe('asian_handicap');
    });

    test('parses "AH +0.5 Home"', () => {
      expect(normalizeMarket('AH +0.5 Home', '')).toBe('asian_handicap');
    });
  });

  describe('Corners', () => {
    test('parses "Over 9.5 Corners"', () => {
      expect(normalizeMarket('Over 9.5 Corners', '')).toBe('corners');
    });

    test('parses "Corner Kicks Over 10.5"', () => {
      expect(normalizeMarket('Corner Kicks Over 10.5', '')).toBe('corners');
    });
  });

  describe('Fallback', () => {
    test('uses bet_market when selection does not match known patterns', () => {
      expect(normalizeMarket('something unknown', 'custom_market')).toBe('custom_market');
    });

    test('slugifies selection when no match and no bet_market', () => {
      const result = normalizeMarket('Some weird selection', '');
      expect(result).toMatch(/^[a-z0-9_]+$/);
    });

    test('returns unknown for empty inputs', () => {
      expect(normalizeMarket('', '')).toBe('unknown');
    });
  });
});

describe('buildDedupKey', () => {
  test('combines matchId with normalized market', () => {
    const key = buildDedupKey('12345', 'Over 2.5', '');
    expect(key).toBe('12345_over_2.5');
  });

  test('uses bet_market when selection unclear', () => {
    const key = buildDedupKey('12345', 'Liverpool', '1x2_home');
    expect(key).toBe('12345_1x2_home');
  });

  test('same match+market = same key regardless of extra text', () => {
    const key1 = buildDedupKey('12345', 'Over 2.5 goals @ 1.85', '');
    const key2 = buildDedupKey('12345', 'Over 2.5 @ 2.00', '');
    expect(key1).toBe(key2);
  });

  test('different markets on same match = different keys', () => {
    const key1 = buildDedupKey('12345', 'Over 2.5', '');
    const key2 = buildDedupKey('12345', 'BTTS (Yes)', '');
    expect(key1).not.toBe(key2);
  });

  test('same market on different matches = different keys', () => {
    const key1 = buildDedupKey('12345', 'Over 2.5', '');
    const key2 = buildDedupKey('67890', 'Over 2.5', '');
    expect(key1).not.toBe(key2);
  });
});
