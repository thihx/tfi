import { beforeEach, describe, expect, test, vi } from 'vitest';

const mockFetchLeagueById = vi.fn();
const mockFetchAllLeagues = vi.fn();
const mockFetchTeamsByLeagueWithSeason = vi.fn();
const mockFetchFixturesByLeague = vi.fn();

const redisState = new Map<string, string>();
const mockRedis = {
  get: vi.fn(async (key: string) => redisState.get(key) ?? null),
  set: vi.fn(async (key: string, value: string) => {
    redisState.set(key, value);
    return 'OK';
  }),
};

vi.mock('../lib/football-api.js', () => ({
  fetchLeagueById: mockFetchLeagueById,
  fetchAllLeagues: mockFetchAllLeagues,
  fetchTeamsByLeagueWithSeason: mockFetchTeamsByLeagueWithSeason,
  fetchFixturesByLeague: mockFetchFixturesByLeague,
}));

vi.mock('../lib/redis.js', () => ({
  getRedisClient: () => mockRedis,
}));

describe('reference-data-provider', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    redisState.clear();
  });

  test('reuses cached league fixtures without hitting provider again', async () => {
    mockFetchFixturesByLeague.mockResolvedValueOnce([{ fixture: { id: 100 } }]);

    const { fetchLeagueFixturesFromReferenceProvider } = await import('../lib/reference-data-provider.js');
    const first = await fetchLeagueFixturesFromReferenceProvider(39, 2025, 10);
    const second = await fetchLeagueFixturesFromReferenceProvider(39, 2025, 10);

    expect(first).toEqual([{ fixture: { id: 100 } }]);
    expect(second).toEqual([{ fixture: { id: 100 } }]);
    expect(mockFetchFixturesByLeague).toHaveBeenCalledTimes(1);
    expect(mockFetchFixturesByLeague).toHaveBeenCalledWith(39, 2025, 10);
  });

  test('dedupes concurrent league catalog provider requests', async () => {
    let resolveFetch: ((value: unknown) => void) | null = null;
    mockFetchLeagueById.mockImplementationOnce(() => new Promise((resolve) => {
      resolveFetch = resolve;
    }));

    const { fetchLeagueByIdFromReferenceProvider } = await import('../lib/reference-data-provider.js');
    const firstPromise = fetchLeagueByIdFromReferenceProvider(39, { force: true });
    const secondPromise = fetchLeagueByIdFromReferenceProvider(39, { force: true });

    expect(mockFetchLeagueById).toHaveBeenCalledTimes(1);
    resolveFetch?.({
      league: { id: 39, name: 'Premier League', type: 'League', logo: '' },
      country: { name: 'England', code: 'GB', flag: null },
      seasons: [],
    });

    const [first, second] = await Promise.all([firstPromise, secondPromise]);
    expect(first).toEqual(second);
    expect(mockFetchLeagueById).toHaveBeenCalledTimes(1);
  });
});
