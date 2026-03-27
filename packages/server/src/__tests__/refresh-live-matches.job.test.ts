import { beforeEach, describe, expect, test, vi } from 'vitest';

const mockReportJobProgress = vi.fn();
const mockGetAllMatches = vi.fn();
const mockUpdateMatches = vi.fn();
const mockFetchFixturesByIds = vi.fn();
const mockFetchFixtureStatistics = vi.fn();

vi.mock('../jobs/job-progress.js', () => ({
  reportJobProgress: mockReportJobProgress,
}));

vi.mock('../repos/matches.repo.js', () => ({
  getAllMatches: mockGetAllMatches,
  updateMatches: mockUpdateMatches,
}));

vi.mock('../lib/football-api.js', () => ({
  fetchFixturesByIds: mockFetchFixturesByIds,
  fetchFixtureStatistics: mockFetchFixtureStatistics,
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
  mockFetchFixturesByIds.mockResolvedValue([]);
  mockFetchFixtureStatistics.mockResolvedValue([]);
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
    expect(result).toEqual({ tracked: 0, refreshed: 0, live: 0 });
    expect(mockFetchFixturesByIds).not.toHaveBeenCalled();
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
    mockFetchFixturesByIds.mockResolvedValue([
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
    mockFetchFixtureStatistics.mockResolvedValue([
      { statistics: [{ type: 'Red Cards', value: 0 }, { type: 'Yellow Cards', value: 2 }] },
      { statistics: [{ type: 'Red Cards', value: 1 }, { type: 'Yellow Cards', value: 1 }] },
    ]);
    mockUpdateMatches.mockResolvedValue(2);

    const result = await refreshLiveMatchesJob();

    expect(result).toEqual({ tracked: 2, refreshed: 2, live: 1 });
    expect(mockFetchFixturesByIds).toHaveBeenCalledWith(['100', '200']);
    expect(mockFetchFixtureStatistics).toHaveBeenCalledTimes(1);
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
});