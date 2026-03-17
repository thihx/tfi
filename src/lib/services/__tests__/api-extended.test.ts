// ============================================================
// Tests — Frontend API Service (matches, watchlist, recommendations,
//         leagues, reports)
// ============================================================

import { describe, test, expect, vi, beforeEach } from 'vitest';
import {
  fetchMatches,
  fetchWatchlist,
  fetchRecommendations,
  fetchRecommendationsByMatch,
  fetchRecommendationsPaginated,
  fetchDashboardSummary,
  fetchBetTypes,
  fetchDistinctLeagues,
  fetchApprovedLeagues,
  toggleLeagueActive,
  bulkSetLeagueActive,
  fetchLeaguesFromApi,
  toggleLeagueTopLeague,
  bulkSetTopLeague,
  createWatchlistItems,
  updateWatchlistItems,
  deleteWatchlistItems,
  fetchOverviewReport,
  fetchLeagueReport,
  fetchMarketReport,
  fetchWeeklyReport,
  fetchMonthlyReport,
  fetchConfidenceReport,
  fetchOddsRangeReport,
  fetchMinuteReport,
  fetchDailyPnlReport,
  fetchDayOfWeekReport,
  fetchLeagueMarketReport,
  fetchAiInsights,
  ApiError,
} from '@/lib/services/api';

const config = { apiUrl: 'http://localhost:4000' } as Parameters<typeof fetchMatches>[0];

function mockFetch(body: unknown, status = 200) {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  });
}

beforeEach(() => {
  vi.restoreAllMocks();
});

// ── Matches ──

describe('matches API', () => {
  test('fetchMatches calls GET /api/matches', async () => {
    const data = [{ match_id: '1', home_team: 'Arsenal' }];
    globalThis.fetch = mockFetch(data);
    const result = await fetchMatches(config);
    expect(result).toEqual(data);
    expect(fetch).toHaveBeenCalledWith('http://localhost:4000/api/matches', expect.objectContaining({ method: 'GET' }));
  });
});

// ── Watchlist ──

describe('watchlist API', () => {
  test('fetchWatchlist calls GET /api/watchlist', async () => {
    globalThis.fetch = mockFetch([{ match_id: '100' }]);
    const result = await fetchWatchlist(config);
    expect(result).toHaveLength(1);
  });

  test('createWatchlistItems sends POST for each item', async () => {
    globalThis.fetch = mockFetch({ match_id: '200' });
    const result = await createWatchlistItems(config, [
      { match_id: '200' } as never,
      { match_id: '201' } as never,
    ]);
    expect(result.insertedCount).toBe(2);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  test('updateWatchlistItems sends PATCH for each item', async () => {
    globalThis.fetch = mockFetch({ match_id: '100', priority: 3 });
    const result = await updateWatchlistItems(config, [
      { match_id: '100', priority: 3 } as never,
    ]);
    expect(result.updatedCount).toBe(1);
    expect(fetch).toHaveBeenCalledWith(
      'http://localhost:4000/api/watchlist/100',
      expect.objectContaining({ method: 'PATCH' }),
    );
  });

  test('updateWatchlistItems skips items without match_id', async () => {
    globalThis.fetch = mockFetch({});
    const result = await updateWatchlistItems(config, [
      { priority: 3 } as never, // no match_id
    ]);
    expect(result.updatedCount).toBe(0);
    expect(fetch).not.toHaveBeenCalled();
  });

  test('deleteWatchlistItems sends DELETE for each ID', async () => {
    globalThis.fetch = mockFetch({ deleted: true });
    const result = await deleteWatchlistItems(config, ['100', '200']);
    expect(result.deletedCount).toBe(2);
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});

// ── Recommendations ──

describe('recommendations API', () => {
  test('fetchRecommendations returns first page rows', async () => {
    globalThis.fetch = mockFetch({ rows: [{ id: 1 }], total: 100 });
    const result = await fetchRecommendations(config);
    expect(result).toEqual([{ id: 1 }]);
    expect(fetch).toHaveBeenCalledWith(
      'http://localhost:4000/api/recommendations?limit=30',
      expect.anything(),
    );
  });

  test('fetchRecommendationsByMatch URL-encodes matchId', async () => {
    globalThis.fetch = mockFetch([]);
    await fetchRecommendationsByMatch(config, '12345');
    expect(fetch).toHaveBeenCalledWith(
      'http://localhost:4000/api/recommendations/match/12345',
      expect.anything(),
    );
  });

  test('fetchRecommendationsPaginated builds query string from params', async () => {
    globalThis.fetch = mockFetch({ rows: [], total: 0 });
    await fetchRecommendationsPaginated(config, {
      limit: 20, offset: 40, result: 'win', bet_type: 'ou2.5',
      league: 'Premier League', search: 'Arsenal', risk_level: 'high',
      sort_by: 'confidence', sort_dir: 'desc',
    });
    const url = (fetch as ReturnType<typeof vi.fn>).mock.calls[0]![0] as string;
    expect(url).toContain('limit=20');
    expect(url).toContain('offset=40');
    expect(url).toContain('result=win');
    expect(url).toContain('bet_type=ou2.5');
    expect(url).toContain('search=Arsenal');
    expect(url).toContain('risk_level=high');
  });

  test('fetchRecommendationsPaginated skips "all" filter values', async () => {
    globalThis.fetch = mockFetch({ rows: [], total: 0 });
    await fetchRecommendationsPaginated(config, { result: 'all', bet_type: 'all', league: 'all', risk_level: 'all' });
    const url = (fetch as ReturnType<typeof vi.fn>).mock.calls[0]![0] as string;
    expect(url).not.toContain('result=');
    expect(url).not.toContain('bet_type=');
  });

  test('fetchDashboardSummary returns summary object', async () => {
    const summary = { totalBets: 10, wins: 6 };
    globalThis.fetch = mockFetch(summary);
    const result = await fetchDashboardSummary(config);
    expect(result.totalBets).toBe(10);
  });

  test('fetchBetTypes returns array', async () => {
    globalThis.fetch = mockFetch(['ou2.5', 'btts']);
    const result = await fetchBetTypes(config);
    expect(result).toContain('ou2.5');
  });

  test('fetchDistinctLeagues returns array', async () => {
    globalThis.fetch = mockFetch(['Premier League']);
    const result = await fetchDistinctLeagues(config);
    expect(result).toContain('Premier League');
  });
});

// ── Leagues ──

describe('leagues API', () => {
  test('fetchApprovedLeagues calls GET /api/leagues', async () => {
    globalThis.fetch = mockFetch([{ league_id: 39, name: 'PL' }]);
    const result = await fetchApprovedLeagues(config);
    expect(result[0].league_id).toBe(39);
  });

  test('toggleLeagueActive calls PUT with active flag', async () => {
    globalThis.fetch = mockFetch({ league_id: 39, active: true });
    await toggleLeagueActive(config, 39, true);
    expect(fetch).toHaveBeenCalledWith(
      'http://localhost:4000/api/leagues/39/active',
      expect.objectContaining({ method: 'PUT' }),
    );
  });

  test('bulkSetLeagueActive sends POST with ids and active', async () => {
    globalThis.fetch = mockFetch({ updated: 3 });
    const result = await bulkSetLeagueActive(config, [39, 140, 78], true);
    expect(result.updated).toBe(3);
  });

  test('fetchLeaguesFromApi triggers sync', async () => {
    globalThis.fetch = mockFetch({ fetched: 60, upserted: 10 });
    const result = await fetchLeaguesFromApi(config);
    expect(result.fetched).toBe(60);
  });

  test('toggleLeagueTopLeague sends PUT', async () => {
    globalThis.fetch = mockFetch({ league_id: 39, top_league: true });
    await toggleLeagueTopLeague(config, 39, true);
    expect(fetch).toHaveBeenCalledWith(
      'http://localhost:4000/api/leagues/39/top-league',
      expect.objectContaining({ method: 'PUT' }),
    );
  });

  test('bulkSetTopLeague sends POST', async () => {
    globalThis.fetch = mockFetch({ updated: 2 });
    const result = await bulkSetTopLeague(config, [39, 140], true);
    expect(result.updated).toBe(2);
  });
});

// ── Reports ──

describe('reports API', () => {
  const filter = { period: '7d' as const, dateFrom: '2026-03-10', dateTo: '2026-03-17' };

  const reportTests: Array<{
    fn: (c: typeof config, f: typeof filter) => Promise<unknown>;
    path: string;
  }> = [
    { fn: fetchOverviewReport, path: '/api/reports/overview' },
    { fn: fetchLeagueReport, path: '/api/reports/by-league' },
    { fn: fetchMarketReport, path: '/api/reports/by-market' },
    { fn: fetchWeeklyReport, path: '/api/reports/weekly' },
    { fn: fetchMonthlyReport, path: '/api/reports/monthly' },
    { fn: fetchConfidenceReport, path: '/api/reports/confidence' },
    { fn: fetchOddsRangeReport, path: '/api/reports/odds-range' },
    { fn: fetchMinuteReport, path: '/api/reports/by-minute' },
    { fn: fetchDailyPnlReport, path: '/api/reports/daily-pnl' },
    { fn: fetchDayOfWeekReport, path: '/api/reports/day-of-week' },
    { fn: fetchLeagueMarketReport, path: '/api/reports/league-market' },
    { fn: fetchAiInsights, path: '/api/reports/ai-insights' },
  ];

  for (const { fn, path } of reportTests) {
    test(`calls GET ${path} with period filter`, async () => {
      globalThis.fetch = mockFetch({});
      await fn(config, filter);
      const url = (fetch as ReturnType<typeof vi.fn>).mock.calls[0]![0] as string;
      expect(url).toContain(path);
      expect(url).toContain('period=7d');
      expect(url).toContain('dateFrom=2026-03-10');
    });
  }

  test('report with empty filter sends no query params', async () => {
    globalThis.fetch = mockFetch({});
    await fetchOverviewReport(config, {});
    const url = (fetch as ReturnType<typeof vi.fn>).mock.calls[0]![0] as string;
    expect(url).toBe('http://localhost:4000/api/reports/overview');
  });
});

// ── ApiError ──

describe('ApiError', () => {
  test('isUnauthorized for 401', () => {
    const err = new ApiError(401, 'Unauthorized');
    expect(err.isUnauthorized).toBe(true);
    expect(err.isNotFound).toBe(false);
    expect(err.isServerError).toBe(false);
  });

  test('isNotFound for 404', () => {
    const err = new ApiError(404, 'Not found');
    expect(err.isNotFound).toBe(true);
  });

  test('isServerError for 500+', () => {
    const err = new ApiError(500, 'Internal error');
    expect(err.isServerError).toBe(true);
  });

  test('formatApiError truncates long messages', async () => {
    const longText = 'x'.repeat(300);
    globalThis.fetch = mockFetch(longText, 500);
    await expect(fetchMatches(config)).rejects.toThrow('HTTP 500');
  });
});
