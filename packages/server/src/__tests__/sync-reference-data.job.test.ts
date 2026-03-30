import { beforeEach, describe, expect, test, vi } from 'vitest';

const mockGetTopLeagues = vi.fn();
const mockGetActiveLeagues = vi.fn();
const mockRefreshLeagueCatalog = vi.fn();
const mockRefreshLeagueTeamsDirectoryNow = vi.fn();
const mockReportJobProgress = vi.fn();

vi.mock('../repos/leagues.repo.js', () => ({
  getTopLeagues: mockGetTopLeagues,
  getActiveLeagues: mockGetActiveLeagues,
}));

vi.mock('../lib/league-catalog.service.js', () => ({
  refreshLeagueCatalog: mockRefreshLeagueCatalog,
}));

vi.mock('../lib/league-team-directory.service.js', () => ({
  refreshLeagueTeamsDirectoryNow: mockRefreshLeagueTeamsDirectoryNow,
}));

vi.mock('../jobs/job-progress.js', () => ({
  reportJobProgress: mockReportJobProgress,
}));

const { syncReferenceDataJob } = await import('../jobs/sync-reference-data.job.js');

beforeEach(() => {
  vi.clearAllMocks();
  mockGetTopLeagues.mockResolvedValue([{ league_id: 39 }]);
  mockGetActiveLeagues.mockResolvedValue([{ league_id: 39 }, { league_id: 140 }]);
  mockRefreshLeagueCatalog.mockResolvedValue({
    candidateLeagues: 2,
    attemptedLeagues: 1,
    refreshedLeagues: 1,
    skippedFreshLeagues: 1,
    failedLeagues: 0,
  });
});

describe('syncReferenceDataJob', () => {
  test('tracks fresh cache, refreshed, stale fallback, and empty provider outcomes separately', async () => {
    mockRefreshLeagueTeamsDirectoryNow
      .mockResolvedValueOnce({ rows: [], source: 'provider_refreshed' })
      .mockResolvedValueOnce({ rows: [], source: 'stale_fallback' });

    const result = await syncReferenceDataJob();

    expect(result.leagueTeamDirectory).toEqual({
      candidateLeagues: 2,
      refreshedLeagues: 1,
      skippedFreshLeagues: 0,
      staleFallbackLeagues: 1,
      emptyLeagues: 0,
      failedLeagues: 0,
      topLeagueCount: 1,
      activeLeagueCount: 2,
    });
    expect(mockRefreshLeagueTeamsDirectoryNow).toHaveBeenCalledTimes(2);
  });

  test('returns empty counts when no leagues are active', async () => {
    mockGetTopLeagues.mockResolvedValueOnce([]);
    mockGetActiveLeagues.mockResolvedValueOnce([]);

    const result = await syncReferenceDataJob();

    expect(result.leagueTeamDirectory).toEqual({
      candidateLeagues: 0,
      refreshedLeagues: 0,
      skippedFreshLeagues: 0,
      staleFallbackLeagues: 0,
      emptyLeagues: 0,
      failedLeagues: 0,
      topLeagueCount: 0,
      activeLeagueCount: 0,
    });
  });
});
