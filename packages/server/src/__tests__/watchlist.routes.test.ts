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
  countActiveWatchSubscriptionsByUser: vi.fn().mockResolvedValue(1),
  getExistingUserWatchlistMatchIds: vi.fn().mockResolvedValue(new Set()),
  getWatchSubscriptionById: vi.fn().mockImplementation((subscriptionId: number) =>
    subscriptionId === 7 ? Promise.resolve(mockEntry) : Promise.resolve(null),
  ),
  createWatchlistEntry: vi.fn().mockImplementation((body: Record<string, unknown>) =>
    Promise.resolve({ ...mockEntry, ...body }),
  ),
  createWatchlistEntriesBatch: vi.fn().mockImplementation((rows: Array<Record<string, unknown>>) =>
    Promise.resolve(rows.map((row, index) => ({ ...mockEntry, ...row, id: 100 + index }))),
  ),
  updateWatchSubscriptionById: vi.fn().mockImplementation((subscriptionId: number, body: Record<string, unknown>) =>
    subscriptionId === 7 ? Promise.resolve({ ...mockEntry, ...body }) : Promise.resolve(null),
  ),
  deleteWatchSubscriptionById: vi.fn().mockImplementation((subscriptionId: number) =>
    subscriptionId === 7 ? Promise.resolve(true) : Promise.resolve(false),
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
    USER_TIMEZONE: 'Asia/Seoul',
  }),
  saveSettings: vi.fn().mockResolvedValue({
    user_id: 'member-1',
    settings: {},
    updated_at: '2026-03-24T00:00:00.000Z',
  }),
}));

vi.mock('../repos/leagues.repo.js', () => ({
  getTopLeagues: vi.fn().mockResolvedValue([
    { league_id: 39, league_name: 'Premier League', top_league: true, active: true, country: 'England', tier: '1', type: 'League', logo: '', last_updated: '' },
    { league_id: 140, league_name: 'La Liga', top_league: true, active: true, country: 'Spain', tier: '1', type: 'League', logo: '', last_updated: '' },
  ]),
}));

vi.mock('../repos/matches.repo.js', () => ({
  getMatchesForLeaguesEligibleForWatchlist: vi.fn().mockResolvedValue([
    {
      match_id: '300',
      date: '2026-03-24',
      kickoff: '19:00',
      kickoff_at_utc: '2026-03-24T10:00:00.000Z',
      league_id: 39,
      league_name: 'Premier League',
      home_team: 'Arsenal',
      away_team: 'Chelsea',
      home_logo: '',
      away_logo: '',
      venue: '',
      status: 'NS',
      home_score: null,
      away_score: null,
      current_minute: null,
      last_updated: '2026-03-24T00:00:00.000Z',
    },
  ]),
}));

vi.mock('../lib/subscription-access.js', () => ({
  resolveSubscriptionAccess: vi.fn().mockResolvedValue({
    plan: { plan_code: 'free' },
    entitlements: { 'watchlist.active_matches.limit': 5 },
  }),
  assertWatchlistCapacityAvailable: vi.fn().mockResolvedValue(undefined),
  assertWatchlistCapacityForAdditional: vi.fn().mockResolvedValue(undefined),
  sendEntitlementError: vi.fn().mockImplementation((error: unknown) => (
    error instanceof Error && error.message === 'watchlist-limit'
      ? { statusCode: 403, payload: { error: 'Active watchlist limit reached' } }
      : null
  )),
  EntitlementError: class EntitlementError extends Error {
    statusCode: number;
    code: string;
    details: Record<string, unknown>;
    constructor(message: string, options: { statusCode?: number; code: string; details?: Record<string, unknown> }) {
      super(message);
      this.statusCode = options.statusCode ?? 403;
      this.code = options.code;
      this.details = options.details ?? {};
    }
  },
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

  test('returns an entitlement error when active watchlist capacity is exhausted', async () => {
    const access = await import('../lib/subscription-access.js');
    vi.mocked(access.assertWatchlistCapacityAvailable).mockRejectedValueOnce(new Error('watchlist-limit'));

    const res = await app.inject({
      method: 'POST',
      url: '/api/me/watch-subscriptions',
      payload: { match_id: '301', home_team: 'PSG', away_team: 'Marseille' },
    });

    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({ error: 'Active watchlist limit reached' });
  });

  test('bypasses commercial watchlist cap for admin users', async () => {
    const access = await import('../lib/subscription-access.js');
    vi.mocked(access.resolveSubscriptionAccess).mockClear();
    vi.mocked(access.assertWatchlistCapacityAvailable).mockClear();
    vi.mocked(access.assertWatchlistCapacityAvailable).mockRejectedValueOnce(new Error('watchlist-limit'));

    const res = await adminApp.inject({
      method: 'POST',
      url: '/api/me/watch-subscriptions',
      payload: { match_id: '305', home_team: 'Jeonbuk', away_team: 'Pohang' },
    });

    expect(res.statusCode).toBe(201);
    expect(access.resolveSubscriptionAccess).not.toHaveBeenCalled();
    expect(access.assertWatchlistCapacityAvailable).not.toHaveBeenCalled();
  });
});

describe('favorite leagues watchlist automation', () => {
  test('loads system favorite leagues and current user selection', async () => {
    const settingsRepo = await import('../repos/settings.repo.js');
    vi.mocked(settingsRepo.getSettings).mockResolvedValueOnce({
      FAVORITE_LEAGUE_IDS: [39],
      USER_TIMEZONE: 'Asia/Seoul',
    });

    const res = await app.inject({ method: 'GET', url: '/api/me/watch-subscriptions/favorite-leagues' });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual(expect.objectContaining({
      selectedLeagueIds: [39],
      favoriteLeaguesEnabled: true,
      watchlistActiveCount: 1,
    }));
  });

  test('saves selection and adds eligible matches from Matches pool into watchlist', async () => {
    const watchlistRepo = await import('../repos/watchlist.repo.js');
    const settingsRepo = await import('../repos/settings.repo.js');

    const res = await app.inject({
      method: 'PUT',
      url: '/api/me/watch-subscriptions/favorite-leagues',
      payload: { leagueIds: [39, 140] },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual(expect.objectContaining({
      savedLeagueIds: [39, 140],
      candidateMatches: 1,
      alreadyWatched: 0,
      newMatches: 1,
      added: 1,
      limitExceeded: false,
    }));
    expect(settingsRepo.saveSettings).toHaveBeenCalledWith(
      expect.objectContaining({ FAVORITE_LEAGUE_IDS: [39, 140] }),
      'member-1',
    );
    expect(watchlistRepo.createWatchlistEntriesBatch).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ match_id: '300', added_by: 'favorite-league-auto' }),
      ]),
      'member-1',
    );
  });

  test('rejects non-system leagues', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/me/watch-subscriptions/favorite-leagues',
      payload: { leagueIds: [999] },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'One or more selected leagues are not eligible favorite leagues.' });
  });

  test('saves selection but does not add matches when watchlist capacity would be exceeded', async () => {
    const access = await import('../lib/subscription-access.js');
    const watchlistRepo = await import('../repos/watchlist.repo.js');
    vi.mocked(watchlistRepo.createWatchlistEntriesBatch).mockClear();
    vi.mocked(access.assertWatchlistCapacityAvailable).mockResolvedValue(undefined);
    vi.mocked(access.assertWatchlistCapacityForAdditional).mockRejectedValueOnce(new Error('watchlist-limit'));

    const res = await app.inject({
      method: 'PUT',
      url: '/api/me/watch-subscriptions/favorite-leagues',
      payload: { leagueIds: [39] },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual(expect.objectContaining({
      limitExceeded: true,
      added: 0,
      savedLeagueIds: [39],
    }));
    expect(watchlistRepo.createWatchlistEntriesBatch).not.toHaveBeenCalled();
  });

  test('admin bypasses favorite league and watchlist caps', async () => {
    const access = await import('../lib/subscription-access.js');
    const watchlistRepo = await import('../repos/watchlist.repo.js');
    vi.mocked(watchlistRepo.createWatchlistEntriesBatch).mockClear();
    vi.mocked(access.resolveSubscriptionAccess).mockClear();
    vi.mocked(access.assertWatchlistCapacityForAdditional).mockClear();

    const res = await adminApp.inject({
      method: 'PUT',
      url: '/api/me/watch-subscriptions/favorite-leagues',
      payload: { leagueIds: [39, 140] },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual(expect.objectContaining({
      savedLeagueIds: [39, 140],
      limitExceeded: false,
    }));
    expect(access.resolveSubscriptionAccess).not.toHaveBeenCalled();
    expect(access.assertWatchlistCapacityForAdditional).not.toHaveBeenCalled();
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

describe('DELETE /api/me/watch-subscriptions/by-match/:matchId', () => {
  test('deletes a subscription by match_id', async () => {
    const res = await app.inject({ method: 'DELETE', url: '/api/me/watch-subscriptions/by-match/100' });
    expect(res.statusCode).toBe(200);
    expect(res.json().deleted).toBe(true);
  });

  test('returns 200 with deleted:false for unknown match_id (idempotent)', async () => {
    const res = await app.inject({ method: 'DELETE', url: '/api/me/watch-subscriptions/by-match/999' });
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
