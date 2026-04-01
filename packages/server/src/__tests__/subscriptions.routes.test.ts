import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from './helpers.js';

const MEMBER_USER = {
  userId: 'user-1',
  email: 'user@example.com',
  role: 'member' as const,
  status: 'active' as const,
  displayName: 'User',
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

vi.mock('../lib/subscription-access.js', () => ({
  buildSubscriptionSnapshotResponse: vi.fn().mockResolvedValue({
    plan: { plan_code: 'free', display_name: 'Free' },
    subscription: null,
    effectiveStatus: 'free_fallback',
    entitlements: { 'ai.manual.ask.daily_limit': 3 },
    usage: {
      manualAiDaily: {
        entitlementKey: 'ai.manual.ask.daily_limit',
        periodKey: '2026-03-31',
        limit: 3,
        used: 1,
      },
    },
    catalog: [],
  }),
}));

vi.mock('../repos/subscriptions.repo.js', () => ({
  listSubscriptionPlans: vi.fn().mockResolvedValue([
    {
      plan_code: 'free',
      display_name: 'Free',
      description: '',
      billing_interval: 'manual',
      price_amount: '0.00',
      currency: 'USD',
      active: true,
      public: true,
      display_order: 0,
      entitlements: { 'ai.manual.ask.daily_limit': 3 },
      metadata: {},
      created_at: '2026-03-31T00:00:00.000Z',
      updated_at: '2026-03-31T00:00:00.000Z',
    },
  ]),
  updateSubscriptionPlan: vi.fn().mockImplementation(async (planCode: string) => ({
    plan_code: planCode,
    display_name: 'Free',
    description: 'Updated',
    billing_interval: 'manual',
    price_amount: '0.00',
    currency: 'USD',
    active: true,
    public: true,
    display_order: 0,
    entitlements: { 'ai.manual.ask.daily_limit': 4 },
    metadata: {},
    created_at: '2026-03-31T00:00:00.000Z',
    updated_at: '2026-03-31T00:01:00.000Z',
  })),
  listAdminUserSubscriptions: vi.fn().mockResolvedValue([
    {
      id: 'user-1',
      email: 'user@example.com',
      display_name: 'User',
      avatar_url: '',
      role: 'member',
      status: 'active',
      created_at: '2026-03-24T00:00:00.000Z',
      updated_at: '2026-03-31T00:00:00.000Z',
      subscription_plan_code: 'free',
      subscription_status: 'active',
      subscription_provider: 'manual',
      subscription_current_period_end: null,
      subscription_cancel_at_period_end: false,
      subscription_updated_at: '2026-03-31T00:00:00.000Z',
    },
  ]),
  assignUserSubscription: vi.fn().mockResolvedValue({
    id: 10,
    user_id: 'user-1',
    plan_code: 'pro',
    status: 'active',
    provider: 'manual',
    provider_customer_id: null,
    provider_subscription_id: null,
    started_at: '2026-03-31T00:00:00.000Z',
    current_period_start: '2026-03-31T00:00:00.000Z',
    current_period_end: '2026-04-30T00:00:00.000Z',
    trial_ends_at: null,
    cancel_at_period_end: false,
    metadata: {},
    created_at: '2026-03-31T00:00:00.000Z',
    updated_at: '2026-03-31T00:00:00.000Z',
  }),
}));

vi.mock('../repos/users.repo.js', () => ({
  getUserById: vi.fn().mockResolvedValue({
    id: 'user-1',
    email: 'user@example.com',
    display_name: 'User',
    avatar_url: '',
    role: 'member',
    status: 'active',
    created_at: '2026-03-24T00:00:00.000Z',
    updated_at: '2026-03-31T00:00:00.000Z',
  }),
}));

let app: FastifyInstance;
let adminApp: FastifyInstance;

beforeAll(async () => {
  const { subscriptionsRoutes } = await import('../routes/subscriptions.routes.js');
  app = await buildApp([subscriptionsRoutes], { currentUser: MEMBER_USER });
  adminApp = await buildApp([subscriptionsRoutes], { currentUser: ADMIN_USER });
});

afterAll(async () => {
  await app.close();
  await adminApp.close();
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe('GET /api/me/subscription', () => {
  test('returns current user subscription snapshot', async () => {
    const access = await import('../lib/subscription-access.js');
    const res = await app.inject({ method: 'GET', url: '/api/me/subscription' });

    expect(res.statusCode).toBe(200);
    expect(res.json().effectiveStatus).toBe('free_fallback');
    expect(access.buildSubscriptionSnapshotResponse).toHaveBeenCalledWith('user-1');
  });
});

describe('admin subscription settings', () => {
  test('forbids member users from viewing the catalog', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/settings/subscription/catalog' });
    expect(res.statusCode).toBe(403);
  });

  test('returns plan list for admin users', async () => {
    const repo = await import('../repos/subscriptions.repo.js');
    const res = await adminApp.inject({ method: 'GET', url: '/api/settings/subscription/plans' });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toHaveLength(1);
    expect(repo.listSubscriptionPlans).toHaveBeenCalled();
  });

  test('patches a subscription plan for admin users', async () => {
    const repo = await import('../repos/subscriptions.repo.js');
    const res = await adminApp.inject({
      method: 'PATCH',
      url: '/api/settings/subscription/plans/free',
      payload: {
        description: 'Updated',
        entitlements: { 'ai.manual.ask.daily_limit': 4 },
      },
    });

    expect(res.statusCode).toBe(200);
    expect(repo.updateSubscriptionPlan).toHaveBeenCalledWith('free', expect.objectContaining({
      description: 'Updated',
      entitlements: { 'ai.manual.ask.daily_limit': 4 },
    }));
  });

  test('rejects invalid entitlement payloads', async () => {
    const res = await adminApp.inject({
      method: 'PATCH',
      url: '/api/settings/subscription/plans/free',
      payload: { entitlements: ['bad'] },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'entitlements must be an object' });
  });

  test('lists user subscription assignments', async () => {
    const repo = await import('../repos/subscriptions.repo.js');
    const res = await adminApp.inject({ method: 'GET', url: '/api/settings/subscription/users' });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toHaveLength(1);
    expect(repo.listAdminUserSubscriptions).toHaveBeenCalled();
  });

  test('updates a user subscription assignment', async () => {
    const repo = await import('../repos/subscriptions.repo.js');
    const res = await adminApp.inject({
      method: 'PUT',
      url: '/api/settings/subscription/users/user-1',
      payload: {
        planCode: 'pro',
        status: 'active',
        currentPeriodEnd: '2026-04-30T00:00:00.000Z',
      },
    });

    expect(res.statusCode).toBe(200);
    expect(repo.assignUserSubscription).toHaveBeenCalledWith('user-1', expect.objectContaining({
      planCode: 'pro',
      status: 'active',
      currentPeriodEnd: '2026-04-30T00:00:00.000Z',
    }));
  });
});
