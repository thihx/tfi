import { describe, test, expect } from 'vitest';
import {
  convertSeoulToLocalDateTime,
  formatDateTimeDisplay,
  normalizeToISO,
  getLeagueDisplayName,
  parseKickoffForSave,
  debounce,
} from './helpers';
import type { League } from '@/types';

// ==================== convertSeoulToLocalDateTime ====================
describe('convertSeoulToLocalDateTime', () => {
  test('converts Seoul time to UTC by subtracting 9 hours', () => {
    const result = convertSeoulToLocalDateTime('2026-03-16', '21:00');
    // Seoul 21:00 = UTC 12:00
    expect(result.getUTCHours()).toBe(12);
    expect(result.getUTCMinutes()).toBe(0);
  });

  test('handles midnight kickoff', () => {
    const result = convertSeoulToLocalDateTime('2026-03-16', '00:00');
    // Seoul 00:00 Mar 16 = UTC 15:00 Mar 15
    expect(result.getUTCHours()).toBe(15);
    expect(result.getUTCDate()).toBe(15);
  });

  test('returns current date for empty dateStr', () => {
    const before = Date.now();
    const result = convertSeoulToLocalDateTime('', '20:00');
    const after = Date.now();
    expect(result.getTime()).toBeGreaterThanOrEqual(before - 1000);
    expect(result.getTime()).toBeLessThanOrEqual(after + 1000);
  });

  test('handles missing kickoff string', () => {
    const result = convertSeoulToLocalDateTime('2026-03-16', '');
    // Seoul 00:00 = UTC 15:00 previous day
    expect(result.getUTCHours()).toBe(15);
  });

  test('handles malformed date parts gracefully', () => {
    const result = convertSeoulToLocalDateTime('invalid-date', '20:00');
    expect(result instanceof Date).toBe(true);
  });
});

// ==================== formatDateTimeDisplay ====================
describe('formatDateTimeDisplay', () => {
  test('formats date to DD-MMM-YYYY HH:mm', () => {
    const date = new Date(2026, 2, 16, 14, 30); // March 16, 2026 14:30 local
    expect(formatDateTimeDisplay(date)).toBe('16-Mar-2026 14:30');
  });

  test('pads single-digit values', () => {
    const date = new Date(2026, 0, 5, 8, 3); // Jan 5, 2026 08:03
    expect(formatDateTimeDisplay(date)).toBe('05-Jan-2026 08:03');
  });

  test('returns empty string for invalid date', () => {
    expect(formatDateTimeDisplay(new Date('invalid'))).toBe('');
  });

  test('returns empty string for non-Date input', () => {
    expect(formatDateTimeDisplay(null as unknown as Date)).toBe('');
  });
});

// ==================== normalizeToISO ====================
describe('normalizeToISO', () => {
  test('returns ISO date as-is', () => {
    expect(normalizeToISO('2026-03-16')).toBe('2026-03-16');
  });

  test('converts DD/MM/YYYY to ISO', () => {
    expect(normalizeToISO('5/3/2026')).toBe('2026-03-05');
  });

  test('converts DD/MM/YYYY with padding', () => {
    expect(normalizeToISO('16/03/2026')).toBe('2026-03-16');
  });

  test('returns null for empty string', () => {
    expect(normalizeToISO('')).toBeNull();
  });

  test('returns null for undefined', () => {
    expect(normalizeToISO(undefined)).toBeNull();
  });

  test('returns null for null', () => {
    expect(normalizeToISO(null)).toBeNull();
  });

  test('returns null for unparseable string', () => {
    expect(normalizeToISO('not-a-date')).toBeNull();
  });
});

// ==================== getLeagueDisplayName ====================
describe('getLeagueDisplayName', () => {
  const leagues: League[] = [
    { league_id: 39, country: 'England', league_name: 'Premier League', tier: '1', active: true, top_league: false, type: 'League', logo: '', last_updated: '' },
    { league_id: 140, country: 'Spain', league_name: 'La Liga', tier: '1', active: true, top_league: false, type: 'League', logo: '', last_updated: '' },
  ];

  test('prepends country to league name', () => {
    expect(getLeagueDisplayName(39, 'Premier League', leagues)).toBe('ENGLAND - Premier League');
  });

  test('uses approved league name if leagueName is empty', () => {
    expect(getLeagueDisplayName(140, '', leagues)).toBe('SPAIN - La Liga');
  });

  test('returns leagueName when league not in approved list', () => {
    expect(getLeagueDisplayName(999, 'Unknown League', leagues)).toBe('Unknown League');
  });

  test('returns leagueName when leagues is empty', () => {
    expect(getLeagueDisplayName(39, 'Premier League', [])).toBe('Premier League');
  });

  test('handles string leagueId', () => {
    expect(getLeagueDisplayName('39', 'Premier League', leagues)).toBe('ENGLAND - Premier League');
  });

  test('handles undefined leagueId', () => {
    expect(getLeagueDisplayName(undefined, 'Some League', leagues)).toBe('Some League');
  });
});

// ==================== parseKickoffForSave ====================
describe('parseKickoffForSave', () => {
  test('returns HH:mm as-is', () => {
    expect(parseKickoffForSave('20:00')).toBe('20:00');
  });

  test('extracts UTC time from ISO datetime', () => {
    expect(parseKickoffForSave('2026-03-16T14:30:00Z')).toBe('14:30');
  });

  test('returns empty string for undefined', () => {
    expect(parseKickoffForSave(undefined)).toBe('');
  });

  test('returns empty string for empty string', () => {
    expect(parseKickoffForSave('')).toBe('');
  });

  test('returns raw string if no pattern matches', () => {
    expect(parseKickoffForSave('TBD')).toBe('TBD');
  });
});

// ==================== debounce ====================
describe('debounce', () => {
  test('delays function execution', async () => {
    const fn = vi.fn();
    const debounced = debounce(fn, 50);

    debounced();
    expect(fn).not.toHaveBeenCalled();

    await new Promise((r) => setTimeout(r, 80));
    expect(fn).toHaveBeenCalledOnce();
  });

  test('cancels previous call on rapid invocations', async () => {
    const fn = vi.fn();
    const debounced = debounce(fn, 50);

    debounced();
    debounced();
    debounced();

    await new Promise((r) => setTimeout(r, 80));
    expect(fn).toHaveBeenCalledOnce();
  });

  test('passes arguments to the original function', async () => {
    const fn = vi.fn();
    const debounced = debounce(fn, 50);

    debounced('hello', 42);

    await new Promise((r) => setTimeout(r, 80));
    expect(fn).toHaveBeenCalledWith('hello', 42);
  });
});
