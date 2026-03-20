// ============================================================
// Integration tests — Deduplication & Re-evaluation
// ============================================================

import { describe, test, expect, vi, beforeEach, type Mock } from 'vitest';
import { reEvaluateAllResults } from '../jobs/re-evaluate.job.js';
import type { RecommendationRow } from '../repos/recommendations.repo.js';
import type { MatchHistoryRow } from '../repos/matches-history.repo.js';

// ==================== Module Mocks ====================

vi.mock('../db/pool.js', () => ({
  query: vi.fn(),
}));

vi.mock('../repos/recommendations.repo.js', () => ({
  settleRecommendation: vi.fn(),
  normalizeMarket: vi.fn((sel: string, betMarket?: string) => {
    if (betMarket) return betMarket;
    if (/over/i.test(sel)) return 'over_2.5';
    if (/btts/i.test(sel)) return 'btts_yes';
    if (/draw/i.test(sel)) return '1x2_draw';
    if (/home|win/i.test(sel)) return '1x2_home';
    return 'unknown';
  }),
}));

vi.mock('../repos/matches-history.repo.js', () => ({
  getHistoricalMatch: vi.fn(),
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

vi.mock('../lib/normalize-market.js', () => ({
  normalizeMarket: vi.fn((sel: string, betMarket?: string) => {
    if (betMarket) return betMarket;
    if (/over/i.test(sel)) return 'over_2.5';
    if (/btts/i.test(sel)) return 'btts_yes';
    if (/draw/i.test(sel)) return '1x2_draw';
    if (/home|win/i.test(sel)) return '1x2_home';
    return 'unknown';
  }),
}));

import { query } from '../db/pool.js';
import * as recommendationsRepo from '../repos/recommendations.repo.js';
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
    status: 'FT',
    condition_triggered_suggestion: '',
    custom_condition_raw: '',
    execution_id: 'exec1',
    odds_snapshot: {},
    stats_snapshot: {},
    pre_match_prediction_summary: '',
    prompt_version: '',
    custom_condition_matched: false,
    minute: 45,
    score: '1-0',
    bet_type: '1x2',
    selection: 'Home Win',
    odds: 2.0,
    confidence: 8,
    value_percent: 15,
    risk_level: 'LOW',
    stake_percent: 3,
    stake_amount: 30,
    reasoning: 'Good form',
    key_factors: 'Home advantage',
    warnings: '',
    ai_model: 'gemini-3.0-flash',
    mode: 'auto',
    bet_market: '1x2_home',
    notified: 'sent',
    notification_channels: 'telegram',
    result: 'win',
    actual_outcome: '2-0',
    pnl: 3,
    settled_at: '2026-03-16T22:00:00Z',
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
    venue: 'Emirates',
    final_status: 'FT',
    home_score: 2,
    away_score: 0,
    archived_at: '2026-03-16T22:00:00Z',
    ...overrides,
  };
}

// ==================== Tests ====================

describe('reEvaluateAllResults', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  /** Helper to set AI settle response */
  function mockAISettle(results: Array<{ id: number; result: string; explanation: string }>) {
    (callGemini as Mock).mockResolvedValue(JSON.stringify(results));
  }

  test('corrects wrong result with real score data', async () => {
    // Rec incorrectly marked as win, but real score is 0-2 (home loss)
    const rec = makeRec({
      id: 1,
      match_id: '12345',
      selection: 'Home Win',
      bet_market: '1x2_home',
      odds: 2.0,
      stake_percent: 3,
      result: 'win',
      pnl: 3,
    });

    (query as Mock).mockResolvedValueOnce({ rows: [rec] }); // getAllRecs
    (matchHistoryRepo.getHistoricalMatch as Mock).mockResolvedValueOnce(
      makeHistory({ home_score: 0, away_score: 2 }),
    );
    (recommendationsRepo.settleRecommendation as Mock).mockResolvedValueOnce(null);
    (aiPerfRepo.settleAiPerformance as Mock).mockResolvedValueOnce(null);
    mockAISettle([{ id: 1, result: 'loss', explanation: 'Home thua 0-2' }]);

    const result = await reEvaluateAllResults();

    expect(result.total).toBe(1);
    expect(result.evaluated).toBe(1);
    expect(result.corrected).toBe(1);
    expect(result.discrepancies).toHaveLength(1);
    expect(result.discrepancies[0]!.oldResult).toBe('win');
    expect(result.discrepancies[0]!.newResult).toBe('loss');

    // Check the settle was called with correct values
    expect(recommendationsRepo.settleRecommendation).toHaveBeenCalledWith(
      1, 'loss', -3, expect.any(String),
    );
    expect(aiPerfRepo.settleAiPerformance).toHaveBeenCalledWith(
      1, 'loss', -3, false,
    );
  });

  test('skips recs with no score data available', async () => {
    const rec = makeRec({ id: 1, match_id: '99999', result: 'win', pnl: 3 });

    (query as Mock).mockResolvedValueOnce({ rows: [rec] });
    (matchHistoryRepo.getHistoricalMatch as Mock).mockResolvedValueOnce(null);
    (fetchFixturesByIds as Mock).mockResolvedValueOnce([]);

    const result = await reEvaluateAllResults();

    expect(result.skippedNoScore).toBe(1);
    expect(result.corrected).toBe(0);
    expect(recommendationsRepo.settleRecommendation).not.toHaveBeenCalled();
  });

  test('does not correct when result matches', async () => {
    // Home win correctly evaluated
    const rec = makeRec({
      id: 1,
      selection: 'Home Win',
      bet_market: '1x2_home',
      odds: 2.0,
      stake_percent: 3,
      result: 'win',
      pnl: 3,
    });

    (query as Mock).mockResolvedValueOnce({ rows: [rec] });
    (matchHistoryRepo.getHistoricalMatch as Mock).mockResolvedValueOnce(
      makeHistory({ home_score: 2, away_score: 0 }),
    );
    mockAISettle([{ id: 1, result: 'win', explanation: 'Home thắng 2-0' }]);

    const result = await reEvaluateAllResults();

    expect(result.corrected).toBe(0);
    expect(result.discrepancies).toHaveLength(0);
    expect(recommendationsRepo.settleRecommendation).not.toHaveBeenCalled();
  });

  test('uses Football API fallback when history not available', async () => {
    const rec = makeRec({
      id: 1,
      match_id: '55555',
      selection: 'Over 2.5',
      bet_market: 'over_2.5',
      odds: 1.85,
      stake_percent: 2,
      result: 'loss',
      pnl: -2,
    });

    (query as Mock).mockResolvedValueOnce({ rows: [rec] });
    (matchHistoryRepo.getHistoricalMatch as Mock).mockResolvedValueOnce(null);
    (fetchFixturesByIds as Mock).mockResolvedValueOnce([
      {
        fixture: {
          id: 55555,
          date: '2026-03-16T20:00:00+00:00',
          status: { short: 'FT' },
          venue: { name: 'Test Stadium' },
        },
        league: { id: 39, name: 'PL' },
        teams: { home: { name: 'TeamA' }, away: { name: 'TeamB' } },
        goals: { home: 2, away: 1 },
      },
    ]);
    (matchHistoryRepo.archiveFinishedMatches as Mock).mockResolvedValueOnce(undefined);
    (recommendationsRepo.settleRecommendation as Mock).mockResolvedValueOnce(null);
    (aiPerfRepo.settleAiPerformance as Mock).mockResolvedValueOnce(null);
    mockAISettle([{ id: 1, result: 'win', explanation: 'Over 2.5 thắng, 3 bàn' }]);

    const result = await reEvaluateAllResults();

    // 2+1=3 > 2.5 → over wins, but old result was loss → corrected
    expect(result.corrected).toBe(1);
    expect(result.discrepancies[0]!.newResult).toBe('win');
    expect(matchHistoryRepo.archiveFinishedMatches).toHaveBeenCalled();
  });

  test('settles unsettled recommendations found with score', async () => {
    const rec = makeRec({
      id: 1,
      selection: 'BTTS (Yes)',
      bet_market: 'btts_yes',
      odds: 1.70,
      stake_percent: 2,
      result: '',   // unsettled
      pnl: 0,
    });

    (query as Mock).mockResolvedValueOnce({ rows: [rec] });
    (matchHistoryRepo.getHistoricalMatch as Mock).mockResolvedValueOnce(
      makeHistory({ home_score: 1, away_score: 1 }),
    );
    (recommendationsRepo.settleRecommendation as Mock).mockResolvedValueOnce(null);
    (aiPerfRepo.settleAiPerformance as Mock).mockResolvedValueOnce(null);
    mockAISettle([{ id: 1, result: 'win', explanation: 'BTTS thắng, 1-1' }]);

    const result = await reEvaluateAllResults();

    expect(result.newlySettled).toBe(1);
    expect(result.corrected).toBe(0);
    expect(recommendationsRepo.settleRecommendation).toHaveBeenCalledWith(
      1, 'win', expect.closeTo(1.4, 1), expect.any(String),
    );
  });

  test('treats push as neutral when re-evaluating', async () => {
    const rec = makeRec({
      id: 1,
      selection: 'Over 2.0',
      bet_market: 'over_2.0',
      odds: 1.85,
      stake_percent: 3,
      result: 'loss',
      pnl: -3,
    });

    (query as Mock).mockResolvedValueOnce({ rows: [rec] });
    (matchHistoryRepo.getHistoricalMatch as Mock).mockResolvedValueOnce(
      makeHistory({ home_score: 1, away_score: 1 }),
    );
    (recommendationsRepo.settleRecommendation as Mock).mockResolvedValueOnce(null);
    (aiPerfRepo.settleAiPerformance as Mock).mockResolvedValueOnce(null);

    const result = await reEvaluateAllResults();

    expect(result.corrected).toBe(1);
    expect(recommendationsRepo.settleRecommendation).toHaveBeenCalledWith(
      1, 'push', 0, expect.any(String),
    );
    expect(aiPerfRepo.settleAiPerformance).toHaveBeenCalledWith(1, 'push', 0, null);
  });

  test('handles multiple recs across different matches', async () => {
    const recs = [
      makeRec({ id: 1, match_id: '111', selection: 'Home Win', bet_market: '1x2_home', result: 'win', pnl: 3 }),
      makeRec({ id: 2, match_id: '222', selection: 'Over 2.5', bet_market: 'over_2.5', result: 'loss', pnl: -2 }),
      makeRec({ id: 3, match_id: '333', selection: 'Draw', bet_market: '1x2_draw', result: '', pnl: 0 }),
    ];

    (query as Mock).mockResolvedValueOnce({ rows: recs });
    (matchHistoryRepo.getHistoricalMatch as Mock)
      .mockResolvedValueOnce(makeHistory({ match_id: '111', home_score: 2, away_score: 0 }))
      .mockResolvedValueOnce(makeHistory({ match_id: '222', home_score: 2, away_score: 1 }))
      .mockResolvedValueOnce(makeHistory({ match_id: '333', home_score: 1, away_score: 1 }));
    (recommendationsRepo.settleRecommendation as Mock).mockResolvedValue(null);
    (aiPerfRepo.settleAiPerformance as Mock).mockResolvedValue(null);
    // AI settles each match group separately
    (callGemini as Mock)
      .mockResolvedValueOnce(JSON.stringify([{ id: 1, result: 'win', explanation: 'Home thắng 2-0' }]))
      .mockResolvedValueOnce(JSON.stringify([{ id: 2, result: 'win', explanation: 'Over 2.5 thắng' }]))
      .mockResolvedValueOnce(JSON.stringify([{ id: 3, result: 'win', explanation: 'Draw 1-1' }]));

    const result = await reEvaluateAllResults();

    expect(result.total).toBe(3);
    expect(result.evaluated).toBe(3);
    // Rec 1: AI says win, old was win → no change
    // Rec 2: AI says win, old was loss → corrected
    // Rec 3: AI says win, old was '' → newly settled
    expect(result.corrected).toBe(1);
    expect(result.newlySettled).toBe(1);
  });
});
