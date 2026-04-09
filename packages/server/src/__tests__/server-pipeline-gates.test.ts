import { describe, expect, test } from 'vitest';

import {
  checkCoarseStalenessServer,
  checkShouldProceedServer,
  resolveReanalyzeCooldownMinutes,
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
  test('coarse gate re-analyzes on phase change even inside cooldown', () => {
    const result = checkCoarseStalenessServer({
      minute: 47,
      status: '2H',
      score: '0-0',
      previousSnapshot: {
        minute: 45,
        status: '1H',
        home_score: 0,
        away_score: 0,
        odds: {},
      },
      settings: { reanalyzeMinMinutes: 10 },
    });

    expect(result.isStale).toBe(false);
    expect(result.reason).toBe('phase_changed');
  });

  test('uses shorter dynamic cooldown late in the second half', () => {
    expect(resolveReanalyzeCooldownMinutes('2H', 81, 10)).toBe(1);
    expect(resolveReanalyzeCooldownMinutes('2H', 72, 10)).toBe(2);
    expect(resolveReanalyzeCooldownMinutes('1H', 24, 10)).toBe(4);
  });

  test('marks unchanged snapshot inside cooldown as stale', () => {
    const result = checkStalenessServer({
      minute: 65,
      status: '2H',
      score: '1-1',
      statsCompact: {
        possession: { home: '50', away: '50' },
        shots: { home: '8', away: '8' },
        shots_on_target: { home: '2', away: '2' },
        corners: { home: '4', away: '4' },
        fouls: { home: '10', away: '10' },
      },
      eventsCompact: [],
      oddsCanonical: {
        ou: { line: 2.5, over: 1.85, under: 2.0 },
      },
      previousSnapshot: {
        minute: 64,
        home_score: 1,
        away_score: 1,
        odds: {
          ou: { line: 2.5, over: 1.85, under: 2.0 },
        },
        stats: {
          possession: { home: '50', away: '50' },
          shots: { home: '8', away: '8' },
          shots_on_target: { home: '2', away: '2' },
          corners: { home: '4', away: '4' },
          fouls: { home: '10', away: '10' },
        },
      },
      settings: stalenessSettings,
    });

    expect(result.isStale).toBe(true);
    expect(result.reason).toBe('snapshot_stats_unchanged');
    expect(result.baseline).toBe('snapshot');
  });

  test('re-analyzes when snapshot stats changed even if score and odds did not', () => {
    const result = checkStalenessServer({
      minute: 65,
      status: '2H',
      score: '1-1',
      statsCompact: {
        possession: { home: '50', away: '50' },
        shots: { home: '9', away: '8' },
        shots_on_target: { home: '2', away: '2' },
        corners: { home: '4', away: '4' },
        fouls: { home: '10', away: '10' },
      },
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
        stats: {
          possession: { home: '50', away: '50' },
          shots: { home: '8', away: '8' },
          shots_on_target: { home: '2', away: '2' },
          corners: { home: '4', away: '4' },
          fouls: { home: '10', away: '10' },
        },
      },
      settings: stalenessSettings,
    });

    expect(result.isStale).toBe(false);
    expect(result.reason).toBe('time_elapsed');
  });

  test('re-analyzes when a goal happened after the baseline minute', () => {
    const result = checkStalenessServer({
      minute: 65,
      status: '2H',
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
      status: '2H',
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

  test('re-analyzes when HT O/U odds changed versus prior snapshot', () => {
    const result = checkStalenessServer({
      minute: 38,
      status: '1H',
      score: '0-0',
      eventsCompact: [],
      oddsCanonical: {
        ht_ou: { line: 1.5, over: 2.08, under: 1.72 },
      },
      previousSnapshot: {
        minute: 30,
        home_score: 0,
        away_score: 0,
        odds: {
          ht_ou: { line: 1.5, over: 1.95, under: 1.85 },
        },
      },
      settings: stalenessSettings,
    });

    expect(result.isStale).toBe(false);
    expect(result.reason).toBe('odds_movement');
  });

  test('detects odds movement for prior pick on ht_over via extractMarketOdd', () => {
    const result = checkStalenessServer({
      minute: 40,
      status: '1H',
      score: '0-0',
      eventsCompact: [],
      oddsCanonical: {
        ht_ou: { line: 1.5, over: 2.1, under: 1.7 },
      },
      previousRecommendation: {
        minute: 30,
        odds: 1.95,
        bet_market: 'ht_over_1.5',
        selection: 'First half over 1.5',
        score: '0-0',
      },
      settings: stalenessSettings,
    });

    expect(result.isStale).toBe(false);
    expect(result.reason).toBe('odds_movement');
    expect(result.baseline).toBe('recommendation');
  });

  test('re-analyzes once cooldown window fully elapsed', () => {
    const result = checkStalenessServer({
      minute: 75,
      status: '2H',
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
      status: '2H',
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
        minute: 64,
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
