import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const mockRedis = {
  get: vi.fn(),
  set: vi.fn().mockResolvedValue('OK'),
};

vi.mock('../lib/redis.js', () => ({
  getRedisClient: () => mockRedis,
}));

vi.mock('../config.js', () => ({
  config: {
    footballApiCircuitEnabled: true,
  },
}));

describe('football-api-circuit', () => {
  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    mockRedis.get.mockResolvedValue(null);
    const circuit = await import('../lib/football-api-circuit.js');
    circuit.resetFootballApiCircuitForTests();
  });

  afterEach(async () => {
    const circuit = await import('../lib/football-api-circuit.js');
    circuit.resetFootballApiCircuitForTests();
  });

  test('detects production daily limit messages', async () => {
    const { isFootballApiDailyLimitMessage } = await import('../lib/football-api-circuit.js');
    expect(isFootballApiDailyLimitMessage(
      'Football API errors: {"requests":"You have reached the request limit for the day, Go to https://dashboard.api-football.com to upgrade your plan."}',
    )).toBe(true);
    expect(isFootballApiDailyLimitMessage('temporary timeout')).toBe(false);
  });

  test('computes next UTC midnight', async () => {
    const { getNextUtcMidnightMs } = await import('../lib/football-api-circuit.js');
    const now = Date.parse('2026-05-23T12:34:56.000Z');
    expect(getNextUtcMidnightMs(now)).toBe(Date.parse('2026-05-24T00:00:00.000Z'));
  });

  test('opens circuit in Redis until the requested timestamp', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-23T12:00:00.000Z'));
    const untilMs = Date.parse('2026-05-24T00:00:00.000Z');
    const { openFootballApiCircuitUntil, isFootballApiCircuitOpen } = await import('../lib/football-api-circuit.js');

    await openFootballApiCircuitUntil(untilMs);

    expect(mockRedis.set).toHaveBeenCalledWith(
      'football-api:daily-limit-until',
      String(untilMs),
      'PX',
      untilMs - Date.now() + 5_000,
    );
    expect(await isFootballApiCircuitOpen()).toBe(true);
    vi.useRealTimers();
  });

  test('reads open circuit state from Redis', async () => {
    const untilMs = Date.now() + 60_000;
    mockRedis.get.mockResolvedValue(String(untilMs));
    const { isFootballApiCircuitOpen } = await import('../lib/football-api-circuit.js');
    expect(await isFootballApiCircuitOpen()).toBe(true);
  });

  test('skipIfFootballApiCircuitOpen returns skip payload when circuit is open', async () => {
    const untilMs = Date.parse('2026-05-24T00:00:00.000Z');
    mockRedis.get.mockResolvedValue(String(untilMs));
    const { skipIfFootballApiCircuitOpen } = await import('../lib/football-api-circuit.js');
    await expect(skipIfFootballApiCircuitOpen()).resolves.toEqual({
      skipped: true,
      skipReason: 'football_api_daily_limit',
      openUntil: '2026-05-24T00:00:00.000Z',
    });
  });

  test('uses in-memory fallback when Redis is unavailable', async () => {
    mockRedis.set.mockRejectedValueOnce(new Error('redis down'));
    const untilMs = Date.now() + 120_000;
    const { openFootballApiCircuitUntil, isFootballApiCircuitOpen } = await import('../lib/football-api-circuit.js');

    await openFootballApiCircuitUntil(untilMs);
    expect(await isFootballApiCircuitOpen()).toBe(true);
  });

  test('assertFootballApiAvailable throws FootballApiDailyLimitError when open', async () => {
    const untilMs = Date.parse('2026-05-24T00:00:00.000Z');
    mockRedis.get.mockResolvedValue(String(untilMs));
    const { assertFootballApiAvailable, FootballApiDailyLimitError } = await import('../lib/football-api-circuit.js');

    await expect(assertFootballApiAvailable()).rejects.toBeInstanceOf(FootballApiDailyLimitError);
  });
});
