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

const ADMIN_USER = {
  userId: 'admin-1',
  email: 'admin@example.com',
  role: 'admin' as const,
  status: 'active' as const,
  displayName: 'Admin',
  avatarUrl: '',
};

vi.mock('../repos/settings.repo.js', () => ({
  getSettings: vi.fn().mockResolvedValue({ AUTO_APPLY_RECOMMENDED_CONDITION: true }),
  saveSettings: vi.fn().mockResolvedValue({
    user_id: 'user-1',
    settings: { AUTO_APPLY_RECOMMENDED_CONDITION: false },
    updated_at: '2026-03-24T00:00:00.000Z',
  }),
}));

vi.mock('../repos/notification-settings.repo.js', () => ({
  DEFAULT_NOTIFICATION_SETTINGS: {
    webPushEnabled: false,
    telegramEnabled: false,
    notificationLanguage: 'vi',
    minimumConfidence: null,
    minimumOdds: null,
    quietHours: {},
    channelPolicy: {},
  },
  getNotificationSettings: vi.fn().mockResolvedValue({
    webPushEnabled: false,
    telegramEnabled: false,
    notificationLanguage: 'vi',
    minimumConfidence: null,
    minimumOdds: null,
    quietHours: {},
    channelPolicy: {},
  }),
  saveNotificationSettings: vi.fn().mockResolvedValue({
    webPushEnabled: false,
    telegramEnabled: false,
    notificationLanguage: 'vi',
    minimumConfidence: null,
    minimumOdds: null,
    quietHours: {},
    channelPolicy: {},
  }),
}));

let app: FastifyInstance;
let adminApp: FastifyInstance;

beforeAll(async () => {
  const { settingsRoutes } = await import('../routes/settings.routes.js');
  app = await buildApp([settingsRoutes], { currentUser: CURRENT_USER });
  adminApp = await buildApp([settingsRoutes], { currentUser: ADMIN_USER });
});

afterAll(async () => {
  await app.close();
  await adminApp.close();
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe('GET /api/settings', () => {
  test('loads only user-safe settings for current user without default-row fallback', async () => {
    const repo = await import('../repos/settings.repo.js');
    vi.mocked(repo.getSettings).mockResolvedValueOnce({
      UI_LANGUAGE: 'en',
      AUTO_APPLY_RECOMMENDED_CONDITION: false,
      USER_TIMEZONE: 'Europe/London',
      USER_TIMEZONE_CONFIRMED: true,
      TELEGRAM_CHAT_ID: 'secret-chat-id',
    });

    const res = await app.inject({ method: 'GET', url: '/api/settings' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      UI_LANGUAGE: 'en',
      AUTO_APPLY_RECOMMENDED_CONDITION: false,
      USER_TIMEZONE: 'Europe/London',
      USER_TIMEZONE_CONFIRMED: true,
      TELEGRAM_ENABLED: false,
      WEB_PUSH_ENABLED: false,
      NOTIFICATION_LANGUAGE: 'vi',
    });

    expect(repo.getSettings).toHaveBeenCalledWith('user-1', { fallbackToDefault: false });
  });

  test('loads settings through the design-aligned /api/me/settings alias', async () => {
    const repo = await import('../repos/settings.repo.js');
    vi.mocked(repo.getSettings).mockResolvedValueOnce({});

    const res = await app.inject({ method: 'GET', url: '/api/me/settings' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      UI_LANGUAGE: 'vi',
      AUTO_APPLY_RECOMMENDED_CONDITION: true,
      USER_TIMEZONE: null,
      USER_TIMEZONE_CONFIRMED: false,
      TELEGRAM_ENABLED: false,
      WEB_PUSH_ENABLED: false,
      NOTIFICATION_LANGUAGE: 'vi',
    });

    expect(repo.getSettings).toHaveBeenCalledWith('user-1', { fallbackToDefault: false });
  });
});

describe('PUT /api/settings', () => {
  test('merges and saves settings for current user', async () => {
    const repo = await import('../repos/settings.repo.js');
    vi.mocked(repo.getSettings).mockResolvedValueOnce({
      TELEGRAM_CHAT_ID: 'secret-chat-id',
      UI_LANGUAGE: 'vi',
      AUTO_APPLY_RECOMMENDED_CONDITION: true,
      USER_TIMEZONE: 'Asia/Ho_Chi_Minh',
      USER_TIMEZONE_CONFIRMED: false,
    });

    const res = await app.inject({
      method: 'PUT',
      url: '/api/settings',
      payload: { AUTO_APPLY_RECOMMENDED_CONDITION: false, USER_TIMEZONE_CONFIRMED: true, MIN_CONFIDENCE: 7 },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      UI_LANGUAGE: 'vi',
      AUTO_APPLY_RECOMMENDED_CONDITION: false,
      USER_TIMEZONE: 'Asia/Ho_Chi_Minh',
      USER_TIMEZONE_CONFIRMED: true,
      TELEGRAM_ENABLED: false,
      WEB_PUSH_ENABLED: false,
      NOTIFICATION_LANGUAGE: 'vi',
    });

    expect(repo.getSettings).toHaveBeenCalledWith('user-1', { fallbackToDefault: false });
    expect(repo.saveSettings).toHaveBeenCalledWith(
      {
        TELEGRAM_CHAT_ID: 'secret-chat-id',
        UI_LANGUAGE: 'vi',
        AUTO_APPLY_RECOMMENDED_CONDITION: false,
        USER_TIMEZONE: 'Asia/Ho_Chi_Minh',
        USER_TIMEZONE_CONFIRMED: true,
      },
      'user-1',
    );
  });

  test('saves settings through the design-aligned /api/me/settings alias', async () => {
    const repo = await import('../repos/settings.repo.js');
    vi.mocked(repo.getSettings).mockResolvedValueOnce({ UI_LANGUAGE: 'vi' });

    const res = await app.inject({
      method: 'PUT',
      url: '/api/me/settings',
      payload: { MIN_CONFIDENCE: 8 },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      UI_LANGUAGE: 'vi',
      AUTO_APPLY_RECOMMENDED_CONDITION: true,
      USER_TIMEZONE: null,
      USER_TIMEZONE_CONFIRMED: false,
      TELEGRAM_ENABLED: false,
      WEB_PUSH_ENABLED: false,
      NOTIFICATION_LANGUAGE: 'vi',
    });

    expect(repo.saveSettings).toHaveBeenCalledWith(
      { UI_LANGUAGE: 'vi' },
      'user-1',
    );
  });

  test('accepts and normalizes timezone settings for current user', async () => {
    const repo = await import('../repos/settings.repo.js');
    vi.mocked(repo.getSettings).mockResolvedValueOnce({ UI_LANGUAGE: 'vi' });

    const res = await app.inject({
      method: 'PUT',
      url: '/api/me/settings',
      payload: { USER_TIMEZONE: 'America/New_York', USER_TIMEZONE_CONFIRMED: true },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      UI_LANGUAGE: 'vi',
      AUTO_APPLY_RECOMMENDED_CONDITION: true,
      USER_TIMEZONE: 'America/New_York',
      USER_TIMEZONE_CONFIRMED: true,
      TELEGRAM_ENABLED: false,
      WEB_PUSH_ENABLED: false,
      NOTIFICATION_LANGUAGE: 'vi',
    });
    expect(repo.saveSettings).toHaveBeenCalledWith(
      { UI_LANGUAGE: 'vi', USER_TIMEZONE: 'America/New_York', USER_TIMEZONE_CONFIRMED: true },
      'user-1',
    );
  });

  test('saves notification personalization through the unified /api/me/settings endpoint', async () => {
    const repo = await import('../repos/settings.repo.js');
    const notificationRepo = await import('../repos/notification-settings.repo.js');
    vi.mocked(repo.getSettings).mockResolvedValueOnce({ UI_LANGUAGE: 'vi' });
    vi.mocked(notificationRepo.getNotificationSettings).mockResolvedValueOnce({
      webPushEnabled: false,
      telegramEnabled: true,
      notificationLanguage: 'vi',
      minimumConfidence: null,
      minimumOdds: null,
      quietHours: {},
      channelPolicy: {},
    });
    vi.mocked(notificationRepo.saveNotificationSettings).mockResolvedValueOnce({
      webPushEnabled: true,
      telegramEnabled: false,
      notificationLanguage: 'both',
      minimumConfidence: null,
      minimumOdds: null,
      quietHours: {},
      channelPolicy: {},
    });

    const res = await app.inject({
      method: 'PUT',
      url: '/api/me/settings',
      payload: { TELEGRAM_ENABLED: false, WEB_PUSH_ENABLED: true, NOTIFICATION_LANGUAGE: 'both' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      UI_LANGUAGE: 'vi',
      AUTO_APPLY_RECOMMENDED_CONDITION: true,
      USER_TIMEZONE: null,
      USER_TIMEZONE_CONFIRMED: false,
      TELEGRAM_ENABLED: false,
      WEB_PUSH_ENABLED: true,
      NOTIFICATION_LANGUAGE: 'both',
    });
    expect(notificationRepo.saveNotificationSettings).toHaveBeenCalledWith('user-1', {
      webPushEnabled: true,
      telegramEnabled: false,
      notificationLanguage: 'both',
      minimumConfidence: null,
      minimumOdds: null,
      quietHours: {},
      channelPolicy: {},
    });
  });
});

describe('system settings routes', () => {
  test('forbids system settings for non-admin users', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/settings/system' });
    expect(res.statusCode).toBe(403);
  });

  test('loads system settings for admin users', async () => {
    const repo = await import('../repos/settings.repo.js');
    vi.mocked(repo.getSettings).mockResolvedValueOnce({ TELEGRAM_CHAT_ID: '123456' });

    const res = await adminApp.inject({ method: 'GET', url: '/api/settings/system' });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ TELEGRAM_CHAT_ID: '123456' });
    expect(repo.getSettings).toHaveBeenCalledWith('default', { fallbackToDefault: false });
  });

  test('merges and saves system settings for admin users', async () => {
    const repo = await import('../repos/settings.repo.js');
    vi.mocked(repo.getSettings).mockResolvedValueOnce({ TELEGRAM_ENABLED: true });

    const res = await adminApp.inject({
      method: 'PUT',
      url: '/api/settings/system',
      payload: { TELEGRAM_CHAT_ID: '999999' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ TELEGRAM_ENABLED: true, TELEGRAM_CHAT_ID: '999999' });
    expect(repo.saveSettings).toHaveBeenCalledWith({ TELEGRAM_ENABLED: true, TELEGRAM_CHAT_ID: '999999' }, 'default');
  });
});