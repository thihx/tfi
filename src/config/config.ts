import type { AppConfig } from '@/types';
import { STATUS_BADGES, TOP_LEAGUES } from './constants';

// ==================== ENV VALIDATION ====================
(function validateEnv() {
  const apiUrl = import.meta.env.VITE_API_URL as string | undefined;
  if (apiUrl && !apiUrl.startsWith('http://') && !apiUrl.startsWith('https://') && apiUrl !== '') {
    console.error(`[Config] VITE_API_URL "${apiUrl}" does not start with http:// or https://.`);
  }
})();

// ==================== APPLICATION CONFIG ====================
// When VITE_API_URL is not set, default to same-origin (empty string) in production
// or localhost:4000 in development.
const resolveApiUrl = (): string => {
  const env = import.meta.env.VITE_API_URL as string | undefined;
  if (env) return env;
  return import.meta.env.MODE === 'production' ? '' : 'http://localhost:4000';
};

const defaultConfig: AppConfig = {
  defaultMode: 'B',
  apiUrl: resolveApiUrl(),
};

export function loadConfig(): AppConfig {
  return {
    ...defaultConfig,
    defaultMode: localStorage.getItem('defaultMode') || defaultConfig.defaultMode,
  };
}

export function saveConfig(config: AppConfig): void {
  localStorage.setItem('defaultMode', config.defaultMode);
}

// ==================== UTILITY FUNCTIONS ====================
export function escapeHtml(str: string): string {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

export function getStatusBadge(status: string): { label: string; className: string } {
  const info = STATUS_BADGES[status] || { label: status, class: '' };
  return { label: info.label, className: info.class };
}

export function getCountryFromLeague(leagueId: number): string {
  return TOP_LEAGUES[leagueId]?.country || 'Other';
}

export function getTierBadge(leagueId: number): number | null {
  return TOP_LEAGUES[leagueId]?.tier || null;
}
