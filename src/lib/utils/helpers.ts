import type { League, Match } from '@/types';
import {
  convertLocalDateTimeToInstant,
  formatDateKeyInTimeZone,
  formatDateForTimeZone,
  readUserTimeZoneState,
} from '@/lib/utils/timezone';

interface KickoffLike {
  date?: string | null;
  kickoff?: string | null;
  kickoff_at_utc?: string | null;
}

export function getKickoffDateTime(value: KickoffLike): Date {
  if (value.kickoff_at_utc) {
    const kickoff = new Date(value.kickoff_at_utc);
    if (!Number.isNaN(kickoff.getTime())) return kickoff;
  }
  return convertLocalDateTimeToInstant(value.date ?? '', value.kickoff ?? '00:00');
}

export function getKickoffDateKey(value: KickoffLike, timeZone: string): string | null {
  const kickoff = getKickoffDateTime(value);
  if (Number.isNaN(kickoff.getTime())) return null;
  return formatDateKeyInTimeZone(kickoff, timeZone);
}

export function shouldFastRefreshMatch(
  match: Pick<Match, 'status' | 'date' | 'kickoff' | 'kickoff_at_utc'>,
  now = Date.now(),
  preKickoffWindowMin = 10,
  postKickoffWindowMin = 115,
): boolean {
  const status = String(match.status || '').trim().toUpperCase();
  if (['1H', 'HT', '2H', 'ET', 'BT', 'P', 'LIVE', 'INT'].includes(status)) return true;
  if (status !== 'NS') return false;

  const kickoff = getKickoffDateTime(match);
  if (Number.isNaN(kickoff.getTime())) return false;

  const elapsedMin = (now - kickoff.getTime()) / 60_000;
  return elapsedMin >= -preKickoffWindowMin && elapsedMin < postKickoffWindowMin;
}

// ── Format config from env (VITE_DATETIME_FORMAT, VITE_DATE_FORMAT, VITE_TIME_FORMAT) ──
const ENV_DATETIME_FORMAT = import.meta.env['VITE_DATETIME_FORMAT'] as string | undefined;
const ENV_DATE_FORMAT = import.meta.env['VITE_DATE_FORMAT'] as string | undefined;
const ENV_TIME_FORMAT = import.meta.env['VITE_TIME_FORMAT'] as string | undefined;

const DATETIME_FORMAT = ENV_DATETIME_FORMAT || 'DD-MMM-YYYY HH:mm';
const DATE_FORMAT = ENV_DATE_FORMAT || 'DD-MMM-YYYY';
const TIME_FORMAT = ENV_TIME_FORMAT || 'HH:mm';

function applyFormat(fmt: string, d: Date): string {
  const { effectiveTimeZone } = readUserTimeZoneState();
  return formatDateForTimeZone(d, fmt, effectiveTimeZone);
}

/**
 * Format a Date object using VITE_DATETIME_FORMAT (default: "DD-MMM-YYYY HH:mm")
 */
export function formatDateTimeDisplay(dateObj: Date): string {
  if (!(dateObj instanceof Date) || isNaN(dateObj.getTime())) return '';
  return applyFormat(DATETIME_FORMAT, dateObj);
}

/**
 * Format an ISO timestamp string using VITE_DATETIME_FORMAT
 */
export function formatLocalDateTime(ts?: string | null): string {
  if (!ts) return '-';
  const d = new Date(ts);
  if (isNaN(d.getTime())) return '-';
  return applyFormat(DATETIME_FORMAT, d);
}

/**
 * Format an ISO timestamp string using VITE_DATE_FORMAT (default: "DD-MMM-YYYY")
 */
export function formatLocalDate(ts?: string | null): string {
  if (!ts) return '-';
  const d = new Date(ts);
  if (isNaN(d.getTime())) return '-';
  return applyFormat(DATE_FORMAT, d);
}

/**
 * Format an ISO timestamp string using VITE_TIME_FORMAT (default: "HH:mm")
 */
export function formatLocalTime(ts?: string | null): string {
  if (!ts) return '';
  const d = new Date(ts);
  if (isNaN(d.getTime())) return '';
  return applyFormat(TIME_FORMAT, d);
}

/**
 * Format an ISO timestamp string with weekday prefix + VITE_DATETIME_FORMAT
 * e.g. "Thu 19-Mar-2025 09:45"
 */
export function formatLocalDateTimeFull(ts?: string | null): string {
  if (!ts) return '-';
  const d = new Date(ts);
  if (isNaN(d.getTime())) return '-';
  const { effectiveTimeZone } = readUserTimeZoneState();
  const weekday = new Intl.DateTimeFormat(undefined, { weekday: 'short', timeZone: effectiveTimeZone }).format(d);
  return `${weekday} ${applyFormat(DATETIME_FORMAT, d)}`;
}

/**
 * Format an ISO timestamp string to short-year date: "DD-MMM-YY"
 * e.g. "19-Mar-25" — for historical match lists
 */
export function formatLocalDateShortYear(ts?: string | null): string {
  if (!ts) return '-';
  const d = new Date(ts);
  if (isNaN(d.getTime())) return '-';
  return applyFormat(DATE_FORMAT.replace('YYYY', 'YY'), d);
}

/**
 * Format an ISO timestamp string to "HH:mm:ss" in the effective user timezone
 */
export function formatLocalTimeFull(ts?: string | null): string {
  if (!ts) return '—';
  const d = new Date(ts);
  if (isNaN(d.getTime())) return '—';
  return applyFormat('HH:mm:ss', d);
}

/**
 * Normalize date string to ISO yyyy-mm-dd
 */
export function normalizeToISO(dateStr: string | undefined | null): string | null {
  if (!dateStr) return null;
  const s = String(dateStr).trim();
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(s)) {
    const parts = s.split('/');
    return `${parts[2]}-${parts[1]!.padStart(2, '0')}-${parts[0]!.padStart(2, '0')}`;
  }
  const d = new Date(s);
  if (!isNaN(d.getTime())) {
    const yyyy = d.getFullYear();
    const mo = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${yyyy}-${mo}-${dd}`;
  }
  return null;
}

/** Resolved label: admin override or provider name. */
export function getLeagueEffectiveName(league: Pick<League, 'league_name' | 'display_name'>): string {
  const o = league.display_name?.trim();
  return o || league.league_name || '';
}

/**
 * Get league display name with country prefix (uses `display_name` when set).
 */
export function getLeagueDisplayName(
  leagueId: number | string | undefined,
  leagueName: string,
  leagues: League[],
): string {
  if (!leagues || leagues.length === 0) return leagueName || '';
  const searchId = parseInt(String(leagueId));
  if (isNaN(searchId)) return leagueName || '';

  const league = leagues.find((l) => parseInt(String(l.league_id)) === searchId);
  const namePart = league ? getLeagueEffectiveName(league) : (leagueName || '');
  if (league?.country) {
    return `${league.country.toUpperCase()} - ${namePart}`;
  }
  return namePart;
}

/**
 * Parse kickoff time to HH:mm format for saving
 */
export function parseKickoffForSave(kickoff: string | undefined): string {
  if (!kickoff) return '';
  const s = String(kickoff).trim();
  if (s.includes('T') || s.includes('Z')) {
    const d = new Date(s);
    if (!isNaN(d.getTime())) {
      return `${d.getUTCHours().toString().padStart(2, '0')}:${d.getUTCMinutes().toString().padStart(2, '0')}`;
    }
  }
  if (/^\d{1,2}:\d{2}/.test(s)) return s;
  return s;
}

/**
 * Debounce utility
 */
export function debounce<TArgs extends unknown[]>(fn: (...args: TArgs) => void, ms = 250): (...args: TArgs) => void {
  let timer: ReturnType<typeof setTimeout>;
  return (...args: TArgs) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}
