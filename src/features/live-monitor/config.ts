// ============================================================
// Live Monitor Pipeline Config
// Equivalent to n8n "Set Config" node
// ============================================================

import type { LiveMonitorConfig } from './types';
import { internalApiUrl } from '@/lib/internal-api';
import { getToken } from '@/lib/services/auth';
import { DEFAULT_APP_TIMEZONE } from '@/lib/utils/timezone';

const STORAGE_KEY = 'liveMonitorConfig';

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
    TIMEZONE: DEFAULT_APP_TIMEZONE,
    MATCH_STARTED_THRESHOLD_MINUTES: 150,
    MATCH_NOT_YET_STARTED_BUFFER_MINUTES: 15,
    MIN_CONFIDENCE: 5,
    MIN_ODDS: 1.5,
    LATE_PHASE_MINUTE: 75,
    VERY_LATE_PHASE_MINUTE: 85,
    ENDGAME_MINUTE: 88,
    AI_PROVIDER: 'gemini',
    AI_MODEL: 'gemini-2.5-flash',
    EMAIL_TO: '',
    TELEGRAM_CHAT_ID: '',
    MANUAL_PUSH_MATCH_IDS: [],
    NOTIFICATION_LANGUAGE: 'vi',
    UI_LANGUAGE: 'vi',
    USER_TIMEZONE: null,
    USER_TIMEZONE_CONFIRMED: false,
    TELEGRAM_ENABLED: false,
    ZALO_ENABLED: false,
    AUTO_APPLY_RECOMMENDED_CONDITION: true,
    SUGGESTED_TOP_LEAGUE_IDS: [],
    ASK_AI_QUICK_PROMPTS_BY_LOCALE: { en: [], vi: [] },
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
    const res = await fetch(internalApiUrl('/api/me/settings'), {
      headers: { Accept: 'application/json', ...authHeaders() },
      credentials: 'include',
    });

    if (res.ok) {
      const config = createDefaultConfig(await res.json() as Partial<LiveMonitorConfig>);
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
  const res = await fetch(internalApiUrl('/api/me/settings'), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify(config),
    credentials: 'include',
  });
  if (!res.ok) {
    let message = `Save failed: ${res.status}`;
    try {
      const body = (await res.json()) as { error?: string };
      if (typeof body.error === 'string' && body.error.trim()) message = body.error;
    } catch {
      /* ignore */
    }
    throw new Error(message);
  }
  writeMonitorConfigCache(createDefaultConfig(await res.json() as Partial<LiveMonitorConfig>));
}
