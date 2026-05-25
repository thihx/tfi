import { beforeEach, describe, expect, test, vi } from 'vitest';

vi.mock('../jobs/job-progress.js', () => ({
  reportJobProgress: vi.fn(),
}));

vi.mock('../config.js', () => ({
  config: {
    autoAddTopLeagueMaxPerRun: 20,
    autoAddTopLeagueKickoffWindowHours: 36,
  },
}));

vi.mock('../repos/matches.repo.js', () => ({
  getAllMatches: vi.fn().mockResolvedValue([
    {
      match_id: '1001',
      date: new Date(Date.now() + 6 * 60 * 60_000).toISOString().slice(0, 10),
      kickoff: '19:00',
      kickoff_at_utc: new Date(Date.now() + 6 * 60 * 60_000).toISOString(),
      league_id: 39,
      league_name: 'Premier League',
      home_team: 'Arsenal',
      away_team: 'Chelsea',
      home_logo: '',
      away_logo: '',
      status: 'NS',
    },
    {
      match_id: '1002',
      date: new Date(Date.now() + 6 * 60 * 60_000).toISOString().slice(0, 10),
      kickoff: '21:00',
      kickoff_at_utc: new Date(Date.now() + 6 * 60 * 60_000).toISOString(),
      league_id: 140,
      league_name: 'La Liga',
      home_team: 'Barca',
      away_team: 'Real',
      home_logo: '',
      away_logo: '',
      status: 'NS',
    },
  ]),
}));

vi.mock('../repos/leagues.repo.js', () => ({
  getTopLeagues: vi.fn().mockResolvedValue([{ league_id: 39, name: 'Premier League', top_league: true }]),
}));

vi.mock('../repos/settings.repo.js', () => ({
  getSettings: vi.fn().mockResolvedValue({ AUTO_APPLY_RECOMMENDED_CONDITION: true }),
}));

vi.mock('../repos/watchlist.repo.js', () => ({
  getExistingWatchlistMatchIds: vi.fn().mockResolvedValue(new Set<string>()),
  createOperationalWatchlistEntry: vi.fn().mockResolvedValue({}),
}));

const { autoAddTopLeagueWatchlistJob } = await import('../jobs/auto-add-top-league-watchlist.job.js');

beforeEach(() => {
  vi.clearAllMocks();
});

describe('autoAddTopLeagueWatchlistJob', () => {
  test('adds only top-league NS matches that are not already tracked', async () => {
    const result = await autoAddTopLeagueWatchlistJob();
    expect(result).toEqual({ candidates: 1, added: 1, skippedExisting: 0 });

    const watchlistRepo = await import('../repos/watchlist.repo.js');
    expect(watchlistRepo.createOperationalWatchlistEntry).toHaveBeenCalledWith(
      expect.objectContaining({
        match_id: '1001',
        added_by: 'top-league-auto',
        auto_apply_recommended_condition: true,
      }),
    );
  });

  test('skips matches already present in the watchlist boundary', async () => {
    const watchlistRepo = await import('../repos/watchlist.repo.js');
    vi.mocked(watchlistRepo.getExistingWatchlistMatchIds).mockResolvedValueOnce(new Set(['1001']));

    const result = await autoAddTopLeagueWatchlistJob();
    expect(result).toEqual({ candidates: 1, added: 0, skippedExisting: 1 });
    expect(watchlistRepo.createOperationalWatchlistEntry).not.toHaveBeenCalled();
  });

  test('respects per-run cap on auto-added matches', async () => {
    const matchesRepo = await import('../repos/matches.repo.js');
    const configModule = await import('../config.js');
    (configModule.config as Record<string, unknown>).autoAddTopLeagueMaxPerRun = 1;

    const manyMatches = Array.from({ length: 5 }, (_, i) => ({
      match_id: String(2000 + i),
      date: new Date(Date.now() + 6 * 60 * 60_000).toISOString().slice(0, 10),
      kickoff: '19:00',
      kickoff_at_utc: new Date(Date.now() + 6 * 60 * 60_000).toISOString(),
      league_id: 39,
      league_name: 'Premier League',
      home_team: `Home ${i}`,
      away_team: `Away ${i}`,
      home_logo: '',
      away_logo: '',
      status: 'NS',
    }));
    vi.mocked(matchesRepo.getAllMatches).mockResolvedValueOnce(manyMatches as never);

    const result = await autoAddTopLeagueWatchlistJob();
    expect(result.added).toBe(1);

    (configModule.config as Record<string, unknown>).autoAddTopLeagueMaxPerRun = 20;
  });

  test('filters out matches outside kickoff time window', async () => {
    const matchesRepo = await import('../repos/matches.repo.js');
    const configModule = await import('../config.js');
    (configModule.config as Record<string, unknown>).autoAddTopLeagueKickoffWindowHours = 1;

    const farFutureMatch = [{
      match_id: '3001',
      date: new Date(Date.now() + 48 * 60 * 60_000).toISOString().slice(0, 10),
      kickoff: '19:00',
      kickoff_at_utc: new Date(Date.now() + 48 * 60 * 60_000).toISOString(),
      league_id: 39,
      league_name: 'Premier League',
      home_team: 'TeamA',
      away_team: 'TeamB',
      home_logo: '',
      away_logo: '',
      status: 'NS',
    }];
    vi.mocked(matchesRepo.getAllMatches).mockResolvedValueOnce(farFutureMatch as never);

    const result = await autoAddTopLeagueWatchlistJob();
    expect(result.candidates).toBe(0);
    expect(result.added).toBe(0);

    (configModule.config as Record<string, unknown>).autoAddTopLeagueKickoffWindowHours = 36;
  });
});
