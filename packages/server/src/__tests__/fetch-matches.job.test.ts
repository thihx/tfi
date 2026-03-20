// ============================================================
// Unit tests — Fetch Matches Job
// ============================================================

import { describe, test, expect, vi, beforeEach } from 'vitest';

vi.mock('../lib/redis.js', () => ({
  getRedisClient: () => ({ hget: vi.fn(), hset: vi.fn(), expire: vi.fn(), del: vi.fn() }),
}));

vi.mock('../jobs/job-progress.js', () => ({
  reportJobProgress: vi.fn(),
  completeJobProgress: vi.fn(),
  clearJobProgress: vi.fn(),
}));

const mockActiveLeagues = [
  { league_id: 39, name: 'Premier League', active: true },
  { league_id: 140, name: 'La Liga', active: true },
];

const mockTopLeagues = [{ league_id: 39, name: 'Premier League', top_league: true }];

vi.mock('../repos/leagues.repo.js', () => ({
  getActiveLeagues: vi.fn().mockResolvedValue(mockActiveLeagues),
  getTopLeagues: vi.fn().mockResolvedValue(mockTopLeagues),
}));

vi.mock('../repos/matches.repo.js', () => ({
  getAllMatches: vi.fn().mockResolvedValue([]),
  replaceAllMatches: vi.fn().mockImplementation((rows: unknown[]) => Promise.resolve(rows.length)),
}));

vi.mock('../repos/watchlist.repo.js', () => ({
  getWatchlistByMatchId: vi.fn().mockResolvedValue(null),
  createWatchlistEntry: vi.fn().mockResolvedValue({}),
  syncWatchlistDates: vi.fn().mockResolvedValue(0),
}));

vi.mock('../repos/matches-history.repo.js', () => ({
  archiveFinishedMatches: vi.fn().mockResolvedValue(0),
}));

const mkFixture = (id: number, leagueId: number, status: string, date: string, teamHome = 'Home', teamAway = 'Away') => ({
  fixture: { id, date, status: { short: status, elapsed: null }, venue: { name: 'Stadium' } },
  league: { id: leagueId, name: 'League' },
  teams: { home: { name: teamHome, logo: '' }, away: { name: teamAway, logo: '' } },
  goals: { home: null, away: null },
});

let fetchCallCount = 0;
vi.mock('../lib/football-api.js', () => ({
  fetchFixturesForDate: vi.fn().mockImplementation((date: string) => {
    fetchCallCount++;
    // First call = today, second call = tomorrow
    if (fetchCallCount % 2 === 1) {
      return Promise.resolve([
        mkFixture(1001, 39, 'NS', `${date}T15:00:00+00:00`, 'Arsenal', 'Chelsea'),
        mkFixture(1002, 140, 'NS', `${date}T20:00:00+00:00`, 'Barca', 'Real'),
        mkFixture(1003, 999, 'NS', `${date}T18:00:00+00:00`, 'Unknown', 'Team'), // unlisted league
      ]);
    }
    return Promise.resolve([
      mkFixture(2001, 39, 'NS', `${date}T14:00:00+00:00`, 'Liverpool', 'Man City'),
    ]);
  }),
}));

vi.mock('../config.js', () => ({
  config: { timezone: 'Asia/Ho_Chi_Minh' },
}));

const { fetchMatchesJob } = await import('../jobs/fetch-matches.job.js');

beforeEach(() => {
  vi.clearAllMocks();
  fetchCallCount = 0;
});

describe('fetchMatchesJob', () => {
  test('returns saved count and league count', async () => {
    const result = await fetchMatchesJob();
    expect(result.saved).toBe(3); // 2 from today (league 39 + 140) + 1 from tomorrow (league 39)
    expect(result.leagues).toBeGreaterThanOrEqual(1);
  });

  test('filters out fixtures from non-active leagues', async () => {
    const result = await fetchMatchesJob();
    // fixture 1003 (league 999) should be filtered out
    expect(result.saved).toBe(3);
  });

  test('returns 0 when no active leagues', async () => {
    const leagueRepo = await import('../repos/leagues.repo.js');
    vi.mocked(leagueRepo.getActiveLeagues).mockResolvedValueOnce([]);

    const result = await fetchMatchesJob();
    expect(result).toEqual({ saved: 0, leagues: 0 });
  });

  test('auto-adds top league NS matches to watchlist', async () => {
    await fetchMatchesJob();

    const watchlistRepo = await import('../repos/watchlist.repo.js');
    // Should have attempted to add Arsenal vs Chelsea (league 39 = top, NS) and Liverpool vs Man City
    expect(watchlistRepo.createWatchlistEntry).toHaveBeenCalled();
    const calls = vi.mocked(watchlistRepo.createWatchlistEntry).mock.calls;
    expect(calls.some((c) => (c[0] as Record<string, unknown>).added_by === 'top-league-auto')).toBe(true);
  });

  test('skips creating watchlist entry if already exists', async () => {
    const watchlistRepo = await import('../repos/watchlist.repo.js');
    vi.mocked(watchlistRepo.getWatchlistByMatchId).mockResolvedValue({ match_id: '1001' } as never);

    await fetchMatchesJob();
    expect(watchlistRepo.createWatchlistEntry).not.toHaveBeenCalled();
  });

  test('archives finished matches before refresh', async () => {
    await fetchMatchesJob();
    const historyRepo = await import('../repos/matches-history.repo.js');
    expect(historyRepo.archiveFinishedMatches).toHaveBeenCalled();
  });

  test('prefers fresh FT payload over stale live row when archiving', async () => {
    const matchRepo = await import('../repos/matches.repo.js');
    vi.mocked(matchRepo.getAllMatches).mockResolvedValueOnce([
      {
        match_id: '1001',
        date: '2026-03-20',
        kickoff: '15:00',
        league_id: 39,
        league_name: 'League',
        home_team: 'Arsenal',
        away_team: 'Chelsea',
        home_logo: '',
        away_logo: '',
        venue: 'Stadium',
        status: '2H',
        home_score: 1,
        away_score: 1,
        current_minute: 88,
        last_updated: '2026-03-20T14:58:00Z',
        home_team_id: 1,
        away_team_id: 2,
        round: '',
        halftime_home: null,
        halftime_away: null,
        referee: null,
        home_reds: 0,
        away_reds: 0,
        home_yellows: 0,
        away_yellows: 0,
      },
    ] as never);

    const footballApi = await import('../lib/football-api.js');
    vi.mocked(footballApi.fetchFixturesForDate)
      .mockResolvedValueOnce([
        {
          fixture: {
            id: 1001,
            date: '2026-03-20T15:00:00+00:00',
            status: { short: 'FT', elapsed: 90 },
            venue: { name: 'Stadium' },
            referee: null,
          },
          league: { id: 39, name: 'League', round: '' },
          teams: {
            home: { id: 1, name: 'Arsenal', logo: '' },
            away: { id: 2, name: 'Chelsea', logo: '' },
          },
          goals: { home: 2, away: 1 },
          score: { halftime: { home: 1, away: 1 } },
        },
      ] as never)
      .mockResolvedValueOnce([]);

    await fetchMatchesJob();

    const historyRepo = await import('../repos/matches-history.repo.js');
    const archivedRows = vi.mocked(historyRepo.archiveFinishedMatches).mock.calls[0]?.[0] as Array<Record<string, unknown>>;
    const archived = archivedRows.find((row) => row.match_id === '1001');
    expect(archived).toMatchObject({ status: 'FT', home_score: 2, away_score: 1 });
  });

  test('syncs watchlist dates after refresh', async () => {
    await fetchMatchesJob();
    const watchlistRepo = await import('../repos/watchlist.repo.js');
    expect(watchlistRepo.syncWatchlistDates).toHaveBeenCalled();
  });
});
