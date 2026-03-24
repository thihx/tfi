import { beforeEach, describe, expect, test, vi } from 'vitest';

const mockGetLeagueTeamDirectory = vi.fn();
const mockReplaceLeagueTeamsSnapshot = vi.fn();
const mockFetchTeamsByLeagueWithSeason = vi.fn();

const redisState = new Map<string, string>();
const mockRedis = {
  get: vi.fn(async (key: string) => redisState.get(key) ?? null),
  set: vi.fn(async (key: string, value: string, ...args: unknown[]) => {
    if (args.includes('NX') && redisState.has(key)) return null;
    redisState.set(key, value);
    return 'OK';
  }),
  del: vi.fn(async (key: string) => {
    redisState.delete(key);
    return 1;
  }),
};

vi.mock('../repos/team-directory.repo.js', () => ({
  getLeagueTeamDirectory: mockGetLeagueTeamDirectory,
  replaceLeagueTeamsSnapshot: mockReplaceLeagueTeamsSnapshot,
}));

vi.mock('../lib/football-api.js', () => ({
  fetchTeamsByLeagueWithSeason: mockFetchTeamsByLeagueWithSeason,
}));

vi.mock('../lib/redis.js', () => ({
  getRedisClient: () => mockRedis,
}));

function freshRow() {
  return {
    league_id: 39,
    team_id: 33,
    team_name: 'Manchester United',
    team_logo: 'https://logo/33.png',
    country: 'England',
    founded: 1878,
    venue_id: 1,
    venue_name: 'Old Trafford',
    venue_city: 'Manchester',
    season: 2025,
    rank: 1,
    fetched_at: '2026-03-24T00:00:00.000Z',
    expires_at: '2999-01-01T00:00:00.000Z',
  };
}

describe('league-team-directory.service', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    redisState.clear();
  });

  test('returns fresh DB snapshot without hitting provider', async () => {
    mockGetLeagueTeamDirectory.mockResolvedValueOnce([freshRow()]);

    const { getLeagueTeamsDirectory } = await import('../lib/league-team-directory.service.js');
    const result = await getLeagueTeamsDirectory(39);

    expect(result).toEqual([
      { team: { id: 33, name: 'Manchester United', logo: 'https://logo/33.png', country: 'England' }, rank: 1 },
    ]);
    expect(mockFetchTeamsByLeagueWithSeason).not.toHaveBeenCalled();
  });

  test('refreshes stale snapshot from provider and persists normalized rows', async () => {
    mockGetLeagueTeamDirectory.mockResolvedValueOnce([
      {
        ...freshRow(),
        expires_at: '2020-01-01T00:00:00.000Z',
      },
    ]);
    mockFetchTeamsByLeagueWithSeason.mockResolvedValueOnce({
      season: 2025,
      teams: [
        {
          team: { id: 40, name: 'Liverpool', logo: 'https://logo/40.png', country: 'England', founded: 1892 },
          venue: { id: 2, name: 'Anfield', city: 'Liverpool' },
          rank: 2,
        },
      ],
    });
    mockReplaceLeagueTeamsSnapshot.mockResolvedValueOnce(1);

    const { getLeagueTeamsDirectory } = await import('../lib/league-team-directory.service.js');
    const result = await getLeagueTeamsDirectory(39);

    expect(mockFetchTeamsByLeagueWithSeason).toHaveBeenCalledWith(39);
    expect(mockReplaceLeagueTeamsSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({
        leagueId: 39,
        season: 2025,
        teams: [
          expect.objectContaining({
            team: expect.objectContaining({ id: 40, name: 'Liverpool' }),
            rank: 2,
          }),
        ],
      }),
    );
    expect(result).toEqual([
      { team: { id: 40, name: 'Liverpool', logo: 'https://logo/40.png', country: 'England' }, rank: 2 },
    ]);
  });

  test('falls back to stale local rows when provider refresh fails', async () => {
    mockGetLeagueTeamDirectory.mockResolvedValueOnce([
      {
        ...freshRow(),
        expires_at: '2020-01-01T00:00:00.000Z',
      },
    ]);
    mockFetchTeamsByLeagueWithSeason.mockRejectedValueOnce(new Error('provider down'));

    const { getLeagueTeamsDirectory } = await import('../lib/league-team-directory.service.js');
    const result = await getLeagueTeamsDirectory(39);

    expect(result).toEqual([
      { team: { id: 33, name: 'Manchester United', logo: 'https://logo/33.png', country: 'England' }, rank: 1 },
    ]);
  });
});