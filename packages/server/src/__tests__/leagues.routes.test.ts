// ============================================================
// Integration tests — Leagues routes (Top League focus)
// ============================================================

import { describe, test, expect, vi, beforeAll, afterAll } from 'vitest';
import { buildApp } from './helpers.js';
import type { FastifyInstance } from 'fastify';

const MOCK_LEAGUES = [
  { league_id: 39, league_name: 'Premier League', country: 'England', tier: '1', active: true, top_league: false, type: 'League', logo: '', last_updated: '', has_profile: true, profile_updated_at: '2026-03-22T00:00:00Z', profile_volatility_tier: 'medium', profile_data_reliability_tier: 'high' },
  { league_id: 140, league_name: 'La Liga', country: 'Spain', tier: '1', active: true, top_league: true, type: 'League', logo: '', last_updated: '', has_profile: false, profile_updated_at: null, profile_volatility_tier: null, profile_data_reliability_tier: null },
  { league_id: 2, league_name: 'UEFA Champions League', country: 'World', tier: 'International', active: true, top_league: true, type: 'Cup', logo: '', last_updated: '', has_profile: false, profile_updated_at: null, profile_volatility_tier: null, profile_data_reliability_tier: null },
];

const MOCK_PROFILE = {
  league_id: 39,
  tempo_tier: 'high',
  goal_tendency: 'high',
  home_advantage_tier: 'normal',
  corners_tendency: 'balanced',
  cards_tendency: 'low',
  volatility_tier: 'medium',
  data_reliability_tier: 'high',
  avg_goals: 2.95,
  over_2_5_rate: 61,
  btts_rate: 57,
  late_goal_rate_75_plus: 31,
  avg_corners: 9.8,
  avg_cards: 3.7,
  notes_en: 'Fast, transition-heavy league.',
  notes_vi: 'Giai dau co toc do cao.',
  created_at: '2026-03-22T00:00:00Z',
  updated_at: '2026-03-22T00:00:00Z',
};

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

vi.mock('../repos/league-profiles.repo.js', () => ({
  getAllLeagueProfiles: vi.fn().mockResolvedValue([MOCK_PROFILE]),
  getLeagueProfileByLeagueId: vi.fn().mockImplementation((id: number) =>
    Promise.resolve(id === 39 ? MOCK_PROFILE : null),
  ),
  upsertLeagueProfile: vi.fn().mockImplementation((id: number, payload: Record<string, unknown>) =>
    Promise.resolve({ ...MOCK_PROFILE, ...payload, league_id: id }),
  ),
  deleteLeagueProfile: vi.fn().mockImplementation((id: number) =>
    Promise.resolve(id === 39),
  ),
}));

vi.mock('../lib/league-catalog.service.js', () => ({
  ensureLeagueCatalogEntry: vi.fn().mockImplementation((id: number) =>
    Promise.resolve(MOCK_LEAGUES.find((league) => league.league_id === id) ?? null),
  ),
  refreshLeagueCatalog: vi.fn().mockImplementation(({ mode = 'full', leagueIds = [] }: { mode?: string; leagueIds?: number[] }) =>
    Promise.resolve({
      mode,
      candidateLeagues: mode === 'ids' ? leagueIds.length : 3,
      attemptedLeagues: mode === 'ids' ? leagueIds.length : 3,
      refreshedLeagues: mode === 'ids' ? leagueIds.length : 3,
      skippedFreshLeagues: 0,
      failedLeagues: 0,
      fetched: mode === 'ids' ? leagueIds.length : 3,
      upserted: mode === 'ids' ? leagueIds.length : 3,
    }),
  ),
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

describe('League profile routes', () => {
  test('lists all league profiles', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/league-profiles' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toHaveLength(1);
    expect(res.json()[0].league_id).toBe(39);
  });

  test('gets league profile by league id', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/leagues/39/profile' });
    expect(res.statusCode).toBe(200);
    expect(res.json().tempo_tier).toBe('high');
  });

  test('returns 404 when league profile is missing', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/leagues/140/profile' });
    expect(res.statusCode).toBe(404);
    expect(res.json().error).toBe('League profile not found');
  });

  test('upserts league profile', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/leagues/140/profile',
      payload: {
        tempo_tier: 'balanced',
        goal_tendency: 'balanced',
        home_advantage_tier: 'normal',
        corners_tendency: 'balanced',
        cards_tendency: 'balanced',
        volatility_tier: 'medium',
        data_reliability_tier: 'medium',
        avg_goals: 2.5,
        over_2_5_rate: 50,
        btts_rate: 48,
        late_goal_rate_75_plus: 28,
        avg_corners: 9.1,
        avg_cards: 4.2,
        notes_en: 'Balanced profile',
        notes_vi: 'Profile can bang',
      },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().league_id).toBe(140);
    expect(res.json().tempo_tier).toBe('balanced');
  });

  test('rejects invalid league profile payload', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/leagues/140/profile',
      payload: {
        tempo_tier: 'wild',
      },
    });
    expect(res.statusCode).toBe(400);
  });

  test('deletes league profile', async () => {
    const res = await app.inject({ method: 'DELETE', url: '/api/leagues/39/profile' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ league_id: 39, deleted: true });
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

describe('POST /api/leagues/fetch-from-api', () => {
  test('runs full league catalog refresh by default', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/leagues/fetch-from-api' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ mode: 'full', fetched: 3, upserted: 3 });
  });

  test('supports targeted league refresh mode', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/leagues/fetch-from-api',
      payload: { mode: 'ids', leagueIds: [39] },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ mode: 'ids', fetched: 1, upserted: 1 });
  });
});

describe('POST /api/leagues/:id/refresh', () => {
  test('refreshes a single league catalog entry', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/leagues/39/refresh' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ mode: 'ids', fetched: 1, upserted: 1 });
    expect(res.json().league.league_id).toBe(39);
  });
});
