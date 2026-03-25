import type { League } from '@/types';

/**
 * Convert Seoul datetime (UTC+9) to local browser time
 */
export function convertSeoulToLocalDateTime(dateStr: string, kickoffStr: string): Date {
  if (!dateStr) return new Date();

  let year: number, month: number, day: number;

  if (dateStr.includes('T')) {
    // ISO timestamp (e.g. pg DATE serialised at midnight Seoul) — extract Seoul date
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return new Date();
    const seoulMs = d.getTime() + 9 * 60 * 60 * 1000;
    const sd = new Date(seoulMs);
    year = sd.getUTCFullYear();
    month = sd.getUTCMonth() + 1;
    day = sd.getUTCDate();
  } else {
    const parts = dateStr.split('-').map(Number);
    year = parts[0] ?? 0;
    month = parts[1] ?? 0;
    day = parts[2] ?? 0;
    if (!year || !month || !day) return new Date();
  }

  let hours = 0;
  let minutes = 0;
  if (kickoffStr) {
    const parts = kickoffStr.split(':').map(Number);
    hours = parts[0] || 0;
    minutes = parts[1] || 0;
  }

  const seoulDate = new Date(Date.UTC(year, month - 1, day, hours, minutes, 0));
  return new Date(seoulDate.getTime() - 9 * 60 * 60 * 1000);
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// ── Format config from env (VITE_DATETIME_FORMAT, VITE_DATE_FORMAT, VITE_TIME_FORMAT) ──
const ENV_DATETIME_FORMAT = import.meta.env['VITE_DATETIME_FORMAT'] as string | undefined;
const ENV_DATE_FORMAT = import.meta.env['VITE_DATE_FORMAT'] as string | undefined;
const ENV_TIME_FORMAT = import.meta.env['VITE_TIME_FORMAT'] as string | undefined;

const DATETIME_FORMAT = ENV_DATETIME_FORMAT || 'DD-MMM-YYYY HH:mm';
const DATE_FORMAT = ENV_DATE_FORMAT || 'DD-MMM-YYYY';
const TIME_FORMAT = ENV_TIME_FORMAT || 'HH:mm';

function applyFormat(fmt: string, d: Date): string {
  const dd = String(d.getDate()).padStart(2, '0');
  const mmm = MONTHS[d.getMonth()]!;
  const yyyy = String(d.getFullYear());
  const yy = yyyy.slice(2);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  return fmt
    .replace('DD', dd)
    .replace('MMM', mmm)
    .replace('YYYY', yyyy)
    .replace('YY', yy)
    .replace('HH', hh)
    .replace('mm', mm)
    .replace('ss', ss);
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
  const weekday = d.toLocaleDateString(undefined, { weekday: 'short' });
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
 * Format an ISO timestamp string to "HH:mm:ss" in browser local timezone
 */
export function formatLocalTimeFull(ts?: string | null): string {
  if (!ts) return '—';
  const d = new Date(ts);
  if (isNaN(d.getTime())) return '—';
  const hh = String(d.getHours()).padStart(2, '0');
  const min = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  return `${hh}:${min}:${ss}`;
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

/**
 * Get league display name with country prefix
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
  if (league?.country) {
    return `${league.country.toUpperCase()} - ${leagueName || league.league_name || ''}`;
  }
  return leagueName || '';
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
