// ============================================================
// Integration tests - autoSettleJob with Football API fallback
// ============================================================

import { describe, test, expect, vi, beforeEach, type Mock } from 'vitest';
import { autoSettleJob } from '../jobs/auto-settle.job.js';
import type { RecommendationRow } from '../repos/recommendations.repo.js';
import type { MatchHistoryRow } from '../repos/matches-history.repo.js';

vi.mock('../repos/recommendations.repo.js', () => ({
  getAllRecommendations: vi.fn(),
  settleRecommendation: vi.fn(),
  markRecommendationUnresolved: vi.fn(),
}));

vi.mock('../repos/bets.repo.js', () => ({
  getUnsettledBets: vi.fn(),
  settleBet: vi.fn(),
  markBetUnresolved: vi.fn(),
}));

vi.mock('../repos/matches-history.repo.js', () => ({
  getHistoricalMatch: vi.fn(),
  getHistoricalMatchesBatch: vi.fn(),
  archiveFinishedMatches: vi.fn(),
  updateHistoricalMatchSettlementData: vi.fn(),
}));

vi.mock('../repos/ai-performance.repo.js', () => ({
  settleAiPerformance: vi.fn(),
  markAiPerformanceSettlementState: vi.fn(),
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

vi.mock('../lib/audit.js', () => ({
  audit: vi.fn(),
  auditSuccess: vi.fn(),
  auditFailure: vi.fn(),
  auditSkipped: vi.fn(),
  auditWrap: vi.fn(),
}));

import * as recommendationsRepo from '../repos/recommendations.repo.js';
import * as betsRepo from '../repos/bets.repo.js';
import * as matchHistoryRepo from '../repos/matches-history.repo.js';
import * as aiPerfRepo from '../repos/ai-performance.repo.js';
import { fetchFixtureStatistics, fetchFixturesByIds } from '../lib/football-api.js';
import { callGemini } from '../lib/gemini.js';

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

function makeApiFixture(
  id: number,
  homeGoals: number,
  awayGoals: number,
  status = 'FT',
  fulltimeScore?: { home: number | null; away: number | null },
) {
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
    league: {
      id: 39,
      name: 'Premier League',
      country: 'England',
      logo: '',
      flag: '',
      season: 2025,
      round: '',
    },
    teams: {
      home: { id: 42, name: 'Arsenal', logo: '', winner: null },
      away: { id: 49, name: 'Chelsea', logo: '', winner: null },
    },
    goals: { home: homeGoals, away: awayGoals },
    score: fulltimeScore ? { fulltime: fulltimeScore } : {},
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  (betsRepo.getUnsettledBets as Mock).mockResolvedValue([]);
  (matchHistoryRepo.getHistoricalMatchesBatch as Mock).mockResolvedValue(new Map());
});

function mockAISettle(results: Array<{ id: number; result: string; explanation: string }>) {
  (callGemini as Mock).mockResolvedValue(JSON.stringify(results));
}

describe('autoSettleJob', () => {
  test('settles recommendation using matches_history', async () => {
    const rec = makeRec({
      match_id: '12345',
      bet_market: 'Over/Under 2.5',
      selection: 'Over 2.5',
      odds: 1.85,
      stake_percent: 3,
    });
    (recommendationsRepo.getAllRecommendations as Mock).mockResolvedValue({ rows: [rec] });
    (matchHistoryRepo.getHistoricalMatchesBatch as Mock).mockResolvedValue(
      new Map([['12345', makeHistory({ home_score: 2, away_score: 1 })]]),
    );
    mockAISettle([{ id: 1, result: 'win', explanation: 'Tong ban thang la 3, vuot muc 2.5' }]);

    const stats = await autoSettleJob();

    expect(stats.settled).toBe(1);
    expect(stats.skipped).toBe(0);
    expect(recommendationsRepo.settleRecommendation).toHaveBeenCalledWith(
      1,
      'win',
      expect.closeTo(2.55),
      expect.any(String),
      expect.objectContaining({ status: 'resolved', method: 'rules' }),
    );
    expect(aiPerfRepo.settleAiPerformance).toHaveBeenCalledWith(
      1,
      'win',
      expect.closeTo(2.55),
      true,
      expect.objectContaining({ status: 'resolved', method: 'rules', trusted: true }),
    );
    expect(fetchFixturesByIds).not.toHaveBeenCalled();
  });

  test('uses cached settlement stats from matches_history before Football API stats fallback', async () => {
    const rec = makeRec({
      match_id: '12347',
      bet_market: 'corners_over_9.5',
      selection: 'Corners Over 9.5',
      odds: 1.95,
      stake_percent: 2,
    });
    (recommendationsRepo.getAllRecommendations as Mock).mockResolvedValue({ rows: [rec] });
    (matchHistoryRepo.getHistoricalMatchesBatch as Mock).mockResolvedValue(
      new Map([['12347', makeHistory({
        match_id: '12347',
        home_score: 2,
        away_score: 1,
        settlement_stats: [
          { type: 'Corner Kicks', home: 7, away: 4 },
        ],
      })]]),
    );

    const stats = await autoSettleJob();

    expect(stats.settled).toBe(1);
    expect(fetchFixtureStatistics).not.toHaveBeenCalled();
    expect(callGemini).not.toHaveBeenCalled();
    expect(recommendationsRepo.settleRecommendation).toHaveBeenCalledWith(
      1,
      'win',
      expect.closeTo(1.9),
      expect.any(String),
      expect.objectContaining({ status: 'resolved', method: 'rules' }),
    );
  });

  test('settles descriptive standard market labels without AI fallback', async () => {
    const rec = makeRec({
      match_id: '12346',
      bet_market: 'Over/Under 2.5',
      selection: 'Over 2.5',
      odds: 1.9,
      stake_percent: 2,
    });
    (recommendationsRepo.getAllRecommendations as Mock).mockResolvedValue({ rows: [rec] });
    (matchHistoryRepo.getHistoricalMatchesBatch as Mock).mockResolvedValue(
      new Map([['12346', makeHistory({ match_id: '12346', home_score: 2, away_score: 1 })]]),
    );

    const stats = await autoSettleJob();

    expect(stats.settled).toBe(1);
    expect(recommendationsRepo.settleRecommendation).toHaveBeenCalledWith(
      1,
      'win',
      expect.closeTo(1.8),
      expect.any(String),
      expect.objectContaining({ status: 'resolved', method: 'rules' }),
    );
    expect(callGemini).not.toHaveBeenCalled();
  });

  test('falls back to Football API when matches_history is empty', async () => {
    const rec = makeRec({
      match_id: '99999',
      bet_market: 'Over/Under 2.5',
      selection: 'Over 2.5',
      odds: 1.85,
      stake_percent: 3,
    });
    (recommendationsRepo.getAllRecommendations as Mock).mockResolvedValue({ rows: [rec] });
    (matchHistoryRepo.getHistoricalMatchesBatch as Mock).mockResolvedValue(new Map());
    (fetchFixturesByIds as Mock).mockResolvedValue([makeApiFixture(99999, 3, 0)]);
    mockAISettle([{ id: 1, result: 'win', explanation: 'Tong ban thang la 3, vuot muc 2.5' }]);

    const stats = await autoSettleJob();

    expect(fetchFixturesByIds).toHaveBeenCalledWith(['99999']);
    expect(stats.settled).toBe(1);
    expect(recommendationsRepo.settleRecommendation).toHaveBeenCalledWith(
      1,
      'win',
      expect.closeTo(2.55),
      expect.any(String),
      expect.objectContaining({ status: 'resolved', method: 'rules' }),
    );
    expect(matchHistoryRepo.archiveFinishedMatches).toHaveBeenCalled();
  });

  test('skips recommendation when match is still live', async () => {
    const rec = makeRec({ match_id: '77777' });
    (recommendationsRepo.getAllRecommendations as Mock).mockResolvedValue({ rows: [rec] });
    (matchHistoryRepo.getHistoricalMatchesBatch as Mock).mockResolvedValue(new Map());
    (fetchFixturesByIds as Mock).mockResolvedValue([makeApiFixture(77777, 1, 0, '2H')]);

    const stats = await autoSettleJob();

    expect(stats.skipped).toBe(1);
    expect(stats.settled).toBe(0);
    expect(recommendationsRepo.settleRecommendation).not.toHaveBeenCalled();
  });

  test('handles multiple unsettled recs with mixed history and API', async () => {
    const rec1 = makeRec({
      id: 1,
      match_id: '100',
      bet_market: 'Over/Under 2.5',
      selection: 'Over 2.5',
      odds: 1.85,
      stake_percent: 2,
    });
    const rec2 = makeRec({
      id: 2,
      match_id: '200',
      bet_market: 'btts',
      selection: 'yes',
      odds: 1.7,
      stake_percent: 2,
    });
    (recommendationsRepo.getAllRecommendations as Mock).mockResolvedValue({ rows: [rec1, rec2] });
    (matchHistoryRepo.getHistoricalMatchesBatch as Mock).mockResolvedValue(
      new Map([['100', makeHistory({ match_id: '100', home_score: 2, away_score: 1 })]]),
    );
    (fetchFixturesByIds as Mock).mockResolvedValue([makeApiFixture(200, 1, 2)]);
    (callGemini as Mock)
      .mockResolvedValueOnce(JSON.stringify([{ id: 1, result: 'win', explanation: 'Over 2.5 thang' }]))
      .mockResolvedValueOnce(JSON.stringify([{ id: 2, result: 'win', explanation: 'BTTS thang' }]));

    const stats = await autoSettleJob();

    expect(stats.settled).toBe(2);
    expect(fetchFixturesByIds).toHaveBeenCalledWith(['200']);
  });

  test('Football API failure does not crash and missing matches are skipped', async () => {
    const rec = makeRec({ match_id: '55555' });
    (recommendationsRepo.getAllRecommendations as Mock).mockResolvedValue({ rows: [rec] });
    (matchHistoryRepo.getHistoricalMatchesBatch as Mock).mockResolvedValue(new Map());
    (fetchFixturesByIds as Mock).mockRejectedValue(new Error('API key expired'));

    const stats = await autoSettleJob();

    expect(stats.skipped).toBe(1);
    expect(stats.settled).toBe(0);
    expect(stats.errors).toBe(0);
  });

  test('no unsettled items does nothing', async () => {
    (recommendationsRepo.getAllRecommendations as Mock).mockResolvedValue({ rows: [] });

    const stats = await autoSettleJob();

    expect(stats.settled).toBe(0);
    expect(stats.skipped).toBe(0);
    expect(fetchFixturesByIds).not.toHaveBeenCalled();
  });

  test('loss result is computed correctly via API fallback', async () => {
    const rec = makeRec({
      match_id: '88888',
      bet_market: 'Over/Under 2.5',
      selection: 'Over 2.5',
      odds: 1.85,
      stake_percent: 3,
    });
    (recommendationsRepo.getAllRecommendations as Mock).mockResolvedValue({ rows: [rec] });
    (matchHistoryRepo.getHistoricalMatchesBatch as Mock).mockResolvedValue(new Map());
    (fetchFixturesByIds as Mock).mockResolvedValue([makeApiFixture(88888, 1, 0)]);
    mockAISettle([{ id: 1, result: 'loss', explanation: 'Tong ban thang la 1, khong vuot muc 2.5' }]);

    const stats = await autoSettleJob();

    expect(stats.settled).toBe(1);
    expect(recommendationsRepo.settleRecommendation).toHaveBeenCalledWith(
      1,
      'loss',
      -3,
      expect.any(String),
      expect.objectContaining({ status: 'resolved', method: 'rules' }),
    );
  });

  test('treats push as neutral in ai_performance', async () => {
    const rec = makeRec({
      match_id: '54321',
      bet_market: 'over_2.0',
      selection: 'Over 2.0',
      odds: 1.85,
      stake_percent: 3,
    });
    (recommendationsRepo.getAllRecommendations as Mock).mockResolvedValue({ rows: [rec] });
    (matchHistoryRepo.getHistoricalMatchesBatch as Mock).mockResolvedValue(
      new Map([['54321', makeHistory({ match_id: '54321', home_score: 1, away_score: 1 })]]),
    );

    const stats = await autoSettleJob();

    expect(stats.settled).toBe(1);
    expect(recommendationsRepo.settleRecommendation).toHaveBeenCalledWith(
      1,
      'push',
      0,
      expect.any(String),
      expect.objectContaining({ status: 'resolved', method: 'rules' }),
    );
    expect(aiPerfRepo.settleAiPerformance).toHaveBeenCalledWith(
      1,
      'push',
      0,
      null,
      expect.objectContaining({ status: 'resolved', method: 'rules', trusted: true }),
    );
  });

  test('settles AET match using regular-time score from API fulltime breakdown', async () => {
    const rec = makeRec({
      match_id: '66666',
      bet_market: 'over_2.5',
      selection: 'Over 2.5',
      odds: 1.85,
      stake_percent: 2,
    });
    (recommendationsRepo.getAllRecommendations as Mock).mockResolvedValue({ rows: [rec] });
    (matchHistoryRepo.getHistoricalMatchesBatch as Mock).mockResolvedValue(new Map());
    (fetchFixturesByIds as Mock).mockResolvedValue([
      makeApiFixture(66666, 2, 2, 'AET', { home: 1, away: 1 }),
    ]);

    const stats = await autoSettleJob();

    expect(stats.settled).toBe(1);
    expect(recommendationsRepo.settleRecommendation).toHaveBeenCalledWith(
      1,
      'loss',
      -2,
      expect.any(String),
      expect.objectContaining({ status: 'resolved', method: 'rules' }),
    );
    expect(callGemini).not.toHaveBeenCalled();
  });

  test('uses cached regular-time score from matches_history for AET match without fixture lookup', async () => {
    const rec = makeRec({
      match_id: '66668',
      bet_market: 'over_2.5',
      selection: 'Over 2.5',
      odds: 1.85,
      stake_percent: 2,
    });
    (recommendationsRepo.getAllRecommendations as Mock).mockResolvedValue({ rows: [rec] });
    (matchHistoryRepo.getHistoricalMatchesBatch as Mock).mockResolvedValue(
      new Map([['66668', makeHistory({
        match_id: '66668',
        final_status: 'AET',
        home_score: 2,
        away_score: 2,
        regular_home_score: 1,
        regular_away_score: 1,
      })]]),
    );

    const stats = await autoSettleJob();

    expect(stats.settled).toBe(1);
    expect(fetchFixturesByIds).not.toHaveBeenCalled();
    expect(callGemini).not.toHaveBeenCalled();
    expect(recommendationsRepo.settleRecommendation).toHaveBeenCalledWith(
      1,
      'loss',
      -2,
      expect.any(String),
      expect.objectContaining({ status: 'resolved', method: 'rules' }),
    );
  });

  test('skips AET match when regular-time score is unavailable', async () => {
    const rec = makeRec({
      match_id: '66667',
      bet_market: 'over_2.5',
      selection: 'Over 2.5',
      odds: 1.85,
      stake_percent: 2,
    });
    (recommendationsRepo.getAllRecommendations as Mock).mockResolvedValue({ rows: [rec] });
    (matchHistoryRepo.getHistoricalMatchesBatch as Mock).mockResolvedValue(new Map());
    (fetchFixturesByIds as Mock).mockResolvedValue([makeApiFixture(66667, 2, 2, 'AET')]);

    const stats = await autoSettleJob();

    expect(stats.settled).toBe(0);
    expect(stats.skipped).toBe(1);
    expect(recommendationsRepo.settleRecommendation).not.toHaveBeenCalled();
    expect(recommendationsRepo.markRecommendationUnresolved).toHaveBeenCalledWith(
      1,
      expect.objectContaining({ note: expect.stringContaining('Settlement context unavailable') }),
    );
    expect(callGemini).not.toHaveBeenCalled();
  });

  test('marks corners market unresolved when official corner stats are missing', async () => {
    const rec = makeRec({
      match_id: '33333',
      bet_market: 'corners_over_9.5',
      selection: 'Corners Over 9.5',
      odds: 1.95,
      stake_percent: 2,
    });
    (recommendationsRepo.getAllRecommendations as Mock).mockResolvedValue({ rows: [rec] });
    (matchHistoryRepo.getHistoricalMatchesBatch as Mock).mockResolvedValue(
      new Map([['33333', makeHistory({ match_id: '33333', home_score: 2, away_score: 1 })]]),
    );

    const stats = await autoSettleJob();

    expect(stats.settled).toBe(0);
    expect(stats.skipped).toBe(1);
    expect(recommendationsRepo.settleRecommendation).not.toHaveBeenCalled();
    expect(recommendationsRepo.markRecommendationUnresolved).toHaveBeenCalledWith(
      1,
      expect.objectContaining({ method: 'rules', note: expect.stringContaining('Missing official corner statistics') }),
    );
    expect(aiPerfRepo.markAiPerformanceSettlementState).toHaveBeenCalledWith(
      1,
      expect.objectContaining({ status: 'unresolved', method: 'rules', trusted: false }),
    );
    expect(callGemini).not.toHaveBeenCalled();
  });
});
