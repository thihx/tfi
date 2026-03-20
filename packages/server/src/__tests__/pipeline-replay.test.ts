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
    theOddsApiKey: 'test-the-odds-key',
    theOddsApiBaseUrl: 'https://the-odds-api.example.com/v4',
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
    expect(output.allPassed).toBe(true);
  });

  test('uses production resolver order for recorded odds fixtures', async () => {
    const output = await runReplayScenario({
      name: 'recorded-the-odds-fallback',
      matchId: '100',
      fixture: makeFixture(),
      statistics: makeStats(),
      events: makeEvents(),
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
      theOddsEventsResponse: [{
        id: 'event-1',
        sport_key: 'soccer_epl',
        sport_title: 'EPL',
        commence_time: '2026-03-20T12:00:00Z',
        home_team: 'Arsenal',
        away_team: 'Chelsea',
      }],
      theOddsEventOddsResponse: {
        id: 'event-1',
        sport_key: 'soccer_epl',
        sport_title: 'EPL',
        commence_time: '2026-03-20T12:00:00Z',
        home_team: 'Arsenal',
        away_team: 'Chelsea',
        bookmakers: [{
          key: 'fallback',
          title: 'FallbackBook',
          last_update: '2026-03-20T12:45:00Z',
          markets: [{
            key: 'totals',
            last_update: '2026-03-20T12:45:00Z',
            outcomes: [
              { name: 'Over', price: 1.8, point: 2.5 },
              { name: 'Under', price: 2.05, point: 2.5 },
            ],
          }],
        }],
      },
      expected: {
        oddsSource: 'the-odds-api',
        saved: false,
        notified: false,
      },
    });

    expect(output.result.debug?.oddsSource).toBe('the-odds-api');
    expect(output.allPassed).toBe(true);
  });
});
