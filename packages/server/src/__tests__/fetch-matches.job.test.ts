// ============================================================
// Unit tests — Fetch Matches Job
// ============================================================

import { describe, test, expect, vi, beforeEach } from 'vitest';

vi.mock('../lib/redis.js', () => ({
  getRedisClient: () => ({
    hget: vi.fn(), hset: vi.fn(), expire: vi.fn(), del: vi.fn(),
    get: vi.fn().mockResolvedValue(null),  // no skip key by default
    set: vi.fn().mockResolvedValue('OK'),
  }),
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
  getMatchScheduleState: vi.fn().mockResolvedValue({ liveCount: 0, nsCount: 0, minsToNextKickoff: null }),
}));

vi.mock('../repos/watchlist.repo.js', () => ({
  getWatchlistByMatchId: vi.fn().mockResolvedValue(null),
  getExistingWatchlistMatchIds: vi.fn().mockResolvedValue(new Set()),
  createWatchlistEntry: vi.fn().mockResolvedValue({}),
  syncWatchlistDates: vi.fn().mockResolvedValue(0),
}));

vi.mock('../repos/matches-history.repo.js', () => ({
  archiveFinishedMatches: vi.fn().mockResolvedValue(0),
  getHistoricalMatchesBatch: vi.fn().mockResolvedValue(new Map()),
}));

vi.mock('../repos/settings.repo.js', () => ({
  getSettings: vi.fn().mockResolvedValue({
    AUTO_APPLY_RECOMMENDED_CONDITION: true,
  }),
}));

vi.mock('../repos/favorite-teams.repo.js', () => ({
  getFavoriteTeamIds: vi.fn().mockResolvedValue(new Set<string>()),
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
  fetchFixtureStatistics: vi.fn().mockResolvedValue([]),
}));

vi.mock('../config.js', () => ({
  config: { timezone: 'Asia/Ho_Chi_Minh', jobFetchMatchesMs: 60_000, pipelineEnabled: false },
}));

const { fetchMatchesJob } = await import('../jobs/fetch-matches.job.js');
const footballApi = await import('../lib/football-api.js');

beforeEach(() => {
  vi.clearAllMocks();
  fetchCallCount = 0;
});

describe('fetchMatchesJob', () => {
  test('returns saved count and league count', async () => {
    const result = await fetchMatchesJob();
    // job fetches 3 days (yesterday+today+tomorrow); mock alternates odd/even by fetchCallCount
    // odd calls return [1001(39), 1002(140), 1003(999)], even returns [2001(39)]
    // after league filter (39+140 active): 2+1+2 = 5 rows (deduplication happens in DB via replaceAllMatches)
    expect(result.saved).toBe(5);
    expect(result.leagues).toBeGreaterThanOrEqual(1);
  });

  test('filters out fixtures from non-active leagues', async () => {
    const result = await fetchMatchesJob();
    // fixture 1003 (league 999) should be filtered out on each of the 3-day fetches
    expect(result.saved).toBe(5);
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
    expect(calls.every((c) => (c[0] as Record<string, unknown>).auto_apply_recommended_condition === true)).toBe(true);
  });

  test('skips creating watchlist entry if already exists', async () => {
    const watchlistRepo = await import('../repos/watchlist.repo.js');
    vi.mocked(watchlistRepo.getExistingWatchlistMatchIds).mockResolvedValue(new Set(['1001']));

    await fetchMatchesJob();
    const createdMatchIds = vi.mocked(watchlistRepo.createWatchlistEntry).mock.calls.map(
      (call) => String((call[0] as Record<string, unknown>).match_id),
    );
    expect(createdMatchIds).not.toContain('1001');
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
    expect(archived).toMatchObject({ final_status: 'FT', home_score: 2, away_score: 1 });
  });

  test('does not refetch finished stats when history already has settlement cache', async () => {
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

    const historyRepo = await import('../repos/matches-history.repo.js');
    vi.mocked(historyRepo.getHistoricalMatchesBatch).mockResolvedValueOnce(
      new Map([[
        '1001',
        {
          match_id: '1001',
          date: '2026-03-20',
          kickoff: '15:00',
          league_id: 39,
          league_name: 'League',
          home_team: 'Arsenal',
          away_team: 'Chelsea',
          venue: 'Stadium',
          final_status: 'FT',
          home_score: 2,
          away_score: 1,
          settlement_stats: [{ type: 'Corner Kicks', home: 6, away: 5 }],
          archived_at: '2026-03-20T17:00:00Z',
        },
      ]]),
    );

    await fetchMatchesJob();

    expect(footballApi.fetchFixtureStatistics).not.toHaveBeenCalled();
  });

  test('syncs watchlist dates after refresh', async () => {
    await fetchMatchesJob();
    const watchlistRepo = await import('../repos/watchlist.repo.js');
    expect(watchlistRepo.syncWatchlistDates).toHaveBeenCalled();
  });
});

// ============================================================
// Favorite Teams auto-add
// ============================================================

// mkFixture with team IDs for favorite-team matching
const mkFixtureWithIds = (
  id: number,
  leagueId: number,
  status: string,
  date: string,
  homeId: number,
  awayId: number,
  teamHome = 'Home',
  teamAway = 'Away',
) => ({
  fixture: { id, date, status: { short: status, elapsed: null }, venue: { name: 'Stadium' } },
  league: { id: leagueId, name: 'League', round: '' },
  teams: {
    home: { id: homeId, name: teamHome, logo: '' },
    away: { id: awayId, name: teamAway, logo: '' },
  },
  goals: { home: null, away: null },
  score: { halftime: { home: null, away: null } },
});

describe('fetchMatchesJob — favorite team auto-add', () => {
  test('auto-adds NS matches where home team is a favorite', async () => {
    const favoriteRepo = await import('../repos/favorite-teams.repo.js');
    vi.mocked(favoriteRepo.getFavoriteTeamIds).mockResolvedValueOnce(new Set(['33']));

    vi.mocked(footballApi.fetchFixturesForDate)
      .mockResolvedValueOnce([
        mkFixtureWithIds(3001, 39, 'NS', '2026-03-23T15:00:00+00:00', 33, 40, 'Man Utd', 'Liverpool'),
      ] as never)
      .mockResolvedValueOnce([]);

    await fetchMatchesJob();

    const watchlistRepo = await import('../repos/watchlist.repo.js');
    const calls = vi.mocked(watchlistRepo.createWatchlistEntry).mock.calls;
    expect(calls.some((c) => (c[0] as Record<string, unknown>).added_by === 'favorite-team-auto')).toBe(true);
    const favCall = calls.find((c) => (c[0] as Record<string, unknown>).added_by === 'favorite-team-auto');
    expect((favCall?.[0] as Record<string, unknown>).match_id).toBe('3001');
  });

  test('auto-adds NS matches where away team is a favorite', async () => {
    const favoriteRepo = await import('../repos/favorite-teams.repo.js');
    vi.mocked(favoriteRepo.getFavoriteTeamIds).mockResolvedValueOnce(new Set(['40']));

    vi.mocked(footballApi.fetchFixturesForDate)
      .mockResolvedValueOnce([
        mkFixtureWithIds(3002, 39, 'NS', '2026-03-23T15:00:00+00:00', 33, 40, 'Man Utd', 'Liverpool'),
      ] as never)
      .mockResolvedValueOnce([]);

    await fetchMatchesJob();

    const watchlistRepo = await import('../repos/watchlist.repo.js');
    const calls = vi.mocked(watchlistRepo.createWatchlistEntry).mock.calls;
    const favCall = calls.find((c) => (c[0] as Record<string, unknown>).added_by === 'favorite-team-auto');
    expect(favCall).toBeDefined();
    expect((favCall?.[0] as Record<string, unknown>).match_id).toBe('3002');
  });

  test('does not auto-add non-NS (live/finished) matches for favorite teams', async () => {
    const favoriteRepo = await import('../repos/favorite-teams.repo.js');
    vi.mocked(favoriteRepo.getFavoriteTeamIds).mockResolvedValueOnce(new Set(['33']));

    vi.mocked(footballApi.fetchFixturesForDate)
      .mockResolvedValueOnce([
        mkFixtureWithIds(3003, 39, '2H', '2026-03-23T15:00:00+00:00', 33, 40, 'Man Utd', 'Liverpool'),
        mkFixtureWithIds(3004, 39, 'FT', '2026-03-23T17:00:00+00:00', 33, 50, 'Man Utd', 'Arsenal'),
      ] as never)
      .mockResolvedValueOnce([]);

    await fetchMatchesJob();

    const watchlistRepo = await import('../repos/watchlist.repo.js');
    const calls = vi.mocked(watchlistRepo.createWatchlistEntry).mock.calls;
    expect(calls.every((c) => (c[0] as Record<string, unknown>).added_by !== 'favorite-team-auto')).toBe(true);
  });

  test('skips favorite team match already in watchlist', async () => {
    const favoriteRepo = await import('../repos/favorite-teams.repo.js');
    vi.mocked(favoriteRepo.getFavoriteTeamIds).mockResolvedValueOnce(new Set(['33']));

    const watchlistRepo = await import('../repos/watchlist.repo.js');
    vi.mocked(watchlistRepo.getExistingWatchlistMatchIds).mockResolvedValue(new Set(['3005']));

    vi.mocked(footballApi.fetchFixturesForDate)
      .mockResolvedValueOnce([
        mkFixtureWithIds(3005, 39, 'NS', '2026-03-23T15:00:00+00:00', 33, 40, 'Man Utd', 'Liverpool'),
      ] as never)
      .mockResolvedValueOnce([]);

    await fetchMatchesJob();

    const calls = vi.mocked(watchlistRepo.createWatchlistEntry).mock.calls;
    expect(calls.every((c) => (c[0] as Record<string, unknown>).added_by !== 'favorite-team-auto')).toBe(true);
  });

  test('does nothing when no favorite teams are configured', async () => {
    const favoriteRepo = await import('../repos/favorite-teams.repo.js');
    vi.mocked(favoriteRepo.getFavoriteTeamIds).mockResolvedValueOnce(new Set());

    vi.mocked(footballApi.fetchFixturesForDate)
      .mockResolvedValueOnce([
        mkFixtureWithIds(3006, 39, 'NS', '2026-03-23T15:00:00+00:00', 33, 40, 'Man Utd', 'Liverpool'),
      ] as never)
      .mockResolvedValueOnce([]);

    await fetchMatchesJob();

    const watchlistRepo = await import('../repos/watchlist.repo.js');
    const calls = vi.mocked(watchlistRepo.createWatchlistEntry).mock.calls;
    expect(calls.every((c) => (c[0] as Record<string, unknown>).added_by !== 'favorite-team-auto')).toBe(true);
  });

  test('uses shared autoApplyRecommendedCondition from earlier settings fetch', async () => {
    const settingsRepo = await import('../repos/settings.repo.js');
    vi.mocked(settingsRepo.getSettings).mockResolvedValueOnce({ AUTO_APPLY_RECOMMENDED_CONDITION: false } as never);

    const favoriteRepo = await import('../repos/favorite-teams.repo.js');
    vi.mocked(favoriteRepo.getFavoriteTeamIds).mockResolvedValueOnce(new Set(['33']));

    vi.mocked(footballApi.fetchFixturesForDate)
      .mockResolvedValueOnce([
        mkFixtureWithIds(3007, 39, 'NS', '2026-03-23T15:00:00+00:00', 33, 40, 'Man Utd', 'Liverpool'),
      ] as never)
      .mockResolvedValueOnce([]);

    await fetchMatchesJob();

    const watchlistRepo = await import('../repos/watchlist.repo.js');
    const calls = vi.mocked(watchlistRepo.createWatchlistEntry).mock.calls;
    const favCall = calls.find((c) => (c[0] as Record<string, unknown>).added_by === 'favorite-team-auto');
    expect((favCall?.[0] as Record<string, unknown>).auto_apply_recommended_condition).toBe(false);

    // getSettings should only be called once (shared)
    expect(settingsRepo.getSettings).toHaveBeenCalledTimes(1);
  });
});
