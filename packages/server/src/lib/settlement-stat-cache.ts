import type { ApiFixtureStat } from './football-api.js';

export interface SettlementStatRow {
  type: string;
  home: string | number | null;
  away: string | number | null;
}

export function mergeApiFixtureStatistics(statsRaw: ApiFixtureStat[]): SettlementStatRow[] {
  if (statsRaw.length < 2) return [];

  const homeStats = statsRaw[0]?.statistics ?? [];
  const awayStats = statsRaw[1]?.statistics ?? [];

  return homeStats.map((homeStat) => ({
    type: homeStat.type,
    home: homeStat.value,
    away: awayStats.find((awayStat) => awayStat.type === homeStat.type)?.value ?? null,
  }));
}

function isSettlementStatRow(value: unknown): value is SettlementStatRow {
  if (!value || typeof value !== 'object') return false;
  const row = value as Record<string, unknown>;
  return typeof row.type === 'string' && 'home' in row && 'away' in row;
}

export function parseStoredSettlementStats(value: unknown): SettlementStatRow[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isSettlementStatRow);
}
