// ============================================================
// Integration tests — Watchlist routes
// ============================================================

import { describe, test, expect, vi, beforeAll, afterAll } from 'vitest';
import { buildApp } from './helpers.js';
import type { FastifyInstance } from 'fastify';

const MEMBER_USER = {
  userId: 'member-1',
  email: 'member@example.com',
  role: 'member' as const,
  status: 'active' as const,
  displayName: 'Member',
  avatarUrl: '',
};

const ADMIN_USER = {
  userId: 'admin-1',
  email: 'admin@example.com',
  role: 'admin' as const,
  status: 'active' as const,
  displayName: 'Admin',
  avatarUrl: '',
};

const mockEntry = {
  id: 7,
  match_id: '100', home_team: 'Arsenal', away_team: 'Chelsea',
  status: 'active', priority: 1, total_checks: 3,
};

vi.mock('../repos/watchlist.repo.js', () => ({
  getAllWatchlist: vi.fn().mockResolvedValue([mockEntry]),
  getWatchSubscriptionById: vi.fn().mockImplementation((subscriptionId: number) =>
    subscriptionId === 7 ? Promise.resolve(mockEntry) : Promise.resolve(null),
  ),
  createWatchlistEntry: vi.fn().mockImplementation((body: Record<string, unknown>) =>
    Promise.resolve({ ...mockEntry, ...body }),
  ),
  updateWatchSubscriptionById: vi.fn().mockImplementation((subscriptionId: number, body: Record<string, unknown>) =>
    subscriptionId === 7 ? Promise.resolve({ ...mockEntry, ...body }) : Promise.resolve(null),
  ),
  deleteWatchSubscriptionById: vi.fn().mockImplementation((subscriptionId: number) =>
    subscriptionId === 7 ? Promise.resolve(true) : Promise.resolve(false),
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
let adminApp: FastifyInstance;

beforeAll(async () => {
  const { watchlistRoutes } = await import('../routes/watchlist.routes.js');
  app = await buildApp([watchlistRoutes], { currentUser: MEMBER_USER });
  adminApp = await buildApp([watchlistRoutes], { currentUser: ADMIN_USER });
});

afterAll(async () => {
  await app.close();
  await adminApp.close();
});

describe('POST /api/me/watch-subscriptions defaults', () => {
  test('defaults auto-apply to true without default-row fallback', async () => {
    const settingsRepo = await import('../repos/settings.repo.js');
    const watchlistRepo = await import('../repos/watchlist.repo.js');
    vi.mocked(settingsRepo.getSettings).mockResolvedValueOnce({ TELEGRAM_CHAT_ID: 'system-only' });

    const res = await app.inject({
      method: 'POST',
      url: '/api/me/watch-subscriptions',
      payload: { match_id: '301', home_team: 'Seoul', away_team: 'Ulsan' },
    });

    expect(res.statusCode).toBe(201);
    expect(settingsRepo.getSettings).toHaveBeenCalledWith('member-1', { fallbackToDefault: false });
    expect(watchlistRepo.createWatchlistEntry).toHaveBeenCalledWith(
      expect.objectContaining({ auto_apply_recommended_condition: true }),
      'member-1',
    );
  });
});

describe('GET /api/me/watch-subscriptions', () => {
  test('returns current user watch subscriptions via design-aligned path', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/me/watch-subscriptions' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toHaveLength(1);
    expect(res.json()[0].id).toBe(7);
    expect(res.json()[0].match_id).toBe('100');
  });
});

describe('GET /api/me/watch-subscriptions/:id', () => {
  test('returns subscription by ID', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/me/watch-subscriptions/7' });
    expect(res.statusCode).toBe(200);
    expect(res.json().id).toBe(7);
  });

  test('returns 400 for invalid subscription ID', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/me/watch-subscriptions/not-a-number' });
    expect(res.statusCode).toBe(400);
  });

  test('returns 404 when subscription ID is not found', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/me/watch-subscriptions/999' });
    expect(res.statusCode).toBe(404);
  });
});

describe('POST /api/me/watch-subscriptions', () => {
  test('creates a subscription through the design-aligned path', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/me/watch-subscriptions',
      payload: { match_id: '300', home_team: 'Inter', away_team: 'Milan' },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().match_id).toBe('300');
  });
});

describe('PUT /api/me/watch-subscriptions/:id', () => {
  test('updates a subscription by ID', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/me/watch-subscriptions/7',
      payload: { priority: 4 },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().priority).toBe(4);
  });

  test('returns 404 for missing subscription ID', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/me/watch-subscriptions/999',
      payload: { priority: 1 },
    });
    expect(res.statusCode).toBe(404);
  });
});

describe('retired legacy self-service watchlist routes', () => {
  test('GET /api/watchlist returns 404', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/watchlist' });
    expect(res.statusCode).toBe(404);
  });

  test('GET /api/watchlist/active returns 404', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/watchlist/active' });
    expect(res.statusCode).toBe(404);
  });

  test('POST /api/watchlist returns 404', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/watchlist',
      payload: { match_id: '200', home_team: 'Barca', away_team: 'Real' },
    });
    expect(res.statusCode).toBe(404);
  });
});

describe('PATCH /api/me/watch-subscriptions/:id', () => {
  test('patches a subscription by ID', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/me/watch-subscriptions/7',
      payload: { priority: 6 },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().priority).toBe(6);
  });

  test('returns 400 for invalid subscription ID on patch', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/me/watch-subscriptions/not-a-number',
      payload: { priority: 1 },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe('DELETE /api/me/watch-subscriptions/:id', () => {
  test('deletes a subscription by ID', async () => {
    const res = await app.inject({ method: 'DELETE', url: '/api/me/watch-subscriptions/7' });
    expect(res.statusCode).toBe(200);
    expect(res.json().deleted).toBe(true);
  });

  test('returns 200 with deleted:false for unknown subscription ID (idempotent)', async () => {
    const res = await app.inject({ method: 'DELETE', url: '/api/me/watch-subscriptions/999' });
    expect(res.statusCode).toBe(200);
    expect(res.json().deleted).toBe(false);
  });
});

describe('POST /api/watchlist/:matchId/check', () => {
  test('rejects member role', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/watchlist/100/check' });
    expect(res.statusCode).toBe(403);
  });

  test('increments check count', async () => {
    const res = await adminApp.inject({ method: 'POST', url: '/api/watchlist/100/check' });
    expect(res.statusCode).toBe(200);
    expect(res.json().ok).toBe(true);
  });
});

describe('POST /api/watchlist/expire', () => {
  test('rejects member role', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/watchlist/expire',
      payload: { cutoffMinutes: 120 },
    });
    expect(res.statusCode).toBe(403);
  });

  test('expires old entries', async () => {
    const res = await adminApp.inject({
      method: 'POST',
      url: '/api/watchlist/expire',
      payload: { cutoffMinutes: 120 },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().expired).toBe(5);
  });

  test('works without cutoffMinutes', async () => {
    const res = await adminApp.inject({
      method: 'POST',
      url: '/api/watchlist/expire',
      payload: {},
    });
    expect(res.statusCode).toBe(200);
  });
});
