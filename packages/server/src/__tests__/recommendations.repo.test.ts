import { beforeEach, describe, expect, test, vi } from 'vitest';

const { clientQuery } = vi.hoisted(() => ({
  clientQuery: vi.fn(),
}));

vi.mock('../db/pool.js', () => ({
  query: vi.fn(),
  transaction: vi.fn(async (cb: (client: { query: typeof clientQuery }) => Promise<unknown>) => cb({ query: clientQuery })),
}));

import { query } from '../db/pool.js';
import {
  bulkCreateRecommendations,
  createRecommendation,
  getAllRecommendations,
  getRecommendationsByMatchId,
  getStats,
  markRecommendationNotified,
  settleRecommendation,
} from '../repos/recommendations.repo.js';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('recommendations repository prompt versioning', () => {
  test('createRecommendation inserts prompt_version', async () => {
    vi.mocked(query).mockResolvedValueOnce({
      rows: [{ id: 1, prompt_version: 'v4-evidence-hardened' }],
    } as never);

    await createRecommendation({
      match_id: '100',
      selection: 'Over 2.5 Goals @1.85',
      bet_market: 'over_2.5',
      prompt_version: 'v4-evidence-hardened',
    });

    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('prompt_version'),
      expect.arrayContaining(['v4-evidence-hardened']),
    );
  });

  test('bulkCreateRecommendations inserts prompt_version', async () => {
    clientQuery.mockResolvedValueOnce({ rowCount: 1 } as never);

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
      rows: [{ total: '10', wins: '4', losses: '3', pushes: '1', duplicates: '2', unsettled: '2', total_pnl: '5.5' }],
    } as never);

    const stats = await getStats();

    expect(query).toHaveBeenCalledWith(
      expect.stringContaining("bet_type IS DISTINCT FROM 'NO_BET'"),
    );
    expect(stats.total).toBe(10);
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
