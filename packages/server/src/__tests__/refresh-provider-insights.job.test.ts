import { beforeEach, describe, expect, test, vi } from 'vitest';

const mockReportJobProgress = vi.fn();
const mockGetMatchesByStatus = vi.fn();
const mockGetActiveOperationalWatchlist = vi.fn();
const mockEnsureFixturesForMatchIds = vi.fn();
const mockEnsureScoutInsight = vi.fn();

vi.mock('../jobs/job-progress.js', () => ({
  reportJobProgress: mockReportJobProgress,
}));

vi.mock('../repos/matches.repo.js', () => ({
  getMatchesByStatus: mockGetMatchesByStatus,
}));

vi.mock('../repos/watchlist.repo.js', () => ({
  getActiveOperationalWatchlist: mockGetActiveOperationalWatchlist,
}));

vi.mock('../lib/provider-insight-cache.js', () => ({
  ensureFixturesForMatchIds: mockEnsureFixturesForMatchIds,
  ensureScoutInsight: mockEnsureScoutInsight,
}));

vi.mock('../config.js', () => ({
  config: {
    jobRefreshProviderInsightsMs: 60_000,
    refreshProviderInsightsApiBudget: 30,
  },
}));

const mockSkipIfFootballApiCircuitOpen = vi.fn().mockResolvedValue(null);
const mockGetFootballApiDailyCount = vi.fn().mockResolvedValue(0);

vi.mock('../lib/football-api-circuit.js', () => ({
  skipIfFootballApiCircuitOpen: (...args: unknown[]) => mockSkipIfFootballApiCircuitOpen(...args),
}));

vi.mock('../lib/football-api-quota.js', () => ({
  getFootballApiDailyCount: (...args: unknown[]) => mockGetFootballApiDailyCount(...args),
}));

const { refreshProviderInsightsJob } = await import('../jobs/refresh-provider-insights.job.js');

beforeEach(() => {
  vi.clearAllMocks();
  mockSkipIfFootballApiCircuitOpen.mockResolvedValue(null);
  mockGetFootballApiDailyCount.mockResolvedValue(0);
  mockGetMatchesByStatus.mockResolvedValue([]);
  mockGetActiveOperationalWatchlist.mockResolvedValue([]);
  mockEnsureFixturesForMatchIds.mockResolvedValue([]);
  mockEnsureScoutInsight.mockResolvedValue({
    fixture: { cacheStatus: 'hit' },
    statistics: { cacheStatus: 'hit' },
    events: { cacheStatus: 'hit' },
    lineups: { cacheStatus: 'hit' },
    standings: { cacheStatus: 'hit' },
  });
});

describe('refreshProviderInsightsJob', () => {
  test('skips background live fixtures and only prewarms non-live watchlist candidates', async () => {
    mockGetMatchesByStatus.mockResolvedValue([
      { match_id: '100' },
      { match_id: '200' },
    ]);
    mockGetActiveOperationalWatchlist.mockResolvedValue([
      { match_id: '100' },
      { match_id: '300' },
      { match_id: '300' },
    ]);
    mockEnsureFixturesForMatchIds.mockResolvedValue([
      {
        fixture: { id: 300, status: { short: 'NS', elapsed: null } },
        league: { id: 39, season: 2025 },
      },
    ]);
    mockEnsureScoutInsight.mockResolvedValue({
      fixture: { cacheStatus: 'refreshed' },
      statistics: { cacheStatus: 'refreshed' },
      events: { cacheStatus: 'refreshed' },
      lineups: { cacheStatus: 'refreshed' },
      standings: { cacheStatus: 'refreshed' },
    });

    const result = await refreshProviderInsightsJob();

    expect(result).toEqual({
      candidates: 1,
      skippedLiveCandidates: 2,
      fixturesAvailable: 1,
      fixtureRefreshed: 1,
      eventRefreshed: 1,
      statisticsRefreshed: 1,
      lineupsRefreshed: 1,
      standingsRefreshed: 1,
      apiCallsUsed: 0,
    });
    expect(mockEnsureFixturesForMatchIds).toHaveBeenCalledWith(['300'], { freshnessMode: 'prewarm_only' });
    expect(mockEnsureScoutInsight).toHaveBeenCalledWith('300', expect.objectContaining({
      status: 'NS',
      leagueId: 39,
      season: 2025,
      consumer: 'provider-insight-refresh-job',
      freshnessMode: 'prewarm_only',
    }));
  });

  test('skips when Football API daily limit circuit is open', async () => {
    mockSkipIfFootballApiCircuitOpen.mockResolvedValueOnce({
      skipped: true,
      skipReason: 'football_api_daily_limit',
      openUntil: '2026-05-24T00:00:00.000Z',
    });

    const result = await refreshProviderInsightsJob();

    expect(result).toEqual({
      candidates: 0,
      skippedLiveCandidates: 0,
      fixturesAvailable: 0,
      fixtureRefreshed: 0,
      eventRefreshed: 0,
      statisticsRefreshed: 0,
      lineupsRefreshed: 0,
      standingsRefreshed: 0,
      skipped: true,
      skipReason: 'football_api_daily_limit',
      openUntil: '2026-05-24T00:00:00.000Z',
    });
    expect(mockGetMatchesByStatus).not.toHaveBeenCalled();
    expect(mockEnsureFixturesForMatchIds).not.toHaveBeenCalled();
  });

  test('returns early when all current candidates are live', async () => {
    mockGetMatchesByStatus.mockResolvedValue([{ match_id: '100' }]);
    mockGetActiveOperationalWatchlist.mockResolvedValue([{ match_id: '100' }]);

    const result = await refreshProviderInsightsJob();

    expect(result).toEqual({
      candidates: 0,
      skippedLiveCandidates: 1,
      fixturesAvailable: 0,
      fixtureRefreshed: 0,
      eventRefreshed: 0,
      statisticsRefreshed: 0,
      lineupsRefreshed: 0,
      standingsRefreshed: 0,
    });
    expect(mockEnsureFixturesForMatchIds).not.toHaveBeenCalled();
    expect(mockEnsureScoutInsight).not.toHaveBeenCalled();
  });

  test('caps candidates by estimated request budget and reports budgetCapped', async () => {
    const ids = Array.from({ length: 50 }, (_, i) => ({ match_id: String(400 + i) }));
    mockGetMatchesByStatus.mockResolvedValue([]);
    mockGetActiveOperationalWatchlist.mockResolvedValue(ids);
    mockEnsureFixturesForMatchIds.mockResolvedValue(
      ids.slice(0, 15).map((entry) => ({
        fixture: { id: Number(entry.match_id), status: { short: 'NS', elapsed: null } },
        league: { id: 39, season: 2025 },
      })),
    );
    mockEnsureScoutInsight.mockResolvedValue({
      fixture: { cacheStatus: 'hit' },
      statistics: { cacheStatus: 'hit' },
      events: { cacheStatus: 'hit' },
      lineups: { cacheStatus: 'hit' },
      standings: { cacheStatus: 'hit' },
    });

    const result = await refreshProviderInsightsJob();

    expect(result.candidates).toBe(50);
    expect(result.budgetCapped).toBe(true);
    expect(result.budgetLimit).toBe(30);
    expect(mockEnsureFixturesForMatchIds).toHaveBeenCalledWith(
      expect.arrayContaining([String(ids[0]!.match_id)]),
      { freshnessMode: 'prewarm_only' },
    );
    const calledIds = mockEnsureFixturesForMatchIds.mock.calls[0][0] as string[];
    expect(calledIds.length).toBe(15);
  });
});
