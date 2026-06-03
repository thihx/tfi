import {
  buildMockResolvedOdds,
  buildSettledReplayScenario,
  canonicalOddsToRecordedResponse,
  compactStatsToApiFixtureStats,
  mergeHtMarketsIntoSnapshot,
} from '../lib/db-replay-scenarios.js';
import { buildOddsCanonical } from '../lib/server-pipeline.js';

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

  test('canonicalOddsToRecordedResponse round-trips ht_* markets through buildOddsCanonical', () => {
    const response = canonicalOddsToRecordedResponse({
      '1x2': { home: 2.0, draw: 3.0, away: 4.0 },
      ht_1x2: { home: 2.2, draw: 2.4, away: 4.5 },
      ht_ou: { line: 1.5, over: 2.05, under: 1.75 },
      ht_btts: { yes: 2.1, no: 1.72 },
      ht_ah: { line: -0.5, home: 1.92, away: 1.88 },
    }) as unknown[];
    const built = buildOddsCanonical(response);
    expect(built.canonical['ht_1x2']?.home).toBe(2.2);
    expect(built.canonical['ht_ou']?.line).toBe(1.5);
    expect(built.canonical['ht_btts']?.yes).toBe(2.1);
    expect(built.canonical['ht_ah']?.line).toBe(-0.5);
  });

  test('canonicalOddsToRecordedResponse preserves adjacent and extra ladder lines', () => {
    const response = canonicalOddsToRecordedResponse({
      ou: { line: 2.5, over: 1.95, under: 1.9 },
      ou_adjacent: { line: 2.75, over: 2.12, under: 1.78 },
      ou_extra: [{ line: 3.75, over: 2.45, under: 1.55 }],
      ah: { line: 0, home: 1.8, away: 2.05 },
      ah_adjacent: { line: -0.25, home: 2.1, away: 1.76 },
      ah_extra: [{ line: 0.5, home: 1.62, away: 2.35 }],
      ht_ou: { line: 1.0, over: 1.85, under: 1.95 },
      ht_ou_adjacent: { line: 1.25, over: 2.05, under: 1.78 },
      ht_ah: { line: 0, home: 1.91, away: 1.91 },
      ht_ah_adjacent: { line: 0.25, home: 1.7, away: 2.2 },
    }) as unknown[];

    const built = buildOddsCanonical(response);
    const goalLines = [
      built.canonical.ou,
      built.canonical.ou_adjacent,
      ...(built.canonical.ou_extra ?? []),
    ].map((row) => row?.line);
    const ahLines = [
      built.canonical.ah,
      built.canonical.ah_adjacent,
      ...(built.canonical.ah_extra ?? []),
    ].map((row) => row?.line);
    const htGoalLines = [
      built.canonical.ht_ou,
      built.canonical.ht_ou_adjacent,
      ...(built.canonical.ht_ou_extra ?? []),
    ].map((row) => row?.line);
    const htAhLines = [
      built.canonical.ht_ah,
      built.canonical.ht_ah_adjacent,
      ...(built.canonical.ht_ah_extra ?? []),
    ].map((row) => row?.line);

    expect(goalLines).toEqual(expect.arrayContaining([2.5, 2.75, 3.75]));
    expect(ahLines).toEqual(expect.arrayContaining([0, -0.25, 0.5]));
    expect(htGoalLines).toEqual(expect.arrayContaining([1, 1.25]));
    expect(htAhLines).toEqual(expect.arrayContaining([0, 0.25]));
  });

  test('mergeHtMarketsIntoSnapshot copies H1 markets from provider response when snapshot omits them', () => {
    const providerLike = canonicalOddsToRecordedResponse({
      ou: { line: 2.5, over: 1.9, under: 1.9 },
      ht_ou: { line: 1.5, over: 2.0, under: 1.8 },
      ht_1x2: { home: 2.5, draw: 2.9, away: 3.2 },
    }) as unknown[];
    const merged = mergeHtMarketsIntoSnapshot({ ou: { line: 2.5, over: 1.91, under: 1.89 } }, providerLike);
    expect(merged.ht_ou).toEqual({ line: 1.5, over: 2, under: 1.8 });
    expect(merged['ht_1x2']).toEqual({ home: 2.5, draw: 2.9, away: 3.2 });
    expect(merged.ou).toEqual({ line: 2.5, over: 1.91, under: 1.89 });
  });

  test('mergeHtMarketsIntoSnapshot does not overwrite existing ht_ou on snapshot', () => {
    const providerLike = canonicalOddsToRecordedResponse({
      ht_ou: { line: 2.5, over: 2.1, under: 1.7 },
    }) as unknown[];
    const merged = mergeHtMarketsIntoSnapshot({ ht_ou: { line: 1.5, over: 1.95, under: 1.85 } }, providerLike);
    expect(merged.ht_ou).toEqual({ line: 1.5, over: 1.95, under: 1.85 });
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
        ai_model: 'gemini-3.5-flash',
        mode: 'B',
        result: 'win',
        pnl: 2.76,
        prompt_version: 'v10-hybrid-legacy-g',
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
        halftime_home: 0,
        halftime_away: 0,
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
    expect(scenario.metadata.performanceMemoryKey).toBe('under_2.5|45-59|0-0');
    expect(scenario.metadata.performanceMemoryStatus).toBe('no_history');
    expect(scenario.performanceMemorySnapshot).toEqual(expect.objectContaining({
      key: 'under_2.5|45-59|0-0',
      lookupResult: { status: 'no_history' },
    }));
    expect(scenario.settlementContext.regularHomeScore).toBe(1);
    expect(scenario.fixture.score?.halftime).toEqual({ home: 0, away: 0 });
    expect(scenario.previousRecommendations).toHaveLength(1);
    expect(scenario.statistics?.[0]?.statistics).toEqual(expect.arrayContaining([
      { type: 'Total Shots', value: 8 },
      { type: 'Shots on Goal', value: 2 },
      { type: 'expected_goals', value: '0.84' },
    ]));
    expect(Array.isArray(scenario.liveOddsResponse)).toBe(true);
    expect(scenario.liveOddsResponse!.length).toBeGreaterThan(0);
    expect(scenario.liveOddsResponse).toBe(scenario.mockResolvedOdds?.response);
    expect(JSON.parse(scenario.mockAiText ?? '{}')).toEqual(expect.objectContaining({
      should_push: true,
      selection: 'Under 2.5 Goals @1.92',
      bet_market: 'under_2.5',
      confidence: 6,
      stake_percent: 3,
    }));
  });

  test('buildSettledReplayScenario carries a hydrated performance memory snapshot', () => {
    const scenario = buildSettledReplayScenario(
      {
        recommendation_id: 89,
        match_id: '1504752',
        timestamp: '2026-04-05T03:30:00.000Z',
        league: 'J1 League',
        home_team: 'Machida Zelvia',
        away_team: 'FC Tokyo',
        status: '2H',
        minute: 66,
        score: '1-1',
        selection: 'Over 2.5 Goals @1.92',
        bet_market: 'over_2.5',
        odds: 1.92,
        confidence: 6,
        stake_percent: 3,
        reasoning: 'Open game.',
        reasoning_vi: 'Open game.',
        ai_model: 'gemini-3.5-flash',
        mode: 'B',
        result: 'loss',
        pnl: -3,
        prompt_version: 'v10-hybrid-legacy-g',
        odds_snapshot: { ou: { line: 2.5, over: 1.92, under: 1.92 } },
        stats_snapshot: { shots: { home: 8, away: 8 } },
        decision_context: {},
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
        away_score: 1,
        regular_home_score: 1,
        regular_away_score: 1,
        halftime_home: 0,
        halftime_away: 0,
        settlement_stats: [],
      },
      [],
      {
        key: 'over_2.5|60-74|level',
        canonicalMarket: 'over_2.5',
        minuteBand: '60-74',
        scoreState: 'level',
        lookupResult: {
          status: 'found',
          record: {
            key: 'over_2.5|60-74|level',
            canonicalMarket: 'over_2.5',
            minuteBand: '60-74',
            scoreState: 'level',
            total: 12,
            wins: 3,
            losses: 9,
            halfWins: 0,
            halfLosses: 0,
            pushes: 0,
            empiricalWinRate: 0.25,
            sampleReliable: true,
            lastUpdated: '2026-04-06T00:00:00.000Z',
          },
        },
        source: 'db',
      },
    );

    expect(scenario.metadata.performanceMemoryKey).toBe('over_2.5|60-74|level');
    expect(scenario.metadata.performanceMemoryStatus).toBe('found');
    expect(scenario.performanceMemorySnapshot?.lookupResult.record?.empiricalWinRate).toBe(0.25);
  });
});
