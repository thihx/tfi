// ============================================================
// Live Monitor Pipeline Config
// Equivalent to n8n "Set Config" node
// ============================================================

import type { LiveMonitorConfig } from './types';
import { getToken } from '@/lib/services/auth';
import {
  fetchNotificationSettings,
  persistNotificationSettings,
  type NotificationSettings,
  type NotificationSettingsPatch,
} from '@/lib/services/notification-settings';

const STORAGE_KEY = 'liveMonitorConfig';

const API_BASE = import.meta.env.VITE_API_URL as string | undefined
  ?? (import.meta.env.MODE === 'production' ? '' : 'http://localhost:4000');

function authHeaders(): Record<string, string> {
  const token = getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function readMonitorConfigCache(): Partial<LiveMonitorConfig> {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) return JSON.parse(stored) as Partial<LiveMonitorConfig>;
  } catch {
    // Corrupted storage — ignore
  }
  return {};
}

function writeMonitorConfigCache(config: LiveMonitorConfig): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
  window.dispatchEvent(new CustomEvent('tfi:settings-updated'));
}

function mapNotificationSettingsToConfig(
  settings: NotificationSettings | null,
): Partial<LiveMonitorConfig> {
  if (!settings) return {};
  return {
    WEB_PUSH_ENABLED: settings.webPushEnabled,
    TELEGRAM_ENABLED: settings.telegramEnabled,
    NOTIFICATION_LANGUAGE: settings.notificationLanguage,
  };
}

function splitNotificationSettingsPatch(config: Partial<LiveMonitorConfig>): {
  settingsPatch: Partial<LiveMonitorConfig>;
  notificationPatch: NotificationSettingsPatch;
} {
  const settingsPatch = { ...config };
  const notificationPatch: NotificationSettingsPatch = {};

  if ('WEB_PUSH_ENABLED' in settingsPatch) {
    notificationPatch.webPushEnabled = settingsPatch.WEB_PUSH_ENABLED === true;
    delete settingsPatch.WEB_PUSH_ENABLED;
  }
  if ('TELEGRAM_ENABLED' in settingsPatch) {
    notificationPatch.telegramEnabled = settingsPatch.TELEGRAM_ENABLED !== false;
    delete settingsPatch.TELEGRAM_ENABLED;
  }
  if ('NOTIFICATION_LANGUAGE' in settingsPatch) {
    const language = settingsPatch.NOTIFICATION_LANGUAGE;
    if (language === 'vi' || language === 'en' || language === 'both') {
      notificationPatch.notificationLanguage = language;
    }
    delete settingsPatch.NOTIFICATION_LANGUAGE;
  }

  return { settingsPatch, notificationPatch };
}

function hasKeys(obj: Record<string, unknown>): boolean {
  return Object.keys(obj).length > 0;
}

/**
 * Default pipeline configuration.
 * Mirrors the "Set Config" node in the n8n workflow exactly.
 */
export function createDefaultConfig(overrides?: Partial<LiveMonitorConfig>): LiveMonitorConfig {
  return {
    SPREADSHEET_ID: '1XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX',
    SHEET_IDS: {
      Watchlist: 715101038,
      Recommendations: 0,
      Matches: 0,
      ApprovedLeagues: 0,
    },
    TIMEZONE: 'Asia/Seoul',
    MATCH_STARTED_THRESHOLD_MINUTES: 150,
    MATCH_NOT_YET_STARTED_BUFFER_MINUTES: 15,
    MIN_CONFIDENCE: 5,
    MIN_ODDS: 1.5,
    LATE_PHASE_MINUTE: 75,
    VERY_LATE_PHASE_MINUTE: 85,
    ENDGAME_MINUTE: 88,
    AI_PROVIDER: 'gemini',
    AI_MODEL: 'gemini-3-pro-preview',
    EMAIL_TO: '',
    TELEGRAM_CHAT_ID: '',
    MANUAL_PUSH_MATCH_IDS: [],
    NOTIFICATION_LANGUAGE: 'vi',
    UI_LANGUAGE: 'vi',
    TELEGRAM_ENABLED: false,
    ZALO_ENABLED: false,
    AUTO_APPLY_RECOMMENDED_CONDITION: true,
    ...overrides,
  };
}

/**
 * Load config synchronously from localStorage cache (for pipeline use).
 * The cache is kept in sync by fetchMonitorConfig / persistMonitorConfig.
 */
export function loadMonitorConfig(overrides?: Partial<LiveMonitorConfig>): LiveMonitorConfig {
  const storedOverrides = readMonitorConfigCache();
  return createDefaultConfig({ ...storedOverrides, ...overrides });
}

/**
 * Save config to localStorage (sync cache only — use persistMonitorConfig for DB).
 */
export function saveMonitorConfig(config: Partial<LiveMonitorConfig>): void {
  const current = loadMonitorConfig();
  const merged = { ...current, ...config };
  writeMonitorConfigCache(merged);
}

// ── API-backed persistence (DB) ──────────────────────────────

/**
 * Fetch config from server DB + merge with defaults.
 * Also updates the localStorage cache so pipeline can read it synchronously.
 */
export async function fetchMonitorConfig(): Promise<LiveMonitorConfig> {
  try {
    const [settingsResult, notificationResult] = await Promise.allSettled([
      fetch(`${API_BASE}/api/me/settings`, {
        headers: { Accept: 'application/json', ...authHeaders() },
        credentials: 'include',
      }),
      fetchNotificationSettings(),
    ]);

    const dbSettings =
      settingsResult.status === 'fulfilled' && settingsResult.value.ok
        ? await settingsResult.value.json() as Partial<LiveMonitorConfig>
        : null;
    const notificationSettings =
      notificationResult.status === 'fulfilled'
        ? notificationResult.value
        : null;

    if (dbSettings || notificationSettings) {
      const config = createDefaultConfig({
        ...(dbSettings ?? {}),
        ...mapNotificationSettingsToConfig(notificationSettings),
      });
      writeMonitorConfigCache(config);
      return config;
    }
  } catch {
    // Fallback to localStorage
  }
  return loadMonitorConfig();
}

/**
 * Persist config to server DB and update localStorage cache.
 */
export async function persistMonitorConfig(config: Partial<LiveMonitorConfig>): Promise<void> {
  const { settingsPatch, notificationPatch } = splitNotificationSettingsPatch(config);
  const merged = { ...loadMonitorConfig() };

  if (hasKeys(settingsPatch as Record<string, unknown>)) {
    const res = await fetch(`${API_BASE}/api/me/settings`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify(settingsPatch),
      credentials: 'include',
    });
    if (!res.ok) throw new Error(`Save failed: ${res.status}`);
    Object.assign(merged, await res.json() as Partial<LiveMonitorConfig>);
  }

  if (hasKeys(notificationPatch as Record<string, unknown>)) {
    const savedNotificationSettings = await persistNotificationSettings(notificationPatch);
    Object.assign(merged, mapNotificationSettingsToConfig(savedNotificationSettings));
  }

  writeMonitorConfigCache(createDefaultConfig(merged));
}
