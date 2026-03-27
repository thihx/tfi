import { describe, expect, test } from 'vitest';

import { kickoffAtUtcFromFixtureDate, kickoffAtUtcFromLocalParts } from '../lib/kickoff-time.js';

describe('kickoff time helpers', () => {
  test('parses fixture ISO into canonical UTC', () => {
    expect(kickoffAtUtcFromFixtureDate('2026-03-24T15:00:00+09:00')).toBe('2026-03-24T06:00:00.000Z');
  });

  test('resolves local date and kickoff in configured timezone into canonical UTC', () => {
    expect(kickoffAtUtcFromLocalParts('2026-03-24', '15:00', 'Asia/Seoul')).toBe('2026-03-24T06:00:00.000Z');
  });

  test('returns null for invalid inputs', () => {
    expect(kickoffAtUtcFromFixtureDate('bad-date')).toBeNull();
    expect(kickoffAtUtcFromLocalParts('2026-03-24', 'bad-time', 'Asia/Seoul')).toBeNull();
  });
});