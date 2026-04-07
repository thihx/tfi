import { beforeEach, describe, expect, test, vi } from 'vitest';

vi.mock('../repos/settings.repo.js', () => ({
  getSettings: vi.fn().mockResolvedValue({
    TELEGRAM_CHAT_ID: '123456',
    AI_MODEL: 'gemini-test',
    MIN_CONFIDENCE: 5,
    MIN_ODDS: 1.5,
    MIN_MINUTE: 5,
    MAX_MINUTE: 85,
    SECOND_HALF_START_MINUTE: 5,
    REANALYZE_MIN_MINUTES: 10,
    STALENESS_ODDS_DELTA: 0.1,
    LATE_PHASE_MINUTE: 75,
    VERY_LATE_PHASE_MINUTE: 85,
    ENDGAME_MINUTE: 88,
  }),
}));

vi.mock('../config.js', () => ({
  config: {
    databaseUrl: 'postgresql://test:test@localhost:5432/test',
    timezone: 'Asia/Seoul',
    geminiApiKey: 'test-key',
    geminiModel: 'gemini-test',
    telegramBotToken: 'test-bot',
    pipelineTelegramChatId: '123456',
    pipelineEnabled: true,
    pipelineBatchSize: 3,
    pipelineMinOdds: 1.5,
    pipelineMinConfidence: 5,
    pipelineMinMinute: 5,
    pipelineMaxMinute: 85,
    pipelineSecondHalfStartMinute: 5,
    pipelineReanalyzeMinMinutes: 10,
    pipelineStalenessOddsDelta: 0.1,
    pipelineLatePhaseMinute: 75,
    pipelineVeryLatePhaseMinute: 85,
    pipelineEndgameMinute: 88,
    providerSamplingEnabled: true,
  },
}));

vi.mock('../lib/audit.js', () => ({
  audit: vi.fn(),
}));

vi.mock('../repos/provider-odds-cache.repo.js', () => ({
  getProviderOddsCache: vi.fn().mockResolvedValue(null),
  upsertProviderOddsCache: vi.fn().mockResolvedValue(null),
}));

const { runReplayScenario } = await import('../lib/pipeline-replay.js');

function makeFixture() {
  return {
    fixture: {
      id: 100,
      date: '2026-03-20T12:00:00Z',
      timestamp: Date.parse('2026-03-20T12:00:00Z') / 1000,
      status: { short: '2H', elapsed: 65 },
    },
    teams: {
      home: { id: 1, name: 'Arsenal', logo: '', winner: null },
      away: { id: 2, name: 'Chelsea', logo: '', winner: null },
    },
    league: {
      id: 39,
      name: 'Premier League',
      country: 'England',
      logo: '',
      flag: null,
      season: 2026,
      round: 'Regular Season - 28',
    },
    goals: { home: 1, away: 1 },
    score: {},
  };
}

function makeStats() {
  return [
    {
      team: { id: 1, name: 'Arsenal', logo: '' },
      statistics: [
        { type: 'Ball Possession', value: '55%' },
        { type: 'Total Shots', value: 12 },
        { type: 'Shots on Goal', value: 5 },
        { type: 'Corner Kicks', value: 6 },
        { type: 'Fouls', value: 10 },
      ],
    },
    {
      team: { id: 2, name: 'Chelsea', logo: '' },
      statistics: [
        { type: 'Ball Possession', value: '45%' },
        { type: 'Total Shots', value: 8 },
        { type: 'Shots on Goal', value: 3 },
        { type: 'Corner Kicks', value: 4 },
        { type: 'Fouls', value: 12 },
      ],
    },
  ];
}

function makeEvents() {
  return [
    {
      time: { elapsed: 23, extra: null },
      team: { id: 1, name: 'Arsenal', logo: '' },
      player: { id: 10, name: 'Player A' },
      assist: { id: null, name: null },
      type: 'Goal',
      detail: 'Normal Goal',
      comments: null,
    },
    {
      time: { elapsed: 55, extra: null },
      team: { id: 2, name: 'Chelsea', logo: '' },
      player: { id: 20, name: 'Player B' },
      assist: { id: null, name: null },
      type: 'Goal',
      detail: 'Normal Goal',
      comments: null,
    },
  ];
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('runReplayScenario', () => {
  test('defaults to shadow mode and does not save or notify', async () => {
    const output = await runReplayScenario({
      name: 'recorded-live-odds',
      matchId: '100',
      fixture: makeFixture(),
      statistics: makeStats(),
      events: makeEvents(),
      liveOddsResponse: [{
        fixture: { id: 100 },
        odds: [{
          id: 1,
          name: 'Over/Under',
          values: [
            { value: 'Over', odd: '1.85', handicap: '2.5' },
            { value: 'Under', odd: '2.00', handicap: '2.5' },
          ],
        }],
      }],
      expected: {
        shouldPush: true,
        oddsSource: 'live',
        saved: false,
        notified: false,
        selectionContains: 'Over 2.5',
      },
    });

    expect(output.shadowMode).toBe(true);
    expect(output.result.saved).toBe(false);
    expect(output.result.notified).toBe(false);
    expect(output.result.debug?.shadowMode).toBe(true);
    expect(output.result.debug?.oddsSource).toBe('live');
    expect(output.result.debug?.promptVersion).toBeTruthy();
    expect(output.result.debug?.promptChars).toBeGreaterThan(0);
    expect(output.result.debug?.promptEstimatedTokens).toBeGreaterThan(0);
    expect(output.result.debug?.aiTextChars).toBeGreaterThan(0);
    expect(output.result.debug?.aiTextEstimatedTokens).toBeGreaterThan(0);
    expect(output.result.debug?.totalLatencyMs).toBeGreaterThanOrEqual(0);
    expect(output.allPassed).toBe(true);
  });

  test('uses production resolver order for recorded odds fixtures', async () => {
    const output = await runReplayScenario({
      name: 'recorded-live-empty-prematch',
      matchId: '100',
      fixture: {
        ...makeFixture(),
        fixture: {
          ...makeFixture().fixture,
          status: { short: 'NS', elapsed: null as unknown as number },
        },
      },
      statistics: makeStats(),
      events: makeEvents(),
      pipelineOptions: {
        skipProceedGate: true,
        forceAnalyze: true,
      },
      liveOddsResponse: [],
      preMatchOddsResponse: [{
        fixture: { id: 100 },
        bookmakers: [{
          id: 1,
          name: 'PrematchBook',
          bets: [{
            id: 2,
            name: 'Over/Under',
            values: [
              { value: 'Over', odd: '1.95', handicap: '2.5' },
              { value: 'Under', odd: '1.90', handicap: '2.5' },
            ],
          }],
        }],
      }],
      expected: {
        oddsSource: 'reference-prematch',
        saved: false,
        notified: false,
      },
    });

    expect(output.result.debug?.oddsSource).toBe('reference-prematch');
    expect(output.allPassed).toBe(true);
  });

  test('supports manual force replay via pipeline options', async () => {
    const output = await runReplayScenario({
      name: 'manual-force-replay',
      matchId: '100',
      fixture: {
        ...makeFixture(),
        fixture: {
          ...makeFixture().fixture,
          status: { short: '1H', elapsed: 3 },
        },
        goals: { home: 0, away: 0 },
      },
      statistics: [],
      events: [],
      liveOddsResponse: [],
      pipelineOptions: {
        forceAnalyze: true,
      },
      expected: {
        analysisMode: 'manual_force',
        saved: false,
        notified: false,
      },
    });

    expect(output.result.debug?.analysisMode).toBe('manual_force');
    expect(output.allPassed).toBe(true);
  });

  test('reuses captured ai text without relying on a fresh llm call', async () => {
    const output = await runReplayScenario({
      name: 'captured-ai-text',
      matchId: '100',
      fixture: makeFixture(),
      statistics: makeStats(),
      events: makeEvents(),
      liveOddsResponse: [{
        fixture: { id: 100 },
        odds: [{
          id: 1,
          name: 'Over/Under',
          values: [
            { value: 'Over', odd: '1.95', handicap: '2.5' },
            { value: 'Under', odd: '1.90', handicap: '2.5' },
          ],
        }],
      }],
    }, {
      llmMode: 'real',
      capturedAiText: JSON.stringify({
        should_push: true,
        ai_should_push: true,
        selection: 'Under 2.5 Goals @1.90',
        bet_market: 'under_2.5',
        confidence: 6,
        reasoning_en: 'Cached replay output.',
        reasoning_vi: 'Cached replay output.',
        warnings: [],
        value_percent: 6,
        risk_level: 'MEDIUM',
        stake_percent: 3,
        condition_triggered_suggestion: '',
        custom_condition_matched: false,
      }),
    });

    expect(output.result.selection).toContain('Under 2.5 Goals');
    expect(output.result.debug?.aiText).toContain('Cached replay output');
  });

  test('supports prompt version override for candidate replay', async () => {
    const output = await runReplayScenario({
      name: 'candidate-prompt-replay',
      matchId: '100',
      fixture: makeFixture(),
      statistics: makeStats(),
      events: makeEvents(),
      liveOddsResponse: [{
        fixture: { id: 100 },
        odds: [{
          id: 1,
          name: 'Over/Under',
          values: [
            { value: 'Over', odd: '1.85', handicap: '2.5' },
            { value: 'Under', odd: '2.00', handicap: '2.5' },
          ],
        }],
      }],
    }, {
      promptVersionOverride: 'v5-compact-a',
    });

    expect(output.result.debug?.promptVersion).toBe('v5-compact-a');
    expect(output.result.debug?.promptChars).toBeGreaterThan(0);
  });

  test('asserts evidenceMode and statsSource metadata when provided', async () => {
    const output = await runReplayScenario({
      name: 'metadata-assertions',
      matchId: '100',
      fixture: makeFixture(),
      statistics: makeStats(),
      events: makeEvents(),
      liveOddsResponse: [{
        fixture: { id: 100 },
        odds: [{
          id: 1,
          name: 'Over/Under',
          values: [
            { value: 'Over', odd: '1.85', handicap: '2.5' },
            { value: 'Under', odd: '2.00', handicap: '2.5' }
          ]
        }]
      }],
      expected: {
        analysisMode: 'auto',
        evidenceMode: 'full_live_data',
        statsSource: 'api-football',
        oddsSource: 'live',
      },
    });

    expect(output.assertions.find((item) => item.field === 'evidenceMode')?.pass).toBe(true);
    expect(output.assertions.find((item) => item.field === 'statsSource')?.pass).toBe(true);
    expect(output.allPassed).toBe(true);
  });

  test('supports betMarket assertions and disallowed market prefixes', async () => {
    const output = await runReplayScenario({
      name: 'bet-market-assertions',
      matchId: '100',
      fixture: makeFixture(),
      statistics: makeStats(),
      events: makeEvents(),
      liveOddsResponse: [{
        fixture: { id: 100 },
        odds: [{
          id: 1,
          name: 'Over/Under',
          values: [
            { value: 'Over', odd: '1.85', handicap: '2.5' },
            { value: 'Under', odd: '2.00', handicap: '2.5' },
          ],
        }],
      }],
      mockAiText: JSON.stringify({
        should_push: true,
        ai_should_push: true,
        selection: 'Over 2.5 Goals @1.85',
        bet_market: 'over_2.5',
        confidence: 7,
        reasoning_en: 'Value stays with Over 2.5.',
        reasoning_vi: 'Van co gia tri cho Over 2.5.',
        warnings: ['DISCIPLINED_EDGE'],
        value_percent: 9,
        risk_level: 'MEDIUM',
        stake_percent: 3,
        condition_triggered_suggestion: '',
        custom_condition_matched: false,
      }),
      expected: {
        betMarket: 'over_2.5',
        disallowedBetMarketPrefixes: ['1x2_', 'btts_'],
        warningContains: 'DISCIPLINED_EDGE',
      },
    }, { llmMode: 'mock' });

    expect(output.assertions.find((item) => item.field === 'betMarket')?.pass).toBe(true);
    expect(output.assertions.find((item) => item.field === 'disallowedBetMarketPrefixes')?.pass).toBe(true);
    expect(output.assertions.find((item) => item.field === 'warningContains')?.pass).toBe(true);
    expect(output.allPassed).toBe(true);
  });

  test('fails when a disallowed bet market prefix is selected', async () => {
    const output = await runReplayScenario({
      name: 'disallowed-market',
      matchId: '100',
      fixture: makeFixture(),
      statistics: makeStats(),
      events: makeEvents(),
      liveOddsResponse: [{
        fixture: { id: 100 },
        odds: [{
          id: 1,
          name: 'Match Winner',
          values: [
            { value: 'Home', odd: '1.90' },
            { value: 'Draw', odd: '3.40' },
            { value: 'Away', odd: '4.50' },
          ],
        }],
      }],
      mockAiText: JSON.stringify({
        should_push: true,
        ai_should_push: true,
        selection: 'Home Win @1.90',
        bet_market: '1x2_home',
        confidence: 7,
        reasoning_en: 'Mock 1x2 pick.',
        reasoning_vi: 'Mock 1x2 pick.',
        warnings: [],
        value_percent: 6,
        risk_level: 'MEDIUM',
        stake_percent: 2,
        condition_triggered_suggestion: '',
        custom_condition_matched: false,
      }),
      expected: {
        disallowedBetMarketPrefixes: ['1x2_'],
      },
    }, { llmMode: 'mock' });

    expect(output.assertions.find((item) => item.field === 'disallowedBetMarketPrefixes')?.pass).toBe(false);
    expect(output.allPassed).toBe(false);
  });
});
