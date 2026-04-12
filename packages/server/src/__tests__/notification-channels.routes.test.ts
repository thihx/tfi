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
    telegramBotToken: 'test-token',
    telegramBotUsername: 'env_bot',
    telegramWebhookSecret: 'whsec',
  },
}));

vi.mock('../lib/telegram-link-flow.js', () => ({
  processTelegramDeepLinkStart: vi.fn().mockResolvedValue({ respond: true, userMessage: 'ok' }),
  replyTelegramUser: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../repos/telegram-link-tokens.repo.js', () => ({
  createTelegramLinkOffer: vi.fn().mockResolvedValue({
    token: 'deadbeef',
    expiresAt: new Date('2030-01-01T00:00:00.000Z'),
  }),
}));

vi.mock('../lib/telegram-bot-username.js', () => ({
  resolveTelegramBotUsername: vi.fn().mockResolvedValue('tfi_test_bot'),
}));

vi.mock('../repos/notification-channels.repo.js', () => ({
  SUPPORTED_NOTIFICATION_CHANNELS: ['telegram', 'zalo', 'web_push', 'email'],
  getNotificationChannelConfigs: vi.fn().mockResolvedValue([
    {
      channelType: 'telegram',
      enabled: true,
      status: 'pending',
      address: '123456',
      config: {},
      metadata: { senderImplemented: true },
    },
    {
      channelType: 'zalo',
      enabled: false,
      status: 'draft',
      address: null,
      config: {},
      metadata: { senderImplemented: false },
    },
    {
      channelType: 'web_push',
      enabled: false,
      status: 'draft',
      address: null,
      config: {},
      metadata: { senderImplemented: true },
    },
    {
      channelType: 'email',
      enabled: false,
      status: 'draft',
      address: null,
      config: {},
      metadata: { senderImplemented: false },
    },
  ]),
  saveNotificationChannelConfig: vi.fn().mockResolvedValue({
    channelType: 'email',
    enabled: true,
    status: 'pending',
    address: 'user@example.com',
    config: { format: 'html' },
    metadata: { senderImplemented: false },
  }),
}));

vi.mock('../lib/subscription-access.js', () => ({
  resolveSubscriptionAccess: vi.fn().mockResolvedValue({
    subscription: null,
    plan: { plan_code: 'free', display_name: 'Free', entitlements: {} },
    effectiveStatus: 'free_fallback',
    entitlements: {
      'notifications.channels.allowed_types': ['web_push', 'telegram'],
      'notifications.channels.max_active': 2,
    },
  }),
  assertNotificationChannelAllowed: vi.fn().mockResolvedValue(undefined),
  sendEntitlementError: vi.fn().mockImplementation((error: unknown) => (
    error instanceof Error && error.message === 'channel-limit'
      ? { statusCode: 403, payload: { error: 'Notification channel is not available on your current plan.' } }
      : null
  )),
}));

let app: FastifyInstance;
let webhookApp: FastifyInstance;

beforeAll(async () => {
  const { notificationChannelsRoutes } = await import('../routes/notification-channels.routes.js');
  const { telegramWebhookRoutes } = await import('../routes/telegram-webhook.routes.js');
  app = await buildApp([notificationChannelsRoutes], { currentUser: CURRENT_USER });
  webhookApp = await buildApp([telegramWebhookRoutes]);
});

afterAll(async () => {
  await app.close();
  await webhookApp.close();
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe('GET /api/notification-channels', () => {
  test('returns supported channel configs for current user', async () => {
    const repo = await import('../repos/notification-channels.repo.js');
    const res = await app.inject({ method: 'GET', url: '/api/notification-channels' });

    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.json())).toBe(true);
    expect(repo.getNotificationChannelConfigs).toHaveBeenCalledWith('user-1');
  });

  test('supports canonical /api/me/notification-channels alias', async () => {
    const repo = await import('../repos/notification-channels.repo.js');
    const res = await app.inject({ method: 'GET', url: '/api/me/notification-channels' });

    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.json())).toBe(true);
    expect(repo.getNotificationChannelConfigs).toHaveBeenCalledWith('user-1');
  });
});

describe('POST /api/telegram/webhook', () => {
  test('rejects when secret token header does not match', async () => {
    const linkFlow = await import('../lib/telegram-link-flow.js');
    const res = await webhookApp.inject({
      method: 'POST',
      url: '/api/telegram/webhook',
      headers: { 'x-telegram-bot-api-secret-token': 'wrong' },
      payload: { message: { chat: { id: 1 }, text: '/start abc' } },
    });
    expect(res.statusCode).toBe(401);
    expect(linkFlow.processTelegramDeepLinkStart).not.toHaveBeenCalled();
  });

  test('runs link flow for /start with payload', async () => {
    const linkFlow = await import('../lib/telegram-link-flow.js');
    const res = await webhookApp.inject({
      method: 'POST',
      url: '/api/telegram/webhook',
      headers: { 'x-telegram-bot-api-secret-token': 'whsec' },
      payload: { message: { chat: { id: 42 }, text: '/start tok123' } },
    });
    expect(res.statusCode).toBe(200);
    expect(linkFlow.processTelegramDeepLinkStart).toHaveBeenCalledWith('tok123', '42');
    expect(linkFlow.replyTelegramUser).toHaveBeenCalledWith('42', 'ok');
  });

  test('ignores non-start messages', async () => {
    const linkFlow = await import('../lib/telegram-link-flow.js');
    const res = await webhookApp.inject({
      method: 'POST',
      url: '/api/telegram/webhook',
      headers: { 'x-telegram-bot-api-secret-token': 'whsec' },
      payload: { message: { chat: { id: 1 }, text: 'hello' } },
    });
    expect(res.statusCode).toBe(200);
    expect(linkFlow.processTelegramDeepLinkStart).not.toHaveBeenCalled();
  });
});

describe('POST /api/me/notification-channels/telegram/link-offer', () => {
  test('returns a t.me deep link for the current user', async () => {
    const tokens = await import('../repos/telegram-link-tokens.repo.js');
    const res = await app.inject({ method: 'POST', url: '/api/me/notification-channels/telegram/link-offer' });

    expect(res.statusCode).toBe(200);
    const body = res.json() as { deepLinkUrl: string; expiresAt: string };
    expect(body.deepLinkUrl).toBe('https://t.me/tfi_test_bot?start=deadbeef');
    expect(body.expiresAt).toBe('2030-01-01T00:00:00.000Z');
    expect(tokens.createTelegramLinkOffer).toHaveBeenCalledWith('user-1');
  });
});

describe('PUT /api/notification-channels/:channelType', () => {
  test('updates a supported channel config for current user', async () => {
    const repo = await import('../repos/notification-channels.repo.js');
    const res = await app.inject({
      method: 'PUT',
      url: '/api/notification-channels/email',
      payload: {
        enabled: true,
        address: 'user@example.com',
        config: { format: 'html' },
      },
    });

    expect(res.statusCode).toBe(200);
    expect(repo.saveNotificationChannelConfig).toHaveBeenCalledWith('user-1', 'email', {
      enabled: true,
      address: 'user@example.com',
      config: { format: 'html' },
      metadata: undefined,
    });
  });

  test('supports canonical /api/me/notification-channels/:channelType alias', async () => {
    const repo = await import('../repos/notification-channels.repo.js');
    const res = await app.inject({
      method: 'PUT',
      url: '/api/me/notification-channels/email',
      payload: {
        enabled: true,
        address: 'user@example.com',
      },
    });

    expect(res.statusCode).toBe(200);
    expect(repo.saveNotificationChannelConfig).toHaveBeenCalledWith('user-1', 'email', {
      enabled: true,
      address: 'user@example.com',
      config: undefined,
      metadata: undefined,
    });
  });

  test('rejects unsupported channel types', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/notification-channels/sms',
      payload: { enabled: true },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'Unsupported notification channel' });
  });

  test('rejects empty updates', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/notification-channels/telegram',
      payload: {},
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'No notification channel updates provided' });
  });

  test('returns an entitlement error when the channel is not allowed on the current plan', async () => {
    const access = await import('../lib/subscription-access.js');
    vi.mocked(access.assertNotificationChannelAllowed).mockRejectedValueOnce(new Error('channel-limit'));

    const res = await app.inject({
      method: 'PUT',
      url: '/api/notification-channels/telegram',
      payload: { enabled: true, address: '123456' },
    });

    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({ error: 'Notification channel is not available on your current plan.' });
  });
});
