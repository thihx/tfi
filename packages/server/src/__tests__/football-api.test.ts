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
    const { resetFootballApiInFlightForTests } = await import('../lib/football-api.js');
    resetFootballApiInFlightForTests();
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

  test('coalesces concurrent equivalent provider requests', async () => {
    let resolveFetch: (value: unknown) => void = () => {};
    const fetchPromise = new Promise((resolve) => {
      resolveFetch = resolve;
    });
    global.fetch = vi.fn(() => fetchPromise) as unknown as typeof fetch;

    const { fetchFixturesByIds } = await import('../lib/football-api.js');
    const first = fetchFixturesByIds(['2', '1']);
    const second = fetchFixturesByIds(['1', '2']);

    await vi.waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(1));

    resolveFetch({
      ok: true,
      status: 200,
      json: async () => ({
        errors: {},
        results: 2,
        response: [{ fixture: { id: 1 } }, { fixture: { id: 2 } }],
      }),
    });

    await expect(Promise.all([first, second])).resolves.toEqual([
      [{ fixture: { id: 1 } }, { fixture: { id: 2 } }],
      [{ fixture: { id: 1 } }, { fixture: { id: 2 } }],
    ]);
    expect(mockRecordApiFootballRequestSafe).toHaveBeenCalledTimes(1);
  });

  test('does not reuse coalesced provider requests after they settle', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ errors: {}, results: 1, response: [{ fixture: { id: 1 } }] }),
    });

    const { fetchFixturesByIds } = await import('../lib/football-api.js');
    await expect(fetchFixturesByIds(['1'])).resolves.toEqual([{ fixture: { id: 1 } }]);
    await expect(fetchFixturesByIds(['1'])).resolves.toEqual([{ fixture: { id: 1 } }]);

    expect(global.fetch).toHaveBeenCalledTimes(2);
    expect(mockRecordApiFootballRequestSafe).toHaveBeenCalledTimes(2);
  });

  test('does not open circuit for healthy status quota metadata', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({
        get: 'status',
        errors: [],
        response: {
          account: { firstname: 'Test' },
          subscription: { plan: 'Pro', active: true },
          requests: { current: 196, limit_day: 7500 },
        },
      }),
    });

    const { fetchFootballApiStatus } = await import('../lib/football-api.js');
    const result = await fetchFootballApiStatus();

    expect(result.ok).toBe(true);
    expect(mockOpenFootballApiCircuitUntilNextUtcMidnight).not.toHaveBeenCalled();
    expect(mockRecordApiFootballRequestSafe).toHaveBeenCalledWith(expect.objectContaining({
      endpoint: '/status',
      success: true,
      dailyLimit: false,
      statusCode: 200,
      quotaCurrent: 196,
      quotaLimit: 7500,
    }));
  });
});
