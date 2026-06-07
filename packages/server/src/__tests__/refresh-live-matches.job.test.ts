import { beforeEach, describe, expect, test, vi } from 'vitest';

const mockReportJobProgress = vi.fn();
const mockGetLiveRefreshCandidates = vi.fn();
const mockUpdateMatches = vi.fn();
const mockDeleteMatchesByIds = vi.fn();
const mockEnsureFixturesForMatchIds = vi.fn();
const mockEnsureFixtureStatistics = vi.fn();
const mockGetAutoPipelineOperationalWatchlist = vi.fn();
const mockGetRealtimeAlertMatchIds = vi.fn();
const mockArchiveFinishedMatches = vi.fn();
const mockConfig = vi.hoisted(() => ({
  timezone: 'Asia/Seoul',
  jobRefreshLiveMatchesMaxPublicMatches: 0,
}));

vi.mock('../jobs/job-progress.js', () => ({
  reportJobProgress: mockReportJobProgress,
}));

vi.mock('../repos/matches.repo.js', () => ({
  getLiveRefreshCandidates: mockGetLiveRefreshCandidates,
  updateMatches: mockUpdateMatches,
  deleteMatchesByIds: mockDeleteMatchesByIds,
}));

vi.mock('../repos/matches-history.repo.js', () => ({
  archiveFinishedMatches: mockArchiveFinishedMatches,
}));

vi.mock('../repos/watchlist.repo.js', () => ({
  getAutoPipelineOperationalWatchlist: mockGetAutoPipelineOperationalWatchlist,
}));

vi.mock('../repos/match-alert-rules.repo.js', () => ({
  getRealtimeAlertMatchIds: mockGetRealtimeAlertMatchIds,
}));

vi.mock('../lib/provider-insight-cache.js', () => ({
  ensureFixturesForMatchIds: mockEnsureFixturesForMatchIds,
  ensureFixtureStatistics: mockEnsureFixtureStatistics,
}));

const mockSkipIfFootballApiCircuitOpen = vi.fn().mockResolvedValue(null);

vi.mock('../lib/football-api-circuit.js', () => ({
  skipIfFootballApiCircuitOpen: (...args: unknown[]) => mockSkipIfFootballApiCircuitOpen(...args),
}));

vi.mock('../config.js', () => ({
  config: mockConfig,
}));

const { refreshLiveMatchesJob } = await import('../jobs/refresh-live-matches.job.js');

beforeEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
  mockSkipIfFootballApiCircuitOpen.mockResolvedValue(null);
  mockGetLiveRefreshCandidates.mockResolvedValue([]);
  mockUpdateMatches.mockResolvedValue(0);
  mockDeleteMatchesByIds.mockResolvedValue(0);
  mockArchiveFinishedMatches.mockResolvedValue(0);
  mockEnsureFixturesForMatchIds.mockResolvedValue([]);
  mockEnsureFixtureStatistics.mockResolvedValue({ payload: [], cacheStatus: 'miss' });
  mockGetAutoPipelineOperationalWatchlist.mockResolvedValue([{ match_id: '100' }, { match_id: '200' }]);
  mockGetRealtimeAlertMatchIds.mockResolvedValue([]);
  mockConfig.jobRefreshLiveMatchesMaxPublicMatches = 0;
});

describe('refreshLiveMatchesJob', () => {
  test('does not refresh public live candidates when no matches have realtime interest', async () => {
    mockGetAutoPipelineOperationalWatchlist.mockResolvedValueOnce([]);
    mockGetRealtimeAlertMatchIds.mockResolvedValueOnce([]);

    const result = await refreshLiveMatchesJob();

    expect(result).toEqual({
      tracked: 0,
      refreshed: 0,
      live: 0,
      statsRefreshed: 0,
      skipped: true,
      skipReason: 'no_active_realtime_interest',
    });
    expect(mockGetLiveRefreshCandidates).not.toHaveBeenCalled();
    expect(mockEnsureFixturesForMatchIds).not.toHaveBeenCalled();
  });

  test('refreshes a near-kickoff match that only has an enabled alert rule', async () => {
    vi.setSystemTime(new Date('2026-06-07T04:00:03.000Z'));
    mockGetAutoPipelineOperationalWatchlist.mockResolvedValueOnce([]);
    mockGetRealtimeAlertMatchIds.mockResolvedValueOnce(['1546317']);
    mockGetLiveRefreshCandidates.mockResolvedValue([
      {
        match_id: '1546317',
        status: 'NS',
        date: '2026-06-07',
        kickoff: '13:00',
        kickoff_at_utc: '2026-06-07T04:00:00.000Z',
      },
    ]);
    mockEnsureFixturesForMatchIds.mockResolvedValue([
      {
        fixture: {
          id: 1546317,
          date: '2026-06-07T04:00:00+00:00',
          status: { short: '1H', elapsed: 3 },
        },
        goals: { home: 0, away: 0 },
      },
    ]);
    mockUpdateMatches.mockResolvedValue(1);

    const result = await refreshLiveMatchesJob();

    expect(result).toEqual({ tracked: 1, refreshed: 1, live: 1, statsRefreshed: 0 });
    expect(mockEnsureFixturesForMatchIds).toHaveBeenCalledWith(['1546317'], {
      freshnessMode: 'real_required',
      forceRefreshIds: ['1546317'],
    });
    expect(mockUpdateMatches).toHaveBeenCalledWith([
      expect.objectContaining({
        match_id: '1546317',
        status: '1H',
        current_minute: 3,
        home_score: 0,
        away_score: 0,
      }),
    ]);
  });

  test('returns early when no live or near-live matches are tracked', async () => {
    mockGetLiveRefreshCandidates.mockResolvedValue([
      {
        match_id: '100',
        status: 'NS',
        date: '2030-01-01',
        kickoff: '19:00',
        kickoff_at_utc: '2030-01-01T10:00:00.000Z',
      },
    ]);

    const result = await refreshLiveMatchesJob();
    expect(result).toEqual({ tracked: 0, refreshed: 0, live: 0, statsRefreshed: 0 });
    expect(mockEnsureFixturesForMatchIds).not.toHaveBeenCalled();
  });

  test('refreshes live matches and updates scores plus cards', async () => {
    vi.setSystemTime(new Date('2026-03-26T10:05:00.000Z'));
    mockGetLiveRefreshCandidates.mockResolvedValue([
      {
        match_id: '100',
        status: '1H',
        date: '2026-03-26',
        kickoff: '19:00',
        kickoff_at_utc: '2026-03-26T10:00:00.000Z',
      },
      {
        match_id: '200',
        status: 'NS',
        date: '2026-03-26',
        kickoff: '19:12',
        kickoff_at_utc: '2026-03-26T10:12:00.000Z',
      },
    ]);
    mockEnsureFixturesForMatchIds.mockResolvedValue([
      {
        fixture: {
          id: 100,
          date: '2026-03-26T10:00:00+00:00',
          status: { short: '1H', elapsed: 7 },
        },
        goals: { home: 1, away: 0 },
      },
      {
        fixture: {
          id: 200,
          date: '2026-03-26T10:12:00+00:00',
          status: { short: 'NS', elapsed: null },
        },
        goals: { home: null, away: null },
      },
    ]);
    mockEnsureFixtureStatistics.mockResolvedValue({
      payload: [
        { statistics: [{ type: 'Red Cards', value: 0 }, { type: 'Yellow Cards', value: 2 }] },
        { statistics: [{ type: 'Red Cards', value: 1 }, { type: 'Yellow Cards', value: 1 }] },
      ],
      cacheStatus: 'refreshed',
    });
    mockUpdateMatches.mockResolvedValue(2);

    const result = await refreshLiveMatchesJob();

    expect(result).toEqual({ tracked: 2, refreshed: 2, live: 1, statsRefreshed: 1 });
    expect(mockEnsureFixturesForMatchIds).toHaveBeenCalledWith(['100', '200'], {
      freshnessMode: 'real_required',
      forceRefreshIds: ['200'],
    });
    expect(mockEnsureFixtureStatistics).toHaveBeenCalledTimes(1);
    expect(mockEnsureFixtureStatistics).toHaveBeenCalledWith('100', expect.objectContaining({
      freshnessMode: 'stale_safe',
      status: '1H',
      matchMinute: 7,
    }));
    expect(mockUpdateMatches).toHaveBeenCalledWith([
      expect.objectContaining({
        match_id: '100',
        status: '1H',
        home_score: 1,
        away_score: 0,
        current_minute: 7,
        home_yellows: 2,
        away_reds: 1,
      }),
      expect.objectContaining({
        match_id: '200',
        status: 'NS',
      }),
    ]);
  });

  test('reuses fresh cached stats without calling Football API again', async () => {
    vi.setSystemTime(new Date('2026-03-26T10:05:00.000Z'));
    mockGetLiveRefreshCandidates.mockResolvedValue([
      {
        match_id: '100',
        status: '1H',
        date: '2026-03-26',
        kickoff: '19:00',
        kickoff_at_utc: '2026-03-26T10:00:00.000Z',
      },
    ]);
    mockEnsureFixturesForMatchIds.mockResolvedValue([
      {
        fixture: {
          id: 100,
          date: '2026-03-26T10:00:00+00:00',
          status: { short: '1H', elapsed: 7 },
        },
        goals: { home: 1, away: 0 },
      },
    ]);
    mockEnsureFixtureStatistics.mockResolvedValue({
      payload: [
        { statistics: [{ type: 'Red Cards', value: 0 }, { type: 'Yellow Cards', value: 2 }] },
        { statistics: [{ type: 'Red Cards', value: 1 }, { type: 'Yellow Cards', value: 1 }] },
      ],
      cacheStatus: 'hit',
    });
    mockUpdateMatches.mockResolvedValue(1);

    const result = await refreshLiveMatchesJob();

    expect(result).toEqual({ tracked: 1, refreshed: 1, live: 1, statsRefreshed: 0 });
    expect(mockEnsureFixtureStatistics).toHaveBeenCalledTimes(1);
    expect(mockEnsureFixtureStatistics).toHaveBeenCalledWith('100', expect.objectContaining({
      freshnessMode: 'stale_safe',
    }));
    expect(mockUpdateMatches).toHaveBeenCalledWith([
      expect.objectContaining({
        match_id: '100',
        home_yellows: 2,
        away_reds: 1,
      }),
    ]);
  });

  test('keeps live score refresh when real-time card stats are unavailable', async () => {
    vi.setSystemTime(new Date('2026-03-26T10:05:00.000Z'));
    mockGetLiveRefreshCandidates.mockResolvedValue([
      {
        match_id: '100',
        status: '1H',
        date: '2026-03-26',
        kickoff: '19:00',
        kickoff_at_utc: '2026-03-26T10:00:00.000Z',
      },
    ]);
    mockEnsureFixturesForMatchIds.mockResolvedValue([
      {
        fixture: {
          id: 100,
          date: '2026-03-26T10:00:00+00:00',
          status: { short: '1H', elapsed: 8 },
        },
        goals: { home: 2, away: 1 },
      },
    ]);
    mockEnsureFixtureStatistics.mockRejectedValueOnce(new Error('fresh live stats unavailable'));
    mockUpdateMatches.mockResolvedValue(1);

    const result = await refreshLiveMatchesJob();

    expect(result).toEqual({ tracked: 1, refreshed: 1, live: 1, statsRefreshed: 0 });
    expect(mockUpdateMatches).toHaveBeenCalledWith([
      expect.objectContaining({
        match_id: '100',
        home_score: 2,
        away_score: 1,
        current_minute: 8,
        home_yellows: undefined,
        away_reds: undefined,
      }),
    ]);
  });

  test('skips when Football API daily limit circuit is open', async () => {
    mockSkipIfFootballApiCircuitOpen.mockResolvedValueOnce({
      skipped: true,
      skipReason: 'football_api_daily_limit',
      openUntil: '2026-05-24T00:00:00.000Z',
    });

    const result = await refreshLiveMatchesJob();

    expect(result).toEqual({
      tracked: 0,
      refreshed: 0,
      live: 0,
      statsRefreshed: 0,
      skipped: true,
      skipReason: 'football_api_daily_limit',
      openUntil: '2026-05-24T00:00:00.000Z',
    });
    expect(mockGetLiveRefreshCandidates).not.toHaveBeenCalled();
    expect(mockEnsureFixturesForMatchIds).not.toHaveBeenCalled();
  });

  test('loads only narrowed live-refresh candidates instead of scanning the full matches table', async () => {
    vi.setSystemTime(new Date('2026-03-26T10:05:00.000Z'));
    mockGetLiveRefreshCandidates.mockResolvedValue([]);

    await refreshLiveMatchesJob();

    expect(mockGetLiveRefreshCandidates).toHaveBeenCalledOnce();
    expect(mockGetLiveRefreshCandidates.mock.calls[0]?.[0]).toContain('1H');
  });

  test('archives and removes terminal fixtures instead of leaving FT rows in matches', async () => {
    vi.setSystemTime(new Date('2026-03-26T12:00:00.000Z'));
    mockGetLiveRefreshCandidates.mockResolvedValue([
      {
        match_id: '100',
        status: '2H',
        date: '2026-03-26',
        kickoff: '19:00',
        kickoff_at_utc: '2026-03-26T10:00:00.000Z',
      },
    ]);
    mockEnsureFixturesForMatchIds.mockResolvedValue([
      {
        fixture: {
          id: 100,
          date: '2026-03-26T10:00:00+00:00',
          status: { short: 'FT', elapsed: 90 },
          venue: { name: 'Stadium' },
        },
        league: { id: 39, name: 'Premier League' },
        teams: {
          home: { id: 1, name: 'Arsenal' },
          away: { id: 2, name: 'Chelsea' },
        },
        goals: { home: 2, away: 1 },
        score: { halftime: { home: 1, away: 0 } },
      },
    ]);
    mockArchiveFinishedMatches.mockResolvedValue(1);
    mockDeleteMatchesByIds.mockResolvedValue(1);

    const result = await refreshLiveMatchesJob();

    expect(result).toEqual({ tracked: 1, refreshed: 1, live: 0, statsRefreshed: 0 });
    expect(mockArchiveFinishedMatches).toHaveBeenCalledWith([
      expect.objectContaining({
        match_id: '100',
        final_status: 'FT',
        home_score: 2,
        away_score: 1,
      }),
    ]);
    expect(mockDeleteMatchesByIds).toHaveBeenCalledWith(['100']);
    expect(mockUpdateMatches).not.toHaveBeenCalled();
  });

  test('refreshes capped public live candidates when no matches are actively watched', async () => {
    vi.setSystemTime(new Date('2026-03-26T10:05:00.000Z'));
    mockConfig.jobRefreshLiveMatchesMaxPublicMatches = 1;
    mockGetAutoPipelineOperationalWatchlist.mockResolvedValueOnce([]);
    mockGetRealtimeAlertMatchIds.mockResolvedValueOnce([]);
    mockGetLiveRefreshCandidates.mockResolvedValue([
      {
        match_id: '100',
        status: '1H',
        date: '2026-03-26',
        kickoff: '19:00',
        kickoff_at_utc: '2026-03-26T10:00:00.000Z',
      },
      {
        match_id: '200',
        status: '2H',
        date: '2026-03-26',
        kickoff: '19:05',
        kickoff_at_utc: '2026-03-26T10:05:00.000Z',
      },
    ]);
    mockEnsureFixturesForMatchIds.mockResolvedValue([
      {
        fixture: {
          id: 100,
          date: '2026-03-26T10:00:00+00:00',
          status: { short: '1H', elapsed: 6 },
        },
        goals: { home: 1, away: 0 },
      },
    ]);
    mockUpdateMatches.mockResolvedValue(1);

    const result = await refreshLiveMatchesJob();

    expect(result).toEqual({ tracked: 1, refreshed: 1, live: 1, statsRefreshed: 0 });
    expect(mockEnsureFixturesForMatchIds).toHaveBeenCalledWith(['100'], {
      freshnessMode: 'real_required',
      forceRefreshIds: [],
    });
    expect(mockEnsureFixtureStatistics).not.toHaveBeenCalled();
  });

  test('refreshes watched candidates without pulling extra public live fixtures when public cap is disabled', async () => {
    vi.setSystemTime(new Date('2026-03-26T10:05:00.000Z'));
    mockGetAutoPipelineOperationalWatchlist.mockResolvedValueOnce([{ match_id: '200' }]);
    mockGetLiveRefreshCandidates.mockResolvedValue([
      {
        match_id: '100',
        status: '1H',
        date: '2026-03-26',
        kickoff: '19:00',
        kickoff_at_utc: '2026-03-26T10:00:00.000Z',
      },
      {
        match_id: '200',
        status: 'NS',
        date: '2026-03-26',
        kickoff: '19:12',
        kickoff_at_utc: '2026-03-26T10:12:00.000Z',
      },
    ]);
    mockEnsureFixturesForMatchIds.mockResolvedValue([
      {
        fixture: {
          id: 100,
          date: '2026-03-26T10:00:00+00:00',
          status: { short: '1H', elapsed: 6 },
        },
        goals: { home: 1, away: 0 },
      },
      {
        fixture: {
          id: 200,
          date: '2026-03-26T10:12:00+00:00',
          status: { short: 'NS', elapsed: null },
        },
        goals: { home: null, away: null },
      },
    ]);

    await refreshLiveMatchesJob();

    expect(mockEnsureFixturesForMatchIds).toHaveBeenCalledWith(['200'], {
      freshnessMode: 'real_required',
      forceRefreshIds: ['200'],
    });
    expect(mockEnsureFixtureStatistics).not.toHaveBeenCalled();
  });
});
