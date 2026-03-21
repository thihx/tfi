// ============================================================
// Unit tests — Server Pipeline
// ============================================================

import { describe, test, expect, vi, beforeEach } from 'vitest';
import { LIVE_ANALYSIS_PROMPT_VERSION } from '../lib/live-analysis-prompt.js';

// ─── Mocks ───────────────────────────────────────────────

vi.mock('../config.js', () => ({
  config: {
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
  },
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
}));

const mockFixture = {
  fixture: { id: 100, status: { short: '2H', elapsed: 65 }, timestamp: 1700000000 },
  teams: { home: { id: 1, name: 'Team A' }, away: { id: 2, name: 'Team B' } },
  league: { name: 'Test League' },
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
  getWatchlistByMatchId: vi.fn().mockResolvedValue(mockWatchlistEntry),
}));

vi.mock('../repos/matches.repo.js', () => ({
  getMatchesByIds: vi.fn().mockResolvedValue([]),
}));

vi.mock('../repos/recommendations.repo.js', () => ({
  createRecommendation: vi.fn().mockResolvedValue({ id: 999 }),
  getRecommendationsByMatchId: vi.fn().mockResolvedValue([]),
  markRecommendationNotified: vi.fn().mockResolvedValue({ id: 999, notified: 'yes', notification_channels: 'telegram' }),
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

const {
  runPipelineBatch,
  runPromptOnlyAnalysisForMatch,
} = await import('../lib/server-pipeline.js');

beforeEach(() => {
  vi.clearAllMocks();
});

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

    const { sendTelegramMessage } = await import('../lib/telegram.js');
    const { markRecommendationNotified } = await import('../repos/recommendations.repo.js');
    expect(sendTelegramMessage).toHaveBeenCalledTimes(1);
    expect(sendTelegramMessage).toHaveBeenCalledWith('123456', expect.stringContaining('AI RECOMMENDATION'));
    expect(markRecommendationNotified).toHaveBeenCalledWith(999, 'telegram');
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
    vi.mocked(watchlistRepo.getWatchlistByMatchId).mockResolvedValueOnce(null);

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
    expect(prompt).toContain('pre-match');
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
    expect(prompt).toContain('ODDS_SOURCE: the-odds-api');
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
    vi.mocked(snapshotsRepo.getLatestSnapshot).mockResolvedValueOnce({
      id: 99,
      match_id: '100',
      captured_at: new Date().toISOString(),
      source: 'server-pipeline',
      minute: 63,
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
    expect(createSnapshot).toHaveBeenCalledTimes(1);
    expect(callGemini).not.toHaveBeenCalled();
    expect(result.results[0].success).toBe(true);
    expect(result.results[0].saved).toBe(false);
    expect(result.results[0].notified).toBe(false);
  });

  test('force mode bypasses proceed and staleness gates', async () => {
    const footballApi = await import('../lib/football-api.js');
    vi.mocked(footballApi.fetchFixturesByIds).mockResolvedValueOnce([{
      ...mockFixture,
      fixture: { ...mockFixture.fixture, status: { short: '1H', elapsed: 3 } },
    }] as never);

    const watchlistRepo = await import('../repos/watchlist.repo.js');
    vi.mocked(watchlistRepo.getWatchlistByMatchId).mockResolvedValueOnce({
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
    vi.mocked(watchlistRepo.getWatchlistByMatchId)
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
    vi.mocked(watchlistRepo.getWatchlistByMatchId).mockResolvedValueOnce({
      ...mockWatchlistEntry,
      strategic_context: {
        summary: 'Structured strategic context summary.',
        competition_type: 'domestic_league',
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
        source_meta: {
          search_quality: 'high',
          sources: [
            { domain: 'reuters.com', trust_tier: 'tier_1' },
            { domain: 'fbref.com', trust_tier: 'tier_2' },
          ],
        },
      },
    } as never);

    await runPipelineBatch(['100']);

    const { callGemini } = await import('../lib/gemini.js');
    const prompt = vi.mocked(callGemini).mock.calls[0][0];
    expect(prompt).toContain('SOURCE_QUALITY: high');
    expect(prompt).toContain('TRUSTED_SOURCE_DOMAINS: reuters.com, fbref.com');
    expect(prompt).toContain('"home_last5_points":10');
    expect(prompt).toContain('SUMMARY: Structured strategic context summary.');
  });

  test('logs audit on successful analysis', async () => {
    await runPipelineBatch(['100']);

    const { audit } = await import('../lib/audit.js');
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({
      category: 'PIPELINE',
      action: 'PIPELINE_MATCH_ANALYZED',
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
    // parseAiResponse should block due to confidence < 5
    expect(result.results[0].shouldPush).toBe(false);
    // But still SAVES because AI raw intent was should_push=true
    expect(result.results[0].saved).toBe(true);
    // No Telegram because system blocked it
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
    // System blocks shouldPush (no selection)
    expect(result.results[0].shouldPush).toBe(false);
    // But still SAVES because AI raw intent was should_push=true
    expect(result.results[0].saved).toBe(true);
    // No Telegram because system blocked it
    const { sendTelegramMessage } = await import('../lib/telegram.js');
    expect(sendTelegramMessage).not.toHaveBeenCalled();
  });

  test('Telegram handles long messages by chunking', async () => {
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
    // Multiple chunks for the long message
    expect(vi.mocked(sendTelegramMessage).mock.calls.length).toBeGreaterThanOrEqual(2);
  });
});
