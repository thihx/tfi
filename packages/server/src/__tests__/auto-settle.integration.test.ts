// ============================================================
// Integration tests — autoSettleJob with Football API fallback
// ============================================================

import { describe, test, expect, vi, beforeEach, type Mock } from 'vitest';
import { autoSettleJob } from '../jobs/auto-settle.job.js';
import type { RecommendationRow } from '../repos/recommendations.repo.js';
import type { MatchHistoryRow } from '../repos/matches-history.repo.js';

// ==================== Module Mocks ====================

vi.mock('../repos/recommendations.repo.js', () => ({
  getAllRecommendations: vi.fn(),
  settleRecommendation: vi.fn(),
}));

vi.mock('../repos/bets.repo.js', () => ({
  getUnsettledBets: vi.fn(),
  settleBet: vi.fn(),
}));

vi.mock('../repos/matches-history.repo.js', () => ({
  getHistoricalMatch: vi.fn(),
  getHistoricalMatchesBatch: vi.fn(),
  archiveFinishedMatches: vi.fn(),
}));

vi.mock('../repos/ai-performance.repo.js', () => ({
  settleAiPerformance: vi.fn(),
}));

vi.mock('../lib/football-api.js', () => ({
  fetchFixturesByIds: vi.fn(),
  fetchFixtureStatistics: vi.fn().mockResolvedValue([]),
}));

vi.mock('../lib/gemini.js', () => ({
  callGemini: vi.fn(),
}));

vi.mock('../config.js', () => ({
  config: { geminiApiKey: 'test-key', geminiModel: 'test-model' },
}));

vi.mock('../jobs/job-progress.js', () => ({
  reportJobProgress: vi.fn(),
}));

import * as recommendationsRepo from '../repos/recommendations.repo.js';
import * as betsRepo from '../repos/bets.repo.js';
import * as matchHistoryRepo from '../repos/matches-history.repo.js';
import * as aiPerfRepo from '../repos/ai-performance.repo.js';
import { fetchFixturesByIds } from '../lib/football-api.js';
import { callGemini } from '../lib/gemini.js';

// ==================== Helpers ====================

function makeRec(overrides: Partial<RecommendationRow> = {}): RecommendationRow {
  return {
    id: 1,
    unique_key: 'test_key',
    match_id: '12345',
    timestamp: '2026-03-16T20:00:00Z',
    league: 'Premier League',
    home_team: 'Arsenal',
    away_team: 'Chelsea',
    status: '2H',
    condition_triggered_suggestion: '',
    custom_condition_raw: '',
    execution_id: 'exec_1',
    odds_snapshot: {},
    stats_snapshot: {},
    pre_match_prediction_summary: '',
    prompt_version: 'v3',
    custom_condition_matched: false,
    minute: 65,
    score: '1-0',
    bet_type: 'over_2.5',
    selection: 'Over 2.5 Goals @1.85',
    odds: 1.85,
    confidence: 7,
    value_percent: 12,
    risk_level: 'MEDIUM',
    stake_percent: 3,
    stake_amount: null,
    reasoning: 'Both pressing',
    key_factors: '',
    warnings: '[]',
    ai_model: 'gemini-3-pro-preview',
    mode: 'B',
    bet_market: 'Over/Under 2.5',
    notified: 'yes',
    notification_channels: 'telegram',
    result: '',
    actual_outcome: '',
    pnl: 0,
    settled_at: null,
    _was_overridden: false,
    ...overrides,
  };
}

function makeHistory(overrides: Partial<MatchHistoryRow> = {}): MatchHistoryRow {
  return {
    match_id: '12345',
    date: '2026-03-16',
    kickoff: '20:00',
    league_id: 39,
    league_name: 'Premier League',
    home_team: 'Arsenal',
    away_team: 'Chelsea',
    venue: 'Emirates Stadium',
    final_status: 'FT',
    home_score: 2,
    away_score: 1,
    archived_at: '2026-03-16T22:00:00Z',
    ...overrides,
  };
}

function makeApiFixture(id: number, homeGoals: number, awayGoals: number, status = 'FT') {
  return {
    fixture: {
      id,
      referee: null,
      timezone: 'UTC',
      date: '2026-03-16T20:00:00+00:00',
      timestamp: 1773955200,
      periods: { first: null, second: null },
      venue: { id: 1, name: 'Emirates Stadium', city: 'London' },
      status: { long: status === 'FT' ? 'Match Finished' : status, short: status, elapsed: 90 },
    },
    league: { id: 39, name: 'Premier League', country: 'England', logo: '', flag: '', season: 2025, round: '' },
    teams: {
      home: { id: 42, name: 'Arsenal', logo: '', winner: null },
      away: { id: 49, name: 'Chelsea', logo: '', winner: null },
    },
    goals: { home: homeGoals, away: awayGoals },
    score: {},
  };
}

// ==================== Setup ====================

beforeEach(() => {
  vi.resetAllMocks();
  (betsRepo.getUnsettledBets as Mock).mockResolvedValue([]);
  (matchHistoryRepo.getHistoricalMatchesBatch as Mock).mockResolvedValue(new Map());
});

/** Helper to set AI settle response */
function mockAISettle(results: Array<{ id: number; result: string; explanation: string }>) {
  (callGemini as Mock).mockResolvedValue(JSON.stringify(results));
}

// ==================== Tests ====================

describe('autoSettleJob', () => {
  test('settles recommendation using matches_history', async () => {
    const rec = makeRec({ match_id: '12345', bet_market: 'Over/Under 2.5', selection: 'Over 2.5', odds: 1.85, stake_percent: 3 });
    (recommendationsRepo.getAllRecommendations as Mock).mockResolvedValue({ rows: [rec] });
    (matchHistoryRepo.getHistoricalMatchesBatch as Mock).mockResolvedValue(
      new Map([['12345', makeHistory({ home_score: 2, away_score: 1 })]]),
    );
    mockAISettle([{ id: 1, result: 'win', explanation: 'Tổng bàn thắng là 3, vượt mức 2.5' }]);

    const stats = await autoSettleJob();

    expect(stats.settled).toBe(1);
    expect(stats.skipped).toBe(0);
    expect(recommendationsRepo.settleRecommendation).toHaveBeenCalledWith(1, 'win', expect.closeTo(2.55), expect.any(String));
    expect(aiPerfRepo.settleAiPerformance).toHaveBeenCalledWith(1, 'win', expect.closeTo(2.55), true);
    expect(fetchFixturesByIds).not.toHaveBeenCalled();
  });

  test('falls back to Football API when matches_history is empty', async () => {
    const rec = makeRec({ match_id: '99999', bet_market: 'Over/Under 2.5', selection: 'Over 2.5', odds: 1.85, stake_percent: 3 });
    (recommendationsRepo.getAllRecommendations as Mock).mockResolvedValue({ rows: [rec] });
    (matchHistoryRepo.getHistoricalMatchesBatch as Mock).mockResolvedValue(new Map());
    (fetchFixturesByIds as Mock).mockResolvedValue([makeApiFixture(99999, 3, 0)]);
    mockAISettle([{ id: 1, result: 'win', explanation: 'Tổng bàn thắng là 3, vượt mức 2.5' }]);

    const stats = await autoSettleJob();

    expect(fetchFixturesByIds).toHaveBeenCalledWith(['99999']);
    expect(stats.settled).toBe(1);
    expect(recommendationsRepo.settleRecommendation).toHaveBeenCalledWith(1, 'win', expect.closeTo(2.55), expect.any(String));
    // Also archives the result
    expect(matchHistoryRepo.archiveFinishedMatches).toHaveBeenCalled();
  });

  test('skips recommendation when match is still live (not FT)', async () => {
    const rec = makeRec({ match_id: '77777' });
    (recommendationsRepo.getAllRecommendations as Mock).mockResolvedValue({ rows: [rec] });
    (matchHistoryRepo.getHistoricalMatchesBatch as Mock).mockResolvedValue(new Map());
    (fetchFixturesByIds as Mock).mockResolvedValue([
      makeApiFixture(77777, 1, 0, '2H'),
    ]);

    const stats = await autoSettleJob();

    expect(stats.skipped).toBe(1);
    expect(stats.settled).toBe(0);
    expect(recommendationsRepo.settleRecommendation).not.toHaveBeenCalled();
  });

  test('handles multiple unsettled recs — mixed history and API', async () => {
    const rec1 = makeRec({ id: 1, match_id: '100', bet_market: 'Over/Under 2.5', selection: 'Over 2.5', odds: 1.85, stake_percent: 2 });
    const rec2 = makeRec({ id: 2, match_id: '200', bet_market: 'btts', selection: 'yes', odds: 1.7, stake_percent: 2 });
    (recommendationsRepo.getAllRecommendations as Mock).mockResolvedValue({ rows: [rec1, rec2] });

    // 100 is in history, 200 must come from API
    (matchHistoryRepo.getHistoricalMatchesBatch as Mock).mockResolvedValue(
      new Map([['100', makeHistory({ match_id: '100', home_score: 2, away_score: 1 })]]),
    );
    (fetchFixturesByIds as Mock).mockResolvedValue([makeApiFixture(200, 1, 2)]);
    // AI settles each match group separately
    (callGemini as Mock)
      .mockResolvedValueOnce(JSON.stringify([{ id: 1, result: 'win', explanation: 'Over 2.5 thắng' }]))
      .mockResolvedValueOnce(JSON.stringify([{ id: 2, result: 'win', explanation: 'BTTS thắng' }]));

    const stats = await autoSettleJob();

    expect(stats.settled).toBe(2);
    expect(fetchFixturesByIds).toHaveBeenCalledWith(['200']);
  });

  test('Football API failure does not crash — missing matches skipped', async () => {
    const rec = makeRec({ match_id: '55555' });
    (recommendationsRepo.getAllRecommendations as Mock).mockResolvedValue({ rows: [rec] });
    (matchHistoryRepo.getHistoricalMatchesBatch as Mock).mockResolvedValue(new Map());
    (fetchFixturesByIds as Mock).mockRejectedValue(new Error('API key expired'));

    const stats = await autoSettleJob();

    expect(stats.skipped).toBe(1);
    expect(stats.settled).toBe(0);
    expect(stats.errors).toBe(0);
  });

  test('no unsettled items — nothing happens', async () => {
    (recommendationsRepo.getAllRecommendations as Mock).mockResolvedValue({ rows: [] });

    const stats = await autoSettleJob();

    expect(stats.settled).toBe(0);
    expect(stats.skipped).toBe(0);
    expect(fetchFixturesByIds).not.toHaveBeenCalled();
  });

  test('loss result correctly computed via API fallback', async () => {
    const rec = makeRec({ match_id: '88888', bet_market: 'Over/Under 2.5', selection: 'Over 2.5', odds: 1.85, stake_percent: 3 });
    (recommendationsRepo.getAllRecommendations as Mock).mockResolvedValue({ rows: [rec] });
    (matchHistoryRepo.getHistoricalMatchesBatch as Mock).mockResolvedValue(new Map());
    (fetchFixturesByIds as Mock).mockResolvedValue([makeApiFixture(88888, 1, 0)]);
    mockAISettle([{ id: 1, result: 'loss', explanation: 'Tổng bàn thắng là 1, không vượt mức 2.5' }]);

    const stats = await autoSettleJob();

    expect(stats.settled).toBe(1);
    // Over 2.5, total goals = 1 → loss
    expect(recommendationsRepo.settleRecommendation).toHaveBeenCalledWith(1, 'loss', -3, expect.any(String));
  });

  test('treats push as neutral in ai_performance', async () => {
    const rec = makeRec({ match_id: '54321', bet_market: 'over_2.0', selection: 'Over 2.0', odds: 1.85, stake_percent: 3 });
    (recommendationsRepo.getAllRecommendations as Mock).mockResolvedValue({ rows: [rec] });
    (matchHistoryRepo.getHistoricalMatchesBatch as Mock).mockResolvedValue(
      new Map([['54321', makeHistory({ match_id: '54321', home_score: 1, away_score: 1 })]]),
    );

    const stats = await autoSettleJob();

    expect(stats.settled).toBe(1);
    expect(recommendationsRepo.settleRecommendation).toHaveBeenCalledWith(1, 'push', 0, expect.any(String));
    expect(aiPerfRepo.settleAiPerformance).toHaveBeenCalledWith(1, 'push', 0, null);
  });

  test('settles AET match from API', async () => {
    const rec = makeRec({ match_id: '66666', bet_market: 'Over/Under 2.5', selection: 'Over 2.5', odds: 1.85, stake_percent: 2 });
    (recommendationsRepo.getAllRecommendations as Mock).mockResolvedValue({ rows: [rec] });
    (matchHistoryRepo.getHistoricalMatchesBatch as Mock).mockResolvedValue(new Map());
    (fetchFixturesByIds as Mock).mockResolvedValue([makeApiFixture(66666, 2, 2, 'AET')]);
    mockAISettle([{ id: 1, result: 'win', explanation: 'Tổng bàn thắng là 4, vượt mức 2.5' }]);

    const stats = await autoSettleJob();

    expect(stats.settled).toBe(1);
    // Over 2.5, total goals = 4 → win
    expect(recommendationsRepo.settleRecommendation).toHaveBeenCalledWith(1, 'win', expect.closeTo(1.7), expect.any(String));
  });
});
