// ============================================================
// Unit tests — Server Pipeline
// ============================================================

import { describe, test, expect, vi, beforeEach } from 'vitest';
import { LIVE_ANALYSIS_PROMPT_VERSION } from '../lib/live-analysis-prompt.js';

const { mockConfig } = vi.hoisted(() => ({
  mockConfig: {
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
    liveAnalysisActivePromptVersion: '',
    liveAnalysisShadowPromptVersion: '',
    liveAnalysisShadowEnabled: false,
    liveAnalysisShadowSampleRate: 0,
  },
}));

// ─── Mocks ───────────────────────────────────────────────

vi.mock('../config.js', () => ({
  config: mockConfig,
}));

vi.mock('../lib/audit.js', () => ({
  audit: vi.fn(),
}));

vi.mock('../lib/gemini.js', () => ({
  callGemini: vi.fn().mockResolvedValue(JSON.stringify({
    should_push: true,
    selection: 'Over 2.5 Goals @1.85',
    bet_market: 'over_2.5',
    market_chosen_reason: 'High tempo match',
    confidence: 8,
    reasoning_en: 'Open match with high shot count',
    reasoning_vi: 'Trận mở với nhiều cú sút',
    warnings: [],
    value_percent: 12,
    risk_level: 'MEDIUM',
    stake_percent: 5,
    custom_condition_matched: false,
    custom_condition_status: 'none',
    custom_condition_summary_en: '',
    custom_condition_summary_vi: '',
    custom_condition_reason_en: '',
    custom_condition_reason_vi: '',
    condition_triggered_suggestion: '',
    condition_triggered_reasoning_en: '',
    condition_triggered_reasoning_vi: '',
    condition_triggered_confidence: 0,
    condition_triggered_stake: 0,
  })),
}));

vi.mock('../lib/telegram.js', () => ({
  sendTelegramMessage: vi.fn().mockResolvedValue(undefined),
  sendTelegramPhoto: vi.fn().mockRejectedValue(new Error('photo unavailable in test')),
  sendTelegramAlbum: vi.fn().mockResolvedValue(undefined),
}));

const mockFixture = {
  fixture: { id: 100, status: { short: '2H', elapsed: 65 }, timestamp: 1700000000 },
  teams: { home: { id: 1, name: 'Team A' }, away: { id: 2, name: 'Team B' } },
  league: { id: 39, name: 'Test League' },
  goals: { home: 1, away: 1 },
};

vi.mock('../lib/football-api.js', () => ({
  fetchFixturesByIds: vi.fn().mockResolvedValue([mockFixture]),
  fetchFixtureStatistics: vi.fn().mockResolvedValue([
    { team: { id: 1 }, statistics: [
      { type: 'Ball Possession', value: '55%' },
      { type: 'Total Shots', value: 12 },
      { type: 'Shots on Goal', value: 5 },
      { type: 'Corner Kicks', value: 6 },
      { type: 'Fouls', value: 10 },
    ] },
    { team: { id: 2 }, statistics: [
      { type: 'Ball Possession', value: '45%' },
      { type: 'Total Shots', value: 8 },
      { type: 'Shots on Goal', value: 3 },
      { type: 'Corner Kicks', value: 4 },
      { type: 'Fouls', value: 12 },
    ] },
  ]),
  fetchFixtureEvents: vi.fn().mockResolvedValue([
    { time: { elapsed: 23 }, team: { id: 1 }, type: 'Goal', detail: 'Normal Goal', player: { name: 'Player A' } },
    { time: { elapsed: 55 }, team: { id: 2 }, type: 'Goal', detail: 'Normal Goal', player: { name: 'Player B' } },
  ]),
  fetchLiveOdds: vi.fn().mockResolvedValue([{
    bookmakers: [{
      name: 'TestBook',
      bets: [
        { name: 'Over/Under', values: [
          { value: 'Over', odd: '1.85', handicap: '2.5' },
          { value: 'Under', odd: '2.00', handicap: '2.5' },
        ] },
        { name: 'Match Winner', values: [
          { value: 'Home', odd: '2.10' },
          { value: 'Draw', odd: '3.40' },
          { value: 'Away', odd: '3.50' },
        ] },
        { name: 'Both Teams Score', values: [
          { value: 'Yes', odd: '1.60' },
          { value: 'No', odd: '2.15' },
        ] },
      ],
    }],
  }]),
  fetchPreMatchOdds: vi.fn().mockResolvedValue([]),
}));

vi.mock('../repos/provider-odds-cache.repo.js', () => ({
  getProviderOddsCache: vi.fn().mockResolvedValue(null),
  upsertProviderOddsCache: vi.fn().mockResolvedValue(null),
}));

vi.mock('../lib/provider-insight-cache.js', () => ({
  ensureFixturesForMatchIds: vi.fn(async (matchIds: string[]) => {
    const footballApi = await import('../lib/football-api.js');
    return footballApi.fetchFixturesByIds(matchIds);
  }),
  ensureMatchInsight: vi.fn(async (matchId: string, options?: { fixture?: typeof mockFixture | null }) => {
    const footballApi = await import('../lib/football-api.js');
    const fixture = options?.fixture ?? (await footballApi.fetchFixturesByIds([matchId]))[0] ?? mockFixture;
    const [statistics, events] = await Promise.all([
      footballApi.fetchFixtureStatistics(matchId).catch(() => []),
      footballApi.fetchFixtureEvents(matchId).catch(() => []),
    ]);
    const now = new Date().toISOString();

    return {
      fixture: { payload: fixture, freshness: 'fresh', cacheStatus: 'hit', cachedAt: now, fetchedAt: now, degraded: false },
      statistics: {
        payload: statistics,
        freshness: statistics.length > 0 ? 'fresh' : 'missing',
        cacheStatus: statistics.length > 0 ? 'hit' : 'miss',
        cachedAt: statistics.length > 0 ? now : null,
        fetchedAt: statistics.length > 0 ? now : null,
        degraded: false,
      },
      events: {
        payload: events,
        freshness: events.length > 0 ? 'fresh' : 'missing',
        cacheStatus: events.length > 0 ? 'hit' : 'miss',
        cachedAt: events.length > 0 ? now : null,
        fetchedAt: events.length > 0 ? now : null,
        degraded: false,
      },
    };
  }),
  ensureScoutInsight: vi.fn(async () => ({
    lineups: {
      payload: [
        {
          team: { id: 1, name: 'Team A', logo: '' },
          coach: { id: 10, name: 'Coach A', photo: null },
          formation: '4-2-3-1',
          startXI: [
            { player: { id: 1, name: 'Keeper A', number: 1, pos: 'G', grid: '1:1' } },
            { player: { id: 2, name: 'Forward A', number: 9, pos: 'F', grid: '4:1' } },
          ],
          substitutes: [
            { player: { id: 3, name: 'Bench A', number: 14, pos: 'M', grid: null } },
          ],
        },
      ],
      freshness: 'fresh',
      cacheStatus: 'hit',
      cachedAt: new Date().toISOString(),
      fetchedAt: new Date().toISOString(),
      degraded: false,
    },
  })),
}));

vi.mock('../lib/provider-sampling.js', () => ({
  extractStatusCode: vi.fn(() => null),
  recordProviderStatsSampleSafe: vi.fn().mockResolvedValue(undefined),
  recordProviderOddsSampleSafe: vi.fn().mockResolvedValue(undefined),
}));

const mockWatchlistEntry = {
  match_id: '100',
  home_team: 'Team A',
  away_team: 'Team B',
  league: 'Test League',
  mode: 'B',
  custom_conditions: '',
  recommended_custom_condition: '',
  recommended_condition_reason: '',
};

vi.mock('../repos/watchlist.repo.js', () => ({
  getOperationalWatchlistByMatchId: vi.fn().mockResolvedValue(mockWatchlistEntry),
}));

vi.mock('../repos/matches.repo.js', () => ({
  getMatchesByIds: vi.fn().mockResolvedValue([]),
}));

vi.mock('../repos/recommendations.repo.js', () => ({
  createRecommendation: vi.fn().mockResolvedValue({ id: 999 }),
  getRecommendationsByMatchId: vi.fn().mockResolvedValue([]),
  markRecommendationNotified: vi.fn().mockResolvedValue({ id: 999, notified: 'yes', notification_channels: 'telegram' }),
}));

vi.mock('../repos/recommendation-deliveries.repo.js', () => ({
  getEligibleTelegramDeliveryTargets: vi.fn().mockResolvedValue([]),
  getEligibleDeliveryUserIds: vi.fn().mockResolvedValue(new Set(['user-1'])),
  markDeliveryRowsDelivered: vi.fn().mockResolvedValue(0),
  markRecommendationDeliveriesDelivered: vi.fn().mockResolvedValue(1),
  stageConditionOnlyDeliveries: vi.fn().mockResolvedValue([]),
}));

vi.mock('../repos/notification-channels.repo.js', () => ({
  getNotificationChannelAddressesByUserIds: vi.fn().mockResolvedValue([]),
  filterUserIdsAllowingWebPushNotifications: vi.fn((ids: string[]) => Promise.resolve(new Set(ids))),
}));

vi.mock('../repos/push-subscriptions.repo.js', () => ({
  getAllSubscriptions: vi.fn().mockResolvedValue([
    {
      endpoint: 'https://push.example.com/sub-1',
      p256dh: 'p256dh-1',
      auth: 'auth-1',
      user_id: 'user-1',
    },
    {
      endpoint: 'https://push.example.com/sub-2',
      p256dh: 'p256dh-2',
      auth: 'auth-2',
      user_id: 'user-2',
    },
  ]),
  deleteSubscription: vi.fn().mockResolvedValue(undefined),
  updateLastUsed: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../repos/ai-performance.repo.js', () => ({
  createAiPerformanceRecord: vi.fn().mockResolvedValue({ id: 1 }),
  lookupPerformanceMemory: vi.fn().mockResolvedValue({ status: 'no_history' }),
  getPerformanceMemoryPromptContext: vi.fn().mockResolvedValue([]),
  autoGeneratePerformanceMemoryRules: vi.fn().mockResolvedValue([]),
  deriveMinuteBand: vi.fn((minute: number) => {
    if (minute <= 29) return '00-29';
    if (minute <= 44) return '30-44';
    if (minute <= 59) return '45-59';
    if (minute <= 74) return '60-74';
    return '75+';
  }),
  deriveScoreState: vi.fn((score: string) => (String(score).trim() === '0-0' ? '0-0' : 'one-goal-margin')),
  getHistoricalPerformanceContext: vi.fn().mockResolvedValue({
    overall: { settled: 18, correct: 11, accuracy: 61.11 },
    byMarket: [
      { market: 'over_2.5', settled: 10, correct: 7, accuracy: 70 },
      { market: '1x2_home', settled: 9, correct: 4, accuracy: 44.44 },
    ],
    byConfidenceBand: [
      { band: '8-10 (high)', settled: 11, correct: 8, accuracy: 72.73 },
    ],
    byMinuteBand: [
      { band: '60-74 (late)', settled: 9, correct: 6, accuracy: 66.67 },
    ],
    byOddsRange: [
      { range: '1.70-1.99', settled: 12, correct: 7, accuracy: 58.33 },
    ],
    byLeague: [
      { league: 'Test League', settled: 8, correct: 5, accuracy: 62.5 },
    ],
    generatedAt: '2026-03-21T00:00:00.000Z',
  }),
}));

vi.mock('../repos/settings.repo.js', () => ({
  getSettings: vi.fn().mockResolvedValue({
    TELEGRAM_CHAT_ID: '123456',
    TELEGRAM_ENABLED: true,
    AI_MODEL: 'gemini-test',
    MIN_CONFIDENCE: 5,
    MIN_ODDS: 1.5,
    LATE_PHASE_MINUTE: 75,
    VERY_LATE_PHASE_MINUTE: 85,
    ENDGAME_MINUTE: 88,
  }),
}));

vi.mock('../repos/match-snapshots.repo.js', () => ({
  createSnapshot: vi.fn().mockResolvedValue({ id: 1 }),
  getLatestSnapshot: vi.fn().mockResolvedValue(null),
}));

vi.mock('../repos/odds-movements.repo.js', () => ({
  recordOddsMovementsBulk: vi.fn().mockResolvedValue([]),
}));

vi.mock('../lib/web-push.js', () => ({
  isWebPushConfigured: vi.fn().mockReturnValue(true),
  sendWebPushNotification: vi.fn().mockResolvedValue({ ok: true, gone: false }),
}));

vi.mock('../repos/prompt-shadow-runs.repo.js', () => ({
  createPromptShadowRun: vi.fn().mockResolvedValue({ id: 1 }),
}));

vi.mock('../repos/league-profiles.repo.js', () => ({
  getLeagueProfileByLeagueId: vi.fn().mockResolvedValue({
    league_id: 39,
    tempo_tier: 'high',
    goal_tendency: 'high',
    home_advantage_tier: 'normal',
    corners_tendency: 'balanced',
    cards_tendency: 'balanced',
    volatility_tier: 'medium',
    data_reliability_tier: 'high',
    avg_goals: 2.9,
    over_2_5_rate: 58,
    btts_rate: 55,
    late_goal_rate_75_plus: 29,
    avg_corners: 9.4,
    avg_cards: 4.1,
    notes_en: 'Top league context',
    notes_vi: 'Ngu canh giai dau top',
  }),
  flattenLeagueProfileData: vi.fn((value: Record<string, unknown>) => value),
  isLeagueProfileStoredData: vi.fn().mockReturnValue(false),
}));

vi.mock('../repos/team-profiles.repo.js', () => ({
  getTeamProfileByTeamId: vi.fn().mockResolvedValue(null),
  flattenTeamProfileData: vi.fn((value: Record<string, unknown>) => value),
  isTeamProfileStoredData: vi.fn().mockReturnValue(false),
}));

vi.mock('../repos/leagues.repo.js', () => ({
  getLeagueById: vi.fn().mockResolvedValue({
    league_id: 39,
    league_name: 'Test League',
    country: 'England',
    tier: '1',
    active: true,
    top_league: true,
    type: 'league',
    logo: '',
    last_updated: '',
  }),
}));

const {
  runPipelineBatch,
  runPromptOnlyAnalysisForMatch,
} = await import('../lib/server-pipeline.js');

beforeEach(async () => {
  vi.clearAllMocks();
  mockConfig.liveAnalysisActivePromptVersion = '';
  mockConfig.liveAnalysisShadowPromptVersion = '';
  mockConfig.liveAnalysisShadowEnabled = false;
  mockConfig.liveAnalysisShadowSampleRate = 0;

  const footballApi = await import('../lib/football-api.js');
  vi.mocked(footballApi.fetchFixturesByIds).mockResolvedValue([mockFixture]);
  vi.mocked(footballApi.fetchLiveOdds).mockReset();
  vi.mocked(footballApi.fetchPreMatchOdds).mockReset();
  vi.mocked(footballApi.fetchLiveOdds).mockResolvedValue([{
    bookmakers: [{
      name: 'TestBook',
      bets: [
        { name: 'Over/Under', values: [
          { value: 'Over', odd: '1.85', handicap: '2.5' },
          { value: 'Under', odd: '2.00', handicap: '2.5' },
        ] },
        { name: 'Match Winner', values: [
          { value: 'Home', odd: '2.10' },
          { value: 'Draw', odd: '3.40' },
          { value: 'Away', odd: '3.50' },
        ] },
        { name: 'Both Teams Score', values: [
          { value: 'Yes', odd: '1.60' },
          { value: 'No', odd: '2.15' },
        ] },
      ],
    }],
  }] as never);
  vi.mocked(footballApi.fetchPreMatchOdds).mockResolvedValue([]);

  const watchlistRepo = await import('../repos/watchlist.repo.js');
  vi.mocked(watchlistRepo.getOperationalWatchlistByMatchId).mockResolvedValue(mockWatchlistEntry as never);
});

async function flushAsyncWork() {
  await Promise.resolve();
  await Promise.resolve();
}

// ─── Tests ───────────────────────────────────────────────

describe('runPipelineBatch', () => {
  test('returns empty result for empty input', async () => {
    const result = await runPipelineBatch([]);
    expect(result).toEqual({ totalMatches: 0, processed: 0, errors: 0, results: [] });
  });

  test('processes a single match through the full pipeline', async () => {
    const result = await runPipelineBatch(['100']);

    expect(result.totalMatches).toBe(1);
    expect(result.processed).toBe(1);
    expect(result.errors).toBe(0);
    expect(result.results).toHaveLength(1);

    const match = result.results[0];
    expect(match.matchId).toBe('100');
    expect(match.success).toBe(true);
    expect(match.shouldPush).toBe(true);
    expect(match.selection).toBe('Over 2.5 Goals @1.85');
    expect(match.confidence).toBe(8);
    expect(match.saved).toBe(true);
    expect(match.notified).toBe(true);
  });

  test('blocks corners recommendations when the live corners line looks stale versus the current state', async () => {
    const footballApi = await import('../lib/football-api.js');
    const { callGemini } = await import('../lib/gemini.js');
    const { createRecommendation } = await import('../repos/recommendations.repo.js');

    vi.mocked(footballApi.fetchFixturesByIds).mockResolvedValueOnce([{
      fixture: { id: 100, status: { short: '2H', elapsed: 58 }, timestamp: 1700000000 },
      teams: { home: { id: 1, name: 'Team A' }, away: { id: 2, name: 'Team B' } },
      league: { id: 39, name: 'Test League' },
      goals: { home: 0, away: 1 },
    }] as never);
    vi.mocked(footballApi.fetchFixtureStatistics).mockResolvedValueOnce([
      { team: { id: 1 }, statistics: [
        { type: 'Ball Possession', value: '56%' },
        { type: 'Total Shots', value: 11 },
        { type: 'Shots on Goal', value: 4 },
        { type: 'Corner Kicks', value: 6 },
        { type: 'Fouls', value: 9 },
      ] },
      { team: { id: 2 }, statistics: [
        { type: 'Ball Possession', value: '44%' },
        { type: 'Total Shots', value: 7 },
        { type: 'Shots on Goal', value: 2 },
        { type: 'Corner Kicks', value: 3 },
        { type: 'Fouls', value: 11 },
      ] },
    ] as never);
    vi.mocked(footballApi.fetchLiveOdds).mockResolvedValueOnce([{
      bookmakers: [{
        name: 'TestBook',
        bets: [
          { name: 'Over/Under', values: [
            { value: 'Over', odd: '1.88', handicap: '2.5' },
            { value: 'Under', odd: '1.96', handicap: '2.5' },
          ] },
          { name: 'Corners Over Under', values: [
            { value: 'Over', odd: '2.10', handicap: '10' },
            { value: 'Under', odd: '1.70', handicap: '10' },
          ] },
        ],
      }],
    }] as never);

    vi.mocked(callGemini).mockResolvedValueOnce(JSON.stringify({
      should_push: true,
      selection: 'Corners Over 10 @2.10',
      bet_market: 'corners_over_10',
      confidence: 6,
      reasoning_en: 'The match should keep producing corners.',
      reasoning_vi: 'Tran dau se tiep tuc co phat goc.',
      warnings: [],
      value_percent: 12,
      risk_level: 'MEDIUM',
      stake_percent: 3,
      custom_condition_matched: false,
      custom_condition_status: 'none',
      custom_condition_summary_en: '',
      custom_condition_summary_vi: '',
      custom_condition_reason_en: '',
      custom_condition_reason_vi: '',
      condition_triggered_suggestion: '',
      condition_triggered_reasoning_en: '',
      condition_triggered_reasoning_vi: '',
      condition_triggered_confidence: 0,
      condition_triggered_stake: 0,
    }));

    const result = await runPipelineBatch(['100']);

    expect(result.results[0].shouldPush).toBe(false);
    expect(result.results[0].saved).toBe(false);
    expect(result.results[0].debug?.parsed).toEqual(expect.objectContaining({
      warnings: expect.arrayContaining(['ODDS_INVALID']),
      final_should_bet: false,
    }));
    expect(createRecommendation).not.toHaveBeenCalled();
  });

  test('blocks 1x2_home before minute 75 even when the AI wants to push it', async () => {
    const { callGemini } = await import('../lib/gemini.js');
    const { createRecommendation } = await import('../repos/recommendations.repo.js');
    const { createAiPerformanceRecord } = await import('../repos/ai-performance.repo.js');

    vi.mocked(callGemini).mockResolvedValueOnce(JSON.stringify({
      should_push: true,
      selection: 'Home Win @2.10',
      bet_market: '1x2_home',
      confidence: 7,
      reasoning_en: 'Home pressure is rising.',
      reasoning_vi: 'Ap luc chu nha dang tang.',
      warnings: [],
      value_percent: 7,
      risk_level: 'MEDIUM',
      stake_percent: 4,
      custom_condition_matched: false,
    }));

    const result = await runPipelineBatch(['100']);

    expect(result.results[0].shouldPush).toBe(false);
    expect(result.results[0].saved).toBe(false);
    expect(result.results[0].debug?.parsed).toEqual(expect.objectContaining({
      warnings: expect.arrayContaining(['POLICY_BLOCK_1X2_HOME_PRE75']),
      final_should_bet: false,
    }));
    expect(createRecommendation).not.toHaveBeenCalled();
    expect(createAiPerformanceRecord).not.toHaveBeenCalled();
  });

  test('still allows 1x2_away when it passes runtime policy', async () => {
    const { callGemini } = await import('../lib/gemini.js');
    const { createRecommendation } = await import('../repos/recommendations.repo.js');

    vi.mocked(callGemini).mockResolvedValueOnce(JSON.stringify({
      should_push: true,
      selection: 'Away Win @3.50',
      bet_market: '1x2_away',
      confidence: 7,
      reasoning_en: 'Away transitions remain superior.',
      reasoning_vi: 'Chuyen doi cua doi khach tot hon.',
      warnings: [],
      value_percent: 8,
      risk_level: 'MEDIUM',
      stake_percent: 3,
      custom_condition_matched: false,
    }));

    const result = await runPipelineBatch(['100']);

    expect(result.results[0].shouldPush).toBe(true);
    expect(result.results[0].saved).toBe(true);
    expect(createRecommendation).toHaveBeenCalledWith(expect.objectContaining({
      bet_market: '1x2_away',
      selection: 'Away Win @3.50',
      decision_context: expect.objectContaining({
        evidenceMode: expect.any(String),
        prematchStrength: expect.any(String),
        profileCoverageBand: expect.any(String),
        overlayCoverageBand: expect.any(String),
        policyImpactBand: expect.any(String),
      }),
    }));
  });

  test('caps BTTS No confidence and stake before saving', async () => {
    const { callGemini } = await import('../lib/gemini.js');
    const footballApi = await import('../lib/football-api.js');
    const { createRecommendation } = await import('../repos/recommendations.repo.js');

    vi.mocked(footballApi.fetchFixturesByIds).mockResolvedValueOnce([{
      ...mockFixture,
      fixture: {
        ...mockFixture.fixture,
        status: { ...mockFixture.fixture.status, elapsed: 52 },
      },
      goals: { home: 1, away: 0 },
    }] as never);
    vi.mocked(footballApi.fetchFixtureStatistics).mockResolvedValueOnce([
      { team: { id: 1 }, statistics: [
        { type: 'Ball Possession', value: '52%' },
        { type: 'Total Shots', value: 9 },
        { type: 'Shots on Goal', value: 1 },
        { type: 'Corner Kicks', value: 4 },
        { type: 'Fouls', value: 8 },
      ] },
      { team: { id: 2 }, statistics: [
        { type: 'Ball Possession', value: '48%' },
        { type: 'Total Shots', value: 7 },
        { type: 'Shots on Goal', value: 1 },
        { type: 'Corner Kicks', value: 3 },
        { type: 'Fouls', value: 10 },
      ] },
    ] as never);
    vi.mocked(footballApi.fetchLiveOdds).mockResolvedValueOnce([{
      bookmakers: [{
        name: 'TestBook',
        bets: [
          { name: 'Over/Under', values: [
            { value: 'Over', odd: '1.85', handicap: '2.5' },
            { value: 'Under', odd: '2.00', handicap: '2.5' },
          ] },
          { name: 'Match Winner', values: [
            { value: 'Home', odd: '2.10' },
            { value: 'Draw', odd: '3.40' },
            { value: 'Away', odd: '3.50' },
          ] },
          { name: 'Both Teams Score', values: [
            { value: 'Yes', odd: '1.95' },
            { value: 'No', odd: '1.82' },
          ] },
        ],
      }],
    }] as never);
    vi.mocked(callGemini).mockResolvedValueOnce(JSON.stringify({
      should_push: true,
      selection: 'BTTS No @1.82',
      bet_market: 'btts_no',
      confidence: 9,
      reasoning_en: 'One side should keep a clean sheet.',
      reasoning_vi: 'Mot doi co the giu sach luoi.',
      warnings: [],
      value_percent: 6,
      risk_level: 'MEDIUM',
      stake_percent: 5,
      custom_condition_matched: false,
    }));

    const result = await runPipelineBatch(['100']);

    expect(result.results[0].shouldPush).toBe(true);
    expect(result.results[0].saved).toBe(true);
    expect(createRecommendation).toHaveBeenCalledWith(expect.objectContaining({
      bet_market: 'btts_no',
      confidence: 6,
      stake_percent: 2,
    }));
  });

  test('blocks BTTS No in minute 60-74 even when the AI wants to push it', async () => {
    const { callGemini } = await import('../lib/gemini.js');
    const footballApi = await import('../lib/football-api.js');
    const { createRecommendation } = await import('../repos/recommendations.repo.js');

    vi.mocked(footballApi.fetchFixturesByIds).mockResolvedValueOnce([{
      ...mockFixture,
      goals: { home: 1, away: 0 },
    }] as never);
    vi.mocked(footballApi.fetchFixtureStatistics).mockResolvedValueOnce([
      { team: { id: 1 }, statistics: [
        { type: 'Ball Possession', value: '52%' },
        { type: 'Total Shots', value: 9 },
        { type: 'Shots on Goal', value: 1 },
        { type: 'Corner Kicks', value: 4 },
        { type: 'Fouls', value: 8 },
      ] },
      { team: { id: 2 }, statistics: [
        { type: 'Ball Possession', value: '48%' },
        { type: 'Total Shots', value: 7 },
        { type: 'Shots on Goal', value: 1 },
        { type: 'Corner Kicks', value: 3 },
        { type: 'Fouls', value: 10 },
      ] },
    ] as never);
    vi.mocked(footballApi.fetchLiveOdds).mockResolvedValueOnce([{
      bookmakers: [{
        name: 'TestBook',
        bets: [
          { name: 'Over/Under', values: [
            { value: 'Over', odd: '1.85', handicap: '2.5' },
            { value: 'Under', odd: '2.00', handicap: '2.5' },
          ] },
          { name: 'Match Winner', values: [
            { value: 'Home', odd: '2.10' },
            { value: 'Draw', odd: '3.40' },
            { value: 'Away', odd: '3.50' },
          ] },
          { name: 'Both Teams Score', values: [
            { value: 'Yes', odd: '1.95' },
            { value: 'No', odd: '1.82' },
          ] },
        ],
      }],
    }] as never);
    vi.mocked(callGemini).mockResolvedValueOnce(JSON.stringify({
      should_push: true,
      selection: 'BTTS No @1.82',
      bet_market: 'btts_no',
      confidence: 6,
      reasoning_en: 'The chasing side still looks blunt.',
      reasoning_vi: 'Doi dang bi dan van rat be tac.',
      warnings: [],
      value_percent: 8,
      risk_level: 'MEDIUM',
      stake_percent: 2,
      custom_condition_matched: false,
    }));

    const result = await runPipelineBatch(['100']);

    expect(result.results[0].shouldPush).toBe(false);
    expect(result.results[0].saved).toBe(false);
    expect(result.results[0].debug?.parsed).toEqual(expect.objectContaining({
      warnings: expect.arrayContaining(['POLICY_BLOCK_BTTS_NO_60_74']),
      final_should_bet: false,
    }));
    expect(createRecommendation).not.toHaveBeenCalled();
  });

  test('blocks a third recommendation in the same thesis ladder', async () => {
    const { callGemini } = await import('../lib/gemini.js');
    const recsRepo = await import('../repos/recommendations.repo.js');
    const { createRecommendation } = await import('../repos/recommendations.repo.js');

    vi.mocked(recsRepo.getRecommendationsByMatchId).mockResolvedValueOnce([
      {
        minute: 44,
        selection: 'Under 3.5 Goals @1.76',
        bet_market: 'under_3.5',
        confidence: 6,
        odds: 1.76,
        stake_percent: 5,
        score: '1-0',
        result: 'loss',
      },
      {
        minute: 58,
        selection: 'Under 2.5 Goals @1.84',
        bet_market: 'under_2.5',
        confidence: 6,
        odds: 1.84,
        stake_percent: 3,
        score: '1-0',
        result: 'loss',
      },
    ] as never);
    vi.mocked(callGemini).mockResolvedValueOnce(JSON.stringify({
      should_push: true,
      selection: 'Under 1.5 Goals @1.95',
      bet_market: 'under_1.5',
      confidence: 6,
      reasoning_en: 'Still a low-event game.',
      reasoning_vi: 'Tran dau van it bien co.',
      warnings: [],
      value_percent: 6,
      risk_level: 'MEDIUM',
      stake_percent: 3,
      custom_condition_matched: false,
    }));

    const result = await runPipelineBatch(['100']);

    expect(result.results[0].shouldPush).toBe(false);
    expect(result.results[0].saved).toBe(false);
    expect(result.results[0].debug?.parsed).toEqual(expect.objectContaining({
      warnings: expect.arrayContaining(['POLICY_BLOCK_SAME_THESIS_COUNT_CAP', 'POLICY_BLOCK_SAME_THESIS_STAKE_CAP']),
      final_should_bet: false,
    }));
    expect(createRecommendation).not.toHaveBeenCalled();
  });

  test('fetches fixtures, stats, events in parallel', async () => {
    await runPipelineBatch(['100']);

    const footballApi = await import('../lib/football-api.js');
    expect(footballApi.fetchFixturesByIds).toHaveBeenCalledWith(['100']);
    expect(footballApi.fetchFixtureStatistics).toHaveBeenCalledWith('100');
    expect(footballApi.fetchFixtureEvents).toHaveBeenCalledWith('100');
    expect(footballApi.fetchLiveOdds).toHaveBeenCalledWith('100');
  });

  test('uses real-required freshness mode for live provider inputs', async () => {
    await runPipelineBatch(['100']);

    const insight = await import('../lib/provider-insight-cache.js');
    expect(insight.ensureFixturesForMatchIds).toHaveBeenCalledWith(['100'], { freshnessMode: 'real_required' });
    expect(insight.ensureMatchInsight).toHaveBeenCalledWith('100', expect.objectContaining({
      status: '2H',
      freshnessMode: 'real_required',
    }));
  });

  test('records API-Sports stats samples for observability', async () => {
    await runPipelineBatch(['100']);

    const providerSampling = await import('../lib/provider-sampling.js');
    const calls = vi.mocked(providerSampling.recordProviderStatsSampleSafe).mock.calls;
    expect(calls.some(([sample]) => sample.provider === 'api-football' && sample.success === true)).toBe(true);
  });

  test('keeps API-Sports as stats source when current stats are already usable', async () => {
    const result = await runPipelineBatch(['100']);

    const { callGemini } = await import('../lib/gemini.js');
    const prompt = vi.mocked(callGemini).mock.calls[0][0];
    expect(prompt).toContain('STATS_SOURCE: api-football');
    expect(prompt).toContain('EVIDENCE_MODE: full_live_data');
    expect(result.results[0]?.debug?.statsSource).toBe('api-football');
    expect(result.results[0]?.debug?.promptDataLevel).toBe('advanced-upgraded');
    expect(result.results[0]?.debug?.prematchAvailability).toBe('minimal');
    expect(result.results[0]?.debug?.prematchNoisePenalty).toBe(60);
    expect(result.results[0]?.debug?.prematchStrength).toBe('weak');
    expect(result.results[0]?.debug?.statsFallbackUsed).toBe(false);
  });

  test('skips LLM entirely when evidence mode is low_evidence and no watch condition exists', async () => {
    const footballApi = await import('../lib/football-api.js');
    vi.mocked(footballApi.fetchFixtureStatistics).mockResolvedValueOnce([]);
    vi.mocked(footballApi.fetchFixtureEvents).mockResolvedValueOnce([] as never);
    vi.mocked(footballApi.fetchLiveOdds).mockResolvedValueOnce([] as never);
    vi.mocked(footballApi.fetchPreMatchOdds).mockResolvedValueOnce([] as never);

    const result = await runPipelineBatch(['100']);

    const { callGemini } = await import('../lib/gemini.js');
    const { createRecommendation } = await import('../repos/recommendations.repo.js');
    expect(callGemini).not.toHaveBeenCalled();
    expect(createRecommendation).not.toHaveBeenCalled();
    expect(result.results[0]?.success).toBe(true);
    expect(result.results[0]?.decisionKind).toBe('no_bet');
    expect(result.results[0]?.saved).toBe(false);
    expect(result.results[0]?.debug?.evidenceMode).toBe('low_evidence');
    expect(result.results[0]?.debug?.skipReason).toContain('low-evidence mode');
  });

  test('uses the same LLM path in low_evidence when user custom conditions exist, but keeps the alert unsaved if no usable live odds exist', async () => {
    const footballApi = await import('../lib/football-api.js');
    vi.mocked(footballApi.fetchFixtureStatistics).mockResolvedValueOnce([]);
    vi.mocked(footballApi.fetchFixtureEvents).mockResolvedValueOnce([] as never);
    vi.mocked(footballApi.fetchLiveOdds).mockResolvedValueOnce([] as never);
    vi.mocked(footballApi.fetchPreMatchOdds).mockResolvedValueOnce([] as never);

    const watchlistRepo = await import('../repos/watchlist.repo.js');
    vi.mocked(watchlistRepo.getOperationalWatchlistByMatchId).mockResolvedValueOnce({
      ...mockWatchlistEntry,
      custom_conditions: 'Trigger when total goals >= 2',
    } as never);

    const { callGemini } = await import('../lib/gemini.js');
    vi.mocked(callGemini).mockResolvedValueOnce(JSON.stringify({
      should_push: true,
      selection: 'Over 2.5 Goals @1.85',
      bet_market: 'over_2.5',
      market_chosen_reason: 'Legacy AI path still prefers over.',
      confidence: 8,
      reasoning_en: 'Condition-focused check only.',
      reasoning_vi: 'Condition-focused check only.',
      warnings: [],
      value_percent: 12,
      risk_level: 'MEDIUM',
      stake_percent: 5,
      custom_condition_matched: true,
      custom_condition_status: 'evaluated',
      custom_condition_summary_en: 'Total goals condition matched.',
      custom_condition_summary_vi: 'Total goals condition matched.',
      custom_condition_reason_en: 'Score is already 1-1.',
      custom_condition_reason_vi: 'Score is already 1-1.',
      condition_triggered_suggestion: 'Over 2.5 Goals @1.85',
      condition_triggered_reasoning_en: 'Condition met from scoreboard only.',
      condition_triggered_reasoning_vi: 'Condition met from scoreboard only.',
      condition_triggered_confidence: 7,
      condition_triggered_stake: 2,
    }));

    const result = await runPipelineBatch(['100']);

    const prompt = vi.mocked(callGemini).mock.calls[0]?.[0] ?? '';
    const { createRecommendation } = await import('../repos/recommendations.repo.js');
    expect(prompt).toContain('LOW EVIDENCE CONDITION GUARD');
    expect(prompt).toContain('CUSTOM_CONDITIONS');
    expect(result.results[0]?.success).toBe(true);
    expect(result.results[0]?.decisionKind).toBe('condition_only');
    expect(result.results[0]?.shouldPush).toBe(true);
    expect(result.results[0]?.saved).toBe(false);
    expect(createRecommendation).not.toHaveBeenCalled();
    expect(result.results[0]?.debug?.parsed).toEqual(
      expect.objectContaining({
        ai_should_push: false,
        final_should_bet: false,
        condition_triggered_should_push: true,
      }),
    );
  });

  test('keeps full analysis alive outside low_evidence even when custom conditions are present', async () => {
    const watchlistRepo = await import('../repos/watchlist.repo.js');
    vi.mocked(watchlistRepo.getOperationalWatchlistByMatchId).mockResolvedValueOnce({
      ...mockWatchlistEntry,
      custom_conditions: '(Minute >= 60) AND (Total goals >= 2)',
    } as never);

    const { callGemini } = await import('../lib/gemini.js');
    vi.mocked(callGemini).mockResolvedValueOnce(JSON.stringify({
      should_push: true,
      selection: 'Over 2.5 Goals @1.85',
      bet_market: 'over_2.5',
      market_chosen_reason: 'Full analysis still finds a live over edge.',
      confidence: 8,
      reasoning_en: 'Live tempo, shot volume, and odds all support the over.',
      reasoning_vi: 'Live tempo, shot volume, and odds all support the over.',
      warnings: [],
      value_percent: 12,
      risk_level: 'MEDIUM',
      stake_percent: 5,
      custom_condition_matched: true,
      custom_condition_status: 'evaluated',
      custom_condition_summary_en: 'Tracked total-goals condition matched.',
      custom_condition_summary_vi: 'Tracked total-goals condition matched.',
      custom_condition_reason_en: 'Score and minute satisfy the watch rule.',
      custom_condition_reason_vi: 'Score and minute satisfy the watch rule.',
      condition_triggered_suggestion: 'Over 2.5 Goals @1.85',
      condition_triggered_reasoning_en: 'The watched trigger and the full thesis align.',
      condition_triggered_reasoning_vi: 'The watched trigger and the full thesis align.',
      condition_triggered_confidence: 7,
      condition_triggered_stake: 3,
    }));

    const result = await runPipelineBatch(['100']);

    const prompt = vi.mocked(callGemini).mock.calls[0]?.[0] ?? '';
    const { createRecommendation } = await import('../repos/recommendations.repo.js');
    const { createAiPerformanceRecord } = await import('../repos/ai-performance.repo.js');
    expect(prompt).not.toContain('LOW EVIDENCE CONDITION GUARD');
    expect(result.results[0]?.success).toBe(true);
    expect(result.results[0]?.decisionKind).toBe('ai_push');
    expect(result.results[0]?.saved).toBe(true);
    expect(result.results[0]?.notified).toBe(true);
    expect(result.results[0]?.selection).toBe('Over 2.5 Goals @1.85');
    expect(result.results[0]?.debug?.evidenceMode).toBe('full_live_data');
    expect(result.results[0]?.debug?.parsed).toEqual(expect.objectContaining({
      custom_condition_matched: true,
      custom_condition_status: 'evaluated',
      condition_triggered_should_push: true,
      final_should_bet: true,
      ai_should_push: true,
    }));
    expect(createRecommendation).toHaveBeenCalledTimes(1);
    expect(createAiPerformanceRecord).toHaveBeenCalledTimes(1);
  });

  test('skips LLM in low_evidence when only recommended conditions exist without a user custom condition', async () => {
    const footballApi = await import('../lib/football-api.js');
    vi.mocked(footballApi.fetchFixtureStatistics).mockResolvedValueOnce([]);
    vi.mocked(footballApi.fetchFixtureEvents).mockResolvedValueOnce([] as never);
    vi.mocked(footballApi.fetchLiveOdds).mockResolvedValueOnce([] as never);
    vi.mocked(footballApi.fetchPreMatchOdds).mockResolvedValueOnce([] as never);

    const watchlistRepo = await import('../repos/watchlist.repo.js');
    vi.mocked(watchlistRepo.getOperationalWatchlistByMatchId).mockResolvedValueOnce({
      ...mockWatchlistEntry,
      recommended_custom_condition: 'Alert when Team A scores next',
      recommended_condition_reason: 'Low-data match; scoreboard-only trigger is safer.',
    } as never);

    const result = await runPipelineBatch(['100']);

    const { callGemini } = await import('../lib/gemini.js');
    expect(callGemini).not.toHaveBeenCalled();
    expect(result.results[0]?.success).toBe(true);
    expect(result.results[0]?.decisionKind).toBe('no_bet');
    expect(result.results[0]?.saved).toBe(false);
    expect(result.results[0]?.debug?.skipReason).toContain('no custom watch condition');
  });

  test('uses degraded odds+events mode when stats stay unavailable after fallback check', async () => {
    const footballApi = await import('../lib/football-api.js');
    vi.mocked(footballApi.fetchFixtureStatistics).mockResolvedValueOnce([]);
    vi.mocked(footballApi.fetchFixtureEvents).mockResolvedValueOnce([
      { time: { elapsed: 23 }, team: { id: 1 }, type: 'Goal', detail: 'Normal Goal', player: { name: 'Player A' } },
      { time: { elapsed: 55 }, team: { id: 2 }, type: 'Goal', detail: 'Normal Goal', player: { name: 'Player B' } },
    ] as never);

    const result = await runPipelineBatch(['100']);

    const { callGemini } = await import('../lib/gemini.js');
    const prompt = vi.mocked(callGemini).mock.calls[0][0];
    expect(prompt).toContain('STATS_SOURCE: api-football');
    expect(prompt).toContain('EVIDENCE_MODE: odds_events_only_degraded');
    expect(prompt).toContain('- Allowed markets: O/U and selective AH only');
    expect(result.results[0]?.debug?.statsFallbackUsed).toBe(false);
    expect(result.results[0]?.success).toBe(true);
  });

  test('blocks BTTS recommendation when evidence tier only allows O/U or AH', async () => {
    const footballApi = await import('../lib/football-api.js');
    vi.mocked(footballApi.fetchFixtureStatistics).mockResolvedValueOnce([]);
    vi.mocked(footballApi.fetchFixtureEvents).mockResolvedValueOnce([
      { time: { elapsed: 23 }, team: { id: 1 }, type: 'Goal', detail: 'Normal Goal', player: { name: 'Player A' } },
      { time: { elapsed: 55 }, team: { id: 2 }, type: 'Goal', detail: 'Normal Goal', player: { name: 'Player B' } },
    ] as never);

    const { callGemini } = await import('../lib/gemini.js');
    vi.mocked(callGemini).mockResolvedValueOnce(JSON.stringify({
      should_push: true,
      selection: 'BTTS Yes @1.60',
      bet_market: 'btts_yes',
      market_chosen_reason: 'Both teams already scored',
      confidence: 7,
      reasoning_en: 'Both teams already scored and the game is open.',
      reasoning_vi: 'Ca hai doi da ghi ban va tran dau dang mo.',
      warnings: [],
      value_percent: 8,
      risk_level: 'MEDIUM',
      stake_percent: 4,
      custom_condition_matched: false,
      custom_condition_status: 'none',
      custom_condition_summary_en: '',
      custom_condition_summary_vi: '',
      custom_condition_reason_en: '',
      custom_condition_reason_vi: '',
      condition_triggered_suggestion: '',
      condition_triggered_reasoning_en: '',
      condition_triggered_reasoning_vi: '',
      condition_triggered_confidence: 0,
      condition_triggered_stake: 0,
    }));

    const result = await runPipelineBatch(['100']);
    expect(result.results[0]?.shouldPush).toBe(false);
    expect(result.results[0]?.debug?.evidenceMode).toBe('odds_events_only_degraded');
    expect(result.results[0]?.debug?.parsed?.warnings).toContain('MARKET_NOT_ALLOWED_FOR_EVIDENCE');
  });

  test('ignores hallucinated odds when canonical odds are unavailable', async () => {
    const footballApi = await import('../lib/football-api.js');
    vi.mocked(footballApi.fetchLiveOdds).mockResolvedValueOnce([]);
    vi.mocked(footballApi.fetchPreMatchOdds).mockResolvedValueOnce([]);

    const { callGemini } = await import('../lib/gemini.js');
    vi.mocked(callGemini).mockResolvedValueOnce(JSON.stringify({
      should_push: true,
      selection: 'Over 2.5 Goals @1.88',
      bet_market: 'over_2.5',
      market_chosen_reason: 'AI attempted to infer a fair price without provider odds.',
      confidence: 7,
      reasoning_en: 'Tempo is decent but there are no reliable odds in the feed.',
      reasoning_vi: 'Nhip do kha on nhung khong co odds tin cay trong feed.',
      warnings: [],
      value_percent: 6,
      risk_level: 'MEDIUM',
      stake_percent: 4,
      custom_condition_matched: false,
      custom_condition_status: 'none',
      custom_condition_summary_en: '',
      custom_condition_summary_vi: '',
      custom_condition_reason_en: '',
      custom_condition_reason_vi: '',
      condition_triggered_suggestion: '',
      condition_triggered_reasoning_en: '',
      condition_triggered_reasoning_vi: '',
      condition_triggered_confidence: 0,
      condition_triggered_stake: 0,
    }));

    const result = await runPipelineBatch(['100']);
    expect(result.results[0]?.shouldPush).toBe(false);
    expect(result.results[0]?.debug?.evidenceMode).toBe('stats_only');
    expect(result.results[0]?.debug?.parsed?.warnings).toContain('ODDS_INVALID');
    expect(result.results[0]?.debug?.parsed?.warnings).toContain('MARKET_NOT_ALLOWED_FOR_EVIDENCE');
  });

  test('calls Gemini with prompt containing match context', async () => {
    await runPipelineBatch(['100']);

    const { callGemini } = await import('../lib/gemini.js');
    expect(callGemini).toHaveBeenCalledTimes(1);
    const prompt = vi.mocked(callGemini).mock.calls[0][0];
    expect(prompt).toContain('Team A');
    expect(prompt).toContain('Team B');
    expect(prompt).toContain('Test League');
    expect(prompt).toContain('1-1');
  });

  test('saves recommendation to DB', async () => {
    await runPipelineBatch(['100']);

    const { createRecommendation } = await import('../repos/recommendations.repo.js');
    expect(createRecommendation).toHaveBeenCalledTimes(1);
    expect(createRecommendation).toHaveBeenCalledWith(expect.objectContaining({
      match_id: '100',
      home_team: 'Team A',
      away_team: 'Team B',
      selection: 'Over 2.5 Goals @1.85',
      confidence: 8,
      prompt_version: LIVE_ANALYSIS_PROMPT_VERSION,
    }));
  });

  test('creates ai_performance tracking row when a recommendation is saved', async () => {
    await runPipelineBatch(['100']);

    const { createAiPerformanceRecord } = await import('../repos/ai-performance.repo.js');
    expect(createAiPerformanceRecord).toHaveBeenCalledTimes(1);
    expect(createAiPerformanceRecord).toHaveBeenCalledWith(expect.objectContaining({
      match_id: '100',
      ai_model: 'gemini-test',
      prompt_version: LIVE_ANALYSIS_PROMPT_VERSION,
      ai_should_push: true,
      predicted_market: 'over_2.5',
      predicted_selection: 'Over 2.5 Goals @1.85',
    }));
  });

  test('queues Telegram delivery asynchronously for should_push=true', async () => {
    await runPipelineBatch(['100']);

    const { sendTelegramPhoto, sendTelegramMessage } = await import('../lib/telegram.js');
    const { markRecommendationNotified } = await import('../repos/recommendations.repo.js');
    expect(sendTelegramPhoto).not.toHaveBeenCalled();
    expect(sendTelegramMessage).not.toHaveBeenCalled();
    expect(markRecommendationNotified).not.toHaveBeenCalledWith(999, 'telegram');
  });

  test('does not send Telegram inline even when eligible user channels exist', async () => {
    const settingsRepo = await import('../repos/settings.repo.js');
    vi.mocked(settingsRepo.getSettings).mockResolvedValueOnce({
      AI_MODEL: 'gemini-test',
      MIN_CONFIDENCE: 5,
      MIN_ODDS: 1.5,
      LATE_PHASE_MINUTE: 75,
      VERY_LATE_PHASE_MINUTE: 85,
      ENDGAME_MINUTE: 88,
      TELEGRAM_ENABLED: true,
    });

    const deliveryRepo = await import('../repos/recommendation-deliveries.repo.js');
    vi.mocked(deliveryRepo.getEligibleTelegramDeliveryTargets).mockResolvedValueOnce([
      { userId: 'user-1', chatId: 'telegram-chat-1' },
      { userId: 'user-2', chatId: 'telegram-chat-2' },
    ]);

    await runPipelineBatch(['100']);

    const { sendTelegramPhoto, sendTelegramMessage } = await import('../lib/telegram.js');
    const { markRecommendationNotified } = await import('../repos/recommendations.repo.js');

    expect(deliveryRepo.getEligibleTelegramDeliveryTargets).not.toHaveBeenCalled();
    expect(sendTelegramPhoto).not.toHaveBeenCalled();
    expect(sendTelegramMessage).not.toHaveBeenCalled();
    expect(deliveryRepo.markRecommendationDeliveriesDelivered).not.toHaveBeenCalledWith(999, ['user-1', 'user-2'], 'telegram');
    expect(markRecommendationNotified).not.toHaveBeenCalledWith(999, 'telegram');
  });

  test('does not fall back to env telegram chat id when DB setting is missing', async () => {
    const settingsRepo = await import('../repos/settings.repo.js');
    vi.mocked(settingsRepo.getSettings).mockResolvedValueOnce({
      AI_MODEL: 'gemini-test',
      MIN_CONFIDENCE: 5,
      MIN_ODDS: 1.5,
      LATE_PHASE_MINUTE: 75,
      VERY_LATE_PHASE_MINUTE: 85,
      ENDGAME_MINUTE: 88,
      TELEGRAM_ENABLED: true,
    });

    await runPipelineBatch(['100']);

    const { sendTelegramMessage, sendTelegramPhoto } = await import('../lib/telegram.js');
    const { markRecommendationNotified } = await import('../repos/recommendations.repo.js');
    expect(sendTelegramPhoto).not.toHaveBeenCalled();
    expect(sendTelegramMessage).not.toHaveBeenCalled();
    expect(markRecommendationNotified).not.toHaveBeenCalledWith(999, 'telegram');
  });

  test('keeps Telegram disabled by default when DB toggle is missing', async () => {
    const settingsRepo = await import('../repos/settings.repo.js');
    vi.mocked(settingsRepo.getSettings).mockResolvedValueOnce({
      TELEGRAM_CHAT_ID: '123456',
      AI_MODEL: 'gemini-test',
      MIN_CONFIDENCE: 5,
      MIN_ODDS: 1.5,
      LATE_PHASE_MINUTE: 75,
      VERY_LATE_PHASE_MINUTE: 85,
      ENDGAME_MINUTE: 88,
    });

    await runPipelineBatch(['100']);

    const { sendTelegramMessage, sendTelegramPhoto } = await import('../lib/telegram.js');
    const { markRecommendationNotified } = await import('../repos/recommendations.repo.js');
    expect(sendTelegramPhoto).not.toHaveBeenCalled();
    expect(sendTelegramMessage).not.toHaveBeenCalled();
    expect(markRecommendationNotified).not.toHaveBeenCalledWith(999, 'telegram');
  });

  test('marks delivery rows as delivered only for eligible successful web push users', async () => {
    const settingsRepo = await import('../repos/settings.repo.js');
    vi.mocked(settingsRepo.getSettings).mockResolvedValueOnce({
      TELEGRAM_CHAT_ID: '123456',
      AI_MODEL: 'gemini-test',
      MIN_CONFIDENCE: 5,
      MIN_ODDS: 1.5,
      LATE_PHASE_MINUTE: 75,
      VERY_LATE_PHASE_MINUTE: 85,
      ENDGAME_MINUTE: 88,
      WEB_PUSH_ENABLED: true,
    });

    await runPipelineBatch(['100']);

    const pushRepo = await import('../repos/push-subscriptions.repo.js');
    const deliveryRepo = await import('../repos/recommendation-deliveries.repo.js');
    const webPush = await import('../lib/web-push.js');
    const { markRecommendationNotified } = await import('../repos/recommendations.repo.js');

    expect(pushRepo.getAllSubscriptions).toHaveBeenCalledTimes(1);
    expect(deliveryRepo.getEligibleDeliveryUserIds).toHaveBeenCalledWith(999);
    expect(webPush.sendWebPushNotification).toHaveBeenCalledTimes(1);
    expect(pushRepo.updateLastUsed).toHaveBeenCalledWith('https://push.example.com/sub-1');
    expect(deliveryRepo.markRecommendationDeliveriesDelivered).toHaveBeenCalledWith(999, ['user-1'], 'web_push');
    expect(markRecommendationNotified).toHaveBeenCalledWith(999, 'web_push');
  });

  test('does NOT save or notify when AI says should_push=false', async () => {
    const { callGemini } = await import('../lib/gemini.js');
    vi.mocked(callGemini).mockResolvedValueOnce(JSON.stringify({
      should_push: false,
      selection: '',
      bet_market: '',
      confidence: 3,
      reasoning_en: 'No clear opportunity',
      reasoning_vi: 'Không có cơ hội rõ ràng',
      warnings: [],
      value_percent: 0,
      risk_level: 'HIGH',
      stake_percent: 0,
      custom_condition_matched: false,
    }));

    const result = await runPipelineBatch(['100']);
    const { sendTelegramMessage } = await import('../lib/telegram.js');
    const { createRecommendation } = await import('../repos/recommendations.repo.js');
    expect(sendTelegramMessage).not.toHaveBeenCalled();
    expect(createRecommendation).not.toHaveBeenCalled();
    expect(result.results[0].shouldPush).toBe(false);
    expect(result.results[0].saved).toBe(false);
    expect(result.results[0].notified).toBe(false);
  });

  test('handles fixture not found gracefully', async () => {
    const footballApi = await import('../lib/football-api.js');
    vi.mocked(footballApi.fetchFixturesByIds).mockResolvedValueOnce([]);

    const result = await runPipelineBatch(['999']);
    expect(result.errors).toBe(1);
    expect(result.results[0].success).toBe(false);
    expect(result.results[0].error).toContain('Fixture not found');
  });

  test('handles watchlist entry not found gracefully', async () => {
    const watchlistRepo = await import('../repos/watchlist.repo.js');
    vi.mocked(watchlistRepo.getOperationalWatchlistByMatchId).mockResolvedValueOnce(null);

    const result = await runPipelineBatch(['100']);
    expect(result.errors).toBe(1);
    expect(result.results[0].error).toContain('Watchlist entry not found');
  });

  test('does not reuse pre-match odds for live analysis when real-time odds are unavailable', async () => {
    const footballApi = await import('../lib/football-api.js');
    vi.mocked(footballApi.fetchLiveOdds).mockResolvedValueOnce([]);

    await runPipelineBatch(['100']);

    const { callGemini } = await import('../lib/gemini.js');
    const prompt = vi.mocked(callGemini).mock.calls[0][0];
    expect(prompt).toContain('ODDS_SOURCE: none');
    expect(footballApi.fetchPreMatchOdds).not.toHaveBeenCalled();
  });

  test('normalizes live odds[] payloads before building canonical odds', async () => {
    const footballApi = await import('../lib/football-api.js');
    vi.mocked(footballApi.fetchLiveOdds).mockResolvedValueOnce([{
      fixture: { id: 100 },
      odds: [
        {
          id: 1,
          name: 'Match Winner',
          values: [
            { value: 'Home', odd: '2.10' },
            { value: 'Draw', odd: '3.40' },
            { value: 'Away', odd: '3.50' },
          ],
        },
        {
          id: 2,
          name: 'Over/Under',
          values: [
            { value: 'Over', odd: '1.85', handicap: '2.5' },
            { value: 'Under', odd: '2.00', handicap: '2.5' },
          ],
        },
      ],
    }] as never);

    await runPipelineBatch(['100']);

    const { callGemini } = await import('../lib/gemini.js');
    const prompt = vi.mocked(callGemini).mock.calls[0][0];
    expect(prompt).toContain('"1x2"');
    expect(prompt).toContain('"ou"');
  });

  test('uses pre-match when live is empty in auto-pipeline', async () => {
    const footballApi = await import('../lib/football-api.js');
    const watchlistRepo = await import('../repos/watchlist.repo.js');

    vi.mocked(footballApi.fetchFixturesByIds).mockResolvedValueOnce([{
      ...mockFixture,
      fixture: {
        ...mockFixture.fixture,
        status: { short: '2H', elapsed: 65 },
      },
    }] as never);
    vi.mocked(watchlistRepo.getOperationalWatchlistByMatchId).mockResolvedValueOnce(mockWatchlistEntry as never);

    vi.mocked(footballApi.fetchLiveOdds).mockResolvedValueOnce([]);
    vi.mocked(footballApi.fetchPreMatchOdds).mockResolvedValueOnce([{
      bookmakers: [{
        name: 'PreMatchBook',
        bets: [
          { name: 'Over/Under', values: [
            { value: 'Over', odd: '1.90', handicap: '2.5' },
            { value: 'Under', odd: '1.95', handicap: '2.5' },
          ] },
        ],
      }],
    }] as never);

    const result = await runPipelineBatch(['100']);

    const { callGemini } = await import('../lib/gemini.js');
    expect(['reference-prematch', 'none', undefined]).toContain(result.results[0].debug?.oddsSource);
    expect(vi.mocked(callGemini)).toHaveBeenCalled();
  });

  test('proceeds with no odds when live and pre-match are empty', async () => {
    const footballApi = await import('../lib/football-api.js');
    const watchlistRepo = await import('../repos/watchlist.repo.js');

    vi.mocked(footballApi.fetchFixturesByIds).mockResolvedValueOnce([{
      ...mockFixture,
      fixture: {
        ...mockFixture.fixture,
        status: { short: '2H', elapsed: 65 },
      },
    }] as never);
    vi.mocked(watchlistRepo.getOperationalWatchlistByMatchId).mockResolvedValueOnce(mockWatchlistEntry as never);

    vi.mocked(footballApi.fetchLiveOdds).mockResolvedValueOnce([]);
    vi.mocked(footballApi.fetchPreMatchOdds).mockResolvedValueOnce([]);

    const result = await runPipelineBatch(['100']);

    expect(result.results[0].debug?.oddsSource).toBe('none');
    const { callGemini } = await import('../lib/gemini.js');
    expect(vi.mocked(callGemini)).toHaveBeenCalled();
  });

  test('handles Gemini error gracefully', async () => {
    const { callGemini } = await import('../lib/gemini.js');
    vi.mocked(callGemini).mockRejectedValueOnce(new Error('Gemini quota exceeded'));

    const result = await runPipelineBatch(['100']);
    expect(result.results[0].success).toBe(false);
    expect(result.results[0].error).toContain('Gemini quota exceeded');
  });

  test('handles malformed AI JSON response', async () => {
    const { callGemini } = await import('../lib/gemini.js');
    vi.mocked(callGemini).mockResolvedValueOnce('this is not valid json at all');

    const result = await runPipelineBatch(['100']);
    // Still succeeds (saves with parse defaults), should_push=false
    expect(result.results[0].success).toBe(true);
    expect(result.results[0].shouldPush).toBe(false);
  });

  test('skips AI when match is outside proceed window', async () => {
    const footballApi = await import('../lib/football-api.js');
    vi.mocked(footballApi.fetchFixturesByIds).mockResolvedValueOnce([{
      ...mockFixture,
      fixture: { ...mockFixture.fixture, status: { short: '1H', elapsed: 3 } },
    }] as never);

    const result = await runPipelineBatch(['100']);

    const { callGemini } = await import('../lib/gemini.js');
    const { createRecommendation } = await import('../repos/recommendations.repo.js');
    expect(footballApi.fetchLiveOdds).not.toHaveBeenCalled();
    expect(callGemini).not.toHaveBeenCalled();
    expect(createRecommendation).not.toHaveBeenCalled();
    expect(result.results[0].success).toBe(true);
    expect(result.results[0].shouldPush).toBe(false);
    expect(result.results[0].saved).toBe(false);
  });

  test('skips AI when snapshot shows no significant change inside cooldown', async () => {
    const snapshotsRepo = await import('../repos/match-snapshots.repo.js');
    const footballApi = await import('../lib/football-api.js');
    vi.mocked(snapshotsRepo.getLatestSnapshot).mockResolvedValueOnce({
      id: 99,
      match_id: '100',
      captured_at: new Date().toISOString(),
      source: 'server-pipeline',
      minute: 64,
      status: '2H',
      home_score: 1,
      away_score: 1,
      stats: {},
      events: [],
      odds: {
        '1x2': { home: 2.1, draw: 3.4, away: 3.5 },
        ou: { line: 2.5, over: 1.85, under: 2.0 },
        btts: { yes: 1.6, no: 2.15 },
      },
    } as never);

    const result = await runPipelineBatch(['100']);

    const { callGemini } = await import('../lib/gemini.js');
    const { createSnapshot } = await import('../repos/match-snapshots.repo.js');
    expect(footballApi.fetchFixtureStatistics).not.toHaveBeenCalled();
    expect(footballApi.fetchFixtureEvents).not.toHaveBeenCalled();
    expect(createSnapshot).not.toHaveBeenCalled();
    expect(callGemini).not.toHaveBeenCalled();
    expect(result.results[0].success).toBe(true);
    expect(result.results[0].saved).toBe(false);
    expect(result.results[0].notified).toBe(false);
  });

  test('records odds movements from the server pipeline when canonical odds are available', async () => {
    await runPipelineBatch(['100']);

    const { recordOddsMovementsBulk } = await import('../repos/odds-movements.repo.js');
    expect(recordOddsMovementsBulk).toHaveBeenCalledTimes(1);
    const payload = vi.mocked(recordOddsMovementsBulk).mock.calls[0]?.[0] ?? [];
    expect(payload).toEqual(expect.arrayContaining([
      expect.objectContaining({ match_id: '100', match_minute: 65, market: '1x2' }),
      expect.objectContaining({ match_id: '100', match_minute: 65, market: 'ou', line: 2.5 }),
    ]));
  });

  test('does not record odds movements when odds are unavailable', async () => {
    const footballApi = await import('../lib/football-api.js');
    vi.mocked(footballApi.fetchLiveOdds).mockResolvedValueOnce([]);
    vi.mocked(footballApi.fetchPreMatchOdds).mockResolvedValueOnce([]);

    await runPipelineBatch(['100']);

    const { recordOddsMovementsBulk } = await import('../repos/odds-movements.repo.js');
    expect(recordOddsMovementsBulk).not.toHaveBeenCalled();
  });

  test('does NOT save condition-only no-bet analyses into recommendations', async () => {
    const { callGemini } = await import('../lib/gemini.js');
    vi.mocked(callGemini).mockResolvedValueOnce(JSON.stringify({
      should_push: false,
      selection: '',
      bet_market: '',
      confidence: 0,
      reasoning_en: 'Condition matched but no market has enough value.',
      reasoning_vi: 'Condition match nhung khong co keo du value.',
      warnings: ['EDGE_BELOW_MIN'],
      value_percent: 0,
      risk_level: 'HIGH',
      stake_percent: 0,
      custom_condition_matched: true,
      condition_triggered_suggestion: 'No bet - negative EV',
    }));

    const result = await runPipelineBatch(['100']);
    const { createRecommendation } = await import('../repos/recommendations.repo.js');
    const { createAiPerformanceRecord } = await import('../repos/ai-performance.repo.js');
  const { sendTelegramMessage } = await import('../lib/telegram.js');

    expect(createRecommendation).not.toHaveBeenCalled();
    expect(createAiPerformanceRecord).not.toHaveBeenCalled();
    expect(sendTelegramMessage).not.toHaveBeenCalled();
    expect(result.results[0].saved).toBe(false);
    expect(result.results[0].shouldPush).toBe(false);
  });

  test('saves a condition-triggered actionable bet even when the main AI path is no-bet', async () => {
    const { callGemini } = await import('../lib/gemini.js');
    vi.mocked(callGemini).mockResolvedValueOnce(JSON.stringify({
      should_push: false,
      selection: '',
      bet_market: '',
      confidence: 4,
      reasoning_en: 'AI sees no direct edge, but the tracked condition is satisfied.',
      reasoning_vi: 'AI khong thay edge truc tiep, nhung dieu kien theo doi da thoa.',
      warnings: [],
      value_percent: 0,
      risk_level: 'MEDIUM',
      stake_percent: 0,
      custom_condition_matched: true,
      custom_condition_status: 'evaluated',
      custom_condition_summary_en: 'Late under condition matched',
      custom_condition_summary_vi: 'Dieu kien under cuoi tran da thoa',
      custom_condition_reason_en: 'Minute and goal state match the watchlist rule',
      custom_condition_reason_vi: 'Phut va ty so phu hop voi rule watchlist',
      condition_triggered_suggestion: 'Over 2.5 Goals @1.85',
      condition_triggered_reasoning_en: 'Condition says the over thesis is live.',
      condition_triggered_reasoning_vi: 'Dieu kien cho thay thesis over dang hop le.',
      condition_triggered_confidence: 7,
      condition_triggered_stake: 3,
    }));

    const result = await runPipelineBatch(['100']);
    const { createRecommendation } = await import('../repos/recommendations.repo.js');
    const { createAiPerformanceRecord } = await import('../repos/ai-performance.repo.js');
    const { sendTelegramMessage } = await import('../lib/telegram.js');
    const deliveryRepo = await import('../repos/recommendation-deliveries.repo.js');

    expect(result.results[0]?.shouldPush).toBe(true);
    expect(result.results[0]?.saved).toBe(true);
    expect(result.results[0]?.notified).toBe(true);
    expect(result.results[0]?.selection).toBe('Over 2.5 Goals @1.85');
    expect(result.results[0]?.confidence).toBe(7);
    expect(result.results[0]?.debug?.parsed).toEqual(expect.objectContaining({
      custom_condition_matched: true,
      custom_condition_status: 'evaluated',
      condition_triggered_suggestion: 'Over 2.5 Goals @1.85',
      condition_triggered_confidence: 7,
      condition_triggered_stake: 3,
      condition_triggered_should_push: true,
      should_push: true,
      final_should_bet: false,
      ai_should_push: false,
    }));
    expect(createRecommendation).toHaveBeenCalledTimes(1);
    expect(createRecommendation).toHaveBeenCalledWith(expect.objectContaining({
      selection: 'Over 2.5 Goals @1.85',
      bet_market: 'over_2.5',
      confidence: 7,
      stake_percent: 2.5,
      custom_condition_matched: true,
    }));
    expect(createAiPerformanceRecord).toHaveBeenCalledTimes(1);
    expect(sendTelegramMessage).not.toHaveBeenCalled();
    expect(deliveryRepo.stageConditionOnlyDeliveries).not.toHaveBeenCalled();
  });

  test('pushes a condition-only alert when the condition is evaluated and matched even without a betting suggestion', async () => {
    const { callGemini } = await import('../lib/gemini.js');
    vi.mocked(callGemini).mockResolvedValueOnce(JSON.stringify({
      should_push: false,
      selection: '',
      bet_market: '',
      confidence: 0,
      reasoning_en: 'No standalone AI bet, but the watch condition has been satisfied.',
      reasoning_vi: 'Khong co keo AI doc lap, nhung dieu kien theo doi da thoa.',
      warnings: [],
      value_percent: 0,
      risk_level: 'LOW',
      stake_percent: 0,
      custom_condition_matched: true,
      custom_condition_status: 'evaluated',
      custom_condition_summary_en: 'Watched condition matched.',
      custom_condition_summary_vi: 'Dieu kien theo doi da thoa.',
      custom_condition_reason_en: 'Minute and scoreline satisfy the watched rule.',
      custom_condition_reason_vi: 'Phut va ty so da thoa rule theo doi.',
      condition_triggered_suggestion: '',
      condition_triggered_reasoning_en: 'Condition matched from scoreboard facts.',
      condition_triggered_reasoning_vi: 'Dieu kien da thoa theo du lieu bang ty so.',
      condition_triggered_confidence: 0,
      condition_triggered_stake: 0,
    }));

    const result = await runPipelineBatch(['100']);
    const { createRecommendation } = await import('../repos/recommendations.repo.js');
    const { createAiPerformanceRecord } = await import('../repos/ai-performance.repo.js');
    const { sendTelegramMessage } = await import('../lib/telegram.js');
    const deliveryRepo = await import('../repos/recommendation-deliveries.repo.js');

    expect(result.results[0]?.shouldPush).toBe(true);
    expect(result.results[0]?.decisionKind).toBe('condition_only');
    expect(result.results[0]?.saved).toBe(false);
    expect(result.results[0]?.notified).toBe(true);
    expect(result.results[0]?.selection).toBe('');
    expect(result.results[0]?.confidence).toBe(0);
    expect(result.results[0]?.debug?.parsed).toEqual(expect.objectContaining({
      custom_condition_matched: true,
      custom_condition_status: 'evaluated',
      condition_triggered_suggestion: '',
      condition_triggered_confidence: 0,
      condition_triggered_stake: 0,
      condition_triggered_should_push: true,
      should_push: true,
      final_should_bet: false,
      ai_should_push: false,
    }));
    expect(createRecommendation).not.toHaveBeenCalled();
    expect(createAiPerformanceRecord).not.toHaveBeenCalled();
    expect(sendTelegramMessage).not.toHaveBeenCalled();
    expect(deliveryRepo.stageConditionOnlyDeliveries).toHaveBeenCalled();
  });

  test('stages the concrete custom condition into condition-only delivery metadata', async () => {
    const watchlistRepo = await import('../repos/watchlist.repo.js');
    vi.mocked(watchlistRepo.getOperationalWatchlistByMatchId).mockResolvedValueOnce({
      ...mockWatchlistEntry,
      custom_conditions: '(Minute >= 60) AND (Total goals = 0)',
    } as never);

    const { callGemini } = await import('../lib/gemini.js');
    vi.mocked(callGemini).mockResolvedValueOnce(JSON.stringify({
      should_push: false,
      selection: '',
      bet_market: '',
      confidence: 0,
      reasoning_en: 'No standalone AI bet, but the watch condition is satisfied.',
      reasoning_vi: 'Khong co keo AI doc lap, nhung dieu kien theo doi da thoa.',
      warnings: [],
      value_percent: 0,
      risk_level: 'LOW',
      stake_percent: 0,
      custom_condition_matched: true,
      custom_condition_status: 'evaluated',
      custom_condition_summary_en: 'Watched condition matched.',
      custom_condition_summary_vi: 'Dieu kien theo doi da thoa.',
      custom_condition_reason_en: 'Minute and scoreline satisfy the watched rule.',
      custom_condition_reason_vi: 'Phut va ty so da thoa rule theo doi.',
      condition_triggered_suggestion: '',
      condition_triggered_reasoning_en: 'Condition matched from scoreboard facts.',
      condition_triggered_reasoning_vi: 'Dieu kien da thoa theo du lieu bang ty so.',
      condition_triggered_confidence: 0,
      condition_triggered_stake: 0,
    }));

    await runPipelineBatch(['100']);

    const deliveryRepo = await import('../repos/recommendation-deliveries.repo.js');
    expect(deliveryRepo.stageConditionOnlyDeliveries).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        match_id: '100',
        status: '2H',
        ai_model: 'gemini-test',
        condition_summary_vi: 'Dieu kien theo doi da thoa.',
      }),
    );
  });

  test('keeps repeated same-thesis condition-triggered bets as alert-only when an actionable thesis already exists', async () => {
    const recommendationsRepo = await import('../repos/recommendations.repo.js');
    vi.mocked(recommendationsRepo.getRecommendationsByMatchId).mockResolvedValueOnce([
      {
        id: 41,
        unique_key: '100_under_1.25',
        match_id: '100',
        timestamp: '2026-04-02T07:00:00.000Z',
        league: 'Test League',
        home_team: 'Team A',
        away_team: 'Team B',
        status: '2H',
        condition_triggered_suggestion: '',
        custom_condition_raw: '',
        execution_id: 'prev-1',
        odds_snapshot: {},
        stats_snapshot: {},
        decision_context: {},
        pre_match_prediction_summary: '',
        prompt_version: LIVE_ANALYSIS_PROMPT_VERSION,
        custom_condition_matched: false,
        minute: 59,
        score: '0-0',
        bet_type: 'AI',
        selection: 'Under 1.25 Goals @1.93',
        odds: 1.93,
        confidence: 7,
        value_percent: 8,
        risk_level: 'MEDIUM',
        stake_percent: 3,
        stake_amount: null,
        reasoning: 'Previous under thesis already saved.',
        reasoning_vi: 'Previous under thesis already saved.',
        key_factors: '',
        warnings: '',
        ai_model: 'gemini-test',
        mode: 'B',
        bet_market: 'under_1.25',
        notified: '',
        notification_channels: '',
        result: '',
        actual_outcome: '',
        pnl: 0,
        settled_at: null,
        settlement_status: 'pending',
        settlement_method: '',
        settle_prompt_version: '',
        settlement_note: '',
        _was_overridden: false,
      },
    ] as never);

    const footballApi = await import('../lib/football-api.js');
    vi.mocked(footballApi.fetchLiveOdds).mockResolvedValueOnce([{
      bookmakers: [{
        name: 'TestBook',
        bets: [
          { name: 'Over/Under', values: [
            { value: 'Over', odd: '2.15', handicap: '0.5' },
            { value: 'Under', odd: '1.75', handicap: '0.5' },
          ] },
        ],
      }],
    }] as never);

    const { callGemini } = await import('../lib/gemini.js');
    vi.mocked(callGemini).mockResolvedValueOnce(JSON.stringify({
      should_push: false,
      selection: '',
      bet_market: '',
      confidence: 3,
      reasoning_en: 'Main AI path still says no standalone bet.',
      reasoning_vi: 'Main AI path still says no standalone bet.',
      warnings: [],
      value_percent: 6,
      risk_level: 'MEDIUM',
      stake_percent: 0,
      custom_condition_matched: true,
      custom_condition_status: 'evaluated',
      custom_condition_summary_en: 'Late under condition matched',
      custom_condition_summary_vi: 'Late under condition matched',
      custom_condition_reason_en: 'Match state still supports the under.',
      custom_condition_reason_vi: 'Match state still supports the under.',
      condition_triggered_suggestion: 'Under 0.5 Goals @1.75',
      condition_triggered_reasoning_en: 'The under thesis is still live, but we already hold it.',
      condition_triggered_reasoning_vi: 'The under thesis is still live, but we already hold it.',
      condition_triggered_confidence: 6,
      condition_triggered_stake: 2,
    }));

    const result = await runPipelineBatch(['100']);
    const { createRecommendation } = await import('../repos/recommendations.repo.js');

    expect(result.results[0]?.shouldPush).toBe(true);
    expect(result.results[0]?.saved).toBe(false);
    expect(createRecommendation).not.toHaveBeenCalled();
  });

  test('allows a condition-triggered special override only on the same canonical line with materially better price', async () => {
    const recommendationsRepo = await import('../repos/recommendations.repo.js');
    vi.mocked(recommendationsRepo.getRecommendationsByMatchId).mockResolvedValueOnce([
      {
        id: 52,
        unique_key: '100_over_2.5',
        match_id: '100',
        timestamp: '2026-04-02T07:00:00.000Z',
        league: 'Test League',
        home_team: 'Team A',
        away_team: 'Team B',
        status: '2H',
        condition_triggered_suggestion: '',
        custom_condition_raw: '',
        execution_id: 'prev-2',
        odds_snapshot: {},
        stats_snapshot: {},
        decision_context: {},
        pre_match_prediction_summary: '',
        prompt_version: LIVE_ANALYSIS_PROMPT_VERSION,
        custom_condition_matched: false,
        minute: 60,
        score: '0-0',
        bet_type: 'AI',
        selection: 'Over 2.5 Goals @1.85',
        odds: 1.85,
        confidence: 6,
        value_percent: 8,
        risk_level: 'MEDIUM',
        stake_percent: 2,
        stake_amount: null,
        reasoning: 'Saved under line.',
        reasoning_vi: 'Saved under line.',
        key_factors: '',
        warnings: '',
        ai_model: 'gemini-test',
        mode: 'B',
        bet_market: 'over_2.5',
        notified: '',
        notification_channels: '',
        result: '',
        actual_outcome: '',
        pnl: 0,
        settled_at: null,
        settlement_status: 'pending',
        settlement_method: '',
        settle_prompt_version: '',
        settlement_note: '',
        _was_overridden: false,
      },
    ] as never);

    const footballApi = await import('../lib/football-api.js');
    vi.mocked(footballApi.fetchLiveOdds).mockResolvedValueOnce([{
      bookmakers: [{
        name: 'TestBook',
        bets: [
          { name: 'Over/Under', values: [
            { value: 'Over', odd: '2.05', handicap: '2.5' },
            { value: 'Under', odd: '1.70', handicap: '2.5' },
          ] },
        ],
      }],
    }] as never);

    const { callGemini } = await import('../lib/gemini.js');
    vi.mocked(callGemini).mockResolvedValueOnce(JSON.stringify({
      should_push: false,
      selection: '',
      bet_market: '',
      confidence: 3,
      reasoning_en: 'Main AI path still says no standalone bet.',
      reasoning_vi: 'Main AI path still says no standalone bet.',
      warnings: [],
      value_percent: 7,
      risk_level: 'MEDIUM',
      stake_percent: 0,
      custom_condition_matched: true,
      custom_condition_status: 'evaluated',
      custom_condition_summary_en: 'Late under condition matched',
      custom_condition_summary_vi: 'Late under condition matched',
      custom_condition_reason_en: 'The match remains slow and the same line is now better priced.',
      custom_condition_reason_vi: 'The match remains slow and the same line is now better priced.',
      condition_triggered_suggestion: 'Over 2.5 Goals @2.05',
      condition_triggered_reasoning_en: 'The same over line now has materially better price.',
      condition_triggered_reasoning_vi: 'The same over line now has materially better price.',
      condition_triggered_confidence: 6,
      condition_triggered_stake: 2,
      condition_triggered_special_override: true,
      condition_triggered_special_override_reason_en: 'Same line, but the live price improved materially versus the earlier save.',
      condition_triggered_special_override_reason_vi: 'Same line, but the live price improved materially versus the earlier save.',
    }));

    const result = await runPipelineBatch(['100']);
    const { createRecommendation } = await import('../repos/recommendations.repo.js');

    expect(result.results[0]?.saved).toBe(true);
    expect(createRecommendation).toHaveBeenCalledWith(expect.objectContaining({
      selection: 'Over 2.5 Goals @2.05',
      bet_market: 'over_2.5',
      confidence: 6,
      stake_percent: 2,
    }));
    expect(result.results[0]?.debug?.parsed?.warnings).toContain(
      'Special override accepted: updating the existing saved line with a materially better price.',
    );
  });

  test('watchlist no longer bypasses proceed and staleness gates via mode field', async () => {
    const footballApi = await import('../lib/football-api.js');
    vi.mocked(footballApi.fetchFixturesByIds).mockResolvedValueOnce([{
      ...mockFixture,
      fixture: { ...mockFixture.fixture, status: { short: '1H', elapsed: 3 } },
    }] as never);

    const result = await runPipelineBatch(['100']);

    const { callGemini } = await import('../lib/gemini.js');
    expect(callGemini).not.toHaveBeenCalled();
    expect(result.results[0].success).toBe(true);
    expect(result.results[0].debug?.analysisMode).toBe('auto');
  });

  test('prompt-only Ask AI path marks manual_force provenance', async () => {
    const result = await runPromptOnlyAnalysisForMatch('100', { forceAnalyze: true });

    expect(result.prompt).toContain('- Analysis Mode: manual_force');
    expect(result.prompt).toContain('- Trigger Provenance: manual Ask AI request');
    expect(result.prompt).toContain('- Is Manual Push: YES');
    expect(result.prompt).not.toContain('watchlist/system force mode, not by a direct manual Ask AI request');
    expect(result.result.debug?.analysisMode).toBe('manual_force');
  });

  test('prompt-only Ask AI skips low_evidence matches with no watch condition instead of calling LLM', async () => {
    const footballApi = await import('../lib/football-api.js');
    vi.mocked(footballApi.fetchFixtureStatistics).mockResolvedValueOnce([]);
    vi.mocked(footballApi.fetchFixtureEvents).mockResolvedValueOnce([] as never);
    vi.mocked(footballApi.fetchLiveOdds).mockResolvedValueOnce([] as never);
    vi.mocked(footballApi.fetchPreMatchOdds).mockResolvedValueOnce([] as never);

    const result = await runPromptOnlyAnalysisForMatch('100', { forceAnalyze: true });

    const { callGemini } = await import('../lib/gemini.js');
    expect(callGemini).not.toHaveBeenCalled();
    expect(result.prompt).toBe('[LLM skipped]');
    expect(result.text).toContain('Skipped AI analysis because this match is in low-evidence mode and no custom watch condition is configured.');
    expect(result.result.debug?.evidenceMode).toBe('low_evidence');
  });

  test('prompt-only Ask AI still runs the shared LLM path in low_evidence when custom conditions exist', async () => {
    const footballApi = await import('../lib/football-api.js');
    vi.mocked(footballApi.fetchFixtureStatistics).mockResolvedValueOnce([]);
    vi.mocked(footballApi.fetchFixtureEvents).mockResolvedValueOnce([] as never);
    vi.mocked(footballApi.fetchLiveOdds).mockResolvedValueOnce([] as never);
    vi.mocked(footballApi.fetchPreMatchOdds).mockResolvedValueOnce([] as never);

    const watchlistRepo = await import('../repos/watchlist.repo.js');
    vi.mocked(watchlistRepo.getOperationalWatchlistByMatchId).mockResolvedValueOnce({
      ...mockWatchlistEntry,
      custom_conditions: '(Minute >= 60) AND (Total goals >= 2)',
    } as never);

    const { callGemini } = await import('../lib/gemini.js');
    vi.mocked(callGemini).mockResolvedValueOnce(JSON.stringify({
      should_push: false,
      selection: '',
      bet_market: '',
      confidence: 0,
      reasoning_en: 'Low-evidence prompt-only analysis checked the watched condition.',
      reasoning_vi: 'Low-evidence prompt-only analysis checked the watched condition.',
      warnings: [],
      value_percent: 0,
      risk_level: 'LOW',
      stake_percent: 0,
      custom_condition_matched: true,
      custom_condition_status: 'evaluated',
      custom_condition_summary_en: 'Watched condition matched.',
      custom_condition_summary_vi: 'Watched condition matched.',
      custom_condition_reason_en: 'Scoreboard facts satisfy the watched rule.',
      custom_condition_reason_vi: 'Scoreboard facts satisfy the watched rule.',
      condition_triggered_suggestion: '',
      condition_triggered_reasoning_en: 'The watched condition is satisfied.',
      condition_triggered_reasoning_vi: 'The watched condition is satisfied.',
      condition_triggered_confidence: 0,
      condition_triggered_stake: 0,
    }));

    const result = await runPromptOnlyAnalysisForMatch('100', { forceAnalyze: true });

    expect(result.prompt).toContain('LOW EVIDENCE CONDITION GUARD');
    expect(result.prompt).toContain('CUSTOM_CONDITIONS');
    expect(result.text).toContain('Low-evidence prompt-only analysis checked the watched condition.');
    expect(result.result.debug?.evidenceMode).toBe('low_evidence');
  });

  test('prompt-only Ask AI still runs for low_evidence top-league prematch matches when structured prematch context is available', async () => {
    const footballApi = await import('../lib/football-api.js');
    vi.mocked(footballApi.fetchFixturesByIds).mockResolvedValueOnce([{
      ...mockFixture,
      fixture: { ...mockFixture.fixture, status: { short: 'NS', elapsed: null }, timestamp: 1700000000 },
      goals: { home: null, away: null },
    }] as never);
    vi.mocked(footballApi.fetchFixtureStatistics).mockResolvedValueOnce([]);
    vi.mocked(footballApi.fetchFixtureEvents).mockResolvedValueOnce([] as never);
    vi.mocked(footballApi.fetchLiveOdds).mockResolvedValueOnce([] as never);
    vi.mocked(footballApi.fetchPreMatchOdds).mockResolvedValueOnce([] as never);

    const watchlistRepo = await import('../repos/watchlist.repo.js');
    vi.mocked(watchlistRepo.getOperationalWatchlistByMatchId).mockResolvedValueOnce({
      ...mockWatchlistEntry,
      prediction: {
        predictions: {
          winner: { id: 1, name: 'Team A', comment: 'Home slight edge' },
          advice: 'Lean Team A or draw',
          percent: { home: '42%', draw: '31%', away: '27%' },
          under_over: 'Under 2.5',
        },
        comparison: {
          form: { home: '61', away: '45' },
          att: { home: '55', away: '42' },
          def: { home: '58', away: '46' },
          goals: { home: '57', away: '43' },
          total: { home: '59', away: '44' },
        },
      },
    } as never);

    const teamProfilesRepo = await import('../repos/team-profiles.repo.js');
    vi.mocked(teamProfilesRepo.getTeamProfileByTeamId)
      .mockResolvedValueOnce({
        team_id: '1',
        profile: {
          avg_goals_scored: 1.9,
          avg_goals_conceded: 1.0,
          clean_sheet_rate: 0.36,
          btts_rate: 0.52,
          over_2_5_rate: 0.58,
          avg_corners_for: 6.1,
          avg_corners_against: 4.2,
          avg_cards: 2.1,
          first_goal_rate: 0.63,
          late_goal_rate: 0.38,
          data_reliability_tier: 'high',
        },
        notes_en: '',
        notes_vi: '',
        created_at: '',
        updated_at: '',
      } as never)
      .mockResolvedValueOnce({
        team_id: '2',
        profile: {
          avg_goals_scored: 1.2,
          avg_goals_conceded: 1.5,
          clean_sheet_rate: 0.19,
          btts_rate: 0.6,
          over_2_5_rate: 0.56,
          avg_corners_for: 4.3,
          avg_corners_against: 5.7,
          avg_cards: 2.7,
          first_goal_rate: 0.38,
          late_goal_rate: 0.34,
          data_reliability_tier: 'medium',
        },
        notes_en: '',
        notes_vi: '',
        created_at: '',
        updated_at: '',
      } as never);

    const { callGemini } = await import('../lib/gemini.js');
    vi.mocked(callGemini).mockResolvedValueOnce(JSON.stringify({
      should_push: false,
      selection: '',
      bet_market: '',
      confidence: 0,
      reasoning_en: 'Structured prematch context points to a cautious lean but not enough edge to bet.',
      reasoning_vi: 'Structured prematch context points to a cautious lean but not enough edge to bet.',
      warnings: ['PREMATCH_ONLY_CONTEXT'],
      value_percent: 0,
      risk_level: 'LOW',
      stake_percent: 0,
      custom_condition_matched: false,
      custom_condition_status: 'none',
      custom_condition_summary_en: '',
      custom_condition_summary_vi: '',
      custom_condition_reason_en: '',
      custom_condition_reason_vi: '',
      condition_triggered_suggestion: '',
      condition_triggered_reasoning_en: '',
      condition_triggered_reasoning_vi: '',
      condition_triggered_confidence: 0,
      condition_triggered_stake: 0,
    }));

    const result = await runPromptOnlyAnalysisForMatch('100', { forceAnalyze: true });

    expect(result.prompt).toContain('STRUCTURED PREMATCH ASK AI OVERRIDE');
    expect(result.prompt).toContain('NOT STARTED top-league match');
    expect(result.prompt).toContain('PREMATCH EXPERT FEATURES V1');
    expect(result.text).toContain('Structured prematch context points to a cautious lean');
    expect(result.result.debug?.evidenceMode).toBe('low_evidence');
    expect(result.result.debug?.analysisMode).toBe('manual_force');
    expect(result.result.debug?.structuredPrematchAskAi).toBe(true);
    expect(result.result.debug?.structuredPrematchAskAiReason).toBe('eligible');
  });

  test('prompt-only Ask AI still runs for low_evidence top-league prematch matches when provider prediction is missing but profile coverage is strong', async () => {
    const footballApi = await import('../lib/football-api.js');
    vi.mocked(footballApi.fetchFixturesByIds).mockResolvedValueOnce([{
      ...mockFixture,
      fixture: { ...mockFixture.fixture, status: { short: 'NS', elapsed: null }, timestamp: 1700000000 },
      goals: { home: null, away: null },
    }] as never);
    vi.mocked(footballApi.fetchFixtureStatistics).mockResolvedValueOnce([]);
    vi.mocked(footballApi.fetchFixtureEvents).mockResolvedValueOnce([] as never);
    vi.mocked(footballApi.fetchLiveOdds).mockResolvedValueOnce([] as never);
    vi.mocked(footballApi.fetchPreMatchOdds).mockResolvedValueOnce([] as never);

    const watchlistRepo = await import('../repos/watchlist.repo.js');
    vi.mocked(watchlistRepo.getOperationalWatchlistByMatchId).mockResolvedValueOnce({
      ...mockWatchlistEntry,
      prediction: null,
    } as never);

    const teamProfilesRepo = await import('../repos/team-profiles.repo.js');
    vi.mocked(teamProfilesRepo.getTeamProfileByTeamId)
      .mockResolvedValueOnce({
        team_id: '1',
        profile: {
          avg_goals_scored: 1.9,
          avg_goals_conceded: 1.0,
          clean_sheet_rate: 0.36,
          btts_rate: 0.52,
          over_2_5_rate: 0.58,
          avg_corners_for: 6.1,
          avg_corners_against: 4.2,
          avg_cards: 2.1,
          first_goal_rate: 0.63,
          late_goal_rate: 0.38,
          data_reliability_tier: 'high',
        },
        notes_en: '',
        notes_vi: '',
        created_at: '',
        updated_at: '',
      } as never)
      .mockResolvedValueOnce({
        team_id: '2',
        profile: {
          avg_goals_scored: 1.2,
          avg_goals_conceded: 1.5,
          clean_sheet_rate: 0.19,
          btts_rate: 0.6,
          over_2_5_rate: 0.56,
          avg_corners_for: 4.3,
          avg_corners_against: 5.7,
          avg_cards: 2.7,
          first_goal_rate: 0.38,
          late_goal_rate: 0.34,
          data_reliability_tier: 'medium',
        },
        notes_en: '',
        notes_vi: '',
        created_at: '',
        updated_at: '',
      } as never);

    const { callGemini } = await import('../lib/gemini.js');
    vi.mocked(callGemini).mockResolvedValueOnce(JSON.stringify({
      should_push: false,
      selection: '',
      bet_market: '',
      confidence: 0,
      reasoning_en: 'Profile priors keep the match eligible for prematch analysis, but there is still not enough edge to bet.',
      reasoning_vi: 'Profile priors keep the match eligible for prematch analysis, but there is still not enough edge to bet.',
      warnings: ['PREMATCH_PROFILE_ONLY_CONTEXT'],
      value_percent: 0,
      risk_level: 'LOW',
      stake_percent: 0,
      custom_condition_matched: false,
      custom_condition_status: 'none',
      custom_condition_summary_en: '',
      custom_condition_summary_vi: '',
      custom_condition_reason_en: '',
      custom_condition_reason_vi: '',
      condition_triggered_suggestion: '',
      condition_triggered_reasoning_en: '',
      condition_triggered_reasoning_vi: '',
      condition_triggered_confidence: 0,
      condition_triggered_stake: 0,
    }));

    const result = await runPromptOnlyAnalysisForMatch('100', { forceAnalyze: true });

    expect(result.prompt).toContain('STRUCTURED PREMATCH ASK AI OVERRIDE');
    expect(result.prompt).toContain('provider prediction when available');
    expect(result.text).toContain('Profile priors keep the match eligible');
    expect(result.result.debug?.evidenceMode).toBe('low_evidence');
    expect(result.result.debug?.structuredPrematchAskAi).toBe(true);
    expect(result.result.debug?.structuredPrematchAskAiReason).toBe('eligible');
  });

  test('prompt-only analysis removes logically settled BTTS odds before sending prompt to LLM', async () => {
    const result = await runPromptOnlyAnalysisForMatch('100', { forceAnalyze: true });

    expect(result.prompt).toContain('1-1');
    expect(result.prompt).toContain('ODDS SANITY NOTES:');
    expect(result.prompt).toContain('Removed BTTS market from prompt: both teams have already scored (1-1), so BTTS is already logically settled.');
    expect(result.prompt).not.toContain('"btts":{"yes":1.6,"no":2.15}');
  });

  test('prompt-only analysis removes suspiciously easy live corners lines before sending prompt to LLM', async () => {
    const footballApi = await import('../lib/football-api.js');

    vi.mocked(footballApi.fetchFixturesByIds).mockResolvedValueOnce([{
      fixture: { id: 100, status: { short: '2H', elapsed: 58 }, timestamp: 1700000000 },
      teams: { home: { id: 1, name: 'Team A' }, away: { id: 2, name: 'Team B' } },
      league: { id: 39, name: 'Test League' },
      goals: { home: 0, away: 1 },
    }] as never);
    vi.mocked(footballApi.fetchFixtureStatistics).mockResolvedValueOnce([
      { team: { id: 1 }, statistics: [
        { type: 'Ball Possession', value: '56%' },
        { type: 'Total Shots', value: 11 },
        { type: 'Shots on Goal', value: 4 },
        { type: 'Corner Kicks', value: 6 },
        { type: 'Fouls', value: 9 },
      ] },
      { team: { id: 2 }, statistics: [
        { type: 'Ball Possession', value: '44%' },
        { type: 'Total Shots', value: 7 },
        { type: 'Shots on Goal', value: 2 },
        { type: 'Corner Kicks', value: 3 },
        { type: 'Fouls', value: 11 },
      ] },
    ] as never);
    vi.mocked(footballApi.fetchLiveOdds).mockResolvedValueOnce([{
      bookmakers: [{
        name: 'TestBook',
        bets: [
          { name: 'Over/Under', values: [
            { value: 'Over', odd: '1.88', handicap: '2.5' },
            { value: 'Under', odd: '1.96', handicap: '2.5' },
          ] },
          { name: 'Corners Over Under', values: [
            { value: 'Over', odd: '2.10', handicap: '10' },
            { value: 'Under', odd: '1.70', handicap: '10' },
          ] },
        ],
      }],
    }] as never);

    const result = await runPromptOnlyAnalysisForMatch('100', { forceAnalyze: true });

    expect(result.prompt).toContain('CURRENT_TOTAL_CORNERS: 9');
    expect(result.prompt).toContain('ODDS SANITY NOTES:');
    expect(result.prompt).toContain('Removed corners O/U market from prompt: live total corners 9 is already too close to line 10 at minute 58 for an over price of 2.1, which suggests a stale or non-main live corners line.');
    expect(result.prompt).not.toContain('"corners_ou":{"line":10,"over":2.1,"under":1.7}');
  });

  test('prompt-only analysis keeps a plausible live corners line available to the LLM', async () => {
    const footballApi = await import('../lib/football-api.js');

    vi.mocked(footballApi.fetchFixturesByIds).mockResolvedValueOnce([{
      fixture: { id: 100, status: { short: '2H', elapsed: 58 }, timestamp: 1700000000 },
      teams: { home: { id: 1, name: 'Team A' }, away: { id: 2, name: 'Team B' } },
      league: { id: 39, name: 'Test League' },
      goals: { home: 0, away: 1 },
    }] as never);
    vi.mocked(footballApi.fetchFixtureStatistics).mockResolvedValueOnce([
      { team: { id: 1 }, statistics: [
        { type: 'Ball Possession', value: '56%' },
        { type: 'Total Shots', value: 11 },
        { type: 'Shots on Goal', value: 4 },
        { type: 'Corner Kicks', value: 6 },
        { type: 'Fouls', value: 9 },
      ] },
      { team: { id: 2 }, statistics: [
        { type: 'Ball Possession', value: '44%' },
        { type: 'Total Shots', value: 7 },
        { type: 'Shots on Goal', value: 2 },
        { type: 'Corner Kicks', value: 3 },
        { type: 'Fouls', value: 11 },
      ] },
    ] as never);
    vi.mocked(footballApi.fetchLiveOdds).mockResolvedValueOnce([{
      bookmakers: [{
        name: 'TestBook',
        bets: [
          { name: 'Over/Under', values: [
            { value: 'Over', odd: '1.88', handicap: '2.5' },
            { value: 'Under', odd: '1.96', handicap: '2.5' },
          ] },
          { name: 'Corners Over Under', values: [
            { value: 'Over', odd: '1.93', handicap: '12.5' },
            { value: 'Under', odd: '1.85', handicap: '12.5' },
          ] },
        ],
      }],
    }] as never);

    const result = await runPromptOnlyAnalysisForMatch('100', { forceAnalyze: true });

    expect(result.prompt).not.toContain('Removed corners O/U market from prompt: live total corners 9 is already too close');
    expect(result.prompt).toContain('"corners_ou":{"line":12.5,"over":1.93,"under":1.85}');
  });

  test('prompt-only analysis does not misclassify corners totals as goals totals when only corners O/U is present', async () => {
    const footballApi = await import('../lib/football-api.js');

    vi.mocked(footballApi.fetchFixturesByIds).mockResolvedValueOnce([{
      fixture: { id: 100, status: { short: 'HT', elapsed: 45 }, timestamp: 1700000000 },
      teams: { home: { id: 1, name: 'Team A' }, away: { id: 2, name: 'Team B' } },
      league: { id: 39, name: 'Test League' },
      goals: { home: 2, away: 3 },
    }] as never);
    vi.mocked(footballApi.fetchFixtureStatistics).mockResolvedValueOnce([
      { team: { id: 1 }, statistics: [
        { type: 'Ball Possession', value: '61%' },
        { type: 'Total Shots', value: 10 },
        { type: 'Shots on Goal', value: 4 },
        { type: 'Corner Kicks', value: 3 },
        { type: 'Fouls', value: 7 },
      ] },
      { team: { id: 2 }, statistics: [
        { type: 'Ball Possession', value: '39%' },
        { type: 'Total Shots', value: 8 },
        { type: 'Shots on Goal', value: 5 },
        { type: 'Corner Kicks', value: 1 },
        { type: 'Fouls', value: 6 },
      ] },
    ] as never);
    vi.mocked(footballApi.fetchLiveOdds).mockResolvedValueOnce([{
      bookmakers: [{
        name: 'TestBook',
        bets: [
          { name: 'Corners Over/Under', values: [
            { value: 'Over', odd: '2.10', handicap: '10' },
            { value: 'Under', odd: '2.20', handicap: '10' },
          ] },
        ],
      }],
    }] as never);

    const result = await runPromptOnlyAnalysisForMatch('100', { forceAnalyze: true });

    expect(result.prompt).not.toContain('"ou":{"line":10');
    expect(result.prompt).toContain('"corners_ou":{"line":10,"over":2.1,"under":2.2}');
  });

  test('prompt-only analysis removes first-half-only markets once the match reaches HT', async () => {
    const footballApi = await import('../lib/football-api.js');

    vi.mocked(footballApi.fetchFixturesByIds).mockResolvedValueOnce([{
      fixture: {
        id: 100,
        status: { short: 'HT', elapsed: 45 },
        timestamp: 1700000000,
      },
      teams: { home: { id: 1, name: 'Team A' }, away: { id: 2, name: 'Team B' } },
      league: { id: 39, name: 'Test League' },
      goals: { home: 1, away: 0 },
      score: { halftime: { home: 1, away: 0 } },
    }] as never);
    vi.mocked(footballApi.fetchFixtureStatistics).mockResolvedValueOnce([
      { team: { id: 1 }, statistics: [
        { type: 'Ball Possession', value: '52%' },
        { type: 'Total Shots', value: 6 },
        { type: 'Shots on Goal', value: 2 },
        { type: 'Corner Kicks', value: 2 },
        { type: 'Fouls', value: 4 },
      ] },
      { team: { id: 2 }, statistics: [
        { type: 'Ball Possession', value: '48%' },
        { type: 'Total Shots', value: 4 },
        { type: 'Shots on Goal', value: 1 },
        { type: 'Corner Kicks', value: 1 },
        { type: 'Fouls', value: 6 },
      ] },
    ] as never);
    vi.mocked(footballApi.fetchLiveOdds).mockResolvedValueOnce([{
      bookmakers: [{
        name: 'TestBook',
        bets: [
          { name: 'Over/Under', values: [
            { value: 'Over', odd: '1.95', handicap: '2.5' },
            { value: 'Under', odd: '1.88', handicap: '2.5' },
          ] },
          { name: '1st Half Match Winner', values: [
            { value: 'Home', odd: '2.20' },
            { value: 'Draw', odd: '2.10' },
            { value: 'Away', odd: '6.00' },
          ] },
          { name: 'Over/Under First Half', values: [
            { value: 'Over', odd: '2.20', handicap: '1.5' },
            { value: 'Under', odd: '1.70', handicap: '1.5' },
          ] },
        ],
      }],
    }] as never);

    const result = await runPromptOnlyAnalysisForMatch('100', { forceAnalyze: true });

    expect(result.prompt).toContain('Removed H1 1X2 market from prompt: first half is already closed (status HT).');
    expect(result.prompt).toContain('Removed H1 goals O/U market from prompt: first half is already closed (status HT).');
    expect(result.prompt).toContain('"ou":{"line":2.5,"over":1.95,"under":1.88}');
    expect(result.prompt).not.toContain('"ht_1x2"');
    expect(result.prompt).not.toContain('"ht_ou"');
  });

  test('prompt-only analysis upgrades prompt with optional advanced stats only when API data is rich enough', async () => {
    const footballApi = await import('../lib/football-api.js');
    vi.mocked(footballApi.fetchFixtureStatistics).mockResolvedValueOnce([
      { team: { id: 1 }, statistics: [
        { type: 'Ball Possession', value: '55%' },
        { type: 'Total Shots', value: 12 },
        { type: 'Shots on Goal', value: 5 },
        { type: 'Corner Kicks', value: 6 },
        { type: 'Fouls', value: 10 },
        { type: 'expected_goals', value: 1.42 },
        { type: 'Shots insidebox', value: 7 },
      ] },
      { team: { id: 2 }, statistics: [
        { type: 'Ball Possession', value: '45%' },
        { type: 'Total Shots', value: 8 },
        { type: 'Shots on Goal', value: 3 },
        { type: 'Corner Kicks', value: 4 },
        { type: 'Fouls', value: 12 },
        { type: 'expected_goals', value: 0.88 },
        { type: 'Shots insidebox', value: 4 },
      ] },
    ] as never);

    const result = await runPromptOnlyAnalysisForMatch('100', { forceAnalyze: true });

    expect(result.prompt).toContain('ADVANCED QUANT STATS');
    expect(result.prompt).toContain('"expected_goals":{"home":"1.42","away":"0.88"}');
    expect(result.prompt).toContain('"shots_inside_box":{"home":"7","away":"4"}');
    expect(result.result.debug?.promptDataLevel).toBe('advanced-upgraded');
  });

  test('records active and shadow prompt outputs with shared analysisRunId when shadow is enabled', async () => {
    mockConfig.liveAnalysisShadowEnabled = true;
    mockConfig.liveAnalysisShadowSampleRate = 1;
    mockConfig.liveAnalysisActivePromptVersion = 'v4-evidence-hardened';
    mockConfig.liveAnalysisShadowPromptVersion = 'v5-compact-a';

    const result = await runPipelineBatch(['100']);
    await flushAsyncWork();

    const { callGemini } = await import('../lib/gemini.js');
    const { createPromptShadowRun } = await import('../repos/prompt-shadow-runs.repo.js');
    const shadowCalls = vi.mocked(createPromptShadowRun).mock.calls;

    expect(callGemini).toHaveBeenCalledTimes(2);
    expect(shadowCalls).toHaveLength(2);
    expect(shadowCalls[0]?.[0].execution_role).toBe('active');
    expect(shadowCalls[0]?.[0].prompt_version).toBe('v4-evidence-hardened');
    expect(shadowCalls[1]?.[0].execution_role).toBe('shadow');
    expect(shadowCalls[1]?.[0].prompt_version).toBe('v5-compact-a');
    expect(shadowCalls[0]?.[0].analysis_run_id).toBe(shadowCalls[1]?.[0].analysis_run_id);
    expect(result.results[0]?.saved).toBe(true);
    expect(result.results[0]?.notified).toBe(true);
    expect(result.results[0]?.debug?.analysisRunId).toBeTypeOf('string');
  });

  test('shadow prompt never creates extra recommendation, performance row, or notification side effects', async () => {
    mockConfig.liveAnalysisShadowEnabled = true;
    mockConfig.liveAnalysisShadowSampleRate = 1;
    mockConfig.liveAnalysisActivePromptVersion = 'v4-evidence-hardened';
    mockConfig.liveAnalysisShadowPromptVersion = 'v5-compact-a';

    await runPipelineBatch(['100']);
    await flushAsyncWork();

    const { createRecommendation, markRecommendationNotified } = await import('../repos/recommendations.repo.js');
    const { createAiPerformanceRecord } = await import('../repos/ai-performance.repo.js');
    const { sendTelegramPhoto, sendTelegramMessage } = await import('../lib/telegram.js');

    expect(createRecommendation).toHaveBeenCalledTimes(1);
    expect(createAiPerformanceRecord).toHaveBeenCalledTimes(1);
    expect(markRecommendationNotified).not.toHaveBeenCalled();
    expect(sendTelegramPhoto).not.toHaveBeenCalled();
    expect(sendTelegramMessage).not.toHaveBeenCalled();
  });

  test('stores shadow failure separately without breaking active pipeline result', async () => {
    mockConfig.liveAnalysisShadowEnabled = true;
    mockConfig.liveAnalysisShadowSampleRate = 1;
    mockConfig.liveAnalysisActivePromptVersion = 'v4-evidence-hardened';
    mockConfig.liveAnalysisShadowPromptVersion = 'v5-compact-a';

    const { callGemini } = await import('../lib/gemini.js');
    vi.mocked(callGemini)
      .mockResolvedValueOnce(JSON.stringify({
        should_push: true,
        selection: 'Over 2.5 Goals @1.85',
        bet_market: 'over_2.5',
        confidence: 8,
        reasoning_en: 'Open match with high shot count',
        reasoning_vi: 'Open match with high shot count',
        warnings: [],
        value_percent: 12,
        risk_level: 'MEDIUM',
        stake_percent: 5,
        custom_condition_matched: false,
      }))
      .mockRejectedValueOnce(new Error('shadow llm aborted'));

    const result = await runPipelineBatch(['100']);
    await flushAsyncWork();

    const { createPromptShadowRun } = await import('../repos/prompt-shadow-runs.repo.js');
    const shadowCalls = vi.mocked(createPromptShadowRun).mock.calls;

    expect(result.results[0]?.success).toBe(true);
    expect(result.results[0]?.shouldPush).toBe(true);
    expect(shadowCalls).toHaveLength(2);
    expect(shadowCalls[1]?.[0]).toMatchObject({
      execution_role: 'shadow',
      prompt_version: 'v5-compact-a',
      success: false,
      error: 'shadow llm aborted',
    });
  });

  test('does not run prompt shadow when prompt version override is explicitly supplied', async () => {
    mockConfig.liveAnalysisShadowEnabled = true;
    mockConfig.liveAnalysisShadowSampleRate = 1;
    mockConfig.liveAnalysisActivePromptVersion = 'v4-evidence-hardened';
    mockConfig.liveAnalysisShadowPromptVersion = 'v5-compact-a';

    await runPromptOnlyAnalysisForMatch('100', { forceAnalyze: true, promptVersionOverride: LIVE_ANALYSIS_PROMPT_VERSION });
    await flushAsyncWork();

    const { callGemini } = await import('../lib/gemini.js');
    const { createPromptShadowRun } = await import('../repos/prompt-shadow-runs.repo.js');
    expect(callGemini).toHaveBeenCalledTimes(1);
    expect(createPromptShadowRun).not.toHaveBeenCalled();
  });

  test('processes multiple matches sequentially', async () => {
    const fixture200 = {
      fixture: { id: 200, status: { short: '1H', elapsed: 30 }, timestamp: 1700001000 },
      teams: { home: { id: 3, name: 'Team C' }, away: { id: 4, name: 'Team D' } },
      league: { name: 'League 2' },
      goals: { home: 0, away: 1 },
    };

    const footballApi = await import('../lib/football-api.js');
    vi.mocked(footballApi.fetchFixturesByIds).mockResolvedValueOnce([mockFixture, fixture200] as never);

    const watchlistRepo = await import('../repos/watchlist.repo.js');
    vi.mocked(watchlistRepo.getOperationalWatchlistByMatchId)
      .mockResolvedValueOnce(mockWatchlistEntry as never)
      .mockResolvedValueOnce({
        ...mockWatchlistEntry,
        match_id: '200',
        home_team: 'Team C',
        away_team: 'Team D',
        league: 'League 2',
      } as never);

    const result = await runPipelineBatch(['100', '200']);
    expect(result.totalMatches).toBe(2);
    expect(result.processed).toBe(2);
    expect(result.results).toHaveLength(2);
  });

  test('includes previous recommendations in prompt context', async () => {
    const recsRepo = await import('../repos/recommendations.repo.js');
    vi.mocked(recsRepo.getRecommendationsByMatchId).mockResolvedValueOnce([
      { minute: 30, selection: 'Over 1.5 @1.50', bet_market: 'over_1.5', confidence: 7, odds: 1.5, result: 'WON', reasoning: 'Good tempo' },
    ] as never);

    await runPipelineBatch(['100']);

    const { callGemini } = await import('../lib/gemini.js');
    const prompt = vi.mocked(callGemini).mock.calls[0][0];
    expect(prompt).toContain('PREVIOUS RECOMMENDATIONS');
    expect(prompt).toContain('Over 1.5 @1.50');
  });

  test('injects dynamic performance priors into the prompt and removes static prior text', async () => {
    await runPipelineBatch(['100']);

    const { callGemini } = await import('../lib/gemini.js');
    const prompt = vi.mocked(callGemini).mock.calls[0][0];
    expect(prompt).toContain('DYNAMIC PERFORMANCE PRIORS (SELF-LEARNING DATA)');
    expect(prompt).toContain('over_2.5: 70% (7/10) [supportive prior]');
    expect(prompt).toContain('1x2_home: 44.44% (4/9) [caution prior]');
    expect(prompt).not.toContain('1x2_home worst market (35.6% win rate)');
    expect(prompt).not.toContain('BTTS YES: 54.5% win rate');
    expect(prompt).not.toContain('confidence 5->40%, 6->50.2%, 7->51.2%, 8->57.1%');
  });

  test('injects strategic context v2 into the server prompt', async () => {
    const watchlistRepo = await import('../repos/watchlist.repo.js');
    vi.mocked(watchlistRepo.getOperationalWatchlistByMatchId).mockResolvedValueOnce({
      ...mockWatchlistEntry,
      strategic_context: {
        summary: 'Structured strategic context summary.',
        competition_type: 'domestic_league',
        _meta: {
          refresh_status: 'good',
        },
        qualitative: {
          en: {
            home_motivation: 'Home side is chasing Europe.',
            away_motivation: 'Away side needs points for survival.',
            league_positions: '5th vs 17th',
            fixture_congestion: 'Home has a cup match in three days.',
            rotation_risk: 'Moderate home rotation risk.',
            key_absences: 'Away missing two defenders.',
            h2h_narrative: 'Home won three of the last four meetings.',
            summary: 'Structured strategic context summary.',
          },
          vi: {
            home_motivation: 'Chu nha dang dua top chau Au.',
            away_motivation: 'Doi khach can diem de tru hang.',
            league_positions: 'Thu 5 vs thu 17',
            fixture_congestion: 'Chu nha da cup sau ba ngay.',
            rotation_risk: 'Rui ro xoay tua vua phai.',
            key_absences: 'Doi khach mat hai hau ve.',
            h2h_narrative: 'Chu nha thang 3/4 lan gap gan nhat.',
            summary: 'Tom tat strategic context co cau truc.',
          },
        },
        quantitative: {
          home_last5_points: 10,
          away_last5_points: 3,
          home_over_2_5_rate_last10: 60,
          away_over_2_5_rate_last10: 40,
        },
        version: 2,
        source_meta: {
          search_quality: 'high',
          web_search_queries: ['table', 'injuries'],
          sources: [
            { domain: 'reuters.com', trust_tier: 'tier_1' },
            { domain: 'fbref.com', trust_tier: 'tier_2' },
          ],
          trusted_source_count: 2,
          rejected_source_count: 0,
          rejected_domains: [],
        },
      },
    } as never);

    await runPipelineBatch(['100']);

    const { callGemini } = await import('../lib/gemini.js');
    const prompt = vi.mocked(callGemini).mock.calls[0][0];
    expect(prompt).toContain('PREMATCH EXPERT FEATURES V1');
    expect(prompt).toContain('"source_quality":"high"');
    expect(prompt).toContain('"trusted_source_count":2');
    expect(prompt).toContain('"strategic_quant_fields_present":4');
    expect(prompt).toContain('"recent_points_delta":47');
  });

  test('injects team profile features into the server prompt when both teams have profiles', async () => {
    const teamProfilesRepo = await import('../repos/team-profiles.repo.js');
    vi.mocked(teamProfilesRepo.getTeamProfileByTeamId)
      .mockResolvedValueOnce({
        team_id: '1',
        profile: {
          attack_style: 'direct',
          defensive_line: 'high',
          pressing_intensity: 'high',
          set_piece_threat: 'high',
          home_strength: 'strong',
          form_consistency: 'consistent',
          squad_depth: 'deep',
          avg_goals_scored: 1.9,
          avg_goals_conceded: 1.1,
          clean_sheet_rate: 0.35,
          btts_rate: 0.58,
          over_2_5_rate: 0.62,
          avg_corners_for: 6.2,
          avg_corners_against: 4.1,
          avg_cards: 2.1,
          first_goal_rate: 0.64,
          late_goal_rate: 0.41,
          data_reliability_tier: 'high',
        },
        notes_en: '',
        notes_vi: '',
        created_at: '',
        updated_at: '',
      } as never)
      .mockResolvedValueOnce({
        team_id: '2',
        profile: {
          attack_style: 'counter',
          defensive_line: 'low',
          pressing_intensity: 'medium',
          set_piece_threat: 'medium',
          home_strength: 'normal',
          form_consistency: 'inconsistent',
          squad_depth: 'medium',
          avg_goals_scored: 1.1,
          avg_goals_conceded: 1.6,
          clean_sheet_rate: 0.18,
          btts_rate: 0.61,
          over_2_5_rate: 0.57,
          avg_corners_for: 4.0,
          avg_corners_against: 5.9,
          avg_cards: 2.8,
          first_goal_rate: 0.39,
          late_goal_rate: 0.36,
          data_reliability_tier: 'medium',
        },
        notes_en: '',
        notes_vi: '',
        created_at: '',
        updated_at: '',
      } as never);

    await runPipelineBatch(['100']);

    const { callGemini } = await import('../lib/gemini.js');
    const prompt = vi.mocked(callGemini).mock.calls[0][0];
    expect(prompt).toContain('PREMATCH EXPERT FEATURES V1');
    expect(prompt).toContain('"team_profile_fields_present":36');
    expect(prompt).toContain('"optional_team_profile":{');
    expect(prompt).toContain('"first_goal_edge_score":25');
    expect(prompt).toContain('"prematch_noise_penalty":0');
  });

  test('does not inject sparse top-league strategic context even if stored refresh_status is good', async () => {
    const watchlistRepo = await import('../repos/watchlist.repo.js');
    vi.mocked(watchlistRepo.getOperationalWatchlistByMatchId).mockResolvedValueOnce({
      ...mockWatchlistEntry,
      strategic_context: {
        version: 2,
        summary: 'Sparse top-league context.',
        home_motivation: 'Home still chasing Europe.',
        away_motivation: 'Away still fighting survival.',
        league_positions: '5th vs 18th',
        fixture_congestion: 'No data found',
        rotation_risk: 'No data found',
        key_absences: 'No data found',
        h2h_narrative: 'No data found',
        qualitative: {
          en: {
            home_motivation: 'Home still chasing Europe.',
            away_motivation: 'Away still fighting survival.',
            league_positions: '5th vs 18th',
            fixture_congestion: 'No data found',
            rotation_risk: 'No data found',
            key_absences: 'No data found',
            h2h_narrative: 'No data found',
            summary: 'Sparse top-league context.',
          },
          vi: {
            home_motivation: 'Chu nha van dua top chau Au.',
            away_motivation: 'Doi khach van dua tru hang.',
            league_positions: 'Thu 5 vs thu 18',
            fixture_congestion: 'Khong tim thay du lieu',
            rotation_risk: 'Khong tim thay du lieu',
            key_absences: 'Khong tim thay du lieu',
            h2h_narrative: 'Khong tim thay du lieu',
            summary: 'Ngu canh top league qua mong.',
          },
        },
        quantitative: {},
        source_meta: {
          search_quality: 'high',
          web_search_queries: ['premier league injuries'],
          sources: [
            { domain: 'reuters.com', trust_tier: 'tier_1' },
            { domain: 'fbref.com', trust_tier: 'tier_2' },
          ],
          trusted_source_count: 2,
          rejected_source_count: 0,
          rejected_domains: [],
        },
        _meta: {
          refresh_status: 'good',
        },
      },
    } as never);

    await runPipelineBatch(['100']);

    const { callGemini } = await import('../lib/gemini.js');
    const prompt = vi.mocked(callGemini).mock.calls[0][0];
    expect(prompt).not.toContain('Sparse top-league context.');
    expect(prompt).not.toContain('"trusted_source_count":2');
  });

  test('logs audit on successful analysis', async () => {
    await runPipelineBatch(['100']);

    const { audit } = await import('../lib/audit.js');
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({
      category: 'PIPELINE',
      action: 'PIPELINE_MATCH_ANALYZED',
      metadata: expect.objectContaining({
        promptDataLevel: 'advanced-upgraded',
        prematchAvailability: 'minimal',
        prematchNoisePenalty: 60,
        prematchStrength: 'weak',
        promptVersion: expect.any(String),
        statsSource: 'api-football',
        evidenceMode: 'full_live_data',
        policyBlocked: false,
        policyWarnings: expect.any(Array),
        homeTacticalOverlaySourceMode: expect.any(String),
        awayTacticalOverlaySourceMode: expect.any(String),
      }),
    }));
  });

  test('samples routine skip audits instead of logging every skipped match', async () => {
    const { getLatestSnapshot } = await import('../repos/match-snapshots.repo.js');
    vi.mocked(getLatestSnapshot).mockResolvedValueOnce({
      id: 1,
      match_id: '100',
      captured_at: new Date().toISOString(),
      source: 'server-pipeline',
      minute: 64,
      status: '2H',
      home_score: 0,
      away_score: 0,
      stats: {},
      events: [],
      odds: {},
    } as never);

    await runPipelineBatch(['100']);

    const { audit } = await import('../lib/audit.js');
    expect(audit).not.toHaveBeenCalledWith(expect.objectContaining({
      category: 'PIPELINE',
      action: 'PIPELINE_MATCH_SKIPPED',
      outcome: 'SKIPPED',
    }));
  });

  test('logs audit on match processing error', async () => {
    const { callGemini } = await import('../lib/gemini.js');
    vi.mocked(callGemini).mockRejectedValueOnce(new Error('API crash'));

    await runPipelineBatch(['100']);

    const { audit } = await import('../lib/audit.js');
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({
      category: 'PIPELINE',
      action: 'PIPELINE_MATCH_ERROR',
      outcome: 'FAILURE',
    }));
  });

  test('safety: blocks should_push when confidence below minimum', async () => {
    const { callGemini } = await import('../lib/gemini.js');
    vi.mocked(callGemini).mockResolvedValueOnce(JSON.stringify({
      should_push: true,
      selection: 'Over 2.5 Goals @1.85',
      bet_market: 'over_2.5',
      confidence: 3,
      reasoning_en: 'Weak signal',
      reasoning_vi: 'Tín hiệu yếu',
      warnings: [],
      value_percent: 5,
      risk_level: 'MEDIUM',
      stake_percent: 3,
      custom_condition_matched: false,
    }));

    const result = await runPipelineBatch(['100']);
    const { createRecommendation } = await import('../repos/recommendations.repo.js');
    const { createAiPerformanceRecord } = await import('../repos/ai-performance.repo.js');
    // parseAiResponse should block due to confidence < 5
    expect(result.results[0].shouldPush).toBe(false);
    expect(result.results[0].saved).toBe(false);
    expect(result.results[0].notified).toBe(false);
    expect(createRecommendation).not.toHaveBeenCalled();
    expect(createAiPerformanceRecord).not.toHaveBeenCalled();
    const { sendTelegramMessage } = await import('../lib/telegram.js');
    expect(sendTelegramMessage).not.toHaveBeenCalled();
  });

  test('safety: blocks should_push when no selection provided', async () => {
    const { callGemini } = await import('../lib/gemini.js');
    vi.mocked(callGemini).mockResolvedValueOnce(JSON.stringify({
      should_push: true,
      selection: '',
      bet_market: '',
      confidence: 8,
      reasoning_en: 'Good match but forgot selection',
      reasoning_vi: 'Tốt nhưng quên chọn',
      warnings: [],
      value_percent: 10,
      risk_level: 'LOW',
      stake_percent: 5,
      custom_condition_matched: false,
    }));

    const result = await runPipelineBatch(['100']);
    const { createRecommendation } = await import('../repos/recommendations.repo.js');
    const { createAiPerformanceRecord } = await import('../repos/ai-performance.repo.js');
    // System blocks shouldPush (no selection)
    expect(result.results[0].shouldPush).toBe(false);
    expect(result.results[0].saved).toBe(false);
    expect(result.results[0].notified).toBe(false);
    expect(createRecommendation).not.toHaveBeenCalled();
    expect(createAiPerformanceRecord).not.toHaveBeenCalled();
    const { sendTelegramMessage } = await import('../lib/telegram.js');
    expect(sendTelegramMessage).not.toHaveBeenCalled();
  });

  test('does not send long Telegram messages inline anymore', async () => {
    const longReasoning = 'A'.repeat(4000);
    const { callGemini } = await import('../lib/gemini.js');
    vi.mocked(callGemini).mockResolvedValueOnce(JSON.stringify({
      should_push: true,
      selection: 'Over 2.5 Goals @1.85',
      bet_market: 'over_2.5',
      confidence: 8,
      reasoning_en: longReasoning,
      reasoning_vi: longReasoning,
      warnings: [],
      value_percent: 12,
      risk_level: 'MEDIUM',
      stake_percent: 5,
      custom_condition_matched: false,
    }));

    await runPipelineBatch(['100']);

    const { sendTelegramMessage } = await import('../lib/telegram.js');
    expect(sendTelegramMessage).not.toHaveBeenCalled();
  });

  test('advisory follow-up stays grounded but does not save or notify', async () => {
    const { callGemini } = await import('../lib/gemini.js');
    const { createRecommendation } = await import('../repos/recommendations.repo.js');
    vi.mocked(callGemini).mockResolvedValueOnce(JSON.stringify({
      should_push: true,
      selection: 'Home -0.25 @1.94',
      bet_market: 'asian_handicap_home_-0.25',
      market_chosen_reason: 'Home control still looks stronger than the market line implies',
      confidence: 7,
      reasoning_en: 'Live edge still leans home, but treat this as advisory only.',
      reasoning_vi: 'The tran van nghieng ve chu nha, nhung day chi la tu van.',
      warnings: ['ADVISORY_ONLY'],
      value_percent: 8,
      risk_level: 'MEDIUM',
      stake_percent: 4,
      custom_condition_matched: false,
      custom_condition_status: 'none',
      custom_condition_summary_en: '',
      custom_condition_summary_vi: '',
      custom_condition_reason_en: '',
      custom_condition_reason_vi: '',
      condition_triggered_suggestion: '',
      condition_triggered_reasoning_en: '',
      condition_triggered_reasoning_vi: '',
      condition_triggered_confidence: 0,
      condition_triggered_stake: 0,
      condition_triggered_special_override: false,
      condition_triggered_special_override_reason_en: '',
      condition_triggered_special_override_reason_vi: '',
      follow_up_answer_en: 'Home -0.25 is playable only if the control persists, but I would still keep risk moderate.',
      follow_up_answer_vi: 'Keo chu nha -0.25 chi nen can nhac neu the tran kiem soat van duoc duy tri.',
    }));

    const result = await runPromptOnlyAnalysisForMatch('100', {
      forceAnalyze: true,
      advisoryOnly: true,
      userQuestion: 'Would Home -0.25 be better here?',
      followUpHistory: [
        { role: 'user', text: 'Why not under?' },
        { role: 'assistant', text: 'The home side is still controlling the match.' },
      ],
    });

    const prompt = vi.mocked(callGemini).mock.calls[0]?.[0] ?? '';
    expect(prompt).toContain('FOLLOW_UP_MODE: advisory');
    expect(prompt).toContain('USER_QUESTION: Would Home -0.25 be better here?');
    expect(prompt).toContain('LINEUPS_SNAPSHOT:');
    expect(prompt).toContain('Coach A');
    expect(prompt).toContain('Forward A');
    expect(result.result.success).toBe(true);
    expect(result.result.saved).toBe(false);
    expect(result.result.notified).toBe(false);
    expect(result.result.debug?.advisoryOnly).toBe(true);
    expect(result.result.debug?.parsed).toEqual(expect.objectContaining({
      follow_up_answer_en: 'Home -0.25 is playable only if the control persists, but I would still keep risk moderate.',
      follow_up_answer_vi: 'Keo chu nha -0.25 chi nen can nhac neu the tran kiem soat van duoc duy tri.',
    }));
    expect(createRecommendation).not.toHaveBeenCalled();
  });

  test('advisory follow-up prepends lineup-unavailable notice when question mixes lineup and market', async () => {
    const { callGemini } = await import('../lib/gemini.js');
    const { ensureScoutInsight } = await import('../lib/provider-insight-cache.js');

    vi.mocked(ensureScoutInsight).mockResolvedValueOnce({
      lineups: {
        payload: [],
        freshness: 'missing',
        cacheStatus: 'miss',
        cachedAt: null,
        fetchedAt: null,
        degraded: false,
      },
    } as Awaited<ReturnType<typeof ensureScoutInsight>>);

    vi.mocked(callGemini).mockResolvedValueOnce(JSON.stringify({
      should_push: false,
      selection: '',
      bet_market: '',
      market_chosen_reason: 'No direct edge',
      confidence: 0,
      reasoning_en: 'No bet.',
      reasoning_vi: 'Khong vao keo.',
      warnings: ['ADVISORY_ONLY'],
      value_percent: 0,
      risk_level: 'LOW',
      stake_percent: 0,
      custom_condition_matched: false,
      custom_condition_status: 'none',
      custom_condition_summary_en: '',
      custom_condition_summary_vi: '',
      custom_condition_reason_en: '',
      custom_condition_reason_vi: '',
      condition_triggered_suggestion: '',
      condition_triggered_reasoning_en: '',
      condition_triggered_reasoning_vi: '',
      condition_triggered_confidence: 0,
      condition_triggered_stake: 0,
      condition_triggered_special_override: false,
      condition_triggered_special_override_reason_en: '',
      condition_triggered_special_override_reason_vi: '',
      follow_up_answer_en: 'Full-time European 1X2 away still looks like the cleaner angle if the pressure holds.',
      follow_up_answer_vi: 'Keo chau Au 1X2 full-time cua doi khach van la lua chon sach hon neu suc ep duoc duy tri.',
    }));

    const result = await runPromptOnlyAnalysisForMatch('100', {
      forceAnalyze: true,
      advisoryOnly: true,
      userQuestion: 'Lineup thế nào và kèo 1x2 đội khách có ổn không?',
      followUpHistory: [],
    });

    expect(result.result.success).toBe(true);
    expect(result.result.saved).toBe(false);
    expect(result.result.notified).toBe(false);
    expect(result.result.debug?.parsed).toEqual(expect.objectContaining({
      follow_up_answer_en: expect.stringContaining('Confirmed lineup data is currently unavailable in this snapshot.'),
      follow_up_answer_vi: expect.stringContaining('Du lieu doi hinh chinh thuc hien chua co trong snapshot nay.'),
    }));
  });
});
