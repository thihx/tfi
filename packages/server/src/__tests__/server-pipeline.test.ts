// ============================================================
// Unit tests — Server Pipeline
// ============================================================

import { describe, test, expect, vi, beforeEach } from 'vitest';

// ─── Mocks ───────────────────────────────────────────────

vi.mock('../config.js', () => ({
  config: {
    geminiApiKey: 'test-key',
    geminiModel: 'gemini-test',
    telegramBotToken: 'test-bot',
    pipelineTelegramChatId: '123456',
    pipelineEnabled: true,
    pipelineBatchSize: 3,
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
  fetchTheOddsLive: vi.fn().mockResolvedValue(null),
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
}));

const { runPipelineBatch } = await import('../lib/server-pipeline.js');

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
    }));
  });

  test('sends Telegram notification for should_push=true', async () => {
    await runPipelineBatch(['100']);

    const { sendTelegramMessage } = await import('../lib/telegram.js');
    expect(sendTelegramMessage).toHaveBeenCalledTimes(1);
    expect(sendTelegramMessage).toHaveBeenCalledWith('123456', expect.stringContaining('AI RECOMMENDATION'));
  });

  test('does NOT send Telegram when AI says should_push=false', async () => {
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
    expect(sendTelegramMessage).not.toHaveBeenCalled();
    expect(result.results[0].shouldPush).toBe(false);
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

  test('falls back to The Odds API when both live and pre-match unavailable', async () => {
    const footballApi = await import('../lib/football-api.js');
    vi.mocked(footballApi.fetchLiveOdds).mockResolvedValueOnce([]);
    vi.mocked(footballApi.fetchPreMatchOdds).mockResolvedValueOnce([]);

    const theOddsApi = await import('../lib/the-odds-api.js');
    vi.mocked(theOddsApi.fetchTheOddsLive).mockResolvedValueOnce({
      bookmakers: [{
        name: 'FallbackBook',
        bets: [{ name: 'Over/Under', values: [
          { value: 'Over', odd: '1.80', handicap: '2.5' },
          { value: 'Under', odd: '2.05', handicap: '2.5' },
        ] }],
      }],
    } as never);

    await runPipelineBatch(['100']);
    expect(theOddsApi.fetchTheOddsLive).toHaveBeenCalled();
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
    expect(result.results[0].shouldPush).toBe(false);
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
