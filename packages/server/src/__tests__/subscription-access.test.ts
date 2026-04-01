import { beforeEach, describe, expect, test, vi } from 'vitest';

vi.mock('../repos/entitlement-usage.repo.js', () => ({
  consumeUsageIfAvailable: vi.fn(),
  getUsageCounter: vi.fn().mockResolvedValue(null),
}));

vi.mock('../repos/notification-channels.repo.js', () => ({
  getNotificationChannelConfigs: vi.fn(),
}));

vi.mock('../repos/subscriptions.repo.js', () => ({
  getCurrentUserSubscription: vi.fn(),
  getSubscriptionPlan: vi.fn(),
}));

vi.mock('../repos/watchlist.repo.js', () => ({
  countActiveWatchSubscriptionsByUser: vi.fn(),
}));

import {
  assertNotificationChannelAllowed,
  assertWatchlistCapacityAvailable,
  consumeManualAiQuota,
  sendEntitlementError,
  type SubscriptionAccessSnapshot,
} from '../lib/subscription-access.js';

function buildSnapshot(entitlements: Record<string, unknown>): SubscriptionAccessSnapshot {
  return {
    subscription: null,
    plan: {
      plan_code: 'free',
      display_name: 'Free',
      description: 'Free tier',
      billing_interval: 'manual',
      price_amount: '0.00',
      currency: 'USD',
      active: true,
      public: true,
      display_order: 0,
      entitlements,
      metadata: {},
      created_at: '2026-03-31T00:00:00.000Z',
      updated_at: '2026-03-31T00:00:00.000Z',
    },
    effectiveStatus: 'free_fallback',
    entitlements,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('subscription access error messaging', () => {
  test('returns a clear daily quota message for Manual Ask AI', async () => {
    const usageRepo = await import('../repos/entitlement-usage.repo.js');
    vi.mocked(usageRepo.consumeUsageIfAvailable).mockResolvedValueOnce({
      allowed: false,
      usedCount: 3,
    } as never);

    const error = await consumeManualAiQuota(
      buildSnapshot({
        'ai.manual.ask.enabled': true,
        'ai.manual.ask.daily_limit': 3,
      }),
      'user-1',
      { source: 'test' },
    ).catch((err) => err);

    const entitlement = sendEntitlementError(error);
    expect(entitlement?.statusCode).toBe(429);
    expect(entitlement?.payload.error).toContain('used 3/3 Manual Ask AI requests today on the Free plan');
    expect(entitlement?.payload.error).toContain('Try again tomorrow or upgrade your subscription');
  });

  test('returns a clear active watchlist limit message', async () => {
    const watchlistRepo = await import('../repos/watchlist.repo.js');
    vi.mocked(watchlistRepo.countActiveWatchSubscriptionsByUser).mockResolvedValueOnce(15);

    const error = await assertWatchlistCapacityAvailable(
      buildSnapshot({
        'watchlist.active_matches.limit': 5,
      }),
      'user-1',
    ).catch((err) => err);

    const entitlement = sendEntitlementError(error);
    expect(entitlement?.statusCode).toBe(403);
    expect(entitlement?.payload.error).toContain('active watchlist limit on the Free plan');
    expect(entitlement?.payload.error).toContain('(15/5 used)');
    expect(entitlement?.payload.error).toContain('Remove a watched match or upgrade your subscription');
  });

  test('returns a clear notification channel not-allowed message', async () => {
    const error = await assertNotificationChannelAllowed(
      buildSnapshot({
        'notifications.channels.allowed_types': ['web_push'],
        'notifications.channels.max_active': 1,
      }),
      'user-1',
      'telegram',
      true,
    ).catch((err) => err);

    const entitlement = sendEntitlementError(error);
    expect(entitlement?.statusCode).toBe(403);
    expect(entitlement?.payload.error).toContain('telegram notifications are not included in the Free plan');
    expect(entitlement?.payload.error).toContain('Upgrade your subscription to enable this channel');
  });

  test('returns a clear notification channel capacity message', async () => {
    const notificationRepo = await import('../repos/notification-channels.repo.js');
    vi.mocked(notificationRepo.getNotificationChannelConfigs).mockResolvedValueOnce([
      { channelType: 'web_push', enabled: true },
    ] as never);

    const error = await assertNotificationChannelAllowed(
      buildSnapshot({
        'notifications.channels.allowed_types': ['web_push', 'telegram'],
        'notifications.channels.max_active': 1,
      }),
      'user-1',
      'telegram',
      true,
    ).catch((err) => err);

    const entitlement = sendEntitlementError(error);
    expect(entitlement?.statusCode).toBe(403);
    expect(entitlement?.payload.error).toContain('already enabled 1/1 notification channels on the Free plan');
    expect(entitlement?.payload.error).toContain('Disable one or upgrade your subscription');
  });
});
