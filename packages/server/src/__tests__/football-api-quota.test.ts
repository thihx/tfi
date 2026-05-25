import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const mockRedis = {
  incr: vi.fn().mockResolvedValue(1),
  get: vi.fn().mockResolvedValue(null),
  set: vi.fn().mockResolvedValue('OK'),
  expire: vi.fn().mockResolvedValue(1),
};

vi.mock('../lib/redis.js', () => ({
  getRedisClient: () => mockRedis,
}));

const mockOpenCircuit = vi.fn().mockResolvedValue(new Date().toISOString());

vi.mock('../lib/football-api-circuit.js', () => ({
  openFootballApiCircuitUntilNextUtcMidnight: (...args: unknown[]) => mockOpenCircuit(...args),
}));

vi.mock('../config.js', () => ({
  config: {
    footballApiDailyLimit: 7000,
    footballApiElevatedPct: 60,
    footballApiHighPct: 80,
    footballApiCriticalPct: 95,
  },
}));

const {
  computeQuotaTier,
  incrementFootballApiDailyCount,
  getFootballApiDailyCount,
  shouldThrottleJob,
  checkAndTripCircuitAtCritical,
  getFootballApiQuotaStatus,
  resetFootballApiQuotaForTests,
} = await import('../lib/football-api-quota.js');

beforeEach(() => {
  vi.clearAllMocks();
  resetFootballApiQuotaForTests();
  mockRedis.incr.mockResolvedValue(1);
  mockRedis.get.mockResolvedValue(null);
});

afterEach(() => {
  resetFootballApiQuotaForTests();
});

describe('computeQuotaTier', () => {
  test('returns normal below elevated threshold', () => {
    expect(computeQuotaTier(4000, 7000)).toBe('normal');
    expect(computeQuotaTier(0, 7000)).toBe('normal');
  });

  test('returns elevated at 60% threshold', () => {
    expect(computeQuotaTier(4200, 7000)).toBe('elevated');
    expect(computeQuotaTier(5000, 7000)).toBe('elevated');
  });

  test('returns high at 80% threshold', () => {
    expect(computeQuotaTier(5600, 7000)).toBe('high');
    expect(computeQuotaTier(6000, 7000)).toBe('high');
  });

  test('returns critical at 95% threshold', () => {
    expect(computeQuotaTier(6650, 7000)).toBe('critical');
    expect(computeQuotaTier(7000, 7000)).toBe('critical');
  });

  test('returns normal when limit is 0', () => {
    expect(computeQuotaTier(100, 0)).toBe('normal');
  });

  test('boundary: exactly at elevated threshold', () => {
    expect(computeQuotaTier(4200, 7000)).toBe('elevated');
  });

  test('boundary: just below elevated threshold', () => {
    expect(computeQuotaTier(4199, 7000)).toBe('normal');
  });
});

describe('incrementFootballApiDailyCount', () => {
  test('increments Redis counter and returns new count', async () => {
    mockRedis.incr.mockResolvedValue(42);
    const count = await incrementFootballApiDailyCount();
    expect(count).toBe(42);
    expect(mockRedis.incr).toHaveBeenCalledTimes(1);
  });

  test('sets TTL on first increment', async () => {
    mockRedis.incr.mockResolvedValue(1);
    await incrementFootballApiDailyCount();
    expect(mockRedis.expire).toHaveBeenCalled();
  });

  test('does not set TTL on subsequent increments', async () => {
    mockRedis.incr.mockResolvedValue(5);
    await incrementFootballApiDailyCount();
    expect(mockRedis.expire).not.toHaveBeenCalled();
  });

  test('falls back to in-memory count when Redis is unavailable', async () => {
    mockRedis.incr.mockRejectedValue(new Error('redis down'));
    const count1 = await incrementFootballApiDailyCount();
    expect(count1).toBe(1);
    const count2 = await incrementFootballApiDailyCount();
    expect(count2).toBe(2);
  });
});

describe('getFootballApiDailyCount', () => {
  test('reads from Redis and updates in-memory', async () => {
    mockRedis.get.mockResolvedValue('500');
    const count = await getFootballApiDailyCount();
    expect(count).toBe(500);
  });

  test('falls back to memory when Redis is unavailable', async () => {
    mockRedis.get.mockRejectedValue(new Error('redis down'));
    mockRedis.incr.mockRejectedValue(new Error('redis down'));
    await incrementFootballApiDailyCount();
    await incrementFootballApiDailyCount();
    const count = await getFootballApiDailyCount();
    expect(count).toBe(2);
  });
});

describe('shouldThrottleJob', () => {
  test('never throttles live-critical jobs', async () => {
    mockRedis.get.mockResolvedValue('6900');
    expect(await shouldThrottleJob('fetch-matches')).toBe(false);
    expect(await shouldThrottleJob('refresh-live-matches')).toBe(false);
    expect(await shouldThrottleJob('check-live-trigger')).toBe(false);
  });

  test('throttles non-critical jobs at critical tier', async () => {
    mockRedis.get.mockResolvedValue('6700');
    expect(await shouldThrottleJob('sync-reference-data')).toBe(true);
    expect(await shouldThrottleJob('refresh-provider-insights')).toBe(true);
    expect(await shouldThrottleJob('update-predictions')).toBe(true);
  });

  test('throttles low-priority jobs at high tier', async () => {
    mockRedis.get.mockResolvedValue('5700');
    expect(await shouldThrottleJob('sync-reference-data')).toBe(true);
    expect(await shouldThrottleJob('refresh-provider-insights')).toBe(true);
  });

  test('throttles low-priority at elevated tier but not important jobs', async () => {
    mockRedis.get.mockResolvedValue('4500');
    expect(await shouldThrottleJob('sync-reference-data')).toBe(true);
    expect(await shouldThrottleJob('update-predictions')).toBe(false);
    expect(await shouldThrottleJob('refresh-provider-insights')).toBe(false);
  });

  test('does not throttle any job at normal tier', async () => {
    mockRedis.get.mockResolvedValue('3000');
    expect(await shouldThrottleJob('sync-reference-data')).toBe(false);
    expect(await shouldThrottleJob('refresh-provider-insights')).toBe(false);
    expect(await shouldThrottleJob('update-predictions')).toBe(false);
  });
});

describe('checkAndTripCircuitAtCritical', () => {
  test('opens circuit breaker at critical tier', async () => {
    mockRedis.get.mockResolvedValue('6700');
    const tripped = await checkAndTripCircuitAtCritical();
    expect(tripped).toBe(true);
    expect(mockOpenCircuit).toHaveBeenCalled();
  });

  test('does not open circuit breaker below critical tier', async () => {
    mockRedis.get.mockResolvedValue('5000');
    const tripped = await checkAndTripCircuitAtCritical();
    expect(tripped).toBe(false);
    expect(mockOpenCircuit).not.toHaveBeenCalled();
  });
});

describe('getFootballApiQuotaStatus', () => {
  test('returns complete status with tier and percentage', async () => {
    mockRedis.get.mockResolvedValue('3500');
    const status = await getFootballApiQuotaStatus();
    expect(status.count).toBe(3500);
    expect(status.limit).toBe(7000);
    expect(status.tier).toBe('normal');
    expect(status.pct).toBe(50);
  });

  test('returns critical status at high usage', async () => {
    mockRedis.get.mockResolvedValue('6800');
    const status = await getFootballApiQuotaStatus();
    expect(status.tier).toBe('critical');
    expect(status.pct).toBeGreaterThan(95);
  });
});