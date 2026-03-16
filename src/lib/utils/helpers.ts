import type { ApprovedLeague } from '@/types';

/**
 * Convert Seoul datetime (UTC+9) to local browser time
 */
export function convertSeoulToLocalDateTime(dateStr: string, kickoffStr: string): Date {
  if (!dateStr) return new Date();

  const [year, month, day] = dateStr.split('-').map(Number);
  if (!year || !month || !day) return new Date();

  let hours = 0;
  let minutes = 0;
  if (kickoffStr) {
    const [h, m] = kickoffStr.split(':').map(Number);
    hours = h || 0;
    minutes = m || 0;
  }

  const seoulDate = new Date(Date.UTC(year, month - 1, day, hours, minutes, 0));
  return new Date(seoulDate.getTime() - 9 * 60 * 60 * 1000);
}

/**
 * Format a Date to "DD-MM HH:mm"
 */
export function formatDateTimeDisplay(dateObj: Date): string {
  if (!(dateObj instanceof Date) || isNaN(dateObj.getTime())) return '';
  const dd = String(dateObj.getDate()).padStart(2, '0');
  const mm = String(dateObj.getMonth() + 1).padStart(2, '0');
  const hh = String(dateObj.getHours()).padStart(2, '0');
  const min = String(dateObj.getMinutes()).padStart(2, '0');
  return `${dd}-${mm} ${hh}:${min}`;
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
  approvedLeagues: ApprovedLeague[],
): string {
  if (!approvedLeagues || approvedLeagues.length === 0) return leagueName || '';
  const searchId = parseInt(String(leagueId));
  if (isNaN(searchId)) return leagueName || '';

  const league = approvedLeagues.find((l) => parseInt(String(l.league_id)) === searchId);
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
export function debounce<T extends (...args: any[]) => void>(fn: T, ms = 250): T {
  let timer: ReturnType<typeof setTimeout>;
  return ((...args: any[]) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  }) as unknown as T;
}
