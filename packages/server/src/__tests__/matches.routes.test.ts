// ============================================================
// Integration tests — Matches routes
// ============================================================

import { describe, test, expect, vi, beforeAll, afterAll } from 'vitest';
import { buildApp } from './helpers.js';
import type { FastifyInstance } from 'fastify';

vi.mock('../repos/settings.repo.js', () => ({
  getSettings: vi.fn().mockResolvedValue({}),
  saveSettings: vi.fn(),
}));

vi.mock('../repos/matches.repo.js', () => ({
  getAllMatches: vi.fn().mockResolvedValue([
    { match_id: '1', home_team: 'Arsenal', away_team: 'Chelsea', status: 'NS', league_id: 39 },
    { match_id: '2', home_team: 'Liverpool', away_team: 'Man City', status: '1H', league_id: 39 },
  ]),
  getActiveLeagueMatches: vi.fn().mockResolvedValue([
    { match_id: '1', home_team: 'Arsenal', away_team: 'Chelsea', status: 'NS', league_id: 39 },
    { match_id: '2', home_team: 'Liverpool', away_team: 'Man City', status: '1H', league_id: 39 },
  ]),
  getMatchesByStatus: vi.fn().mockImplementation((statuses: string[]) => {
    const all = [
      { match_id: '1', home_team: 'Arsenal', away_team: 'Chelsea', status: 'NS' },
      { match_id: '2', home_team: 'Liverpool', away_team: 'Man City', status: '1H' },
      { match_id: '3', home_team: 'Barca', away_team: 'Real', status: 'FT' },
    ];
    return Promise.resolve(all.filter((m) => statuses.includes(m.status)));
  }),
  getMatchesByIds: vi.fn().mockImplementation((ids: string[]) =>
    Promise.resolve(ids.map((id) => ({ match_id: id, home_team: 'Team A', away_team: 'Team B', status: '1H' }))),
  ),
  replaceAllMatches: vi.fn().mockImplementation((rows: unknown[]) => Promise.resolve(rows.length)),
  updateMatches: vi.fn().mockImplementation((rows: unknown[]) => Promise.resolve(rows.length)),
  deleteMatchesByIds: vi.fn().mockImplementation((ids: string[]) => Promise.resolve(ids.length)),
}));

let app: FastifyInstance;

beforeAll(async () => {
  const { matchRoutes } = await import('../routes/matches.routes.js');
  app = await buildApp(matchRoutes);
});

afterAll(async () => {
  await app.close();
});

describe('GET /api/matches', () => {
  test('returns all matches', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/matches' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toHaveLength(2);
    expect(body[0].match_id).toBe('1');
  });
});

describe('GET /api/matches/by-status', () => {
  test('filters by single status', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/matches/by-status?statuses=NS' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toHaveLength(1);
    expect(body[0].status).toBe('NS');
  });

  test('filters by multiple statuses', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/matches/by-status?statuses=NS,1H' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toHaveLength(2);
  });

  test('returns empty array when no statuses match', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/matches/by-status?statuses=ET' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toHaveLength(0);
  });

  test('returns empty when statuses param is missing', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/matches/by-status' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toHaveLength(0);
  });
});

describe('POST /api/matches/by-ids', () => {
  test('returns matches for given IDs', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/matches/by-ids',
      payload: { ids: ['1', '2', '3'] },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toHaveLength(3);
  });
});

describe('POST /api/matches/live-streams/lookup', () => {
  test('filters live stream sources by viewer country before lookup', async () => {
    const settingsRepo = await import('../repos/settings.repo.js');
    vi.mocked(settingsRepo.getSettings).mockResolvedValueOnce({
      LIVE_STREAM_LOCATOR_ENABLED: true,
      LIVE_STREAM_SOURCES: [
        {
          id: 'vn-source',
          name: 'Vietnam Source',
          url: 'https://vn.example/',
          countries: ['VN'],
          priority: 10,
          active: true,
          sourceType: 'provider_homepage',
        },
        {
          id: 'kr-source',
          name: 'Korea Source',
          url: 'https://kr.example/',
          countries: ['KR'],
          priority: 10,
          active: true,
          sourceType: 'provider_homepage',
        },
        {
          id: 'global-source',
          name: 'Global Source',
          url: 'https://global.example/',
          countries: ['*'],
          priority: 100,
          active: true,
          sourceType: 'provider_homepage',
        },
      ],
      LIVE_STREAM_REGION_ENABLED: true,
      LIVE_STREAM_REGION_UNKNOWN_POLICY: 'global_only',
      LIVE_STREAM_LOCATOR_CACHE_TTL_MS: 15000,
    });

    const fetchMock = vi.fn(async (url: string | URL) => {
      const href = String(url);
      if (href === 'https://vn.example/') {
        return new Response('<a href="/team-a-team-b">Team A vs Team B live</a>', { status: 200 });
      }
      if (href === 'https://vn.example/team-a-team-b') {
        return new Response('<main>Team A vs Team B stream player live</main>', { status: 200 });
      }
      if (href === 'https://global.example/') {
        return new Response('<main>No matching stream</main>', { status: 200 });
      }
      return new Response('unexpected', { status: 500 });
    });
    vi.stubGlobal('fetch', fetchMock);

    const res = await app.inject({
      method: 'POST',
      url: '/api/matches/live-streams/lookup',
      headers: { 'cf-ipcountry': 'VN' },
      payload: { matchIds: ['100'] },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      viewerRegion: { country: 'VN', source: 'cloudflare', confidence: 'high' },
      results: [
        {
          matchId: '100',
          found: true,
          sourceName: 'Vietnam Source',
          links: [
            expect.objectContaining({
              sourceId: 'vn-source',
              countries: ['VN'],
              sourceName: 'Vietnam Source',
            }),
          ],
        },
      ],
    });
    expect(fetchMock).not.toHaveBeenCalledWith('https://kr.example/', expect.anything());

    vi.unstubAllGlobals();
  });
});

describe('POST /api/matches/refresh', () => {
  test('replaces all matches and returns count', async () => {
    const rows = [
      { match_id: '10', home_team: 'A', away_team: 'B', status: 'NS' },
      { match_id: '11', home_team: 'C', away_team: 'D', status: 'NS' },
    ];
    const res = await app.inject({
      method: 'POST',
      url: '/api/matches/refresh',
      payload: rows,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ replaced: 2 });
  });
});

describe('PATCH /api/matches', () => {
  test('updates matches and returns count', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/matches',
      payload: [{ match_id: '1', home_score: 1, away_score: 0 }],
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ updated: 1 });
  });
});

describe('DELETE /api/matches', () => {
  test('deletes matches and returns count', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: '/api/matches',
      payload: { ids: ['1', '2'] },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ deleted: 2 });
  });
});
