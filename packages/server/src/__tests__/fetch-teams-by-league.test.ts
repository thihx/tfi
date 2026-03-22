// ============================================================
// Unit tests — fetchTeamsByLeague (football-api.ts)
// ============================================================

import { afterAll, beforeEach, describe, expect, test, vi } from 'vitest';

vi.mock('../config.js', () => ({
  config: {
    footballApiKey: 'test-key',
    footballApiBaseUrl: 'https://v3.football.api-sports.io',
  },
}));

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

const { fetchTeamsByLeague } = await import('../lib/football-api.js');

afterAll(() => {
  vi.unstubAllGlobals();
});

beforeEach(() => {
  mockFetch.mockReset();
});

// ============================================================
// Helpers
// ============================================================

function mkTeamsResponse(teams: Array<{ id: number; name: string }>) {
  return {
    ok: true,
    json: () =>
      Promise.resolve({
        response: teams.map((t) => ({
          team: { id: t.id, name: t.name, logo: `https://logo/${t.id}.png`, country: 'England', founded: 1878 },
          venue: { id: null, name: null, city: null },
        })),
      }),
  };
}

function mkStandingsResponse(standings: Array<{ id: number; rank: number }>) {
  return {
    ok: true,
    json: () =>
      Promise.resolve({
        response: [
          {
            league: {
              standings: [
                standings.map((s) => ({
                  rank: s.rank,
                  team: { id: s.id, name: `Team ${s.id}`, logo: '' },
                  points: 10,
                  goalsDiff: 0,
                  group: 'Group A',
                  form: null,
                  status: null,
                  description: null,
                  all: {},
                  home: {},
                  away: {},
                  update: '',
                })),
              ],
            },
          },
        ],
      }),
  };
}

function mkEmptyResponse() {
  return {
    ok: true,
    json: () => Promise.resolve({ response: [] }),
  };
}

// ============================================================
// Tests
// ============================================================

describe('fetchTeamsByLeague', () => {
  test('returns teams sorted by rank when standings available', async () => {
    // teams call → standings call
    mockFetch
      .mockResolvedValueOnce(mkTeamsResponse([{ id: 33, name: 'Man Utd' }, { id: 50, name: 'Man City' }]))
      .mockResolvedValueOnce(mkStandingsResponse([{ id: 50, rank: 1 }, { id: 33, rank: 2 }]));

    const result = await fetchTeamsByLeague(39);

    expect(result).toHaveLength(2);
    expect(result[0].team.id).toBe(50); // rank 1 first
    expect(result[1].team.id).toBe(33); // rank 2 second
    expect(result[0].rank).toBe(1);
    expect(result[1].rank).toBe(2);
  });

  test('teams without rank sort alphabetically after ranked teams', async () => {
    mockFetch
      .mockResolvedValueOnce(mkTeamsResponse([
        { id: 1, name: 'Zebra FC' },
        { id: 2, name: 'Alpha FC' },
        { id: 3, name: 'Ranked Team' },
      ]))
      .mockResolvedValueOnce(mkStandingsResponse([{ id: 3, rank: 1 }]));

    const result = await fetchTeamsByLeague(39);

    expect(result[0].team.id).toBe(3);    // rank 1 first
    expect(result[1].team.name).toBe('Alpha FC');  // alphabetical
    expect(result[2].team.name).toBe('Zebra FC');
    expect(result[1].rank).toBeNull();
    expect(result[2].rank).toBeNull();
  });

  test('falls back to previous year when current year returns no teams', async () => {
    const currentYear = new Date().getFullYear();

    // current year → empty, previous year → teams, previous year standings
    mockFetch
      .mockResolvedValueOnce(mkEmptyResponse())                  // teams current year
      .mockResolvedValueOnce(mkTeamsResponse([{ id: 33, name: 'Man Utd' }])) // teams year-1
      .mockResolvedValueOnce(mkStandingsResponse([{ id: 33, rank: 1 }]));    // standings year-1

    const result = await fetchTeamsByLeague(39);

    expect(result).toHaveLength(1);
    expect(result[0].team.id).toBe(33);

    // Verify the second teams call used previous year
    const secondCall = mockFetch.mock.calls[1];
    const secondUrl: string = secondCall[0];
    expect(secondUrl).toContain(`season=${currentYear - 1}`);
  });

  test('returns empty array when both current and previous year have no teams', async () => {
    mockFetch
      .mockResolvedValueOnce(mkEmptyResponse())
      .mockResolvedValueOnce(mkEmptyResponse());

    const result = await fetchTeamsByLeague(39);

    expect(result).toEqual([]);
    // standings should NOT be called
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  test('returns teams with null ranks when standings call fails (cups/internationals)', async () => {
    mockFetch
      .mockResolvedValueOnce(mkTeamsResponse([{ id: 1, name: 'Team A' }, { id: 2, name: 'Team B' }]))
      .mockRejectedValueOnce(new Error('Network error'));

    const result = await fetchTeamsByLeague(1);

    expect(result).toHaveLength(2);
    expect(result.every((t) => t.rank === null)).toBe(true);
    // sorted alphabetically when no ranks
    expect(result[0].team.name).toBe('Team A');
    expect(result[1].team.name).toBe('Team B');
  });

  test('uses current year for first teams request', async () => {
    const currentYear = new Date().getFullYear();

    mockFetch
      .mockResolvedValueOnce(mkTeamsResponse([{ id: 1, name: 'Team A' }]))
      .mockResolvedValueOnce(mkStandingsResponse([]));

    await fetchTeamsByLeague(39);

    const firstCall = mockFetch.mock.calls[0];
    const url: string = firstCall[0];
    expect(url).toContain('season=' + currentYear);
    expect(url).toContain('league=39');
  });
});
