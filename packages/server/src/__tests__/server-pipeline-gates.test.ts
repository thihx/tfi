import { describe, expect, test } from 'vitest';

import {
  checkShouldProceedServer,
  checkStalenessServer,
} from '../lib/server-pipeline-gates.js';

const proceedSettings = {
  minMinute: 5,
  maxMinute: 85,
  secondHalfStartMinute: 5,
};

const stalenessSettings = {
  reanalyzeMinMinutes: 10,
  oddsMovementThreshold: 0.1,
};

describe('checkShouldProceedServer', () => {
  test('blocks early second-half matches until 50th minute', () => {
    const result = checkShouldProceedServer(
      '2H',
      47,
      {
        possession: { home: '55', away: '45' },
        shots: { home: '10', away: '6' },
        shots_on_target: { home: '4', away: '2' },
        corners: { home: '5', away: '2' },
        fouls: { home: '8', away: '7' },
      },
      proceedSettings,
    );

    expect(result.shouldProceed).toBe(false);
    expect(result.reason).toContain("below minimum window (50')");
  });

  test('force mode bypasses proceed filters', () => {
    const result = checkShouldProceedServer(
      '1H',
      2,
      {
        possession: { home: null, away: null },
        shots: { home: null, away: null },
        shots_on_target: { home: null, away: null },
        corners: { home: null, away: null },
        fouls: { home: null, away: null },
      },
      proceedSettings,
      true,
    );

    expect(result.shouldProceed).toBe(true);
    expect(result.reason).toBe('FORCE_ANALYZE');
    expect(result.skippedFilters.length).toBeGreaterThan(0);
  });
});

describe('checkStalenessServer', () => {
  test('marks unchanged snapshot inside cooldown as stale', () => {
    const result = checkStalenessServer({
      minute: 65,
      score: '1-1',
      eventsCompact: [],
      oddsCanonical: {
        ou: { line: 2.5, over: 1.85, under: 2.0 },
      },
      previousSnapshot: {
        minute: 63,
        home_score: 1,
        away_score: 1,
        odds: {
          ou: { line: 2.5, over: 1.85, under: 2.0 },
        },
      },
      settings: stalenessSettings,
    });

    expect(result.isStale).toBe(true);
    expect(result.reason).toBe('no_significant_change');
    expect(result.baseline).toBe('snapshot');
  });

  test('re-analyzes when a goal happened after the baseline minute', () => {
    const result = checkStalenessServer({
      minute: 65,
      score: '2-1',
      eventsCompact: [{ minute: 64, type: 'goal', detail: 'Normal Goal' }],
      oddsCanonical: {},
      previousSnapshot: {
        minute: 63,
        home_score: 1,
        away_score: 1,
        odds: {},
      },
      settings: stalenessSettings,
    });

    expect(result.isStale).toBe(false);
    expect(result.reason).toBe('goal_scored');
  });

  test('re-analyzes when odds changed materially versus the prior snapshot', () => {
    const result = checkStalenessServer({
      minute: 65,
      score: '1-1',
      eventsCompact: [],
      oddsCanonical: {
        ou: { line: 2.5, over: 2.05, under: 1.8 },
      },
      previousSnapshot: {
        minute: 63,
        home_score: 1,
        away_score: 1,
        odds: {
          ou: { line: 2.5, over: 1.85, under: 2.0 },
        },
      },
      settings: stalenessSettings,
    });

    expect(result.isStale).toBe(false);
    expect(result.reason).toBe('odds_movement');
  });

  test('re-analyzes once cooldown window fully elapsed', () => {
    const result = checkStalenessServer({
      minute: 75,
      score: '1-1',
      eventsCompact: [],
      oddsCanonical: {},
      previousRecommendation: {
        minute: 65,
        odds: 1.85,
        bet_market: 'over_2.5',
        selection: 'Over 2.5 Goals @1.85',
        score: '1-1',
      },
      settings: stalenessSettings,
    });

    expect(result.isStale).toBe(false);
    expect(result.reason).toBe('time_elapsed');
    expect(result.baseline).toBe('recommendation');
  });

  test('prefers the newer snapshot over an older recommendation baseline', () => {
    const result = checkStalenessServer({
      minute: 65,
      score: '1-1',
      eventsCompact: [],
      oddsCanonical: {},
      previousRecommendation: {
        minute: 50,
        odds: 1.85,
        bet_market: 'over_2.5',
        selection: 'Over 2.5 Goals @1.85',
        score: '1-1',
      },
      previousSnapshot: {
        minute: 63,
        home_score: 1,
        away_score: 1,
        odds: {},
      },
      settings: stalenessSettings,
    });

    expect(result.isStale).toBe(true);
    expect(result.baseline).toBe('snapshot');
  });
});
