import type { AppConfig } from '@/types';
import { STATUS_BADGES, TOP_LEAGUES } from './constants';

// ==================== APPLICATION CONFIG ====================
const defaultConfig: AppConfig = {
  defaultMode: 'B',
  apiUrl: import.meta.env.VITE_API_URL ?? 'http://localhost:4000',
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
