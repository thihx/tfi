import { beforeEach, describe, expect, test, vi } from 'vitest';

const { clientQuery, stageRecommendationDeliveries, evaluateRecommendationDeliveryConditions } = vi.hoisted(() => ({
  clientQuery: vi.fn(),
  stageRecommendationDeliveries: vi.fn().mockResolvedValue(0),
  evaluateRecommendationDeliveryConditions: vi.fn().mockResolvedValue(0),
}));

vi.mock('../db/pool.js', () => ({
  query: vi.fn(),
  transaction: vi.fn(async (cb: (client: { query: typeof clientQuery }) => Promise<unknown>) => cb({ query: clientQuery })),
}));

vi.mock('../repos/recommendation-deliveries.repo.js', () => ({
  stageRecommendationDeliveries,
  evaluateRecommendationDeliveryConditions,
}));

import { query } from '../db/pool.js';
import {
  bulkCreateRecommendations,
  createRecommendation,
  deleteRecommendation,
  deleteRecommendations,
  getAllRecommendations,
  getRecommendationsByMatchId,
  getDashboardSummary,
  getStats,
  markRecommendationNotified,
  settleRecommendation,
} from '../repos/recommendations.repo.js';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('recommendations repository prompt versioning', () => {
  test('createRecommendation inserts prompt_version', async () => {
    clientQuery.mockResolvedValueOnce({
      rows: [{ id: 1, prompt_version: 'v4-evidence-hardened' }],
    } as never);

    await createRecommendation({
      match_id: '100',
      selection: 'Over 2.5 Goals @1.85',
      bet_market: 'over_2.5',
      prompt_version: 'v4-evidence-hardened',
    });

    expect(clientQuery).toHaveBeenCalledWith(
      expect.stringContaining('prompt_version'),
      expect.arrayContaining(['v4-evidence-hardened']),
    );
    expect(stageRecommendationDeliveries).toHaveBeenCalledWith(
      { query: clientQuery },
      expect.objectContaining({ id: 1 }),
    );
    expect(evaluateRecommendationDeliveryConditions).toHaveBeenCalledWith(
      { query: clientQuery },
      expect.objectContaining({ id: 1 }),
    );
  });

  test('bulkCreateRecommendations inserts prompt_version', async () => {
    clientQuery.mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 1, prompt_version: 'v4-evidence-hardened' }] } as never);

    await bulkCreateRecommendations([
      {
        match_id: '100',
        selection: 'Over 2.5 Goals @1.85',
        bet_market: 'over_2.5',
        prompt_version: 'v4-evidence-hardened',
      },
    ]);

    expect(clientQuery).toHaveBeenCalledWith(
      expect.stringContaining('prompt_version'),
      expect.arrayContaining(['v4-evidence-hardened']),
    );
    expect(stageRecommendationDeliveries).toHaveBeenCalledWith(
      { query: clientQuery },
      expect.objectContaining({ id: 1 }),
    );
    expect(evaluateRecommendationDeliveryConditions).toHaveBeenCalledWith(
      { query: clientQuery },
      expect.objectContaining({ id: 1 }),
    );
  });

  test('pending filter excludes half outcomes and void rows from unresolved bucket', async () => {
    vi.mocked(query)
      .mockResolvedValueOnce({ rows: [] } as never)
      .mockResolvedValueOnce({ rows: [{ count: '0' }] } as never);

    await getAllRecommendations({ result: 'pending' });

    expect(query).toHaveBeenCalledWith(
      expect.stringContaining("NOT IN ('win','loss','push','half_win','half_loss','void')"),
      expect.any(Array),
    );
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining("bet_type IS DISTINCT FROM 'NO_BET'"),
      expect.any(Array),
    );
  });

  test('review filter targets unresolved settlement rows instead of result pending rows', async () => {
    vi.mocked(query)
      .mockResolvedValueOnce({ rows: [] } as never)
      .mockResolvedValueOnce({ rows: [{ count: '0' }] } as never);

    await getAllRecommendations({ result: 'review' });

    expect(query).toHaveBeenCalledWith(
      expect.stringContaining("COALESCE(r.settlement_status, 'pending') = 'unresolved' AND r.result IN ('win','loss','push','half_win','half_loss','void')"),
      expect.any(Array),
    );
  });

  test('correct filter groups win and half_win together for dashboard parity', async () => {
    vi.mocked(query)
      .mockResolvedValueOnce({ rows: [] } as never)
      .mockResolvedValueOnce({ rows: [{ count: '0' }] } as never);

    await getAllRecommendations({ result: 'correct' });

    expect(query).toHaveBeenCalledWith(
      expect.stringContaining("r.result IN ('win', 'half_win')"),
      expect.any(Array),
    );
  });

  test('incorrect filter groups loss and half_loss together for dashboard parity', async () => {
    vi.mocked(query)
      .mockResolvedValueOnce({ rows: [] } as never)
      .mockResolvedValueOnce({ rows: [{ count: '0' }] } as never);

    await getAllRecommendations({ result: 'incorrect' });

    expect(query).toHaveBeenCalledWith(
      expect.stringContaining("r.result IN ('loss', 'half_loss')"),
      expect.any(Array),
    );
  });

  test('allows explicit NO_BET filter without injecting default actionable exclusion', async () => {
    vi.mocked(query)
      .mockResolvedValueOnce({ rows: [] } as never)
      .mockResolvedValueOnce({ rows: [{ count: '0' }] } as never);

    await getAllRecommendations({ bet_type: 'NO_BET' });

    const sql = vi.mocked(query).mock.calls[0]![0] as string;
    expect(sql).toContain('r.bet_type = $1');
    expect(sql).not.toContain("r.bet_type IS DISTINCT FROM 'NO_BET'");
  });

  test('getRecommendationsByMatchId excludes NO_BET rows from previous recommendation context', async () => {
    vi.mocked(query).mockResolvedValueOnce({ rows: [] } as never);

    await getRecommendationsByMatchId('100');

    expect(query).toHaveBeenCalledWith(
      expect.stringContaining("bet_type IS DISTINCT FROM 'NO_BET'"),
      ['100'],
    );
  });

  test('getStats excludes NO_BET rows from aggregate statistics', async () => {
    vi.mocked(query).mockResolvedValueOnce({
      rows: [{ total: '10', wins: '5', losses: '3', pushes: '1', half_wins: '1', half_losses: '0', voids: '0', duplicates: '2', unsettled: '2', total_pnl: '5.5' }],
    } as never);

    const stats = await getStats();

    expect(query).toHaveBeenCalledWith(
      expect.stringContaining("bet_type IS DISTINCT FROM 'NO_BET'"),
    );
    expect(stats.total).toBe(10);
    expect(stats.push_void_settled).toBe(1);
    expect(stats.win_rate).toBe(62.5);
  });

  test('getDashboardSummary surfaces directional and push/void settled counts for dashboard display', async () => {
    vi.mocked(query)
      .mockResolvedValueOnce({
        rows: [{
          total: '14',
          wins: '7',
          losses: '5',
          pushes: '2',
          half_wins: '1',
          half_losses: '1',
          voids: '0',
          pending: '3',
          total_pnl: '9.4',
          total_staked: '40',
        }],
      } as never)
      .mockResolvedValueOnce({ rows: [{ date: '22/03', daily_pnl: '9.4' }] } as never)
      .mockResolvedValueOnce({ rows: [] } as never)
      .mockResolvedValueOnce({ rows: [{ result: 'win' }, { result: 'win' }, { result: 'loss' }] } as never)
      .mockResolvedValueOnce({ rows: [{ match_count: '5', watchlist_count: '2', rec_count: '17' }] } as never)
      .mockResolvedValueOnce({
        rows: [
          {
            match_id: 'm1',
            home_team: 'Atletico San Luis',
            away_team: 'Leon',
            minute: 82,
            score: '1-1',
            selection: 'Over 2.5 Goals @2.67',
            bet_market: 'over_2.5',
            stake_percent: 4,
            result: '',
            pnl: 0,
            odds: 2.67,
            confidence: 6,
          },
          {
            match_id: 'm1',
            home_team: 'Atletico San Luis',
            away_team: 'Leon',
            minute: 68,
            score: '1-1',
            selection: 'Over 2.75 Goals @1.92',
            bet_market: 'over_2.75',
            stake_percent: 5,
            result: '',
            pnl: 0,
            odds: 1.92,
            confidence: 7,
          },
        ],
      } as never);

    const summary = await getDashboardSummary();

    expect(summary.totalBets).toBe(14);
    expect(summary.directionalSettled).toBe(12);
    expect(summary.pushVoidSettled).toBe(2);
    expect(summary.halfWins).toBe(1);
    expect(summary.halfLosses).toBe(1);
    expect(summary.winRate).toBeCloseTo(58.33, 2);
    expect(summary.roi).toBe(23.5);
    expect(summary.openExposureConcentration.stackedClusters).toBe(1);
    expect(summary.openExposureConcentration.stackedStake).toBe(9);
  });

  test('settleRecommendation persists settlement provenance', async () => {
    vi.mocked(query).mockResolvedValueOnce({
      rows: [{ id: 1, settlement_status: 'corrected', settlement_method: 'rules' }],
    } as never);

    await settleRecommendation(1, 'half_win', 0.4, 'Split line settled', {
      status: 'corrected',
      method: 'rules',
      note: 'Split line settled',
    });

    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('settlement_status'),
      expect.arrayContaining(['corrected', 'rules', 'Split line settled']),
    );
  });

  test('deleteRecommendation removes linked rows before deleting the recommendation', async () => {
    clientQuery
      .mockResolvedValueOnce({ rows: [{ id: 11 }] } as never)
      .mockResolvedValueOnce({ rowCount: 1 } as never)
      .mockResolvedValueOnce({ rowCount: 2 } as never)
      .mockResolvedValueOnce({ rowCount: 1 } as never)
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 11 }] } as never);

    const result = await deleteRecommendation(11);

    expect(clientQuery).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining('SELECT id'),
      [[11]],
    );
    expect(clientQuery).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('DELETE FROM ai_performance'),
      [[11]],
    );
    expect(clientQuery).toHaveBeenNthCalledWith(
      3,
      expect.stringContaining('DELETE FROM user_recommendation_deliveries'),
      [[11]],
    );
    expect(clientQuery).toHaveBeenNthCalledWith(
      4,
      expect.stringContaining('DELETE FROM bets'),
      [[11]],
    );
    expect(clientQuery).toHaveBeenNthCalledWith(
      5,
      expect.stringContaining('DELETE FROM recommendations'),
      [[11]],
    );
    expect(result).toEqual({
      deletedRecommendationIds: [11],
      recommendationsDeleted: 1,
      aiPerformanceDeleted: 1,
      deliveriesDeleted: 2,
      betsDeleted: 1,
    });
  });

  test('deleteRecommendations short-circuits when ids are empty', async () => {
    const result = await deleteRecommendations([]);

    expect(clientQuery).not.toHaveBeenCalled();
    expect(result).toEqual({
      deletedRecommendationIds: [],
      recommendationsDeleted: 0,
      aiPerformanceDeleted: 0,
      deliveriesDeleted: 0,
      betsDeleted: 0,
    });
  });

  test('markRecommendationNotified persists telegram notification metadata', async () => {
    vi.mocked(query).mockResolvedValueOnce({
      rows: [{ id: 1, notified: 'yes', notification_channels: 'telegram' }],
    } as never);

    await markRecommendationNotified(1, 'telegram');

    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('notification_channels'),
      [1, 'yes', 'telegram'],
    );
  });
});
