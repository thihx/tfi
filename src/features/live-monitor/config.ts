// ============================================================
// Live Monitor Pipeline Config
// Equivalent to n8n "Set Config" node
// ============================================================

import type { LiveMonitorConfig } from './types';

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
    ...overrides,
  };
}

/**
 * Load config from localStorage with environment variable defaults.
 * Accepts optional overrides that take priority over stored values.
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
 * Save config to localStorage.
 */
export function saveMonitorConfig(config: Partial<LiveMonitorConfig>): void {
  const current = loadMonitorConfig();
  const merged = { ...current, ...config };
  localStorage.setItem('liveMonitorConfig', JSON.stringify(merged));
}
