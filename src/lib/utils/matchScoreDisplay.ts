import type { Match } from '@/types';

const STATUS_FINISHED = new Set(['FT', 'AET', 'PEN', 'CANC', 'ABD', 'AWD']);
const STATUS_AFTER_FIRST_HALF = new Set(['2H', 'ET', 'BT', 'P', 'INT']);

export function parseElapsedMinute(raw: string | undefined | null): number | null {
  if (raw == null || raw === '') return null;
  const m = String(raw).trim().match(/^(\d+)/);
  return m ? Number(m[1]) : null;
}

export function shouldShowHalftimeUnderScore(
  match: Pick<Match, 'status' | 'current_minute' | 'halftime_home' | 'halftime_away'>,
): boolean {
  const h = match.halftime_home;
  const a = match.halftime_away;
  if (h == null || a == null) return false;

  const st = match.status;
  if (st === '1H' || st === 'NS') return false;
  if (st === 'HT') return false;

  if (STATUS_AFTER_FIRST_HALF.has(st) || STATUS_FINISHED.has(st)) return true;

  if (st === 'LIVE') {
    const el = parseElapsedMinute(match.current_minute);
    return el != null && el >= 46;
  }

  return false;
}

export function formatHalftimeParen(match: Pick<Match, 'halftime_home' | 'halftime_away'>): string {
  return `(${match.halftime_home}-${match.halftime_away})`;
}
