// ============================================================
// Settlement Context Helpers
// ============================================================

import type { ApiFixture } from './football-api.js';
import type { RegulationScore } from './settle-types.js';

export const REGULAR_TIME_FINAL_STATUSES = new Set(['FT']);
export const EXTRA_TIME_FINAL_STATUSES = new Set(['AET', 'PEN']);
export const NON_STANDARD_FINAL_STATUSES = new Set(['AWD', 'WO']);

export function requiresRegularTimeBreakdown(status: string | null | undefined): boolean {
  return EXTRA_TIME_FINAL_STATUSES.has((status || '').toUpperCase());
}

export function isStandardFullTimeStatus(status: string | null | undefined): boolean {
  return REGULAR_TIME_FINAL_STATUSES.has((status || '').toUpperCase());
}

export function isNonStandardFinalStatus(status: string | null | undefined): boolean {
  return NON_STANDARD_FINAL_STATUSES.has((status || '').toUpperCase());
}

export function extractRegularTimeScoreFromFixture(fixture: ApiFixture): RegulationScore | null {
  const status = (fixture.fixture.status?.short || '').toUpperCase();
  if (!requiresRegularTimeBreakdown(status)) return null;

  const fulltime = fixture.score?.fulltime;
  const home = typeof fulltime?.home === 'number' ? fulltime.home : null;
  const away = typeof fulltime?.away === 'number' ? fulltime.away : null;
  if (home == null || away == null) return null;
  return { home, away };
}

export function resolveSettlementScore(
  finalStatus: string | null | undefined,
  officialHomeScore: number,
  officialAwayScore: number,
  regularTimeScore?: RegulationScore | null,
): RegulationScore | null {
  const status = (finalStatus || '').toUpperCase();

  if (!status || isStandardFullTimeStatus(status)) {
    return { home: officialHomeScore, away: officialAwayScore };
  }
  if (requiresRegularTimeBreakdown(status)) {
    return regularTimeScore ?? null;
  }
  if (isNonStandardFinalStatus(status)) {
    return null;
  }
  return null;
}
