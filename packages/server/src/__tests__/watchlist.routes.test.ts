// ============================================================
// Integration tests — Watchlist routes
// ============================================================

import { describe, test, expect, vi, beforeAll, afterAll } from 'vitest';
import { buildApp } from './helpers.js';
import type { FastifyInstance } from 'fastify';

const mockEntry = {
  match_id: '100', home_team: 'Arsenal', away_team: 'Chelsea',
  status: 'active', priority: 1, total_checks: 3,
};

vi.mock('../repos/watchlist.repo.js', () => ({
  getAllWatchlist: vi.fn().mockResolvedValue([mockEntry]),
  getActiveWatchlist: vi.fn().mockResolvedValue([mockEntry]),
  getWatchlistByMatchId: vi.fn().mockImplementation((matchId: string) =>
    matchId === '100' ? Promise.resolve(mockEntry) : Promise.resolve(null),
  ),
  createWatchlistEntry: vi.fn().mockImplementation((body: Record<string, unknown>) =>
    Promise.resolve({ ...mockEntry, ...body }),
  ),
  updateWatchlistEntry: vi.fn().mockImplementation((matchId: string, body: Record<string, unknown>) =>
    matchId === '100' ? Promise.resolve({ ...mockEntry, ...body }) : Promise.resolve(null),
  ),
  deleteWatchlistEntry: vi.fn().mockImplementation((matchId: string) =>
    matchId === '100' ? Promise.resolve(true) : Promise.resolve(false),
  ),
  incrementChecks: vi.fn().mockResolvedValue(undefined),
  expireOldEntries: vi.fn().mockResolvedValue(5),
}));

vi.mock('../repos/settings.repo.js', () => ({
  getSettings: vi.fn().mockResolvedValue({
    AUTO_APPLY_RECOMMENDED_CONDITION: true,
  }),
}));

let app: FastifyInstance;

beforeAll(async () => {
  const { watchlistRoutes } = await import('../routes/watchlist.routes.js');
  app = await buildApp(watchlistRoutes);
});

afterAll(async () => {
  await app.close();
});

describe('GET /api/watchlist', () => {
  test('returns all entries', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/watchlist' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toHaveLength(1);
    expect(res.json()[0].match_id).toBe('100');
  });
});

describe('GET /api/watchlist/active', () => {
  test('returns active entries', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/watchlist/active' });
    expect(res.statusCode).toBe(200);
    expect(res.json()[0].status).toBe('active');
  });
});

describe('GET /api/watchlist/:matchId', () => {
  test('returns entry if found', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/watchlist/100' });
    expect(res.statusCode).toBe(200);
    expect(res.json().match_id).toBe('100');
  });

  test('returns 404 if not found', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/watchlist/999' });
    expect(res.statusCode).toBe(404);
    expect(res.json().error).toContain('not found');
  });
});

describe('POST /api/watchlist', () => {
  test('creates an entry', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/watchlist',
      payload: { match_id: '200', home_team: 'Barca', away_team: 'Real' },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().match_id).toBe('200');
  });

  test('injects global auto-apply default when field is missing', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/watchlist',
      payload: { match_id: '201', home_team: 'Barca', away_team: 'Real' },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().auto_apply_recommended_condition).toBe(true);
  });

  test('preserves explicit auto-apply override from caller', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/watchlist',
      payload: {
        match_id: '202',
        home_team: 'Barca',
        away_team: 'Real',
        auto_apply_recommended_condition: false,
      },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().auto_apply_recommended_condition).toBe(false);
  });

  test('returns 400 when match_id is missing', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/watchlist',
      payload: { home_team: 'Barca' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toContain('match_id');
  });
});

describe('PUT /api/watchlist/:matchId', () => {
  test('updates an existing entry', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/watchlist/100',
      payload: { priority: 3 },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().priority).toBe(3);
  });

  test('returns 404 for non-existent entry', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/watchlist/999',
      payload: { priority: 1 },
    });
    expect(res.statusCode).toBe(404);
  });
});

// F5 audit fix: PATCH /api/watchlist/:matchId
describe('PATCH /api/watchlist/:matchId', () => {
  test('updates an existing entry via PATCH', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/watchlist/100',
      payload: { priority: 5 },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().priority).toBe(5);
  });

  test('returns 404 for non-existent entry via PATCH', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/watchlist/999',
      payload: { priority: 1 },
    });
    expect(res.statusCode).toBe(404);
  });
});

describe('DELETE /api/watchlist/:matchId', () => {
  test('deletes an entry', async () => {
    const res = await app.inject({ method: 'DELETE', url: '/api/watchlist/100' });
    expect(res.statusCode).toBe(200);
    expect(res.json().deleted).toBe(true);
  });

  test('returns 404 for non-existent entry', async () => {
    const res = await app.inject({ method: 'DELETE', url: '/api/watchlist/999' });
    expect(res.statusCode).toBe(404);
  });
});

describe('POST /api/watchlist/:matchId/check', () => {
  test('increments check count', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/watchlist/100/check' });
    expect(res.statusCode).toBe(200);
    expect(res.json().ok).toBe(true);
  });
});

describe('POST /api/watchlist/expire', () => {
  test('expires old entries', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/watchlist/expire',
      payload: { cutoffMinutes: 120 },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().expired).toBe(5);
  });

  test('works without cutoffMinutes', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/watchlist/expire',
      payload: {},
    });
    expect(res.statusCode).toBe(200);
  });
});
