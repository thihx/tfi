import { beforeEach, describe, expect, test, vi } from 'vitest';

vi.mock('../db/pool.js', () => ({
  query: vi.fn(),
}));

import { query } from '../db/pool.js';
import { getAiInsights, getOverviewReport } from '../repos/reports.repo.js';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('reports repository', () => {
  test('getOverviewReport exposes decisive and neutral settled counts', async () => {
    vi.mocked(query)
      .mockResolvedValueOnce({
        rows: [{
          total: '20',
          settled: '14',
          wins: '6',
          losses: '4',
          pushes: '2',
          half_wins: '1',
          half_losses: '1',
          voids: '0',
          pending: '6',
          total_pnl: '8.5',
          avg_odds: '1.92',
          avg_confidence: '6.6',
          total_staked: '40',
      }],
      } as never)
      .mockResolvedValueOnce({
        rows: [{ date: '2026-03-22', daily_pnl: '8.5' }],
      } as never)
      .mockResolvedValueOnce({
        rows: [
          {
            match_id: 'm1',
            home_team: 'Atlas',
            away_team: 'Club Queretaro',
            minute: 73,
            score: '1-1',
            selection: 'Under 2.5 Goals @1.90',
            bet_market: 'under_2.5',
            stake_percent: 4,
            result: 'win',
            pnl: 3.6,
            odds: 1.9,
            confidence: 6,
          },
          {
            match_id: 'm1',
            home_team: 'Atlas',
            away_team: 'Club Queretaro',
            minute: 81,
            score: '1-1',
            selection: 'Under 2 Goals @2.00',
            bet_market: 'under_2',
            stake_percent: 5,
            result: 'loss',
            pnl: -5,
            odds: 2,
            confidence: 6,
          },
        ],
      } as never);

    const report = await getOverviewReport({ period: 'today' });

    expect(report).toMatchObject({
      total: 20,
      settled: 14,
      decisiveSettled: 10,
      neutralSettled: 4,
      wins: 6,
      losses: 4,
      pushes: 2,
      halfWins: 1,
      halfLosses: 1,
      voids: 0,
      pending: 6,
      winRate: 60,
      totalPnl: 8.5,
      roi: 21.25,
    });
    expect(report.exposureConcentration.stackedClusters).toBe(1);
    expect(report.exposureConcentration.stackedStake).toBe(9);
  });

  test('getAiInsights applies period filter to trend and streak queries and advertises sample floor', async () => {
    vi.mocked(query)
      .mockResolvedValueOnce({ rows: [{ league: 'K League 1', wins: '4', total: '5', pnl: '3.5' }] } as never)
      .mockResolvedValueOnce({ rows: [{ market: 'over_2.5', wins: '4', total: '5', pnl: '4.1' }] } as never)
      .mockResolvedValueOnce({ rows: [{ band: '45-59 (Start 2H)', wins: '3', total: '5', pnl: '2.2' }] } as never)
      .mockResolvedValueOnce({ rows: [{ band: 'High (8-10)', avg_conf: '8.2', wins: '2', total: '5' }] } as never)
      .mockResolvedValueOnce({ rows: [{ recent_wr: '55.0' }] } as never)
      .mockResolvedValueOnce({ rows: [{ overall_wr: '50.0' }] } as never)
      .mockResolvedValueOnce({ rows: [{ result: 'win' }, { result: 'win' }, { result: 'loss' }] } as never)
      .mockResolvedValueOnce({ rows: [{ wins: '3', total: '5' }] } as never)
      .mockResolvedValueOnce({ rows: [{ wins: '2', total: '4' }] } as never)
      .mockResolvedValueOnce({
        rows: [
          {
            match_id: 'm1',
            home_team: 'A',
            away_team: 'B',
            minute: 82,
            score: '1-1',
            selection: 'Over 2.5 Goals @2.10',
            bet_market: 'over_2.5',
            stake_percent: 4,
            result: 'win',
            pnl: 4.4,
            odds: 2.1,
            confidence: 7,
          },
          {
            match_id: 'm2',
            home_team: 'C',
            away_team: 'D',
            minute: 58,
            score: '0-0',
            selection: 'Corners Under 9.5 @1.88',
            bet_market: 'corners_under_9.5',
            stake_percent: 3,
            result: 'loss',
            pnl: -3,
            odds: 1.88,
            confidence: 5,
          },
        ],
      } as never);

    const result = await getAiInsights({ period: 'today' });

    expect(result.sampleFloor).toBe(5);
    expect(result.recentTrend).toBe('stable');
    expect(result.marketFamilies).toHaveLength(2);
    expect(result.lateEntries.find((row) => row.bucket === '75+')?.roi).toBeGreaterThan(0);
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining("CURRENT_DATE"),
      [],
    );
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('HAVING COUNT(*) >= 5'),
      [],
    );
  });
});
