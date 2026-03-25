import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from './helpers.js';

const CURRENT_USER = {
  userId: 'user-1',
  email: 'user@example.com',
  role: 'member' as const,
  status: 'active' as const,
  displayName: 'User',
  avatarUrl: '',
};

vi.mock('../config.js', () => ({
  config: {
    vapidPublicKey: 'public-key',
  },
}));

vi.mock('../lib/web-push.js', () => ({
  isWebPushConfigured: vi.fn().mockReturnValue(true),
}));

vi.mock('../repos/push-subscriptions.repo.js', () => ({
  upsertSubscription: vi.fn().mockResolvedValue(undefined),
  deleteSubscriptionForUser: vi.fn().mockResolvedValue(undefined),
  countSubscriptionsByUserId: vi.fn().mockResolvedValue(2),
}));

let app: FastifyInstance;

beforeAll(async () => {
  const { pushRoutes } = await import('../routes/push.routes.js');
  app = await buildApp([pushRoutes], { currentUser: CURRENT_USER });
});

afterAll(async () => {
  await app.close();
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe('GET /api/push/status', () => {
  test('returns current user subscription count', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/push/status' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ configured: true, subscriptionCount: 2 });

    const repo = await import('../repos/push-subscriptions.repo.js');
    expect(repo.countSubscriptionsByUserId).toHaveBeenCalledWith('user-1');
  });

  test('supports canonical /api/me/push/status alias', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/me/push/status' });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ configured: true, subscriptionCount: 2 });
  });
});

describe('POST /api/push/subscribe', () => {
  test('upserts subscription for current user', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/push/subscribe',
      headers: { 'user-agent': 'Vitest UA' },
      payload: {
        endpoint: 'https://push.example/sub-1',
        keys: { p256dh: 'p256dh-key', auth: 'auth-key' },
      },
    });

    expect(res.statusCode).toBe(201);
    expect(res.json()).toEqual({ ok: true });

    const repo = await import('../repos/push-subscriptions.repo.js');
    expect(repo.upsertSubscription).toHaveBeenCalledWith(
      'user-1',
      'https://push.example/sub-1',
      'p256dh-key',
      'auth-key',
      'Vitest UA',
    );
  });

  test('supports canonical /api/me/push/subscribe alias', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/me/push/subscribe',
      headers: { 'user-agent': 'Vitest UA' },
      payload: {
        endpoint: 'https://push.example/sub-2',
        keys: { p256dh: 'p256dh-key-2', auth: 'auth-key-2' },
      },
    });

    expect(res.statusCode).toBe(201);

    const repo = await import('../repos/push-subscriptions.repo.js');
    expect(repo.upsertSubscription).toHaveBeenCalledWith(
      'user-1',
      'https://push.example/sub-2',
      'p256dh-key-2',
      'auth-key-2',
      'Vitest UA',
    );
  });
});

describe('DELETE /api/push/subscribe', () => {
  test('removes subscription for current user', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: '/api/push/subscribe',
      payload: { endpoint: 'https://push.example/sub-1' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });

    const repo = await import('../repos/push-subscriptions.repo.js');
    expect(repo.deleteSubscriptionForUser).toHaveBeenCalledWith('user-1', 'https://push.example/sub-1');
  });

  test('supports canonical /api/me/push/subscribe alias', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: '/api/me/push/subscribe',
      payload: { endpoint: 'https://push.example/sub-2' },
    });

    expect(res.statusCode).toBe(200);

    const repo = await import('../repos/push-subscriptions.repo.js');
    expect(repo.deleteSubscriptionForUser).toHaveBeenCalledWith('user-1', 'https://push.example/sub-2');
  });
});