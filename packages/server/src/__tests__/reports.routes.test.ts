// ============================================================
// Integration tests — Reports routes
// ============================================================

import { describe, test, expect, vi, beforeAll, afterAll } from 'vitest';
import { buildApp } from './helpers.js';
import type { FastifyInstance } from 'fastify';

const mockOverview = { total: 100, wins: 60, losses: 30, winRate: 60, totalPnl: 25.5 };
const mockLeagueRows = [{ league: 'Premier League', total: 50, wins: 30, pnl: 12 }];
const mockMarketRows = [{ market: 'ou2.5', total: 40, wins: 25, pnl: 10 }];
const mockWeekly = [{ period: '2026-W10', total: 10, wins: 6, pnl: 3 }];
const mockMonthly = [{ period: '2026-03', total: 30, wins: 18, pnl: 8 }];
const mockConfidence = [{ band: '70-80', total: 20, wins: 14, pnl: 5 }];
const mockOddsRange = [{ range: '1.5-2.0', total: 15, wins: 10, pnl: 4 }];
const mockMinute = [{ band: '45-60', total: 12, wins: 8, pnl: 3 }];
const mockDailyPnl = [{ date: '2026-03-15', pnl: 2.5 }];
const mockDayOfWeek = [{ dayOfWeek: 6, dayName: 'Saturday', total: 20, pnl: 8 }];
const mockLeagueMarket = [{ league: 'PL', market: 'ou2.5', total: 10, wins: 7, pnl: 3 }];
const mockAiInsights = { recentTrend: 'improving', recentWinRate: 65, overallWinRate: 60 };

vi.mock('../repos/reports.repo.js', () => ({
  getOverviewReport: vi.fn().mockResolvedValue(mockOverview),
  getLeagueReport: vi.fn().mockResolvedValue(mockLeagueRows),
  getMarketReport: vi.fn().mockResolvedValue(mockMarketRows),
  getWeeklyReport: vi.fn().mockResolvedValue(mockWeekly),
  getMonthlyReport: vi.fn().mockResolvedValue(mockMonthly),
  getConfidenceReport: vi.fn().mockResolvedValue(mockConfidence),
  getOddsRangeReport: vi.fn().mockResolvedValue(mockOddsRange),
  getMinuteReport: vi.fn().mockResolvedValue(mockMinute),
  getDailyPnlReport: vi.fn().mockResolvedValue(mockDailyPnl),
  getDayOfWeekReport: vi.fn().mockResolvedValue(mockDayOfWeek),
  getLeagueMarketReport: vi.fn().mockResolvedValue(mockLeagueMarket),
  getAiInsights: vi.fn().mockResolvedValue(mockAiInsights),
}));

let app: FastifyInstance;

beforeAll(async () => {
  const { reportRoutes } = await import('../routes/reports.routes.js');
  app = await buildApp(reportRoutes);
});

afterAll(async () => {
  await app.close();
});

// ── Test all 12 report endpoints ──

const cases: Array<{ path: string; key: string; expected: unknown }> = [
  { path: '/api/reports/overview', key: 'total', expected: 100 },
  { path: '/api/reports/by-league', key: '[0].league', expected: 'Premier League' },
  { path: '/api/reports/by-market', key: '[0].market', expected: 'ou2.5' },
  { path: '/api/reports/weekly', key: '[0].period', expected: '2026-W10' },
  { path: '/api/reports/monthly', key: '[0].period', expected: '2026-03' },
  { path: '/api/reports/confidence', key: '[0].band', expected: '70-80' },
  { path: '/api/reports/odds-range', key: '[0].range', expected: '1.5-2.0' },
  { path: '/api/reports/by-minute', key: '[0].band', expected: '45-60' },
  { path: '/api/reports/daily-pnl', key: '[0].date', expected: '2026-03-15' },
  { path: '/api/reports/day-of-week', key: '[0].dayName', expected: 'Saturday' },
  { path: '/api/reports/league-market', key: '[0].league', expected: 'PL' },
  { path: '/api/reports/ai-insights', key: 'recentTrend', expected: 'improving' },
];

function getNestedValue(obj: unknown, path: string): unknown {
  return path.split('.').reduce((acc: unknown, key) => {
    if (key.startsWith('[') && key.endsWith(']')) {
      const idx = Number(key.slice(1, -1));
      return (acc as unknown[])[idx];
    }
    return (acc as Record<string, unknown>)[key];
  }, obj);
}

describe('Reports endpoints', () => {
  for (const { path, key, expected } of cases) {
    test(`GET ${path} returns data`, async () => {
      const res = await app.inject({ method: 'GET', url: path });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(getNestedValue(body, key)).toBe(expected);
    });
  }

  test('passes period filter via query string', async () => {
    const { getOverviewReport } = await import('../repos/reports.repo.js');
    await app.inject({
      method: 'GET',
      url: '/api/reports/overview?period=7d&dateFrom=2026-03-10&dateTo=2026-03-17',
    });
    expect(getOverviewReport).toHaveBeenCalledWith({
      period: '7d',
      dateFrom: '2026-03-10',
      dateTo: '2026-03-17',
    });
  });

  test('handles empty filter params', async () => {
    const { getOverviewReport } = await import('../repos/reports.repo.js');
    await app.inject({ method: 'GET', url: '/api/reports/overview' });
    expect(getOverviewReport).toHaveBeenCalledWith({
      period: undefined,
      dateFrom: undefined,
      dateTo: undefined,
    });
  });
});
