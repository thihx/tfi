import { beforeEach, describe, expect, test, vi } from 'vitest';

const mockReportJobProgress = vi.fn();
const mockGetAllMatches = vi.fn();
const mockUpdateMatches = vi.fn();
const mockEnsureFixturesForMatchIds = vi.fn();
const mockEnsureFixtureStatistics = vi.fn();

vi.mock('../jobs/job-progress.js', () => ({
  reportJobProgress: mockReportJobProgress,
}));

vi.mock('../repos/matches.repo.js', () => ({
  getAllMatches: mockGetAllMatches,
  updateMatches: mockUpdateMatches,
}));

vi.mock('../lib/provider-insight-cache.js', () => ({
  ensureFixturesForMatchIds: mockEnsureFixturesForMatchIds,
  ensureFixtureStatistics: mockEnsureFixtureStatistics,
}));

vi.mock('../config.js', () => ({
  config: {
    timezone: 'Asia/Seoul',
  },
}));

const { refreshLiveMatchesJob } = await import('../jobs/refresh-live-matches.job.js');

beforeEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
  mockGetAllMatches.mockResolvedValue([]);
  mockUpdateMatches.mockResolvedValue(0);
  mockEnsureFixturesForMatchIds.mockResolvedValue([]);
  mockEnsureFixtureStatistics.mockResolvedValue({ payload: [], cacheStatus: 'miss' });
});

describe('refreshLiveMatchesJob', () => {
  test('returns early when no live or near-live matches are tracked', async () => {
    mockGetAllMatches.mockResolvedValue([
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
    mockGetAllMatches.mockResolvedValue([
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
    expect(mockEnsureFixturesForMatchIds).toHaveBeenCalledWith(['100', '200'], { freshnessMode: 'real_required' });
    expect(mockEnsureFixtureStatistics).toHaveBeenCalledTimes(1);
    expect(mockEnsureFixtureStatistics).toHaveBeenCalledWith('100', expect.objectContaining({
      freshnessMode: 'real_required',
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
    mockGetAllMatches.mockResolvedValue([
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
      freshnessMode: 'real_required',
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
    mockGetAllMatches.mockResolvedValue([
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
});
