import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const mockAssertFootballApiAvailable = vi.fn().mockResolvedValue(undefined);
const mockOpenFootballApiCircuitUntilNextUtcMidnight = vi.fn().mockResolvedValue('2026-05-24T00:00:00.000Z');

vi.mock('../config.js', () => ({
  config: {
    footballApiKey: 'test-key',
    footballApiBaseUrl: 'https://v3.football.api-sports.io',
    timezone: 'Asia/Seoul',
    footballApiCircuitEnabled: true,
  },
}));

vi.mock('../lib/redis.js', () => ({
  getRedisClient: () => ({
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn().mockResolvedValue('OK'),
    incr: vi.fn().mockResolvedValue(1),
    expire: vi.fn().mockResolvedValue(1),
  }),
}));

const mockRecordApiFootballRequestSafe = vi.fn().mockResolvedValue(undefined);

vi.mock('../repos/api-football-request-ledger.repo.js', () => ({
  recordApiFootballRequestSafe: (...args: unknown[]) => mockRecordApiFootballRequestSafe(...args),
}));

vi.mock('../lib/football-api-circuit.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/football-api-circuit.js')>();
  return {
    ...actual,
    assertFootballApiAvailable: (...args: unknown[]) => mockAssertFootballApiAvailable(...args),
    openFootballApiCircuitUntilNextUtcMidnight: (...args: unknown[]) =>
      mockOpenFootballApiCircuitUntilNextUtcMidnight(...args),
  };
});

describe('football-api apiGet', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();
    vi.useFakeTimers();
    mockAssertFootballApiAvailable.mockResolvedValue(undefined);
    mockOpenFootballApiCircuitUntilNextUtcMidnight.mockResolvedValue('2026-05-24T00:00:00.000Z');
    const { resetFootballApiCircuitForTests } = await import('../lib/football-api-circuit.js');
    resetFootballApiCircuitForTests();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  test('does not call fetch when circuit is already open', async () => {
    const { FootballApiDailyLimitError } = await import('../lib/football-api-circuit.js');
    mockAssertFootballApiAvailable.mockRejectedValueOnce(new FootballApiDailyLimitError('2026-05-24T00:00:00.000Z'));
    global.fetch = vi.fn();

    const { fetchFixturesForDate } = await import('../lib/football-api.js');
    await expect(fetchFixturesForDate('2026-05-23')).rejects.toBeInstanceOf(FootballApiDailyLimitError);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('opens circuit and does not retry when API returns daily limit in errors payload', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        errors: {
          requests: 'You have reached the request limit for the day, Go to https://dashboard.api-football.com to upgrade your plan.',
        },
        response: [],
      }),
    });

    const { fetchFixturesForDate } = await import('../lib/football-api.js');
    await expect(fetchFixturesForDate('2026-05-23')).rejects.toThrow(/football_api_daily_limit/);
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(mockOpenFootballApiCircuitUntilNextUtcMidnight).toHaveBeenCalledTimes(1);
  });

  test('retries transient failures but not daily limit errors', async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 500,
        text: async () => 'internal error',
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ errors: {}, response: [{ fixture: { id: 1 } }] }),
      });

    const { fetchFixturesByIds } = await import('../lib/football-api.js');
    const promise = fetchFixturesByIds(['1']);
    await vi.advanceTimersByTimeAsync(1000);
    await expect(promise).resolves.toEqual([{ fixture: { id: 1 } }]);
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });
});
