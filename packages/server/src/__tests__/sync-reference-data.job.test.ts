import { beforeEach, describe, expect, test, vi } from 'vitest';

const mockGetTopLeagues = vi.fn();
const mockGetActiveLeagues = vi.fn();
const mockGetReferenceDataLeagueActivity = vi.fn();
const mockRefreshLeagueCatalog = vi.fn();
const mockRefreshLeagueTeamsDirectoryNow = vi.fn();
const mockGetLeagueTeamDirectoryFreshness = vi.fn();
const mockSyncDerivedPrematchProfiles = vi.fn();
const mockReportJobProgress = vi.fn();
const mockSkipIfFootballApiCircuitOpen = vi.fn();

vi.mock('../repos/leagues.repo.js', () => ({
  getTopLeagues: mockGetTopLeagues,
  getActiveLeagues: mockGetActiveLeagues,
  getReferenceDataLeagueActivity: mockGetReferenceDataLeagueActivity,
}));

vi.mock('../lib/league-catalog.service.js', () => ({
  refreshLeagueCatalog: mockRefreshLeagueCatalog,
}));

vi.mock('../lib/league-team-directory.service.js', () => ({
  refreshLeagueTeamsDirectoryNow: mockRefreshLeagueTeamsDirectoryNow,
}));

vi.mock('../repos/team-directory.repo.js', () => ({
  getLeagueTeamDirectoryFreshness: mockGetLeagueTeamDirectoryFreshness,
}));

vi.mock('../lib/prematch-profile-sync.js', () => ({
  syncDerivedPrematchProfiles: mockSyncDerivedPrematchProfiles,
}));

vi.mock('../jobs/job-progress.js', () => ({
  reportJobProgress: mockReportJobProgress,
}));

vi.mock('../lib/football-api-circuit.js', () => ({
  skipIfFootballApiCircuitOpen: (...args: unknown[]) => mockSkipIfFootballApiCircuitOpen(...args),
}));

const { syncReferenceDataJob, __testables__ } = await import('../jobs/sync-reference-data.job.js');

beforeEach(() => {
  vi.clearAllMocks();
  mockSkipIfFootballApiCircuitOpen.mockResolvedValue(null);
  mockGetTopLeagues.mockResolvedValue([{
    league_id: 39,
    league_name: 'Premier League',
    country: 'England',
    type: 'League',
    top_league: true,
  }]);
  mockGetActiveLeagues.mockResolvedValue([
    {
      league_id: 39,
      league_name: 'Premier League',
      country: 'England',
      type: 'League',
      top_league: true,
    },
    {
      league_id: 140,
      league_name: 'La Liga',
      country: 'Spain',
      type: 'League',
      top_league: false,
    },
    {
      league_id: 2,
      league_name: 'UEFA Champions League',
      country: 'World',
      type: 'Cup',
      top_league: false,
    },
  ]);
  mockRefreshLeagueCatalog.mockResolvedValue({
    candidateLeagues: 2,
    attemptedLeagues: 1,
    refreshedLeagues: 1,
    skippedFreshLeagues: 1,
    failedLeagues: 0,
  });
  mockGetReferenceDataLeagueActivity.mockResolvedValue(new Map([
    [39, { league_id: 39, current_matches: 0, recent_history_matches: 0, favorite_team_count: 0 }],
    [140, { league_id: 140, current_matches: 0, recent_history_matches: 0, favorite_team_count: 0 }],
    [2, { league_id: 2, current_matches: 0, recent_history_matches: 8, favorite_team_count: 0 }],
  ]));
  mockGetLeagueTeamDirectoryFreshness.mockResolvedValue(new Map([
    [39, { league_id: 39, row_count: 20, oldest_expires_at: '2026-06-01T00:00:00Z', newest_fetched_at: '2026-06-01T00:00:00Z', is_fresh: false }],
    [2, { league_id: 2, row_count: 32, oldest_expires_at: '2026-06-01T00:00:00Z', newest_fetched_at: '2026-06-01T00:00:00Z', is_fresh: false }],
  ]));
  mockSyncDerivedPrematchProfiles.mockResolvedValue({
    lookbackDays: 180,
    candidateLeagues: 1,
    refreshedLeagueProfiles: 1,
    skippedLeagueProfiles: 1,
    candidateTeams: 6,
    refreshedTeamProfiles: 4,
    skippedTeamProfiles: 2,
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
      activeLeagueCount: 3,
      directoryScopeExcludedLeagues: 1,
      profileScopeExcludedLeagues: 1,
      excludedNoRecentSignal: 1,
      favoriteSignalLeagues: 0,
      currentMatchSignalLeagues: 0,
      recentHistorySignalLeagues: 1,
      directoryStaleCandidateLeagues: 2,
      directoryRefreshBudget: 2,
      directoryRefreshAttemptedLeagues: 2,
      directoryRefreshDeferredLeagues: 0,
    });
    expect(result.prematchProfiles).toEqual({
      lookbackDays: 180,
      candidateLeagues: 1,
      refreshedLeagueProfiles: 1,
      skippedLeagueProfiles: 1,
      candidateTeams: 6,
      refreshedTeamProfiles: 4,
      skippedTeamProfiles: 2,
      profileScopeCandidateLeagues: 2,
      profileScopeDeferredLeagues: 0,
      profileScopeBudget: 2,
    });
    expect(mockRefreshLeagueTeamsDirectoryNow).toHaveBeenCalledTimes(2);
    expect(mockRefreshLeagueTeamsDirectoryNow).toHaveBeenNthCalledWith(1, 39);
    expect(mockRefreshLeagueTeamsDirectoryNow).toHaveBeenNthCalledWith(2, 2);
    expect(mockSyncDerivedPrematchProfiles).toHaveBeenCalledWith([39, 2]);
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
      directoryScopeExcludedLeagues: 0,
      profileScopeExcludedLeagues: 0,
      excludedNoRecentSignal: 0,
      favoriteSignalLeagues: 0,
      currentMatchSignalLeagues: 0,
      recentHistorySignalLeagues: 0,
      directoryStaleCandidateLeagues: 0,
      directoryRefreshBudget: 0,
      directoryRefreshAttemptedLeagues: 0,
      directoryRefreshDeferredLeagues: 0,
    });
    expect(result.prematchProfiles).toEqual({
      lookbackDays: 180,
      candidateLeagues: 0,
      refreshedLeagueProfiles: 0,
      skippedLeagueProfiles: 0,
      candidateTeams: 0,
      refreshedTeamProfiles: 0,
      skippedTeamProfiles: 0,
      profileScopeCandidateLeagues: 0,
      profileScopeDeferredLeagues: 0,
      profileScopeBudget: 0,
    });
    expect(mockSyncDerivedPrematchProfiles).not.toHaveBeenCalled();
  });

  test('limits stale directory refreshes by priority budget', () => {
    const plan = __testables__.buildDirectoryRefreshPlan(
      [1, 2, 3, 4],
      new Set([4]),
      new Map([
        [2, { league_id: 2, current_matches: 1, recent_history_matches: 0, favorite_team_count: 0 }],
        [3, { league_id: 3, current_matches: 0, recent_history_matches: 8, favorite_team_count: 0 }],
        [4, { league_id: 4, current_matches: 0, recent_history_matches: 0, favorite_team_count: 0 }],
      ]),
      new Map([
        [1, { league_id: 1, row_count: 12, oldest_expires_at: '2026-06-05T00:00:00Z', newest_fetched_at: '2026-06-04T00:00:00Z', is_fresh: true }],
        [2, { league_id: 2, row_count: 12, oldest_expires_at: '2026-06-01T00:00:00Z', newest_fetched_at: '2026-06-01T00:00:00Z', is_fresh: false }],
        [3, { league_id: 3, row_count: 12, oldest_expires_at: '2026-06-01T00:00:00Z', newest_fetched_at: '2026-06-01T00:00:00Z', is_fresh: false }],
        [4, { league_id: 4, row_count: 12, oldest_expires_at: '2026-06-01T00:00:00Z', newest_fetched_at: '2026-06-01T00:00:00Z', is_fresh: false }],
      ]),
      2,
    );

    expect(plan.freshLeagueIds).toEqual([1]);
    expect(plan.staleLeagueIds).toEqual([2, 3, 4]);
    expect(plan.selectedStaleLeagueIds).toEqual([4, 2]);
    expect(plan.deferredStaleLeagueIds).toEqual([3]);
    expect(plan.budget).toBe(2);
  });
});
