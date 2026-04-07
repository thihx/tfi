import { beforeEach, describe, expect, test, vi } from 'vitest';

vi.mock('../lib/redis.js', () => ({
  getRedisClient: () => ({
    hget: vi.fn(),
    hset: vi.fn(),
    expire: vi.fn(),
    del: vi.fn(),
    get: vi.fn().mockResolvedValue(null),
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

vi.mock('../repos/leagues.repo.js', () => ({
  getActiveLeagues: vi.fn().mockResolvedValue(mockActiveLeagues),
  getTopLeagues: vi.fn().mockResolvedValue([{ league_id: 39, name: 'Premier League', top_league: true }]),
}));

vi.mock('../repos/matches.repo.js', () => ({
  getAllMatches: vi.fn().mockResolvedValue([]),
  replaceAllMatches: vi.fn().mockImplementation((rows: unknown[]) => Promise.resolve(rows.length)),
  getMatchScheduleState: vi.fn().mockResolvedValue({ liveCount: 0, nsCount: 0, minsToNextKickoff: null }),
}));

vi.mock('../repos/watchlist.repo.js', () => ({
  backfillOperationalWatchlistFromLegacy: vi.fn().mockResolvedValue(0),
  syncWatchlistDates: vi.fn().mockResolvedValue(0),
  getExistingWatchlistMatchIds: vi.fn().mockResolvedValue(new Set()),
  getExistingUserWatchlistMatchIds: vi.fn().mockResolvedValue(new Set()),
  createOperationalWatchlistEntry: vi.fn().mockResolvedValue({}),
  createWatchlistEntry: vi.fn().mockResolvedValue({}),
}));

vi.mock('../repos/matches-history.repo.js', () => ({
  archiveFinishedMatches: vi.fn().mockResolvedValue(0),
  getHistoricalMatchesBatch: vi.fn().mockResolvedValue(new Map()),
}));

vi.mock('../lib/provider-insight-cache.js', () => ({
  ensureFixtureStatistics: vi.fn().mockResolvedValue({
    payload: [],
    cacheStatus: 'refreshed',
  }),
}));

vi.mock('../config.js', () => ({
  config: { timezone: 'Asia/Ho_Chi_Minh', jobFetchMatchesMs: 60_000, pipelineEnabled: false },
}));

const mkFixture = (
  id: number,
  leagueId: number,
  status: string,
  date: string,
  teamHome = 'Home',
  teamAway = 'Away',
) => ({
  fixture: { id, date, status: { short: status, elapsed: status === '2H' ? 78 : null }, venue: { name: 'Stadium' }, referee: null },
  league: { id: leagueId, name: 'League', round: '' },
  teams: {
    home: { id: id * 10 + 1, name: teamHome, logo: '' },
    away: { id: id * 10 + 2, name: teamAway, logo: '' },
  },
  goals: { home: null, away: null },
  score: { halftime: { home: null, away: null } },
});

let fetchCallCount = 0;
vi.mock('../lib/football-api.js', () => ({
  fetchFixturesForDate: vi.fn().mockImplementation((date: string) => {
    fetchCallCount++;
    // Job order: 1=yesterday, 2=today, 3=tomorrow (Promise.all settles today before tomorrow in practice).
    if (fetchCallCount === 1) {
      return Promise.resolve([]);
    }
    if (fetchCallCount === 2) {
      return Promise.resolve([
        mkFixture(1001, 39, 'NS', `${date}T15:00:00+00:00`, 'Arsenal', 'Chelsea'),
        mkFixture(1002, 140, 'NS', `${date}T20:00:00+00:00`, 'Barca', 'Real'),
        mkFixture(1003, 999, 'NS', `${date}T18:00:00+00:00`, 'Unknown', 'Team'),
      ]);
    }
    if (fetchCallCount === 3) {
      return Promise.resolve([
        mkFixture(2001, 39, 'NS', `${date}T14:00:00+00:00`, 'Liverpool', 'Man City'),
      ]);
    }
    return Promise.resolve([]);
  }),
}));

const { fetchMatchesJob } = await import('../jobs/fetch-matches.job.js');
const footballApi = await import('../lib/football-api.js');
const providerInsight = await import('../lib/provider-insight-cache.js');

beforeEach(() => {
  vi.clearAllMocks();
  fetchCallCount = 0;
});

describe('fetchMatchesJob', () => {
  test('returns saved count and league count', async () => {
    const result = await fetchMatchesJob();

    expect(result.saved).toBe(3);
    expect(result.leagues).toBeGreaterThanOrEqual(1);

    const matchRepo = await import('../repos/matches.repo.js');
    const savedRows = vi.mocked(matchRepo.replaceAllMatches).mock.calls[0]?.[0] as Array<Record<string, unknown>>;
    expect(savedRows.every((row) => typeof row.kickoff_at_utc === 'string')).toBe(true);
  });

  test('filters out fixtures from non-active leagues', async () => {
    const result = await fetchMatchesJob();
    expect(result.saved).toBe(3);
  });

  test('returns 0 when no active leagues', async () => {
    const leagueRepo = await import('../repos/leagues.repo.js');
    vi.mocked(leagueRepo.getActiveLeagues).mockResolvedValueOnce([]);

    const result = await fetchMatchesJob();
    expect(result).toEqual({ saved: 0, leagues: 0 });
  });

  test('does not perform watchlist side effects directly anymore', async () => {
    await fetchMatchesJob();

    const watchlistRepo = await import('../repos/watchlist.repo.js');
    expect(watchlistRepo.backfillOperationalWatchlistFromLegacy).not.toHaveBeenCalled();
    expect(watchlistRepo.syncWatchlistDates).not.toHaveBeenCalled();
    expect(watchlistRepo.createOperationalWatchlistEntry).not.toHaveBeenCalled();
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

    vi.mocked(footballApi.fetchFixturesForDate)
      .mockResolvedValueOnce([])
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
    expect(archived).toMatchObject({
      final_status: 'FT',
      home_score: 2,
      away_score: 1,
      kickoff_at_utc: '2026-03-20T15:00:00.000Z',
    });
  });

  test('does not refetch finished stats when settlement_stats_fetched_at is set', async () => {
    vi.mocked(footballApi.fetchFixturesForDate)
      .mockResolvedValueOnce([])
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
          settlement_stats: [],
          settlement_stats_fetched_at: '2026-03-20T16:00:00Z',
        },
      ]]),
    );

    await fetchMatchesJob();
    expect(providerInsight.ensureFixtureStatistics).not.toHaveBeenCalled();
  });

  test('fetches finished stats when settlement_stats_fetched_at is null', async () => {
    vi.mocked(footballApi.fetchFixturesForDate)
      .mockResolvedValueOnce([])
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
          settlement_stats_fetched_at: null,
        },
      ]]),
    );

    await fetchMatchesJob();
    expect(providerInsight.ensureFixtureStatistics).toHaveBeenCalledWith('1001', expect.objectContaining({
      status: 'FT',
      acceptFinishedPayloadRegardlessOfTtl: true,
    }));
  });

  test('fetches live and finished stats in one combined pass', async () => {
    vi.mocked(footballApi.fetchFixturesForDate)
      .mockResolvedValueOnce([] as never)
      .mockResolvedValueOnce([
        {
          fixture: { id: 2001, date: '2026-03-20T12:00:00+00:00', status: { short: '2H', elapsed: 78 }, venue: { name: 'Stadium' }, referee: null },
          league: { id: 39, name: 'League', round: '' },
          teams: { home: { id: 1, name: 'Arsenal', logo: '' }, away: { id: 2, name: 'Chelsea', logo: '' } },
          goals: { home: 1, away: 1 },
          score: { halftime: { home: 1, away: 0 } },
        },
        {
          fixture: { id: 2002, date: '2026-03-20T13:00:00+00:00', status: { short: 'FT', elapsed: 90 }, venue: { name: 'Stadium' }, referee: null },
          league: { id: 39, name: 'League', round: '' },
          teams: { home: { id: 3, name: 'Liverpool', logo: '' }, away: { id: 4, name: 'Everton', logo: '' } },
          goals: { home: 2, away: 1 },
          score: { halftime: { home: 1, away: 0 } },
        },
      ] as never)
      .mockResolvedValueOnce([] as never);

    const historyRepo = await import('../repos/matches-history.repo.js');
    vi.mocked(historyRepo.getHistoricalMatchesBatch).mockResolvedValueOnce(new Map());

    await fetchMatchesJob();

    expect(providerInsight.ensureFixtureStatistics).toHaveBeenCalledWith('2001', expect.objectContaining({
      status: '2H',
      acceptFinishedPayloadRegardlessOfTtl: false,
    }));
    expect(providerInsight.ensureFixtureStatistics).toHaveBeenCalledWith('2002', expect.objectContaining({
      status: 'FT',
      acceptFinishedPayloadRegardlessOfTtl: true,
    }));
    expect(providerInsight.ensureFixtureStatistics).toHaveBeenCalledTimes(2);
  });
});
