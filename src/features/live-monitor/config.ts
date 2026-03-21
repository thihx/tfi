// ============================================================
// Live Monitor Pipeline Config
// Equivalent to n8n "Set Config" node
// ============================================================

import type { LiveMonitorConfig } from './types';
import { getToken } from '@/lib/services/auth';

const API_BASE = import.meta.env.VITE_API_URL as string | undefined
  ?? (import.meta.env.MODE === 'production' ? '' : 'http://localhost:4000');

function authHeaders(): Record<string, string> {
  const token = getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
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
    TELEGRAM_ENABLED: true,
    ZALO_ENABLED: false,
    ...overrides,
  };
}

/**
 * Load config synchronously from localStorage cache (for pipeline use).
 * The cache is kept in sync by fetchMonitorConfig / persistMonitorConfig.
 */
export function loadMonitorConfig(overrides?: Partial<LiveMonitorConfig>): LiveMonitorConfig {
  let storedOverrides: Partial<LiveMonitorConfig> = {};
  try {
    const stored = localStorage.getItem('liveMonitorConfig');
    if (stored) storedOverrides = JSON.parse(stored) as Partial<LiveMonitorConfig>;
  } catch {
    // Corrupted storage — ignore
  }
  return createDefaultConfig({ ...storedOverrides, ...overrides });
}

/**
 * Save config to localStorage (sync cache only — use persistMonitorConfig for DB).
 */
export function saveMonitorConfig(config: Partial<LiveMonitorConfig>): void {
  const current = loadMonitorConfig();
  const merged = { ...current, ...config };
  localStorage.setItem('liveMonitorConfig', JSON.stringify(merged));
}

// ── API-backed persistence (DB) ──────────────────────────────

/**
 * Fetch config from server DB + merge with defaults.
 * Also updates the localStorage cache so pipeline can read it synchronously.
 */
export async function fetchMonitorConfig(): Promise<LiveMonitorConfig> {
  try {
    const res = await fetch(`${API_BASE}/api/settings`, {
      headers: { Accept: 'application/json', ...authHeaders() },
      credentials: 'include',
    });
    if (res.ok) {
      const dbSettings = await res.json() as Partial<LiveMonitorConfig>;
      const config = createDefaultConfig(dbSettings);
      // Sync localStorage cache
      localStorage.setItem('liveMonitorConfig', JSON.stringify(config));
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
  // Always update localStorage cache immediately
  saveMonitorConfig(config);
  const res = await fetch(`${API_BASE}/api/settings`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify(config),
    credentials: 'include',
  });
  if (!res.ok) throw new Error(`Save failed: ${res.status}`);
}
