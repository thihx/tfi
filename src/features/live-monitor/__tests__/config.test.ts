// ============================================================
// Config Service Tests
// ============================================================

import { beforeEach, describe, expect, test, vi } from 'vitest';

vi.mock('@/lib/services/notification-settings', () => ({
  fetchNotificationSettings: vi.fn(),
  persistNotificationSettings: vi.fn(),
}));

import {
  createDefaultConfig,
  fetchMonitorConfig,
  loadMonitorConfig,
  persistMonitorConfig,
  saveMonitorConfig,
} from '../config';
import {
  fetchNotificationSettings,
  persistNotificationSettings,
} from '@/lib/services/notification-settings';

describe('createDefaultConfig', () => {
  test('returns all required fields with defaults', () => {
    const config = createDefaultConfig();

    expect(config.TIMEZONE).toBe('Asia/Seoul');
    expect(config.MIN_CONFIDENCE).toBe(5);
    expect(config.MIN_ODDS).toBe(1.5);
    expect(config.LATE_PHASE_MINUTE).toBe(75);
    expect(config.VERY_LATE_PHASE_MINUTE).toBe(85);
    expect(config.ENDGAME_MINUTE).toBe(88);
    expect(config.AI_PROVIDER).toBe('gemini');
    expect(config.AI_MODEL).toBe('gemini-3-pro-preview');
    expect(config.MANUAL_PUSH_MATCH_IDS).toEqual([]);
  });

  test('applies overrides to defaults', () => {
    const config = createDefaultConfig({
      AI_PROVIDER: 'claude',
      AI_MODEL: 'claude-sonnet-4-20250514',
      MIN_CONFIDENCE: 7,
    });

    expect(config.AI_PROVIDER).toBe('claude');
    expect(config.AI_MODEL).toBe('claude-sonnet-4-20250514');
    expect(config.MIN_CONFIDENCE).toBe(7);
    // Other defaults preserved
    expect(config.TIMEZONE).toBe('Asia/Seoul');
  });
});

describe('loadMonitorConfig', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  test('returns default config when localStorage is empty', () => {
    const config = loadMonitorConfig();
    expect(config.AI_PROVIDER).toBe('gemini');
    expect(config.TIMEZONE).toBe('Asia/Seoul');
  });

  test('merges localStorage config with defaults', () => {
    localStorage.setItem(
      'liveMonitorConfig',
      JSON.stringify({ AI_PROVIDER: 'claude', MIN_CONFIDENCE: 8 }),
    );
    const config = loadMonitorConfig();
    expect(config.AI_PROVIDER).toBe('claude');
    expect(config.MIN_CONFIDENCE).toBe(8);
    expect(config.TIMEZONE).toBe('Asia/Seoul');
  });

  test('applies runtime overrides on top of localStorage', () => {
    localStorage.setItem(
      'liveMonitorConfig',
      JSON.stringify({ AI_PROVIDER: 'claude' }),
    );
    const config = loadMonitorConfig({ AI_PROVIDER: 'gemini', MIN_ODDS: 2.0 });
    expect(config.AI_PROVIDER).toBe('gemini');
    expect(config.MIN_ODDS).toBe(2.0);
  });

  test('handles corrupted localStorage gracefully', () => {
    localStorage.setItem('liveMonitorConfig', 'not-json');
    const config = loadMonitorConfig();
    expect(config.AI_PROVIDER).toBe('gemini');
  });
});

describe('saveMonitorConfig', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  test('saves config to localStorage', () => {
    const config = createDefaultConfig({ AI_PROVIDER: 'claude' });
    saveMonitorConfig(config);

    const saved = JSON.parse(localStorage.getItem('liveMonitorConfig')!);
    expect(saved.AI_PROVIDER).toBe('claude');
  });

  test('saved config can be loaded back', () => {
    const original = createDefaultConfig({ MIN_CONFIDENCE: 8, AI_MODEL: 'test-model' });
    saveMonitorConfig(original);
    const loaded = loadMonitorConfig();

    expect(loaded.MIN_CONFIDENCE).toBe(8);
    expect(loaded.AI_MODEL).toBe('test-model');
  });

  test('dispatches a settings updated event when cache changes', () => {
    const onSettingsUpdated = vi.fn();
    window.addEventListener('tfi:settings-updated', onSettingsUpdated as EventListener);

    try {
      saveMonitorConfig({ UI_LANGUAGE: 'en' });

      expect(onSettingsUpdated).toHaveBeenCalledTimes(1);
    } finally {
      window.removeEventListener('tfi:settings-updated', onSettingsUpdated as EventListener);
    }
  });
});

describe('fetchMonitorConfig', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  test('merges notification settings into cached config', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({ UI_LANGUAGE: 'en', AUTO_APPLY_RECOMMENDED_CONDITION: false }),
    }));
    vi.mocked(fetchNotificationSettings).mockResolvedValueOnce({
      webPushEnabled: true,
      telegramEnabled: false,
      notificationLanguage: 'both',
      minimumConfidence: null,
      minimumOdds: null,
      quietHours: {},
      channelPolicy: {},
    });

    const config = await fetchMonitorConfig();

    expect(config.UI_LANGUAGE).toBe('en');
    expect(config.AUTO_APPLY_RECOMMENDED_CONDITION).toBe(false);
    expect(config.WEB_PUSH_ENABLED).toBe(true);
    expect(config.TELEGRAM_ENABLED).toBe(false);
    expect(config.NOTIFICATION_LANGUAGE).toBe('both');
  });
});

describe('persistMonitorConfig', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  test('splits notification keys into dedicated route persistence', async () => {
    saveMonitorConfig(createDefaultConfig());
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({ UI_LANGUAGE: 'en' }),
    }));
    vi.mocked(persistNotificationSettings).mockResolvedValueOnce({
      webPushEnabled: false,
      telegramEnabled: false,
      notificationLanguage: 'en',
      minimumConfidence: null,
      minimumOdds: null,
      quietHours: {},
      channelPolicy: {},
    });

    await persistMonitorConfig({ UI_LANGUAGE: 'en', TELEGRAM_ENABLED: false, NOTIFICATION_LANGUAGE: 'en' });

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(vi.mocked(fetch).mock.calls[0]?.[0]).toContain('/api/me/settings');
    expect(persistNotificationSettings).toHaveBeenCalledWith({
      telegramEnabled: false,
      notificationLanguage: 'en',
    });

    const cached = loadMonitorConfig();
    expect(cached.UI_LANGUAGE).toBe('en');
    expect(cached.TELEGRAM_ENABLED).toBe(false);
    expect(cached.NOTIFICATION_LANGUAGE).toBe('en');
  });

  test('dispatches a single settings updated event after persistence', async () => {
    saveMonitorConfig(createDefaultConfig());
    const onSettingsUpdated = vi.fn();
    window.addEventListener('tfi:settings-updated', onSettingsUpdated as EventListener);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({ UI_LANGUAGE: 'en' }),
    }));

    try {
      await persistMonitorConfig({ UI_LANGUAGE: 'en' });

      expect(onSettingsUpdated).toHaveBeenCalledTimes(1);
    } finally {
      window.removeEventListener('tfi:settings-updated', onSettingsUpdated as EventListener);
    }
  });
});
