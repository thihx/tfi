import {
  buildEvaluatedReplayCase,
  getReplayMinuteBand,
  getReplayScoreState,
  summarizeSettledReplayVariant,
} from '../lib/settled-replay-evaluation.js';

describe('settled replay evaluation', () => {
  test('classifies replay minute bands and score states', () => {
    expect(getReplayMinuteBand(12)).toBe('00-29');
    expect(getReplayMinuteBand(37)).toBe('30-44');
    expect(getReplayMinuteBand(55)).toBe('45-59');
    expect(getReplayMinuteBand(66)).toBe('60-74');
    expect(getReplayMinuteBand(82)).toBe('75+');

    expect(getReplayScoreState('0-0')).toBe('0-0');
    expect(getReplayScoreState('1-1')).toBe('level');
    expect(getReplayScoreState('1-0')).toBe('one-goal-margin');
    expect(getReplayScoreState('3-0')).toBe('two-plus-margin');
  });

  test('summarizes under share, no-bet rate, and accuracy by cohort', () => {
    const rows = [
      buildEvaluatedReplayCase(
        'v6-betting-discipline-c',
        {
          name: 'case-a',
          matchId: '1',
          fixture: {} as never,
          metadata: {
            recommendationId: 1,
            originalPromptVersion: 'v6-betting-discipline-c',
            originalAiModel: 'gemini',
            originalBetMarket: 'under_2.5',
            originalSelection: '',
            originalResult: 'win',
            originalPnl: 2,
            minute: 34,
            score: '0-0',
            status: '1H',
            league: 'A',
            homeTeam: 'Home',
            awayTeam: 'Away',
            evidenceMode: 'full_live_data',
            prematchStrength: 'strong',
            profileCoverageBand: 'high',
            overlayCoverageBand: 'low',
            policyImpactBand: 'neutral',
          },
          settlementContext: {
            matchId: '1',
            homeTeam: 'Home',
            awayTeam: 'Away',
            finalStatus: 'FT',
            homeScore: 0,
            awayScore: 0,
            regularHomeScore: 0,
            regularAwayScore: 0,
            settlementStats: [],
          },
        },
        {
          scenarioName: 'case-a',
          llmMode: 'mock',
          oddsMode: 'mock',
          shadowMode: false,
          sampleProviderData: false,
          assertions: [],
          allPassed: true,
          result: {
            matchId: '1',
            success: true,
            decisionKind: 'ai_push',
            shouldPush: true,
            selection: 'Under 2.5 Goals @1.90',
            confidence: 6,
            saved: false,
            notified: false,
            debug: { parsed: { bet_market: 'under_2.5' }, shadowMode: false },
          },
        },
        'win',
      ),
      buildEvaluatedReplayCase(
        'v6-betting-discipline-c',
        {
          name: 'case-b',
          matchId: '2',
          fixture: {} as never,
          metadata: {
            recommendationId: 2,
            originalPromptVersion: 'v6-betting-discipline-c',
            originalAiModel: 'gemini',
            originalBetMarket: 'over_2.5',
            originalSelection: '',
            originalResult: 'loss',
            originalPnl: -3,
            minute: 61,
            score: '1-0',
            status: '2H',
            league: 'A',
            homeTeam: 'Home',
            awayTeam: 'Away',
            evidenceMode: 'full_live_data',
            prematchStrength: 'strong',
            profileCoverageBand: 'high',
            overlayCoverageBand: 'low',
            policyImpactBand: 'neutral',
          },
          settlementContext: {
            matchId: '2',
            homeTeam: 'Home',
            awayTeam: 'Away',
            finalStatus: 'FT',
            homeScore: 3,
            awayScore: 0,
            regularHomeScore: 3,
            regularAwayScore: 0,
            settlementStats: [],
          },
        },
        {
          scenarioName: 'case-b',
          llmMode: 'mock',
          oddsMode: 'mock',
          shadowMode: false,
          sampleProviderData: false,
          assertions: [],
          allPassed: true,
          result: {
            matchId: '2',
            success: true,
            decisionKind: 'no_bet',
            shouldPush: false,
            selection: 'No bet',
            confidence: 0,
            saved: false,
            notified: false,
            debug: { parsed: { bet_market: '' }, shadowMode: false },
          },
        },
        null,
      ),
    ];

    const summary = summarizeSettledReplayVariant('v6-betting-discipline-c', rows);

    expect(summary.totalScenarios).toBe(2);
    expect(summary.pushCount).toBe(1);
    expect(summary.noBetCount).toBe(1);
    expect(summary.goalsUnderCount).toBe(1);
    expect(summary.goalsOverCount).toBe(0);
    expect(summary.goalsUnderShare).toBe(1);
    expect(summary.accuracy).toBe(1);
    expect(summary.byMinuteBand).toEqual(expect.arrayContaining([
      expect.objectContaining({ bucket: '30-44', goalsUnderCount: 1 }),
      expect.objectContaining({ bucket: '60-74', noBetCount: 1 }),
    ]));
    expect(summary.byScoreState).toEqual(expect.arrayContaining([
      expect.objectContaining({ bucket: '0-0', goalsUnderCount: 1 }),
      expect.objectContaining({ bucket: 'one-goal-margin', noBetCount: 1 }),
    ]));
  });
});
