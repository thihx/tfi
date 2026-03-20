// ============================================================
// Unit tests - normalizeMarket & buildDedupKey
// ============================================================

import { describe, test, expect } from 'vitest';
import { normalizeMarket, buildDedupKey } from '../lib/normalize-market.js';

describe('normalizeMarket', () => {
  describe('Over/Under', () => {
    test('parses over and under from selection text', () => {
      expect(normalizeMarket('Over 2.5', '')).toBe('over_2.5');
      expect(normalizeMarket('Under 1.5', '')).toBe('under_1.5');
      expect(normalizeMarket('Over 2.5 goals @ 1.85', '')).toBe('over_2.5');
      expect(normalizeMarket('Under 3.5 Goals', '')).toBe('under_3.5');
    });

    test('keeps canonical totals from bet_market', () => {
      expect(normalizeMarket('Over 1.5', 'over_1.5')).toBe('over_1.5');
    });

    test('canonicalizes descriptive totals bet_market using selection direction', () => {
      expect(normalizeMarket('Over 2.5', 'Over/Under 2.5')).toBe('over_2.5');
      expect(normalizeMarket('Under 2.25', 'Over/Under 2.25')).toBe('under_2.25');
    });
  });

  describe('BTTS', () => {
    test('parses BTTS from selection text', () => {
      expect(normalizeMarket('BTTS (Yes) @ 1.75', '')).toBe('btts_yes');
      expect(normalizeMarket('BTTS (No) @ 2.10', '')).toBe('btts_no');
      expect(normalizeMarket('Both Teams To Score - Yes', '')).toBe('btts_yes');
      expect(normalizeMarket('BTTS @ 1.80', '')).toBe('btts_yes');
    });

    test('uses selection to resolve descriptive BTTS bet_market', () => {
      expect(normalizeMarket('Yes', 'BTTS')).toBe('btts_yes');
      expect(normalizeMarket('No', 'Both Teams To Score')).toBe('btts_no');
    });
  });

  describe('1X2', () => {
    test('parses match-result outcomes from selection text', () => {
      expect(normalizeMarket('Manchester United Win', '')).toBe('1x2_home');
      expect(normalizeMarket('Arsenal Win (1x2 Home)', '')).toBe('1x2_home');
      expect(normalizeMarket('Draw @ 2.75', '')).toBe('1x2_draw');
      expect(normalizeMarket('Away Win @ 3.50', '')).toBe('1x2_away');
    });

    test('keeps canonical 1x2 bet_market', () => {
      expect(normalizeMarket('Liverpool', '1x2_away')).toBe('1x2_away');
      expect(normalizeMarket('Chelsea', '1x2_home')).toBe('1x2_home');
    });

    test('canonicalizes descriptive match-result bet_market using selection', () => {
      expect(normalizeMarket('Home Win', 'Fulltime Result')).toBe('1x2_home');
      expect(normalizeMarket('Away Win', '1X2')).toBe('1x2_away');
      expect(normalizeMarket('Draw', 'Full Time Result')).toBe('1x2_draw');
    });
  });

  describe('Asian Handicap', () => {
    test('canonicalizes canonical and alias bet_market values', () => {
      expect(normalizeMarket('Home -0.5 @1.90', 'ah_home_-0.5')).toBe('asian_handicap_home_-0.5');
      expect(normalizeMarket('Away +0.25', 'asian_handicap_away_0.25')).toBe('asian_handicap_away_+0.25');
    });

    test('parses AH from selection text', () => {
      expect(normalizeMarket('Asian Handicap -1.5', '')).toBe('asian_handicap_home_-1.5');
      expect(normalizeMarket('AH +0.5 Home', '')).toBe('asian_handicap_home_+0.5');
      expect(normalizeMarket('Asian Handicap Away -0.5', '')).toBe('asian_handicap_away_-0.5');
    });

    test('canonicalizes quarter notation and descriptive bet_market', () => {
      expect(normalizeMarket('Home 0,0.5', 'Asian Handicap')).toBe('asian_handicap_home_+0.25');
      expect(normalizeMarket('Away -0.5,-1', 'Asian Handicap')).toBe('asian_handicap_away_-0.75');
    });

    test('different AH lines produce different keys', () => {
      const k1 = normalizeMarket('Asian Handicap -0.5', '');
      const k2 = normalizeMarket('Asian Handicap -1.5', '');
      expect(k1).not.toBe(k2);
    });
  });

  describe('Corners', () => {
    test('parses corners markets from selection text', () => {
      expect(normalizeMarket('Over 9.5 Corners', '')).toBe('corners_over_9.5');
      expect(normalizeMarket('Corner Kicks Over 10.5', '')).toBe('corners_over_10.5');
      expect(normalizeMarket('Under 8.5 Corners', '')).toBe('corners_under_8.5');
    });

    test('canonicalizes descriptive corners bet_market using selection', () => {
      expect(normalizeMarket('Under 10.5 Corners', 'Over/Under Corners 10.5')).toBe('corners_under_10.5');
    });

    test('different corner lines produce different keys', () => {
      const k1 = normalizeMarket('Over 9.5 Corners', '');
      const k2 = normalizeMarket('Over 10.5 Corners', '');
      expect(k1).not.toBe(k2);
    });
  });

  describe('Fallback', () => {
    test('uses raw bet_market when nothing canonical matches', () => {
      expect(normalizeMarket('something unknown', 'custom_market')).toBe('custom_market');
    });

    test('slugifies selection when no pattern matches', () => {
      expect(normalizeMarket('Some weird selection', '')).toMatch(/^[a-z0-9_]+$/);
    });

    test('returns unknown for empty inputs', () => {
      expect(normalizeMarket('', '')).toBe('unknown');
    });
  });
});

describe('buildDedupKey', () => {
  test('combines matchId with normalized market', () => {
    expect(buildDedupKey('12345', 'Over 2.5', '')).toBe('12345_over_2.5');
  });

  test('uses canonicalized bet_market when selection is unclear', () => {
    expect(buildDedupKey('12345', 'Home Win', 'Fulltime Result')).toBe('12345_1x2_home');
  });

  test('same match and same market produce same key despite extra text', () => {
    const key1 = buildDedupKey('12345', 'Over 2.5 goals @ 1.85', '');
    const key2 = buildDedupKey('12345', 'Over 2.5 @ 2.00', '');
    expect(key1).toBe(key2);
  });

  test('different markets on same match produce different keys', () => {
    const key1 = buildDedupKey('12345', 'Over 2.5', '');
    const key2 = buildDedupKey('12345', 'BTTS (Yes)', '');
    expect(key1).not.toBe(key2);
  });

  test('same market on different matches produces different keys', () => {
    const key1 = buildDedupKey('12345', 'Over 2.5', '');
    const key2 = buildDedupKey('67890', 'Over 2.5', '');
    expect(key1).not.toBe(key2);
  });
});
