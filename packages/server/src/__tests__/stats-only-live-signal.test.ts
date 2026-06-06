import { describe, expect, test } from 'vitest';
import { evaluateStatsOnlyLiveSignal } from '../lib/stats-only-live-signal.js';

describe('stats-only live signal evaluator', () => {
  test('triggers zero-zero pressure without live odds', () => {
    const signal = evaluateStatsOnlyLiveSignal({
      matchId: '100',
      homeTeam: 'Machida',
      awayTeam: 'Nagoya',
      minute: 62,
      status: '2H',
      score: { home: 0, away: 0 },
      stats: {
        shots: { home: 10, away: 8 },
        shots_on_target: { home: 3, away: 2 },
        corners: { home: 5, away: 4 },
        red_cards: { home: 0, away: 0 },
      },
      events: [],
      oddsAvailable: false,
      referenceMarketKeys: ['1x2', 'ou', 'ah'],
    });

    expect(signal.triggered).toBe(true);
    expect(signal.signalType).toBe('zero_zero_pressure_after_55');
    expect(signal.triggerKey).toBe('stats_only:zero_zero_pressure_after_55:100:0-0:60');
    expect(signal.marketFamilyHint).toBe('goals_ou');
    expect(signal.summaryEn).toContain('No usable live odds');
  });

  test('does not trigger when stats are weak', () => {
    const signal = evaluateStatsOnlyLiveSignal({
      matchId: '100',
      homeTeam: 'Team A',
      awayTeam: 'Team B',
      minute: 64,
      status: '2H',
      score: { home: 1, away: 1 },
      stats: {
        shots: { home: 7, away: 6 },
        shots_on_target: { home: 2, away: 2 },
        corners: { home: 3, away: 2 },
        red_cards: { home: 0, away: 0 },
      },
      events: [],
      oddsAvailable: false,
    });

    expect(signal.triggered).toBe(false);
    expect(signal.signalType).toBeNull();
    expect(signal.reasons).toContain('sot_total=4');
  });

  test('does not run when live odds are available', () => {
    const signal = evaluateStatsOnlyLiveSignal({
      matchId: '100',
      homeTeam: 'Team A',
      awayTeam: 'Team B',
      minute: 62,
      status: '2H',
      score: { home: 0, away: 0 },
      stats: {
        shots: { home: 12, away: 10 },
        shots_on_target: { home: 4, away: 3 },
        corners: { home: 6, away: 4 },
      },
      events: [],
      oddsAvailable: true,
    });

    expect(signal.triggered).toBe(false);
    expect(signal.reasons).toEqual(['live_odds_available']);
  });
});

