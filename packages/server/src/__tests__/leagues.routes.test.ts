// ============================================================
// Integration tests — Leagues routes (Top League focus)
// ============================================================

import { describe, test, expect, vi, beforeAll, afterAll } from 'vitest';
import { buildApp } from './helpers.js';
import type { FastifyInstance } from 'fastify';

const MOCK_LEAGUES = [
  { league_id: 39, league_name: 'Premier League', country: 'England', tier: '1', active: true, top_league: false, type: 'League', logo: '', last_updated: '' },
  { league_id: 140, league_name: 'La Liga', country: 'Spain', tier: '1', active: true, top_league: true, type: 'League', logo: '', last_updated: '' },
  { league_id: 2, league_name: 'UEFA Champions League', country: 'World', tier: 'International', active: true, top_league: true, type: 'Cup', logo: '', last_updated: '' },
];

vi.mock('../repos/leagues.repo.js', () => ({
  getAllLeagues: vi.fn().mockResolvedValue(MOCK_LEAGUES),
  getActiveLeagues: vi.fn().mockResolvedValue(MOCK_LEAGUES.filter((l) => l.active)),
  getLeagueById: vi.fn().mockImplementation((id: number) =>
    Promise.resolve(MOCK_LEAGUES.find((l) => l.league_id === id) ?? null),
  ),
  getTopLeagues: vi.fn().mockResolvedValue(MOCK_LEAGUES.filter((l) => l.top_league)),
  updateLeagueActive: vi.fn().mockImplementation((id: number) =>
    Promise.resolve(MOCK_LEAGUES.some((l) => l.league_id === id)),
  ),
  updateLeagueTopLeague: vi.fn().mockImplementation((id: number) =>
    Promise.resolve(MOCK_LEAGUES.some((l) => l.league_id === id)),
  ),
  bulkSetActive: vi.fn().mockImplementation((ids: number[]) =>
    Promise.resolve(ids.length),
  ),
  bulkSetTopLeague: vi.fn().mockImplementation((ids: number[]) =>
    Promise.resolve(ids.length),
  ),
  upsertLeagues: vi.fn().mockResolvedValue(0),
}));

// Mock Football API (for fetch-from-api endpoint)
vi.mock('../lib/football-api.js', () => ({
  fetchAllLeagues: vi.fn().mockResolvedValue([]),
}));

let app: FastifyInstance;

beforeAll(async () => {
  const { leagueRoutes } = await import('../routes/leagues.routes.js');
  app = await buildApp(leagueRoutes);
});

afterAll(async () => {
  await app.close();
});

// ============================================================
// GET endpoints
// ============================================================

describe('GET /api/leagues', () => {
  test('returns all leagues', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/leagues' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toHaveLength(3);
  });
});

describe('GET /api/leagues/active', () => {
  test('returns active leagues', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/leagues/active' });
    expect(res.statusCode).toBe(200);
    expect(res.json().length).toBeGreaterThan(0);
  });
});

describe('GET /api/leagues/:id', () => {
  test('returns league by ID', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/leagues/39' });
    expect(res.statusCode).toBe(200);
    expect(res.json().league_name).toBe('Premier League');
  });

  test('404 for unknown league', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/leagues/999' });
    expect(res.statusCode).toBe(404);
  });

  test('400 for invalid ID', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/leagues/abc' });
    expect(res.statusCode).toBe(400);
  });
});

describe('GET /api/leagues/top', () => {
  test('returns only top leagues', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/leagues/top' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toHaveLength(2);
    expect(body.every((l: { top_league: boolean }) => l.top_league)).toBe(true);
  });
});

// ============================================================
// PUT /api/leagues/:id/active
// ============================================================

describe('PUT /api/leagues/:id/active', () => {
  test('toggles active status', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/leagues/39/active',
      payload: { active: false },
    });
    expect(res.statusCode).toBe(200);
  });

  test('404 for unknown league', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/leagues/999/active',
      payload: { active: true },
    });
    expect(res.statusCode).toBe(404);
  });

  test('400 for invalid ID', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/leagues/abc/active',
      payload: { active: true },
    });
    expect(res.statusCode).toBe(400);
  });
});

// ============================================================
// PUT /api/leagues/:id/top-league
// ============================================================

describe('PUT /api/leagues/:id/top-league', () => {
  test('sets top_league to true', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/leagues/39/top-league',
      payload: { top_league: true },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ league_id: 39, top_league: true });
  });

  test('sets top_league to false', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/leagues/140/top-league',
      payload: { top_league: false },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ league_id: 140, top_league: false });
  });

  test('404 for unknown league', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/leagues/999/top-league',
      payload: { top_league: true },
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().error).toBe('League not found');
  });

  test('400 for invalid ID', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/leagues/abc/top-league',
      payload: { top_league: true },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('Invalid league ID');
  });
});

// ============================================================
// POST /api/leagues/bulk-active
// ============================================================

describe('POST /api/leagues/bulk-active', () => {
  test('bulk updates active status', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/leagues/bulk-active',
      payload: { ids: [39, 140], active: true },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ updated: 2 });
  });
});

// ============================================================
// POST /api/leagues/bulk-top-league
// ============================================================

describe('POST /api/leagues/bulk-top-league', () => {
  test('bulk sets top league', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/leagues/bulk-top-league',
      payload: { ids: [39, 140, 2], top_league: true },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ updated: 3 });
  });

  test('bulk removes top league', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/leagues/bulk-top-league',
      payload: { ids: [140], top_league: false },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ updated: 1 });
  });
});

// ============================================================
// POST /api/leagues/sync
// ============================================================

describe('POST /api/leagues/sync', () => {
  test('syncs leagues', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/leagues/sync',
      payload: [{ league_id: 39, league_name: 'Premier League' }],
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toHaveProperty('upserted');
  });
});
