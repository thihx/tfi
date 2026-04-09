import { describe, expect, test } from 'vitest';
import type { SettledReplayScenario } from '../lib/db-replay-scenarios.js';
import {
  buildReplayMarketOpportunity,
  summarizeReplayMarketOpportunities,
} from '../lib/replay-market-opportunities.js';

function makeScenario(responseBets: Array<{ name: string; values: Array<{ value: string; odd: string; handicap?: string }> }>, minute = 55, score = '1-1'): SettledReplayScenario {
  return {
    name: 'sample',
    matchId: '1',
    fixture: {} as never,
    watchlistEntry: {} as never,
    pipelineOptions: {} as never,
    statistics: [],
    events: [],
    mockResolvedOdds: {
      oddsSource: 'live',
      response: [
        {
          bookmakers: [
            {
              id: 0,
              name: 'Test',
              bets: responseBets,
            },
          ],
        },
      ],
    } as never,
    expectedInput: {} as never,
    settlementContext: {} as never,
    metadata: {
      recommendationId: 1,
      originalPromptVersion: 'v8-market-balance-followup-b',
      originalAiModel: 'test',
      originalBetMarket: 'under_2.5',
      originalSelection: 'Under 2.5 Goals @1.90',
      originalResult: 'loss',
      originalPnl: -1,
      minute,
      score,
      status: '2H',
      league: 'Test League',
      homeTeam: 'Home',
      awayTeam: 'Away',
      evidenceMode: 'full_live_data',
      prematchStrength: 'strong',
      profileCoverageBand: 'high',
      overlayCoverageBand: 'neutral',
      policyImpactBand: 'none',
    },
    previousRecommendations: [],
  };
}

describe('replay market opportunities', () => {
  test('classifies 1x2 home as available but too cheap under min odds', () => {
    const row = buildReplayMarketOpportunity(makeScenario([
      {
        name: 'Match Winner',
        values: [
          { value: 'Home', odd: '1.33' },
          { value: 'Draw', odd: '4.0' },
          { value: 'Away', odd: '9.0' },
        ],
      },
    ]), 1.5);

    expect(row.has1x2Home).toBe(true);
    expect(row.playable1x2Home).toBe(false);
    expect(row.oneX2HomeOdds).toBe(1.33);
  });

  test('classifies asian handicap home as playable when line and odds exist', () => {
    const row = buildReplayMarketOpportunity(makeScenario([
      {
        name: 'Asian Handicap',
        values: [
          { value: 'Home', handicap: '-0.25', odd: '1.82' },
          { value: 'Away', handicap: '+0.25', odd: '2.02' },
        ],
      },
    ]), 1.5);

    expect(row.hasAsianHandicapHome).toBe(true);
    expect(row.playableAsianHandicapHome).toBe(true);
    expect(row.asianHandicapLine).toBe(-0.25);
    expect(row.asianHandicapHomeOdds).toBe(1.82);
  });

  test('summarizes minute-band opportunity counts', () => {
    const rows = [
      buildReplayMarketOpportunity(makeScenario([
        {
          name: 'Match Winner',
          values: [
            { value: 'Home', odd: '1.62' },
            { value: 'Draw', odd: '3.7' },
            { value: 'Away', odd: '5.4' },
          ],
        },
      ], 55, '1-1'), 1.5),
      buildReplayMarketOpportunity(makeScenario([
        {
          name: 'Match Winner',
          values: [
            { value: 'Home', odd: '1.33' },
            { value: 'Draw', odd: '4.1' },
            { value: 'Away', odd: '8.8' },
          ],
        },
      ], 55, '0-0'), 1.5),
    ];

    const summary = summarizeReplayMarketOpportunities(rows);
    expect(summary.total).toBe(2);
    expect(summary.has1x2Home).toBe(2);
    expect(summary.playable1x2Home).toBe(1);
    expect(summary.byMinuteBand).toHaveLength(1);
    expect(summary.byMinuteBand[0]?.bucket).toBe('45-59');
    expect(summary.byMinuteBand[0]?.playable1x2Home).toBe(1);
  });

  test('detects first-half goals O/U and H1 1x2 from canonical builder', () => {
    const row = buildReplayMarketOpportunity(makeScenario([
      {
        name: 'Match Winner',
        values: [
          { value: 'Home', odd: '1.62' },
          { value: 'Draw', odd: '3.7' },
          { value: 'Away', odd: '5.4' },
        ],
      },
      {
        name: 'Over/Under First Half',
        values: [
          { value: 'Over', odd: '2.05', handicap: '1.5' },
          { value: 'Under', odd: '1.75', handicap: '1.5' },
        ],
      },
      {
        name: '1st Half Match Winner',
        values: [
          { value: 'Home', odd: '2.2' },
          { value: 'Draw', odd: '2.4' },
          { value: 'Away', odd: '4.5' },
        ],
      },
    ]), 1.5);

    expect(row.hasHtGoalsOu).toBe(true);
    expect(row.hasHt1x2Home).toBe(true);
    expect(row.playableHt1x2Home).toBe(true);
    expect(row.ht1x2HomeOdds).toBe(2.2);
  });
});
