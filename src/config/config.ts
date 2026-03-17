import type { AppConfig } from '@/types';
import { STATUS_BADGES, TOP_LEAGUES } from './constants';

// ==================== ENV VALIDATION ====================
(function validateEnv() {
  const apiUrl = import.meta.env.VITE_API_URL as string | undefined;
  if (!apiUrl && import.meta.env.MODE === 'production') {
    // Non-fatal: app will fall back to localhost, but log prominently
    console.error(
      '[Config] VITE_API_URL is not set. The app will use http://localhost:4000 which will not work in production. ' +
        'Set VITE_API_URL in your environment before building.',
    );
  }
  if (apiUrl && !apiUrl.startsWith('http://') && !apiUrl.startsWith('https://')) {
    console.error(`[Config] VITE_API_URL "${apiUrl}" does not start with http:// or https://.`);
  }
})();

// ==================== APPLICATION CONFIG ====================
const defaultConfig: AppConfig = {
  defaultMode: 'B',
  apiUrl: (import.meta.env.VITE_API_URL as string | undefined) ?? 'http://localhost:4000',
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
