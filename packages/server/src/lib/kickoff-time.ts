function parseKickoffParts(kickoff: string): { hour: number; minute: number; second: number } | null {
  const match = /^(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(kickoff.trim());
  if (!match) return null;

  const hour = Number(match[1]);
  const minute = Number(match[2]);
  const second = Number(match[3] ?? '0');
  if (
    !Number.isInteger(hour)
    || !Number.isInteger(minute)
    || !Number.isInteger(second)
    || hour < 0
    || hour > 23
    || minute < 0
    || minute > 59
    || second < 0
    || second > 59
  ) {
    return null;
  }

  return { hour, minute, second };
}

function getTimeZoneParts(date: Date, timeZone: string): {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
} {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);

  const read = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((part) => part.type === type)?.value ?? '0');

  return {
    year: read('year'),
    month: read('month'),
    day: read('day'),
    hour: read('hour'),
    minute: read('minute'),
    second: read('second'),
  };
}

export function kickoffAtUtcFromFixtureDate(value: string | null | undefined): string | null {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

export function kickoffAtUtcFromLocalParts(
  date: string | null | undefined,
  kickoff: string | null | undefined,
  timeZone: string,
): string | null {
  if (!date || !kickoff) return null;

  const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date.trim());
  const kickoffParts = parseKickoffParts(kickoff);
  if (!dateMatch || !kickoffParts) return null;

  const year = Number(dateMatch[1]);
  const month = Number(dateMatch[2]);
  const day = Number(dateMatch[3]);
  const { hour, minute, second } = kickoffParts;

  const targetUtcMs = Date.UTC(year, month - 1, day, hour, minute, second);
  let guessUtcMs = targetUtcMs;

  for (let i = 0; i < 4; i += 1) {
    const parts = getTimeZoneParts(new Date(guessUtcMs), timeZone);
    const observedUtcMs = Date.UTC(
      parts.year,
      parts.month - 1,
      parts.day,
      parts.hour,
      parts.minute,
      parts.second,
    );
    const diff = targetUtcMs - observedUtcMs;
    guessUtcMs += diff;
    if (diff === 0) break;
  }

  return new Date(guessUtcMs).toISOString();
}