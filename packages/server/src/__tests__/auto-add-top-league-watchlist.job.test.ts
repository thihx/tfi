import { beforeEach, describe, expect, test, vi } from 'vitest';

vi.mock('../jobs/job-progress.js', () => ({
  reportJobProgress: vi.fn(),
}));

vi.mock('../repos/matches.repo.js', () => ({
  getAllMatches: vi.fn().mockResolvedValue([
    {
      match_id: '1001',
      date: '2026-03-31',
      kickoff: '19:00',
      kickoff_at_utc: '2026-03-31T19:00:00.000Z',
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
      date: '2026-03-31',
      kickoff: '21:00',
      kickoff_at_utc: '2026-03-31T21:00:00.000Z',
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
});
