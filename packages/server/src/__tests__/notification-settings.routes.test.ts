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
  getNotificationSettings: vi.fn(),
  saveNotificationSettings: vi.fn(),
}));

vi.mock('../repos/settings.repo.js', () => ({
  getSettings: vi.fn(),
}));

let app: FastifyInstance;

beforeAll(async () => {
  const { notificationSettingsRoutes } = await import('../routes/notification-settings.routes.js');
  app = await buildApp([notificationSettingsRoutes], { currentUser: CURRENT_USER });
});

afterAll(async () => {
  await app.close();
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe('GET /api/notification-settings', () => {
  test('bootstraps dedicated notification settings from user legacy settings when row is missing', async () => {
    const notificationRepo = await import('../repos/notification-settings.repo.js');
    const settingsRepo = await import('../repos/settings.repo.js');
    vi.mocked(notificationRepo.getNotificationSettings).mockResolvedValueOnce(null);
    vi.mocked(settingsRepo.getSettings).mockResolvedValueOnce({
      WEB_PUSH_ENABLED: true,
      TELEGRAM_ENABLED: false,
      NOTIFICATION_LANGUAGE: 'en',
      MIN_CONFIDENCE: 7,
      MIN_ODDS: 1.8,
    });
    vi.mocked(notificationRepo.saveNotificationSettings).mockResolvedValueOnce({
      webPushEnabled: true,
      telegramEnabled: false,
      notificationLanguage: 'en',
      minimumConfidence: 7,
      minimumOdds: 1.8,
      quietHours: {},
      channelPolicy: {},
    });

    const res = await app.inject({ method: 'GET', url: '/api/notification-settings' });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      webPushEnabled: true,
      telegramEnabled: false,
      notificationLanguage: 'en',
      minimumConfidence: 7,
      minimumOdds: 1.8,
      quietHours: {},
      channelPolicy: {},
    });
    expect(settingsRepo.getSettings).toHaveBeenCalledWith('user-1', { fallbackToDefault: false });
    expect(notificationRepo.saveNotificationSettings).toHaveBeenCalledWith('user-1', {
      webPushEnabled: true,
      telegramEnabled: false,
      notificationLanguage: 'en',
      minimumConfidence: 7,
      minimumOdds: 1.8,
      quietHours: {},
      channelPolicy: {},
    });
  });

  test('uses dedicated defaults when user legacy settings are absent', async () => {
    const notificationRepo = await import('../repos/notification-settings.repo.js');
    const settingsRepo = await import('../repos/settings.repo.js');
    vi.mocked(notificationRepo.getNotificationSettings).mockResolvedValueOnce(null);
    vi.mocked(settingsRepo.getSettings).mockResolvedValueOnce({ TELEGRAM_CHAT_ID: 'system-only' });
    vi.mocked(notificationRepo.saveNotificationSettings).mockResolvedValueOnce({
      webPushEnabled: false,
      telegramEnabled: false,
      notificationLanguage: 'vi',
      minimumConfidence: null,
      minimumOdds: null,
      quietHours: {},
      channelPolicy: {},
    });

    const res = await app.inject({ method: 'GET', url: '/api/me/notification-settings' });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      webPushEnabled: false,
      telegramEnabled: false,
      notificationLanguage: 'vi',
      minimumConfidence: null,
      minimumOdds: null,
      quietHours: {},
      channelPolicy: {},
    });
    expect(notificationRepo.saveNotificationSettings).toHaveBeenCalledWith('user-1', {
      webPushEnabled: false,
      telegramEnabled: false,
      notificationLanguage: 'vi',
      minimumConfidence: null,
      minimumOdds: null,
      quietHours: {},
      channelPolicy: {},
    });
  });

  test('loads notification settings through the design-aligned /api/me/notification-settings alias', async () => {
    const notificationRepo = await import('../repos/notification-settings.repo.js');
    vi.mocked(notificationRepo.getNotificationSettings).mockResolvedValueOnce({
      webPushEnabled: false,
      telegramEnabled: true,
      notificationLanguage: 'vi',
      minimumConfidence: null,
      minimumOdds: null,
      quietHours: {},
      channelPolicy: {},
    });

    const res = await app.inject({ method: 'GET', url: '/api/me/notification-settings' });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      webPushEnabled: false,
      telegramEnabled: true,
      notificationLanguage: 'vi',
      minimumConfidence: null,
      minimumOdds: null,
      quietHours: {},
      channelPolicy: {},
    });
  });
});

describe('PUT /api/notification-settings', () => {
  test('merges and saves notification settings for current user', async () => {
    const notificationRepo = await import('../repos/notification-settings.repo.js');
    const settingsRepo = await import('../repos/settings.repo.js');
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
      telegramEnabled: true,
      notificationLanguage: 'both',
      minimumConfidence: null,
      minimumOdds: null,
      quietHours: {},
      channelPolicy: { telegram: 'instant' },
    });

    const res = await app.inject({
      method: 'PUT',
      url: '/api/notification-settings',
      payload: {
        webPushEnabled: true,
        notificationLanguage: 'both',
        channelPolicy: { telegram: 'instant' },
      },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().notificationLanguage).toBe('both');
    expect(notificationRepo.saveNotificationSettings).toHaveBeenCalledWith('user-1', {
      webPushEnabled: true,
      telegramEnabled: true,
      notificationLanguage: 'both',
      minimumConfidence: null,
      minimumOdds: null,
      quietHours: {},
      channelPolicy: { telegram: 'instant' },
    });
    expect(settingsRepo.getSettings).not.toHaveBeenCalled();
  });

  test('saves notification settings through the design-aligned /api/me/notification-settings alias', async () => {
    const notificationRepo = await import('../repos/notification-settings.repo.js');
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
      webPushEnabled: false,
      telegramEnabled: false,
      notificationLanguage: 'vi',
      minimumConfidence: null,
      minimumOdds: null,
      quietHours: {},
      channelPolicy: {},
    });

    const res = await app.inject({
      method: 'PUT',
      url: '/api/me/notification-settings',
      payload: {
        telegramEnabled: false,
      },
    });

    expect(res.statusCode).toBe(200);
    expect(notificationRepo.saveNotificationSettings).toHaveBeenCalledWith('user-1', {
      webPushEnabled: false,
      telegramEnabled: false,
      notificationLanguage: 'vi',
      minimumConfidence: null,
      minimumOdds: null,
      quietHours: {},
      channelPolicy: {},
    });
  });
});