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

const mockSendFcmNotification = vi.fn();
const mockIsFcmConfigured = vi.fn();

vi.mock('../repos/native-push-devices.repo.js', () => ({
  countNativePushDevicesByUserId: vi.fn().mockResolvedValue(1),
  deleteNativePushDevice: vi.fn().mockResolvedValue(true),
  listNativePushDevices: vi.fn().mockResolvedValue([]),
  upsertNativePushDevice: vi.fn().mockResolvedValue({
    id: 7,
    userId: 'user-1',
    deviceId: 'device-1',
    platform: 'ios',
    provider: 'apns',
    token: 'token-1',
    appVersion: '1.0.0',
    deviceName: 'iPhone',
    timezone: 'Asia/Bangkok',
    localNotificationsEnabled: true,
    metadata: {},
    createdAt: '2026-06-14T00:00:00.000Z',
    updatedAt: '2026-06-14T00:00:00.000Z',
    lastSeenAt: '2026-06-14T00:00:00.000Z',
  }),
}));

vi.mock('../lib/native-push.js', () => ({
  isFcmConfigured: mockIsFcmConfigured,
  sendFcmNotification: mockSendFcmNotification,
}));

vi.mock('../repos/notification-channels.repo.js', () => ({
  saveNotificationChannelConfig: vi.fn().mockResolvedValue({ channelType: 'native_push' }),
}));

vi.mock('../repos/match-alert-rules.repo.js', () => ({
  getLocalMatchStartAlertSchedule: vi.fn().mockResolvedValue([
    {
      ruleId: 10,
      matchId: '100',
      homeTeam: 'Home',
      awayTeam: 'Away',
      league: 'League',
      kickoffAtUtc: '2026-06-14T12:00:00.000Z',
      kickoffLeadMinutes: 5,
      fireAtUtc: '2026-06-14T11:55:00.000Z',
      source: 'manual',
    },
  ]),
}));

vi.mock('../lib/subscription-access.js', () => ({
  resolveSubscriptionAccess: vi.fn().mockResolvedValue({
    subscription: null,
    plan: { plan_code: 'pro', display_name: 'Pro', entitlements: {} },
    effectiveStatus: 'active',
    entitlements: {
      'notifications.channels.allowed_types': ['web_push', 'native_push'],
      'notifications.channels.max_active': 2,
    },
  }),
  assertNotificationChannelAllowed: vi.fn().mockResolvedValue(undefined),
  sendEntitlementError: vi.fn().mockReturnValue(null),
}));

let app: FastifyInstance;

beforeAll(async () => {
  const { nativePushRoutes } = await import('../routes/native-push.routes.js');
  app = await buildApp([nativePushRoutes], { currentUser: CURRENT_USER });
});

afterAll(async () => {
  await app.close();
});

beforeEach(() => {
  vi.clearAllMocks();
  mockIsFcmConfigured.mockReturnValue(true);
  mockSendFcmNotification.mockResolvedValue({ ok: true });
});

describe('native push routes', () => {
  test('registers a native device token and enables the channel', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/me/native-push/devices',
      payload: {
        deviceId: 'device-1',
        platform: 'ios',
        provider: 'apns',
        token: 'token-1',
        appVersion: '1.0.0',
        deviceName: 'iPhone',
        timezone: 'Asia/Bangkok',
        localNotificationsEnabled: true,
      },
    });

    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ deviceId: 'device-1', provider: 'apns' });

    const devices = await import('../repos/native-push-devices.repo.js');
    const channels = await import('../repos/notification-channels.repo.js');
    expect(devices.upsertNativePushDevice).toHaveBeenCalledWith('user-1', expect.objectContaining({
      deviceId: 'device-1',
      platform: 'ios',
      provider: 'apns',
      token: 'token-1',
      localNotificationsEnabled: true,
    }));
    expect(channels.saveNotificationChannelConfig).toHaveBeenCalledWith('user-1', 'native_push', expect.objectContaining({
      enabled: true,
    }));
  });

  test('rejects malformed native device payloads', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/me/native-push/devices',
      payload: { deviceId: 'device-1', platform: 'ios' },
    });

    expect(res.statusCode).toBe(400);
  });

  test('returns local match-start alerts for device scheduling', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/me/native-push/local-match-start-alerts?lookaheadHours=24',
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      lookaheadHours: 24,
      alerts: [{ matchId: '100', fireAtUtc: '2026-06-14T11:55:00.000Z' }],
    });
  });

  test('sends a native push smoke test to registered FCM devices', async () => {
    const devices = await import('../repos/native-push-devices.repo.js');
    vi.mocked(devices.listNativePushDevices).mockResolvedValueOnce([
      {
        id: 1,
        userId: 'user-1',
        deviceId: 'device-1',
        platform: 'ios',
        provider: 'fcm',
        token: 'fcm-token',
        appVersion: '1.0.0',
        deviceName: 'iPhone',
        timezone: 'Asia/Bangkok',
        localNotificationsEnabled: true,
        metadata: {},
        createdAt: '2026-06-14T00:00:00.000Z',
        updatedAt: '2026-06-14T00:00:00.000Z',
        lastSeenAt: '2026-06-14T00:00:00.000Z',
      },
    ]);

    const res = await app.inject({
      method: 'POST',
      url: '/api/me/native-push/test',
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ attempted: 1, delivered: 1, failed: 0 });
    expect(mockSendFcmNotification).toHaveBeenCalledWith('fcm-token', expect.objectContaining({
      data: expect.objectContaining({
        channelType: 'native_push',
        type: 'native_push_test',
      }),
    }));
  });

  test('does not send native push smoke test when FCM is not configured', async () => {
    mockIsFcmConfigured.mockReturnValueOnce(false);

    const res = await app.inject({
      method: 'POST',
      url: '/api/me/native-push/test',
    });

    expect(res.statusCode).toBe(503);
    expect(mockSendFcmNotification).not.toHaveBeenCalled();
  });
});
