import { describe, expect, test } from 'vitest';
import {
  evaluateStatsOnlyLiveSignal,
  parseStatsOnlyAiAdvisoryResponse,
} from '../lib/stats-only-live-signal.js';

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

  test('parses AI advisory as a no-save stats-only signal with no-odds disclosure', () => {
    const signal = parseStatsOnlyAiAdvisoryResponse(JSON.stringify({
      should_push: true,
      confidence: 74,
      strength: 'medium',
      summary_vi: 'Ap luc dang tang, chi nen theo doi.',
      summary_en: 'Pressure is increasing, watch only.',
      suggested_action: 'review_live_market',
      market_family_hint: 'goals_ou',
      reasons: ['stats_events_available'],
    }), {
      matchId: '100',
      homeTeam: 'South Korea',
      awayTeam: 'Czech Republic',
      matchDisplay: 'South Korea vs Czech Republic',
      league: 'World Cup',
      minute: 65,
      status: '2H',
      score: { home: 0, away: 1 },
      stats: {
        shots: { home: 12, away: 10 },
        shots_on_target: { home: 4, away: 4 },
        corners: { home: 3, away: 2 },
      },
      events: [{ minute: 58, team: 'Czech Republic', type: 'Goal', detail: 'Normal Goal' }],
      oddsAvailable: false,
      statsAvailable: true,
      statsSource: 'provider',
      evidenceMode: 'stats_only',
      referenceMarketKeys: [],
    });

    expect(signal).toEqual(expect.objectContaining({
      triggered: true,
      signalType: 'ai_stats_only_advisory',
      source: 'ai_advisory',
      confidence: 74,
      strength: 'medium',
      triggerKey: 'stats_only:ai_stats_only_advisory:100:0-1:60',
      suggestedAction: 'review_live_market',
      marketFamilyHint: 'goals_ou',
    }));
    expect(signal.summaryVi.toLowerCase()).toContain('live odds');
    expect(signal.summaryEn.toLowerCase()).toContain('no live odds');
  });
});
