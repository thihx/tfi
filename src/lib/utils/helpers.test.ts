import { describe, test, expect } from 'vitest';
import {
  formatDateTimeDisplay,
  formatLocalDate,
  formatLocalTimeFull,
  getKickoffDateKey,
  getKickoffDateTime,
  normalizeToISO,
  shouldFastRefreshMatch,
  getLeagueDisplayName,
  parseKickoffForSave,
  debounce,
} from './helpers';
import { convertLocalDateTimeToInstant } from './timezone';
import type { League } from '@/types';

// ==================== convertLocalDateTimeToInstant (Asia/Seoul) ====================
describe('convertLocalDateTimeToInstant', () => {
  test('converts local time in Asia/Seoul to UTC', () => {
    const result = convertLocalDateTimeToInstant('2026-03-16', '21:00', 'Asia/Seoul');
    // Seoul 21:00 = UTC 12:00
    expect(result.getUTCHours()).toBe(12);
    expect(result.getUTCMinutes()).toBe(0);
  });

  test('handles midnight kickoff in Asia/Seoul', () => {
    const result = convertLocalDateTimeToInstant('2026-03-16', '00:00', 'Asia/Seoul');
    // Seoul 00:00 Mar 16 = UTC 15:00 Mar 15
    expect(result.getUTCHours()).toBe(15);
    expect(result.getUTCDate()).toBe(15);
  });

  test('returns current date for empty dateStr', () => {
    const before = Date.now();
    const result = convertLocalDateTimeToInstant('', '20:00');
    const after = Date.now();
    expect(result.getTime()).toBeGreaterThanOrEqual(before - 1000);
    expect(result.getTime()).toBeLessThanOrEqual(after + 1000);
  });

  test('handles missing kickoff string', () => {
    const result = convertLocalDateTimeToInstant('2026-03-16', '', 'Asia/Seoul');
    // Seoul 00:00 = UTC 15:00 previous day
    expect(result.getUTCHours()).toBe(15);
  });

  test('handles malformed date parts gracefully', () => {
    const result = convertLocalDateTimeToInstant('invalid-date', '20:00');
    expect(result instanceof Date).toBe(true);
  });
});

describe('getKickoffDateTime', () => {
  test('prefers kickoff_at_utc when present', () => {
    const result = getKickoffDateTime({
      date: '2026-03-25',
      kickoff: '19:00',
      kickoff_at_utc: '2026-03-24T10:00:00.000Z',
    });

    expect(result.toISOString()).toBe('2026-03-24T10:00:00.000Z');
  });

  test('falls back to legacy date and kickoff when kickoff_at_utc is missing', () => {
    const result = getKickoffDateTime({
      date: '2026-03-16',
      kickoff: '21:00',
    });

    expect(result.getUTCHours()).toBe(12);
    expect(result.getUTCMinutes()).toBe(0);
  });
});

describe('getKickoffDateKey', () => {
  test('uses kickoff_at_utc for timezone-aware date filtering', () => {
    expect(getKickoffDateKey({
      date: '2026-03-25',
      kickoff: '19:00',
      kickoff_at_utc: '2026-03-24T23:30:00.000Z',
    }, 'Asia/Ho_Chi_Minh')).toBe('2026-03-25');
  });
});

describe('shouldFastRefreshMatch', () => {
  test('returns true for live statuses immediately', () => {
    expect(shouldFastRefreshMatch({
      status: '1H',
      date: '2026-03-25',
      kickoff: '19:00',
      kickoff_at_utc: '2026-03-25T10:00:00.000Z',
    }, Date.parse('2026-03-25T09:50:00.000Z'))).toBe(true);
  });

  test('returns true shortly before kickoff for NS matches', () => {
    expect(shouldFastRefreshMatch({
      status: 'NS',
      date: '2026-03-25',
      kickoff: '19:00',
      kickoff_at_utc: '2026-03-25T10:00:00.000Z',
    }, Date.parse('2026-03-25T09:54:00.000Z'))).toBe(true);
  });

  test('returns false when kickoff is still far away', () => {
    expect(shouldFastRefreshMatch({
      status: 'NS',
      date: '2026-03-25',
      kickoff: '19:00',
      kickoff_at_utc: '2026-03-25T10:00:00.000Z',
    }, Date.parse('2026-03-25T09:30:00.000Z'))).toBe(false);
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

describe('timezone-aware local formatters', () => {
  test('formatLocalDate uses the saved user timezone', () => {
    localStorage.setItem('liveMonitorConfig', JSON.stringify({ USER_TIMEZONE: 'America/New_York' }));

    expect(formatLocalDate('2026-03-16T00:30:00.000Z')).toBe('15-Mar-2026');
  });

  test('formatLocalTimeFull uses the saved user timezone', () => {
    localStorage.setItem('liveMonitorConfig', JSON.stringify({ USER_TIMEZONE: 'America/New_York' }));

    expect(formatLocalTimeFull('2026-03-16T00:30:45.000Z')).toBe('20:30:45');
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
