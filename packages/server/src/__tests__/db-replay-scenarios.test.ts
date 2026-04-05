import {
  buildMockResolvedOdds,
  buildSettledReplayScenario,
  canonicalOddsToRecordedResponse,
  compactStatsToApiFixtureStats,
} from '../lib/db-replay-scenarios.js';

describe('db replay scenarios', () => {
  test('compactStatsToApiFixtureStats converts snapshot pairs into raw provider stat rows', () => {
    const stats = compactStatsToApiFixtureStats(
      {
        possession: { home: '55%', away: '45%' },
        shots: { home: 9, away: 4 },
        expected_goals: { home: '1.24', away: '0.61' },
      },
      'Home FC',
      'Away FC',
    );

    expect(stats).toHaveLength(2);
    expect(stats[0]?.team.name).toBe('Home FC');
    expect(stats[1]?.team.name).toBe('Away FC');
    expect(stats[0]?.statistics).toEqual(expect.arrayContaining([
      { type: 'Ball Possession', value: '55%' },
      { type: 'Total Shots', value: 9 },
      { type: 'expected_goals', value: '1.24' },
    ]));
    expect(stats[1]?.statistics).toEqual(expect.arrayContaining([
      { type: 'Ball Possession', value: '45%' },
      { type: 'Total Shots', value: 4 },
      { type: 'expected_goals', value: '0.61' },
    ]));
  });

  test('canonicalOddsToRecordedResponse builds a normalized bookmaker response', () => {
    const response = canonicalOddsToRecordedResponse({
      '1x2': { home: 2.1, draw: 3.2, away: 3.8 },
      ou: { line: 2.5, over: 1.95, under: 1.9 },
      corners_ou: { line: 10.5, over: 1.85, under: 1.92 },
      btts: { yes: 1.8, no: 1.95 },
    }) as Array<{ bookmakers: Array<{ bets: Array<{ name: string }> }> }>;

    expect(response).toHaveLength(1);
    expect(response[0]?.bookmakers[0]?.bets).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'Match Winner' }),
      expect.objectContaining({ name: 'Over/Under' }),
      expect.objectContaining({ name: 'Corners Over/Under' }),
      expect.objectContaining({ name: 'Both Teams Score' }),
    ]));
  });

  test('buildMockResolvedOdds wraps canonical odds into a usable resolver result', () => {
    const result = buildMockResolvedOdds({
      ou: { line: 2.5, over: 2.02, under: 1.82 },
    });

    expect(result.oddsSource).toBe('live');
    expect(result.freshness).toBe('fresh');
    expect(Array.isArray(result.response)).toBe(true);
  });

  test('buildSettledReplayScenario produces a replay-ready scenario with settlement context', () => {
    const scenario = buildSettledReplayScenario(
      {
        recommendation_id: 88,
        match_id: '1504751',
        timestamp: '2026-04-05T03:30:00.000Z',
        league: 'J1 League',
        home_team: 'Machida Zelvia',
        away_team: 'FC Tokyo',
        status: '2H',
        minute: 58,
        score: '0-0',
        selection: 'Under 2.5 Goals @1.92',
        bet_market: 'under_2.5',
        odds: 1.92,
        confidence: 6,
        stake_percent: 3,
        reasoning: 'Slow game.',
        reasoning_vi: 'Nhịp trận chậm.',
        ai_model: 'gemini-3-pro-preview',
        mode: 'B',
        result: 'win',
        pnl: 2.76,
        prompt_version: 'v6-betting-discipline-c',
        odds_snapshot: {
          ou: { line: 2.5, over: 2.02, under: 1.82 },
        },
        stats_snapshot: {
          shots: { home: 8, away: 4 },
          shots_on_target: { home: 2, away: 1 },
          expected_goals: { home: '0.84', away: '0.31' },
        },
        decision_context: {
          evidenceMode: 'full_live_data',
          prematchStrength: 'strong',
          profileCoverageBand: 'high',
          overlayCoverageBand: 'low',
          policyImpactBand: 'neutral',
        },
        league_id: 98,
        league_name: 'J1 League',
        home_team_id: 303,
        away_team_id: 292,
        kickoff_at_utc: '2026-04-05T03:00:00.000Z',
        date: '2026-04-05',
        kickoff: '12:00',
        venue: 'Tokyo Stadium',
        final_status: 'FT',
        home_score: 1,
        away_score: 0,
        regular_home_score: 1,
        regular_away_score: 0,
        settlement_stats: [
          { type: 'Total Shots', home: 12, away: 7 },
        ],
      },
      [{
        minute: 44,
        odds: 1.94,
        bet_market: 'under_3.0',
        selection: 'Under 3.0 Goals @1.94',
        score: '0-0',
        result: 'win',
        status: 'HT',
        confidence: 6,
        stake_percent: 2,
        reasoning: 'Earlier note.',
      }],
    );

    expect(scenario.name).toContain('1504751');
    expect(scenario.pipelineOptions?.forceAnalyze).toBe(true);
    expect(scenario.pipelineOptions?.skipProceedGate).toBe(true);
    expect(scenario.pipelineOptions?.skipStalenessGate).toBe(true);
    expect(scenario.metadata.prematchStrength).toBe('strong');
    expect(scenario.settlementContext.regularHomeScore).toBe(1);
    expect(scenario.previousRecommendations).toHaveLength(1);
    expect(scenario.statistics?.[0]?.statistics).toEqual(expect.arrayContaining([
      { type: 'Total Shots', value: 8 },
      { type: 'Shots on Goal', value: 2 },
      { type: 'expected_goals', value: '0.84' },
    ]));
  });
});
