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
    liveScoreBenchmarkEnabled: true,
    liveScoreStatsFallbackEnabled: true,
    webLiveStatsFallbackEnabled: false,
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

vi.mock('../lib/the-odds-api.js', () => ({
  fetchTheOddsLiveDetailed: vi.fn().mockResolvedValue({
    result: null,
    matchedEvent: null,
    rawEventOdds: null,
    sportKey: null,
    scannedSportKeys: [],
    error: 'NO_EXACT_EVENT_MATCH',
  }),
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
}));

vi.mock('../lib/live-score-api.js', () => ({
  fetchLiveScoreBenchmarkTrace: vi.fn().mockResolvedValue({
    matched: true,
    providerMatchId: '695741',
    providerFixtureId: '1840649',
    matchedMatch: {
      id: 695741,
      fixture_id: 1840649,
      home: { name: 'Team A' },
      away: { name: 'Team B' },
      competition: { name: 'Test League' },
      time: '65',
      scheduled: '14:00',
    },
    rawLiveMatches: [{ id: 695741 }],
    rawStats: {
      possesion: '54:46',
      corners: '6:4',
      attempts_on_goal: '12:8',
      shots_on_target: '5:3',
    },
    rawEvents: [],
    normalizedStats: [],
    normalizedEvents: [],
    statsCompact: {
      possession: { home: '54', away: '46' },
      shots: { home: '12', away: '8' },
      shots_on_target: { home: '5', away: '3' },
      corners: { home: '6', away: '4' },
      fouls: { home: null, away: null },
      offsides: { home: null, away: null },
      yellow_cards: { home: null, away: null },
      red_cards: { home: null, away: null },
      goalkeeper_saves: { home: null, away: null },
      blocked_shots: { home: null, away: null },
      total_passes: { home: null, away: null },
      passes_accurate: { home: null, away: null },
    },
    coverageFlags: {
      matched: true,
      has_possession: true,
      has_shots: true,
      has_shots_on_target: true,
      has_corners: true,
      event_count: 0,
      populated_stat_pairs: 4,
      total_stat_pairs: 12,
    },
    statusCode: 200,
    latencyMs: 120,
    error: null,
  }),
}));

vi.mock('../lib/web-live-fallback.js', () => ({
  fetchDeterministicWebLiveFallback: vi.fn().mockResolvedValue({
    success: false,
    request: null,
    rawDraft: '',
    structured: null,
    sourceMeta: {
      search_quality: 'unknown',
      web_search_queries: [],
      sources: [],
      trusted_source_count: 0,
      rejected_source_count: 0,
      rejected_domains: [],
    },
    fetchedPages: [],
    validation: {
      accepted: false,
      reasons: ['NO_DETERMINISTIC_MATCH'],
    },
    error: 'NO_DETERMINISTIC_MATCH',
  }),
}));

function buildLiveScoreTrace(overrides: Record<string, unknown> = {}) {
  return {
    matched: true,
    providerMatchId: '695741',
    providerFixtureId: '1840649',
    matchedMatch: {
      id: 695741,
      fixture_id: 1840649,
      home: { name: 'Team A' },
      away: { name: 'Team B' },
      competition: { name: 'Test League' },
      time: '65',
      scheduled: '14:00',
    },
    rawLiveMatches: [{ id: 695741 }],
    rawStats: {
      possesion: '54:46',
      corners: '6:4',
      attempts_on_goal: '12:8',
      shots_on_target: '5:3',
      fauls: '10:12',
    },
    rawEvents: [],
    normalizedStats: [
      { team: { id: 1 }, statistics: [
        { type: 'Ball Possession', value: '54%' },
        { type: 'Total Shots', value: 12 },
        { type: 'Shots on Goal', value: 5 },
        { type: 'Corner Kicks', value: 6 },
        { type: 'Fouls', value: 10 },
      ] },
      { team: { id: 2 }, statistics: [
        { type: 'Ball Possession', value: '46%' },
        { type: 'Total Shots', value: 8 },
        { type: 'Shots on Goal', value: 3 },
        { type: 'Corner Kicks', value: 4 },
        { type: 'Fouls', value: 12 },
      ] },
    ],
    normalizedEvents: [
      { time: { elapsed: 23 }, team: { id: 1, name: 'Team A', logo: '' }, type: 'Goal', detail: 'Normal Goal', player: { id: null, name: 'Player A' }, assist: { id: null, name: null }, comments: null },
    ],
    statsCompact: {
      possession: { home: '54', away: '46' },
      shots: { home: '12', away: '8' },
      shots_on_target: { home: '5', away: '3' },
      corners: { home: '6', away: '4' },
      fouls: { home: '10', away: '12' },
      offsides: { home: null, away: null },
      yellow_cards: { home: null, away: null },
      red_cards: { home: null, away: null },
      goalkeeper_saves: { home: null, away: null },
      blocked_shots: { home: null, away: null },
      total_passes: { home: null, away: null },
      passes_accurate: { home: null, away: null },
    },
    coverageFlags: {
      matched: true,
      has_possession: true,
      has_shots: true,
      has_shots_on_target: true,
      has_corners: true,
      event_count: 1,
      populated_stat_pairs: 5,
      total_stat_pairs: 12,
    },
    statusCode: 200,
    latencyMs: 120,
    error: null,
    ...overrides,
  };
}

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
}));

vi.mock('../repos/team-profiles.repo.js', () => ({
  getTeamProfileByTeamId: vi.fn().mockResolvedValue(null),
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

beforeEach(() => {
  vi.clearAllMocks();
  mockConfig.webLiveStatsFallbackEnabled = false;
  mockConfig.liveAnalysisActivePromptVersion = '';
  mockConfig.liveAnalysisShadowPromptVersion = '';
  mockConfig.liveAnalysisShadowEnabled = false;
  mockConfig.liveAnalysisShadowSampleRate = 0;
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

  test('fetches fixtures, stats, events in parallel', async () => {
    await runPipelineBatch(['100']);

    const footballApi = await import('../lib/football-api.js');
    expect(footballApi.fetchFixturesByIds).toHaveBeenCalledWith(['100']);
    expect(footballApi.fetchFixtureStatistics).toHaveBeenCalledWith('100');
    expect(footballApi.fetchFixtureEvents).toHaveBeenCalledWith('100');
    expect(footballApi.fetchLiveOdds).toHaveBeenCalledWith('100');
  });

  test('records live-score benchmark samples without changing the main pipeline path', async () => {
    await runPipelineBatch(['100']);

    const liveScoreApi = await import('../lib/live-score-api.js');
    expect(liveScoreApi.fetchLiveScoreBenchmarkTrace).toHaveBeenCalledWith(mockFixture);

    const providerSampling = await import('../lib/provider-sampling.js');
    const calls = vi.mocked(providerSampling.recordProviderStatsSampleSafe).mock.calls;
    expect(calls.some(([sample]) => sample.provider === 'live-score-api' && sample.success === true)).toBe(true);
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

  test('uses Live Score fallback when API-Sports stats are unusable', async () => {
    const footballApi = await import('../lib/football-api.js');
    vi.mocked(footballApi.fetchFixtureStatistics).mockResolvedValueOnce([]);
    vi.mocked(footballApi.fetchFixtureEvents).mockResolvedValueOnce([]);

    const liveScoreApi = await import('../lib/live-score-api.js');
    vi.mocked(liveScoreApi.fetchLiveScoreBenchmarkTrace).mockResolvedValueOnce(buildLiveScoreTrace());

    const result = await runPipelineBatch(['100']);

    const { callGemini } = await import('../lib/gemini.js');
    const prompt = vi.mocked(callGemini).mock.calls[0][0];
    expect(prompt).toContain('STATS_SOURCE: live-score-api-fallback');
    expect(prompt).toContain('EVIDENCE_MODE: full_live_data');
    expect(prompt).toContain('Stats Fallback Note: API-Sports stats unavailable');
    expect(result.results[0]?.debug?.statsSource).toBe('live-score-api-fallback');
    expect(result.results[0]?.debug?.statsFallbackUsed).toBe(true);
  });

  test('supplements degraded API-Sports stats with partial Live Score stats without upgrading evidence tier', async () => {
    const footballApi = await import('../lib/football-api.js');
    vi.mocked(footballApi.fetchFixtureStatistics).mockResolvedValueOnce([]);
    vi.mocked(footballApi.fetchFixtureEvents).mockResolvedValueOnce([
      { time: { elapsed: 46 }, team: { id: 1 }, type: 'subst', detail: 'Substitution 1', player: { name: 'Player A' } },
    ] as never);

    const liveScoreApi = await import('../lib/live-score-api.js');
    vi.mocked(liveScoreApi.fetchLiveScoreBenchmarkTrace).mockResolvedValueOnce(buildLiveScoreTrace({
      rawStats: {
        possesion: null,
        corners: '3:0',
        attempts_on_goal: null,
        shots_on_target: null,
        fauls: null,
        yellow_cards: '0:2',
      },
      normalizedStats: [
        { team: { id: 1 }, statistics: [{ type: 'Corner Kicks', value: 3 }, { type: 'Yellow Cards', value: 0 }] },
        { team: { id: 2 }, statistics: [{ type: 'Corner Kicks', value: 0 }, { type: 'Yellow Cards', value: 2 }] },
      ],
      normalizedEvents: [
        { time: { elapsed: 46 }, team: { id: 1, name: 'Team A', logo: '' }, type: 'subst', detail: 'Substitution 1', player: { id: null, name: 'Player A' }, assist: { id: null, name: 'Bench' }, comments: null },
      ],
      statsCompact: {
        possession: { home: null, away: null },
        shots: { home: null, away: null },
        shots_on_target: { home: null, away: null },
        corners: { home: '3', away: '0' },
        fouls: { home: null, away: null },
        offsides: { home: null, away: null },
        yellow_cards: { home: '0', away: '2' },
        red_cards: { home: null, away: null },
        goalkeeper_saves: { home: null, away: null },
        blocked_shots: { home: null, away: null },
        total_passes: { home: null, away: null },
        passes_accurate: { home: null, away: null },
      },
      coverageFlags: {
        matched: true,
        has_possession: false,
        has_shots: false,
        has_shots_on_target: false,
        has_corners: true,
        event_count: 1,
        populated_stat_pairs: 1,
        total_stat_pairs: 12,
      },
    }));

    const result = await runPipelineBatch(['100']);

    const { callGemini } = await import('../lib/gemini.js');
    const prompt = vi.mocked(callGemini).mock.calls[0][0];
    expect(prompt).toContain('STATS_SOURCE: live-score-api-fallback');
    expect(prompt).toContain('\"corners\":{\"home\":\"3\",\"away\":\"0\"}');
    expect(prompt).toContain('EVIDENCE_MODE: odds_events_only_degraded');
    expect(String(result.results[0]?.debug?.statsFallbackReason || '')).toContain('supplemented');
    expect(result.results[0]?.debug?.statsSource).toBe('live-score-api-fallback');
    expect(result.results[0]?.debug?.statsFallbackUsed).toBe(true);
    expect(result.results[0]?.debug?.evidenceMode).toBe('odds_events_only_degraded');
  });

  test('uses trusted web fallback when live state matches and deterministic stats improve coverage', async () => {
    mockConfig.webLiveStatsFallbackEnabled = true;

    const footballApi = await import('../lib/football-api.js');
    vi.mocked(footballApi.fetchFixtureStatistics).mockResolvedValueOnce([]);
    vi.mocked(footballApi.fetchFixtureEvents).mockResolvedValueOnce([] as never);

    const liveScoreApi = await import('../lib/live-score-api.js');
    vi.mocked(liveScoreApi.fetchLiveScoreBenchmarkTrace).mockResolvedValueOnce(buildLiveScoreTrace({
      matched: false,
      providerMatchId: null,
      providerFixtureId: null,
      matchedMatch: null,
      rawLiveMatches: [],
      rawStats: null,
      rawEvents: [],
      normalizedStats: [],
      normalizedEvents: [],
      coverageFlags: {
        matched: false,
        has_possession: false,
        has_shots: false,
        has_shots_on_target: false,
        has_corners: false,
        event_count: 0,
        populated_stat_pairs: 0,
        total_stat_pairs: 12,
      },
      error: 'NO_LIVE_SCORE_MATCH',
    }));

    const webFallback = await import('../lib/web-live-fallback.js');
    vi.mocked(webFallback.fetchDeterministicWebLiveFallback).mockResolvedValueOnce({
      success: true,
      request: null,
      rawDraft: '',
      structured: {
        matched: true,
        matched_title: 'Team A vs Team B',
        matched_url: 'https://portal.kleague.com/common/result/result0051popup.do',
        home_team: 'Team A',
        away_team: 'Team B',
        competition: 'Test League',
        status: '2H',
        minute: 65,
        score: { home: 1, away: 1 },
        stats: {
          possession: { home: 54, away: 46 },
          shots: { home: 12, away: 8 },
          shots_on_target: { home: 5, away: 3 },
          corners: { home: 6, away: 4 },
          fouls: { home: 10, away: 12 },
          yellow_cards: { home: 1, away: 2 },
          red_cards: { home: 0, away: 0 },
        },
        events: [
          { minute: 23, team: 'home', type: 'goal', detail: 'Goal', player: 'Player A' },
        ],
        notes: 'Trusted deterministic fallback',
      },
      sourceMeta: {
        search_quality: 'high',
        web_search_queries: ['kleague_portal:Team A vs Team B'],
        sources: [{
          title: 'K League Portal',
          url: 'https://portal.kleague.com/common/result/result0051popup.do',
          domain: 'portal.kleague.com',
          publisher: 'K League Portal',
          language: 'ko',
          source_type: 'official',
          trust_tier: 'tier_1',
        }],
        trusted_source_count: 1,
        rejected_source_count: 0,
        rejected_domains: [],
      },
      fetchedPages: [],
      validation: {
        accepted: true,
        reasons: [],
      },
      error: null,
    } as never);

    const result = await runPipelineBatch(['100']);

    const { callGemini } = await import('../lib/gemini.js');
    const prompt = vi.mocked(callGemini).mock.calls[0][0];
    expect(prompt).toContain('STATS_SOURCE: web-trusted-fallback');
    expect(prompt).toContain('EVIDENCE_MODE: full_live_data');
    expect(result.results[0]?.debug?.statsSource).toBe('web-trusted-fallback');
    expect(result.results[0]?.debug?.statsFallbackUsed).toBe(true);
    expect(String(result.results[0]?.debug?.statsFallbackReason || '')).toContain('Trusted web fallback merged');
  });

  test('rejects trusted web fallback when live-state validation shows score mismatch', async () => {
    mockConfig.webLiveStatsFallbackEnabled = true;

    const footballApi = await import('../lib/football-api.js');
    vi.mocked(footballApi.fetchFixtureStatistics).mockResolvedValueOnce([]);
    vi.mocked(footballApi.fetchFixtureEvents).mockResolvedValueOnce([] as never);

    const liveScoreApi = await import('../lib/live-score-api.js');
    vi.mocked(liveScoreApi.fetchLiveScoreBenchmarkTrace).mockResolvedValueOnce(buildLiveScoreTrace({
      matched: false,
      providerMatchId: null,
      providerFixtureId: null,
      matchedMatch: null,
      rawLiveMatches: [],
      rawStats: null,
      rawEvents: [],
      normalizedStats: [],
      normalizedEvents: [],
      coverageFlags: {
        matched: false,
        has_possession: false,
        has_shots: false,
        has_shots_on_target: false,
        has_corners: false,
        event_count: 0,
        populated_stat_pairs: 0,
        total_stat_pairs: 12,
      },
      error: 'NO_LIVE_SCORE_MATCH',
    }));

    const webFallback = await import('../lib/web-live-fallback.js');
    vi.mocked(webFallback.fetchDeterministicWebLiveFallback).mockResolvedValueOnce({
      success: true,
      request: null,
      rawDraft: '',
      structured: {
        matched: true,
        matched_title: 'Team A vs Team B',
        matched_url: 'https://portal.kleague.com/common/result/result0051popup.do',
        home_team: 'Team A',
        away_team: 'Team B',
        competition: 'Test League',
        status: 'FT',
        minute: 90,
        score: { home: 3, away: 1 },
        stats: {
          possession: { home: 54, away: 46 },
          shots: { home: 12, away: 8 },
          shots_on_target: { home: 5, away: 3 },
          corners: { home: 6, away: 4 },
          fouls: { home: 10, away: 12 },
          yellow_cards: { home: 1, away: 2 },
          red_cards: { home: 0, away: 0 },
        },
        events: [
          { minute: 90, team: 'home', type: 'goal', detail: 'Goal', player: 'Player A' },
        ],
        notes: 'Stale final-state fallback',
      },
      sourceMeta: {
        search_quality: 'high',
        web_search_queries: ['kleague_portal:Team A vs Team B'],
        sources: [{
          title: 'K League Portal',
          url: 'https://portal.kleague.com/common/result/result0051popup.do',
          domain: 'portal.kleague.com',
          publisher: 'K League Portal',
          language: 'ko',
          source_type: 'official',
          trust_tier: 'tier_1',
        }],
        trusted_source_count: 1,
        rejected_source_count: 0,
        rejected_domains: [],
      },
      fetchedPages: [],
      validation: {
        accepted: false,
        reasons: ['SCORE_MISMATCH', 'STATUS_MISMATCH', 'MINUTE_TOO_FAR'],
      },
      error: null,
    } as never);

    const result = await runPipelineBatch(['100']);

    const { callGemini } = await import('../lib/gemini.js');
    const prompt = vi.mocked(callGemini).mock.calls[0][0];
    expect(prompt).toContain('STATS_SOURCE: api-football');
    expect(prompt).toContain('EVIDENCE_MODE: low_evidence');
    expect(result.results[0]?.debug?.statsSource).toBe('api-football');
    expect(result.results[0]?.debug?.statsFallbackUsed).toBe(false);
    expect(String(result.results[0]?.debug?.statsFallbackReason || '')).toContain('live-state mismatch');
  });

  test('keeps pipeline running when trusted web fallback throws provider error', async () => {
    mockConfig.webLiveStatsFallbackEnabled = true;

    const footballApi = await import('../lib/football-api.js');
    vi.mocked(footballApi.fetchFixtureStatistics).mockResolvedValueOnce([]);
    vi.mocked(footballApi.fetchFixtureEvents).mockResolvedValueOnce([
      { time: { elapsed: 23 }, team: { id: 1 }, type: 'Goal', detail: 'Normal Goal', player: { name: 'Player A' } },
      { time: { elapsed: 55 }, team: { id: 2 }, type: 'Goal', detail: 'Normal Goal', player: { name: 'Player B' } },
    ] as never);

    const liveScoreApi = await import('../lib/live-score-api.js');
    vi.mocked(liveScoreApi.fetchLiveScoreBenchmarkTrace).mockResolvedValueOnce(buildLiveScoreTrace({
      matched: false,
      providerMatchId: null,
      providerFixtureId: null,
      matchedMatch: null,
      rawLiveMatches: [],
      rawStats: null,
      rawEvents: [],
      normalizedStats: [],
      normalizedEvents: [],
      coverageFlags: {
        matched: false,
        has_possession: false,
        has_shots: false,
        has_shots_on_target: false,
        has_corners: false,
        event_count: 0,
        populated_stat_pairs: 0,
        total_stat_pairs: 12,
      },
      error: 'NO_LIVE_SCORE_MATCH',
    }));

    const webFallback = await import('../lib/web-live-fallback.js');
    vi.mocked(webFallback.fetchDeterministicWebLiveFallback).mockRejectedValueOnce(new Error('Sofascore 403: Forbidden'));

    const result = await runPipelineBatch(['100']);

    expect(result.errors).toBe(0);
    expect(result.results[0]?.success).toBe(true);
    expect(result.results[0]?.debug?.evidenceMode).toBe('odds_events_only_degraded');
    expect(result.results[0]?.debug?.statsFallbackUsed).toBe(false);
    expect(String(result.results[0]?.debug?.statsFallbackReason || '')).toContain('Trusted web fallback unavailable: Sofascore 403');
  });

  test('uses degraded odds+events mode when stats stay unavailable after fallback check', async () => {
    const footballApi = await import('../lib/football-api.js');
    vi.mocked(footballApi.fetchFixtureStatistics).mockResolvedValueOnce([]);
    vi.mocked(footballApi.fetchFixtureEvents).mockResolvedValueOnce([
      { time: { elapsed: 23 }, team: { id: 1 }, type: 'Goal', detail: 'Normal Goal', player: { name: 'Player A' } },
      { time: { elapsed: 55 }, team: { id: 2 }, type: 'Goal', detail: 'Normal Goal', player: { name: 'Player B' } },
    ] as never);

    const liveScoreApi = await import('../lib/live-score-api.js');
    vi.mocked(liveScoreApi.fetchLiveScoreBenchmarkTrace).mockResolvedValueOnce(buildLiveScoreTrace({
      matched: false,
      providerMatchId: null,
      providerFixtureId: null,
      matchedMatch: null,
      rawLiveMatches: [],
      rawStats: null,
      rawEvents: [],
      normalizedStats: [],
      normalizedEvents: [],
      coverageFlags: {
        matched: false,
        has_possession: false,
        has_shots: false,
        has_shots_on_target: false,
        has_corners: false,
        event_count: 0,
        populated_stat_pairs: 0,
        total_stat_pairs: 12,
      },
      error: 'NO_LIVE_SCORE_MATCH',
    }));

    const result = await runPipelineBatch(['100']);

    const { callGemini } = await import('../lib/gemini.js');
    const prompt = vi.mocked(callGemini).mock.calls[0][0];
    expect(prompt).toContain('STATS_SOURCE: api-football');
    expect(prompt).toContain('EVIDENCE_MODE: odds_events_only_degraded');
    expect(prompt).toContain('Allowed markets in this tier: O/U and selective AH only');
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

    const liveScoreApi = await import('../lib/live-score-api.js');
    vi.mocked(liveScoreApi.fetchLiveScoreBenchmarkTrace).mockResolvedValueOnce(buildLiveScoreTrace({
      matched: false,
      providerMatchId: null,
      providerFixtureId: null,
      matchedMatch: null,
      rawLiveMatches: [],
      rawStats: null,
      rawEvents: [],
      normalizedStats: [],
      normalizedEvents: [],
      coverageFlags: {
        matched: false,
        has_possession: false,
        has_shots: false,
        has_shots_on_target: false,
        has_corners: false,
        event_count: 0,
        populated_stat_pairs: 0,
        total_stat_pairs: 12,
      },
      error: 'NO_LIVE_SCORE_MATCH',
    }));

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

  test('sends Telegram notification for should_push=true', async () => {
    await runPipelineBatch(['100']);

    const { sendTelegramPhoto, sendTelegramMessage } = await import('../lib/telegram.js');
    const { markRecommendationNotified } = await import('../repos/recommendations.repo.js');
    expect(sendTelegramPhoto).toHaveBeenCalledTimes(1);
    expect(vi.mocked(sendTelegramMessage).mock.calls.length).toBeGreaterThanOrEqual(1);
    expect(markRecommendationNotified).toHaveBeenCalledWith(999, 'telegram');
  });

  test('prefers eligible user telegram channels and marks matching delivery rows delivered', async () => {
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

    const { sendTelegramPhoto } = await import('../lib/telegram.js');
    const { markRecommendationNotified } = await import('../repos/recommendations.repo.js');

    expect(deliveryRepo.getEligibleTelegramDeliveryTargets).toHaveBeenCalledWith(999);
    expect(sendTelegramPhoto).toHaveBeenCalledTimes(2);
    expect(sendTelegramPhoto).toHaveBeenNthCalledWith(
      1,
      'telegram-chat-1',
      expect.any(String),
      expect.any(String),
    );
    expect(sendTelegramPhoto).toHaveBeenNthCalledWith(
      2,
      'telegram-chat-2',
      expect.any(String),
      expect.any(String),
    );
    expect(deliveryRepo.markRecommendationDeliveriesDelivered).toHaveBeenCalledWith(999, ['user-1', 'user-2'], 'telegram');
    expect(markRecommendationNotified).toHaveBeenCalledWith(999, 'telegram');
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

  test('falls back to pre-match odds when live odds unavailable', async () => {
    const footballApi = await import('../lib/football-api.js');
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

    await runPipelineBatch(['100']);

    const { callGemini } = await import('../lib/gemini.js');
    const prompt = vi.mocked(callGemini).mock.calls[0][0];
    expect(prompt).toContain('reference-prematch');
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

  test('uses The Odds fallback before pre-match in auto-pipeline', async () => {
    const footballApi = await import('../lib/football-api.js');
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

    const theOddsApi = await import('../lib/the-odds-api.js');
    vi.mocked(theOddsApi.fetchTheOddsLiveDetailed).mockResolvedValueOnce({
      result: {
        fixture: { id: 100 },
        bookmakers: [{
          name: 'FallbackBook',
          bets: [{ name: 'Over/Under', values: [
            { value: 'Over', odd: '1.80', handicap: '2.5' },
            { value: 'Under', odd: '2.05', handicap: '2.5' },
          ] }],
        }],
      },
      matchedEvent: null,
      rawEventOdds: null,
      sportKey: 'soccer_epl',
      scannedSportKeys: ['soccer_epl'],
      error: null,
    } as never);

    await runPipelineBatch(['100']);

    const { callGemini } = await import('../lib/gemini.js');
    const prompt = vi.mocked(callGemini).mock.calls[0][0];
    expect(theOddsApi.fetchTheOddsLiveDetailed).toHaveBeenCalled();
    expect(footballApi.fetchPreMatchOdds).not.toHaveBeenCalled();
    expect(prompt).toContain('ODDS_SOURCE: fallback-live');
  });

  test('falls back to The Odds API when both live and pre-match unavailable', async () => {
    const footballApi = await import('../lib/football-api.js');
    vi.mocked(footballApi.fetchLiveOdds).mockResolvedValueOnce([]);
    vi.mocked(footballApi.fetchPreMatchOdds).mockResolvedValueOnce([]);

    const theOddsApi = await import('../lib/the-odds-api.js');
    vi.mocked(theOddsApi.fetchTheOddsLiveDetailed).mockResolvedValueOnce({
      result: {
        fixture: { id: 100 },
        bookmakers: [{
          name: 'FallbackBook',
          bets: [{ name: 'Over/Under', values: [
            { value: 'Over', odd: '1.80', handicap: '2.5' },
            { value: 'Under', odd: '2.05', handicap: '2.5' },
          ] }],
        }],
      },
      matchedEvent: null,
      rawEventOdds: null,
      sportKey: 'soccer_epl',
      scannedSportKeys: ['soccer_epl'],
      error: null,
    } as never);

    await runPipelineBatch(['100']);
    expect(theOddsApi.fetchTheOddsLiveDetailed).toHaveBeenCalled();
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

  test('marks condition-only trigger in parsed debug but does NOT save when AI has no actionable bet', async () => {
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
      condition_triggered_suggestion: 'Under 2.5 Goals @2.00',
      condition_triggered_reasoning_en: 'Condition says the under thesis is live.',
      condition_triggered_reasoning_vi: 'Dieu kien cho thay thesis under dang hop le.',
      condition_triggered_confidence: 7,
      condition_triggered_stake: 3,
    }));

    const result = await runPipelineBatch(['100']);
    const { createRecommendation } = await import('../repos/recommendations.repo.js');
    const { createAiPerformanceRecord } = await import('../repos/ai-performance.repo.js');
    const { sendTelegramMessage } = await import('../lib/telegram.js');

    expect(result.results[0]?.shouldPush).toBe(true);
    expect(result.results[0]?.saved).toBe(false);
    expect(result.results[0]?.notified).toBe(true);
    expect(result.results[0]?.selection).toBe('Under 2.5 Goals @2.00');
    expect(result.results[0]?.confidence).toBe(7);
    expect(result.results[0]?.debug?.parsed).toEqual(expect.objectContaining({
      custom_condition_matched: true,
      custom_condition_status: 'evaluated',
      condition_triggered_suggestion: 'Under 2.5 Goals @2.00',
      condition_triggered_confidence: 7,
      condition_triggered_stake: 3,
      condition_triggered_should_push: true,
      should_push: true,
      final_should_bet: false,
      ai_should_push: false,
    }));
    expect(createRecommendation).not.toHaveBeenCalled();
    expect(createAiPerformanceRecord).not.toHaveBeenCalled();
    expect(vi.mocked(sendTelegramMessage).mock.calls.length).toBeGreaterThanOrEqual(1);
  });

  test('force mode bypasses proceed and staleness gates', async () => {
    const footballApi = await import('../lib/football-api.js');
    vi.mocked(footballApi.fetchFixturesByIds).mockResolvedValueOnce([{
      ...mockFixture,
      fixture: { ...mockFixture.fixture, status: { short: '1H', elapsed: 3 } },
    }] as never);

    const watchlistRepo = await import('../repos/watchlist.repo.js');
    vi.mocked(watchlistRepo.getOperationalWatchlistByMatchId).mockResolvedValueOnce({
      ...mockWatchlistEntry,
      mode: 'F',
    } as never);

    const result = await runPipelineBatch(['100']);

    const { callGemini } = await import('../lib/gemini.js');
    expect(callGemini).toHaveBeenCalledTimes(1);
    const prompt = vi.mocked(callGemini).mock.calls[0][0];
    expect(prompt).toContain('- Analysis Mode: system_force');
    expect(prompt).toContain('- Trigger Provenance: watchlist/system force mode');
    expect(prompt).not.toContain('MANUAL USER REQUEST');
    expect(result.results[0].success).toBe(true);
    expect(result.results[0].debug?.analysisMode).toBe('system_force');
  });

  test('prompt-only Ask AI path marks manual_force provenance', async () => {
    const result = await runPromptOnlyAnalysisForMatch('100', { forceAnalyze: true });

    expect(result.prompt).toContain('- Analysis Mode: manual_force');
    expect(result.prompt).toContain('- Trigger Provenance: manual Ask AI request');
    expect(result.prompt).toContain('- Is Manual Push: YES');
    expect(result.prompt).not.toContain('watchlist/system force mode, not by a direct manual Ask AI request');
    expect(result.result.debug?.analysisMode).toBe('manual_force');
  });

  test('prompt-only analysis removes logically settled BTTS odds before sending prompt to LLM', async () => {
    const result = await runPromptOnlyAnalysisForMatch('100', { forceAnalyze: true });

    expect(result.prompt).toContain('1-1');
    expect(result.prompt).toContain('ODDS SANITY NOTES:');
    expect(result.prompt).toContain('Removed BTTS market from prompt: both teams have already scored (1-1), so BTTS is already logically settled.');
    expect(result.prompt).not.toContain('"btts":{"yes":1.6,"no":2.15}');
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
    expect(markRecommendationNotified).toHaveBeenCalledTimes(1);
    expect(sendTelegramPhoto).toHaveBeenCalledTimes(1);
    expect(vi.mocked(sendTelegramMessage).mock.calls.length).toBeGreaterThanOrEqual(1);
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
      }),
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

  test('Telegram handles long messages by chunking', async () => {
    const longReasoning = 'A'.repeat(4000);
    const { callGemini } = await import('../lib/gemini.js');
    const { sendTelegramPhoto } = await import('../lib/telegram.js');
    vi.mocked(sendTelegramPhoto).mockRejectedValueOnce(new Error('photo unavailable in test'));
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
    // Multiple chunks for the long message
    expect(vi.mocked(sendTelegramMessage).mock.calls.length).toBeGreaterThanOrEqual(2);
  });
});
