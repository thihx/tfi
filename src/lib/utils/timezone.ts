const STORAGE_KEY = 'liveMonitorConfig';

export const DEFAULT_APP_TIMEZONE = 'Asia/Seoul';

export const COMMON_TIMEZONE_OPTIONS = [
  'Asia/Ho_Chi_Minh',
  'Asia/Bangkok',
  'Asia/Singapore',
  'Asia/Tokyo',
  'Asia/Seoul',
  'UTC',
  'Europe/London',
  'Europe/Berlin',
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'Australia/Sydney',
];

export interface UserTimeZoneState {
  userTimeZone: string | null;
  confirmed: boolean;
  effectiveTimeZone: string;
  detectedTimeZone: string | null;
  source: 'user' | 'browser' | 'default';
}

export function isValidTimeZone(value: unknown): value is string {
  if (typeof value !== 'string' || value.trim().length === 0) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

export function detectBrowserTimeZone(): string | null {
  try {
    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return isValidTimeZone(timeZone) ? timeZone : null;
  } catch {
    return null;
  }
}

export function buildTimeZoneOptions(...extras: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const values = [...extras, ...COMMON_TIMEZONE_OPTIONS];
  return values.filter((value): value is string => {
    if (!isValidTimeZone(value) || seen.has(value)) return false;
    seen.add(value);
    return true;
  });
}

export function readUserTimeZoneState(): UserTimeZoneState {
  let userTimeZone: string | null = null;
  let confirmed = false;
  let storedTimeZone: string | null = null;

  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as {
        USER_TIMEZONE?: unknown;
        USER_TIMEZONE_CONFIRMED?: unknown;
        TIMEZONE?: unknown;
      };
      if (isValidTimeZone(parsed.USER_TIMEZONE)) {
        userTimeZone = parsed.USER_TIMEZONE;
      }
      if (typeof parsed.USER_TIMEZONE_CONFIRMED === 'boolean') {
        confirmed = parsed.USER_TIMEZONE_CONFIRMED;
      }
      if (isValidTimeZone(parsed.TIMEZONE)) {
        storedTimeZone = parsed.TIMEZONE;
      }
    }
  } catch {
    // Ignore corrupted cache.
  }

  const detectedTimeZone = detectBrowserTimeZone();

  if (userTimeZone) {
    return {
      userTimeZone,
      confirmed,
      effectiveTimeZone: userTimeZone,
      detectedTimeZone,
      source: 'user',
    };
  }

  if (detectedTimeZone) {
    return {
      userTimeZone: null,
      confirmed: false,
      effectiveTimeZone: detectedTimeZone,
      detectedTimeZone,
      source: 'browser',
    };
  }

  return {
    userTimeZone: null,
    confirmed: false,
    effectiveTimeZone: storedTimeZone ?? DEFAULT_APP_TIMEZONE,
    detectedTimeZone,
    source: 'default',
  };
}

interface TimeZoneParts {
  year: string;
  month: string;
  day: string;
  hour: string;
  minute: string;
  second: string;
}

function getFormatter(timeZone: string, includeWeekday = false): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
    ...(includeWeekday ? { weekday: 'short' } : {}),
  });
}

function getTimeZoneParts(date: Date, timeZone: string): TimeZoneParts {
  const parts = getFormatter(timeZone).formatToParts(date);
  const read = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? '';
  return {
    year: read('year'),
    month: read('month'),
    day: read('day'),
    hour: read('hour'),
    minute: read('minute'),
    second: read('second'),
  };
}

/**
 * Convert a local date + kickoff string (in the given sourceTimeZone) to a UTC instant.
 * Defaults to DEFAULT_APP_TIMEZONE for backwards compatibility with legacy provider data.
 */
export function convertLocalDateTimeToInstant(
  dateStr: string,
  kickoffStr: string,
  sourceTimeZone = DEFAULT_APP_TIMEZONE,
): Date {
  if (!dateStr) return new Date();

  let year: number;
  let month: number;
  let day: number;

  if (dateStr.includes('T')) {
    const date = new Date(dateStr);
    if (Number.isNaN(date.getTime())) return new Date();
    const parts = getTimeZoneParts(date, sourceTimeZone);
    year = Number(parts.year);
    month = Number(parts.month);
    day = Number(parts.day);
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

  // Reverse-Intl: find the UTC instant that corresponds to (year/month/day hours:minutes)
  // in the given sourceTimeZone, handling DST correctly.
  const approxUtc = new Date(Date.UTC(year, month - 1, day, hours, minutes, 0));
  const tzParts = getTimeZoneParts(approxUtc, sourceTimeZone);
  const offset =
    approxUtc.getTime() -
    Date.UTC(
      Number(tzParts.year),
      Number(tzParts.month) - 1,
      Number(tzParts.day),
      Number(tzParts.hour),
      Number(tzParts.minute),
      Number(tzParts.second),
    );
  return new Date(approxUtc.getTime() + offset);
}

export function formatDateKeyInTimeZone(date: Date, timeZone: string): string {
  const parts = getTimeZoneParts(date, timeZone);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function getDateKeyAtOffsetInTimeZone(offsetDays: number, timeZone: string): string {
  return formatDateKeyInTimeZone(new Date(Date.now() + offsetDays * 24 * 60 * 60 * 1000), timeZone);
}

export function getMatchDateKeyInTimeZone(
  dateStr: string,
  kickoffStr: string,
  userTimeZone: string,
  sourceTimeZone = DEFAULT_APP_TIMEZONE,
): string | null {
  const kickoff = convertLocalDateTimeToInstant(dateStr, kickoffStr, sourceTimeZone);
  if (Number.isNaN(kickoff.getTime())) return null;
  return formatDateKeyInTimeZone(kickoff, userTimeZone);
}

export function getDateGroupLabelInTimeZone(date: Date, timeZone: string): string {
  const today = getDateKeyAtOffsetInTimeZone(0, timeZone);
  const tomorrow = getDateKeyAtOffsetInTimeZone(1, timeZone);
  const dateKey = formatDateKeyInTimeZone(date, timeZone);
  if (dateKey === today) return 'Today';
  if (dateKey === tomorrow) return 'Tomorrow';
  return new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'long',
    month: 'short',
    day: 'numeric',
  }).format(date);
}

export function formatDateForTimeZone(date: Date, fmt: string, timeZone: string): string {
  const parts = getTimeZoneParts(date, timeZone);
  const monthIndex = Math.max(0, Math.min(11, Number(parts.month) - 1));
  const monthShort = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][monthIndex] ?? 'Jan';
  return fmt
    .replace('DD', parts.day)
    .replace('MMM', monthShort)
    .replace('YYYY', parts.year)
    .replace('YY', parts.year.slice(2))
    .replace('HH', parts.hour)
    .replace('mm', parts.minute)
    .replace('ss', parts.second);
}
