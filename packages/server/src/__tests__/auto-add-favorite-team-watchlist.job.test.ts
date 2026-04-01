import { beforeEach, describe, expect, test, vi } from 'vitest';

vi.mock('../jobs/job-progress.js', () => ({
  reportJobProgress: vi.fn(),
}));

vi.mock('../repos/matches.repo.js', () => ({
  getAllMatches: vi.fn().mockResolvedValue([
    {
      match_id: '2001',
      date: '2026-03-31',
      kickoff: '18:00',
      kickoff_at_utc: '2026-03-31T18:00:00.000Z',
      league_id: 39,
      league_name: 'Premier League',
      home_team: 'Arsenal',
      away_team: 'Chelsea',
      home_logo: '',
      away_logo: '',
      status: 'NS',
      home_team_id: 1,
      away_team_id: 2,
    },
    {
      match_id: '2002',
      date: '2026-03-31',
      kickoff: '20:00',
      kickoff_at_utc: '2026-03-31T20:00:00.000Z',
      league_id: 140,
      league_name: 'La Liga',
      home_team: 'Barca',
      away_team: 'Real',
      home_logo: '',
      away_logo: '',
      status: 'NS',
      home_team_id: 3,
      away_team_id: 4,
    },
  ]),
}));

vi.mock('../repos/favorite-teams.repo.js', () => ({
  getFavoriteTeamOwnersByTeamIds: vi.fn().mockResolvedValue([
    { userId: 'user-1', teamId: '1' },
    { userId: 'user-1', teamId: '2' },
    { userId: 'user-2', teamId: '4' },
  ]),
}));

vi.mock('../repos/settings.repo.js', () => ({
  getSettings: vi.fn().mockImplementation((userId?: string) => Promise.resolve({
    AUTO_APPLY_RECOMMENDED_CONDITION: userId !== 'user-2',
  })),
}));

vi.mock('../repos/watchlist.repo.js', () => ({
  getExistingUserWatchlistMatchIds: vi.fn().mockImplementation((userId: string) =>
    Promise.resolve(userId === 'user-2' ? new Set(['2002']) : new Set()),
  ),
  createWatchlistEntry: vi.fn().mockResolvedValue({}),
}));

const { autoAddFavoriteTeamWatchlistJob } = await import('../jobs/auto-add-favorite-team-watchlist.job.js');

beforeEach(() => {
  vi.clearAllMocks();
});

describe('autoAddFavoriteTeamWatchlistJob', () => {
  test('adds matches for users who follow participating teams', async () => {
    const result = await autoAddFavoriteTeamWatchlistJob();
    expect(result).toEqual({ candidateMatches: 2, targetUsers: 2, added: 1, skippedExisting: 1 });

    const watchlistRepo = await import('../repos/watchlist.repo.js');
    expect(watchlistRepo.createWatchlistEntry).toHaveBeenCalledWith(
      expect.objectContaining({
        match_id: '2001',
        added_by: 'favorite-team-auto',
        auto_apply_recommended_condition: true,
      }),
      'user-1',
    );
  });
});
