import { beforeEach, describe, expect, test, vi } from 'vitest';
import { buildTimeZoneOptions, readUserTimeZoneState } from '@/lib/utils/timezone';

describe('readUserTimeZoneState', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  test('returns saved timezone when present', () => {
    localStorage.setItem('liveMonitorConfig', JSON.stringify({
      USER_TIMEZONE: 'Europe/London',
      USER_TIMEZONE_CONFIRMED: true,
    }));

    const state = readUserTimeZoneState();
    expect(state.userTimeZone).toBe('Europe/London');
    expect(state.confirmed).toBe(true);
    expect(state.effectiveTimeZone).toBe('Europe/London');
    expect(state.source).toBe('user');
  });

  test('builds a unique timezone option list with extras first', () => {
    const options = buildTimeZoneOptions('Europe/London', 'Asia/Seoul', 'Europe/London');

    expect(options[0]).toBe('Europe/London');
    expect(options).toContain('Asia/Seoul');
    expect(options.filter((option) => option === 'Europe/London')).toHaveLength(1);
  });

  test('uses browser timezone as effective fallback when no user timezone is saved', () => {
    const state = readUserTimeZoneState();

    expect(state.userTimeZone).toBeNull();
    expect(state.confirmed).toBe(false);
    expect(typeof state.effectiveTimeZone).toBe('string');
  });
});
