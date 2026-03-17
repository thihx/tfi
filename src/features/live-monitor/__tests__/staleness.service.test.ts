// ============================================================
// Staleness Guard Tests
// ============================================================

import { describe, test, expect } from 'vitest';
import { checkStaleness, parseScore, extractCurrentOddForMarket } from '../services/staleness.service';
import { createMergedMatchData } from './fixtures';
import type { PreviousRecommendation } from '../types';

function createPrevRec(overrides?: Partial<PreviousRecommendation>): PreviousRecommendation {
  return {
    minute: 60,
    selection: 'Over 2.5 @1.85',
    bet_market: 'over_2.5',
    confidence: 7,
    odds: 1.85,
    reasoning: 'Both teams pressing',
    result: '',
    timestamp: '2026-03-17T10:00:00Z',
    ...overrides,
  };
}

describe('checkStaleness', () => {
  test('returns not stale when no previous recommendation', () => {
    const match = createMergedMatchData();
    const result = checkStaleness(match, null);
    expect(result.isStale).toBe(false);
    expect(result.reason).toBe('first_analysis');
  });

  test('returns not stale when >= 5 minutes elapsed', () => {
    const match = createMergedMatchData({ minute: 70 });
    const lastRec = createPrevRec({ minute: 60 });
    const result = checkStaleness(match, lastRec);
    expect(result.isStale).toBe(false);
    expect(result.reason).toBe('time_elapsed');
  });

  test('returns stale when < 3 minutes elapsed and no events', () => {
    const match = createMergedMatchData({
      minute: 62,
      events_compact: [
        { minute: 23, extra: null, team: 'Arsenal', type: 'goal', detail: 'Normal Goal', player: 'Saka' },
      ],
    });
    const lastRec = createPrevRec({ minute: 60 });
    const result = checkStaleness(match, lastRec);
    expect(result.isStale).toBe(true);
    expect(result.reason).toBe('no_significant_change');
  });

  test('returns not stale when goal scored since last rec', () => {
    const match = createMergedMatchData({
      minute: 62,
      score: '2-0',
      events_compact: [
        { minute: 23, extra: null, team: 'Arsenal', type: 'goal', detail: 'Normal Goal', player: 'Saka' },
        { minute: 61, extra: null, team: 'Arsenal', type: 'goal', detail: 'Normal Goal', player: 'Havertz' },
      ],
    });
    const lastRec = createPrevRec({ minute: 60 });
    const result = checkStaleness(match, lastRec);
    expect(result.isStale).toBe(false);
    expect(result.reason).toBe('goal_scored');
  });

  test('returns not stale when red card since last rec', () => {
    const match = createMergedMatchData({
      minute: 62,
      events_compact: [
        { minute: 61, extra: null, team: 'Chelsea', type: 'card', detail: 'red card', player: 'Silva' },
      ],
    });
    const lastRec = createPrevRec({ minute: 60 });
    const result = checkStaleness(match, lastRec);
    expect(result.isStale).toBe(false);
    expect(result.reason).toBe('red_card');
  });

  test('returns not stale when odds moved > 0.10', () => {
    const match = createMergedMatchData({
      minute: 62,
      odds_canonical: {
        '1x2': { home: 2.1, draw: 3.4, away: 3.8 },
        ou: { line: 2.5, over: 2.00, under: 1.85 }, // over moved from 1.85 → 2.00
        ah: { line: -0.5, home: 1.9, away: 2.0 },
        btts: { yes: 1.75, no: 2.1 },
        corners_ou: { line: 9.5, over: 1.85, under: 1.95 },
      },
      events_compact: [],
    });
    const lastRec = createPrevRec({
      minute: 60,
      selection: 'Over 2.5 @1.85',
      bet_market: 'over_2.5',
      odds: 1.85,
    });
    const result = checkStaleness(match, lastRec);
    expect(result.isStale).toBe(false);
    expect(result.reason).toBe('odds_movement');
  });

  test('handles string minute in match data', () => {
    const match = createMergedMatchData({ minute: '62' as unknown as number });
    const lastRec = createPrevRec({ minute: 60 });
    // events_compact has goal at 23 which is before last rec minute
    const result = checkStaleness(match, lastRec);
    expect(result.isStale).toBe(true);
  });

  test('returns not stale when lastRec minute is null', () => {
    const match = createMergedMatchData({ minute: 65 });
    const lastRec = createPrevRec({ minute: null });
    const result = checkStaleness(match, lastRec);
    expect(result.isStale).toBe(false);
    // 65 - 0 >= 5 → time_elapsed
    expect(result.reason).toBe('time_elapsed');
  });

  test('returns not stale at exactly 3 minutes (boundary)', () => {
    const match = createMergedMatchData({
      minute: 63,
      events_compact: [],
    });
    const lastRec = createPrevRec({ minute: 60, odds: null, bet_market: '' });
    const result = checkStaleness(match, lastRec);
    expect(result.isStale).toBe(false);
    expect(result.reason).toBe('time_elapsed');
  });
});

describe('parseScore', () => {
  test('parses normal score', () => {
    expect(parseScore('2-1')).toEqual([2, 1]);
  });

  test('handles spaces', () => {
    expect(parseScore('1 - 0')).toEqual([1, 0]);
  });

  test('returns 0-0 for empty string', () => {
    expect(parseScore('')).toEqual([0, 0]);
  });
});

describe('extractCurrentOddForMarket', () => {
  const oc = {
    '1x2': { home: 2.1, draw: 3.4, away: 3.8 },
    ou: { line: 2.5, over: 1.85, under: 2.0 },
    btts: { yes: 1.75, no: 2.1 },
    ah: { line: -0.5, home: 1.9, away: 2.0 },
  };

  test('extracts O/U over', () => {
    expect(extractCurrentOddForMarket('over_2.5', 'Over 2.5 @1.85', oc)).toBe(1.85);
  });

  test('extracts O/U under', () => {
    expect(extractCurrentOddForMarket('under_2.5', 'Under 2.5 @2.0', oc)).toBe(2.0);
  });

  test('extracts 1x2 home', () => {
    expect(extractCurrentOddForMarket('1x2_home', 'Home Win @2.10', oc)).toBe(2.1);
  });

  test('extracts btts yes', () => {
    expect(extractCurrentOddForMarket('btts_yes', 'BTTS Yes @1.75', oc)).toBe(1.75);
  });

  test('extracts ah home', () => {
    expect(extractCurrentOddForMarket('ah_home_-0.5', 'Home -0.5 @1.9', oc)).toBe(1.9);
  });

  test('returns null for unknown market', () => {
    expect(extractCurrentOddForMarket('exotic', 'Something', oc)).toBe(null);
  });
});
