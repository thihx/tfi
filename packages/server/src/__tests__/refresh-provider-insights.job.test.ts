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
  },
}));

const { refreshProviderInsightsJob } = await import('../jobs/refresh-provider-insights.job.js');

beforeEach(() => {
  vi.clearAllMocks();
  mockGetMatchesByStatus.mockResolvedValue([]);
  mockGetActiveOperationalWatchlist.mockResolvedValue([]);
  mockEnsureFixturesForMatchIds.mockResolvedValue([]);
  mockEnsureScoutInsight.mockResolvedValue({
    fixture: { cacheStatus: 'hit' },
    statistics: { cacheStatus: 'hit' },
    events: { cacheStatus: 'hit' },
    lineups: { cacheStatus: 'hit' },
    prediction: { cacheStatus: 'hit' },
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
      prediction: { cacheStatus: 'refreshed' },
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
      predictionsRefreshed: 1,
      standingsRefreshed: 1,
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
      predictionsRefreshed: 0,
      standingsRefreshed: 0,
    });
    expect(mockEnsureFixturesForMatchIds).not.toHaveBeenCalled();
    expect(mockEnsureScoutInsight).not.toHaveBeenCalled();
  });
});
