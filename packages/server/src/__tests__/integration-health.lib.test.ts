// ============================================================
// Unit tests — integration-health.ts (probe functions)
// ============================================================

import { describe, test, expect, vi, beforeEach } from 'vitest';

// ── Mock all external dependencies ───────────────────────────

vi.mock('../db/pool.js', () => ({
  query: vi.fn(),
}));

vi.mock('../lib/redis.js', () => ({
  getRedisClient: vi.fn(),
}));

const mockOpenFootballApiCircuitUntilNextUtcMidnight = vi.fn().mockResolvedValue('2026-05-24T00:00:00.000Z');
const mockGetFootballApiCircuitStatus = vi.fn().mockResolvedValue({ open: false, openUntil: null });
const mockFetchFootballApiStatus = vi.fn().mockResolvedValue({
  ok: true,
  status: 200,
  data: { response: { account: { requests: { current: 42, limit_day: 100 } } } },
  text: JSON.stringify({ response: { account: { requests: { current: 42, limit_day: 100 } } } }),
});

vi.mock('../lib/football-api-circuit.js', () => ({
  getFootballApiCircuitStatus: (...args: unknown[]) => mockGetFootballApiCircuitStatus(...args),
  isFootballApiDailyLimitMessage: (message: string) => message.toLowerCase().includes('request limit for the day'),
  openFootballApiCircuitUntilNextUtcMidnight: (...args: unknown[]) => mockOpenFootballApiCircuitUntilNextUtcMidnight(...args),
}));

vi.mock('../lib/football-api.js', () => ({
  fetchFootballApiStatus: (...args: unknown[]) => mockFetchFootballApiStatus(...args),
}));

vi.mock('../config.js', () => ({
  config: {
    redisUrl:           'redis://localhost:6379',
    footballApiKey:     'fb-key-123',
    footballApiBaseUrl: 'https://v3.football.api-sports.io',
    footballApiCircuitEnabled: true,
    geminiApiKey:       'gemini-key-123',
    geminiModel:        'gemini-3.5-flash',
    telegramBotToken:   'bot123:TOKEN',
    googleClientId:     'google-client-id',
    googleClientSecret: 'google-client-secret',
  },
}));

// ── Helpers ───────────────────────────────────────────────────

import { query } from '../db/pool.js';
import { getRedisClient } from '../lib/redis.js';

const mockQuery  = vi.mocked(query);
const mockGetRedis = vi.mocked(getRedisClient);

/** Build a mock fetch response */
function mockFetch(status: number, body: unknown = {}) {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  });
}

function mockFetchError(message: string) {
  return vi.fn().mockRejectedValue(new Error(message));
}

beforeEach(() => {
  vi.clearAllMocks();
  mockOpenFootballApiCircuitUntilNextUtcMidnight.mockResolvedValue('2026-05-24T00:00:00.000Z');
  mockGetFootballApiCircuitStatus.mockResolvedValue({ open: false, openUntil: null });
  mockFetchFootballApiStatus.mockResolvedValue({
    ok: true,
    status: 200,
    data: { response: { account: { requests: { current: 42, limit_day: 100 } } } },
    text: JSON.stringify({ response: { account: { requests: { current: 42, limit_day: 100 } } } }),
  });
});

// ── Tests ─────────────────────────────────────────────────────

describe('checkAllIntegrations', () => {
  test('returns snapshot with overall status and all integrations', async () => {
    // Postgres OK
    mockQuery.mockResolvedValue({ rows: [{ '?column?': 1 }] } as never);
    // Redis OK
    mockGetRedis.mockReturnValue({ ping: vi.fn().mockResolvedValue('PONG') } as never);
    // All fetch calls return 200
    global.fetch = mockFetch(200, {
      response: { account: { requests: { current: 50, limit_day: 100 } } },
    });

    const { checkAllIntegrations } = await import('../lib/integration-health.js');
    const snapshot = await checkAllIntegrations();

    expect(snapshot.services).toHaveLength(6);
    expect(snapshot.checkedAt).toBeTruthy();
    expect(snapshot.durationMs).toBeGreaterThanOrEqual(0);
    expect(['HEALTHY', 'DEGRADED', 'DOWN', 'NOT_CONFIGURED']).toContain(snapshot.overall);
  });
});

describe('checkSingleIntegration', () => {
  test('returns null for unknown service id', async () => {
    const { checkSingleIntegration } = await import('../lib/integration-health.js');
    const result = await checkSingleIntegration('non-existent');
    expect(result).toBeNull();
  });

  test('returns result for known service id', async () => {
    mockQuery.mockResolvedValue({ rows: [{ '?column?': 1 }] } as never);
    const { checkSingleIntegration } = await import('../lib/integration-health.js');
    const result = await checkSingleIntegration('postgresql');
    expect(result).not.toBeNull();
    expect(result!.id).toBe('postgresql');
  });
});

// ── PostgreSQL probe ──────────────────────────────────────────

describe('PostgreSQL probe', () => {
  test('HEALTHY when SELECT 1 succeeds', async () => {
    mockQuery.mockResolvedValue({ rows: [{ '?column?': 1 }] } as never);
    const { checkSingleIntegration } = await import('../lib/integration-health.js');
    const result = await checkSingleIntegration('postgresql');
    expect(result!.status).toBe('HEALTHY');
    expect(result!.latencyMs).toBeGreaterThanOrEqual(0);
  });

  test('DOWN when query throws', async () => {
    mockQuery.mockRejectedValue(new Error('Connection refused'));
    const { checkSingleIntegration } = await import('../lib/integration-health.js');
    const result = await checkSingleIntegration('postgresql');
    expect(result!.status).toBe('DOWN');
    expect(result!.message).toContain('Connection refused');
  });
});

// ── Redis probe ───────────────────────────────────────────────

describe('Redis probe', () => {
  test('HEALTHY when PING returns PONG', async () => {
    mockGetRedis.mockReturnValue({ ping: vi.fn().mockResolvedValue('PONG') } as never);
    const { checkSingleIntegration } = await import('../lib/integration-health.js');
    const result = await checkSingleIntegration('redis');
    expect(result!.status).toBe('HEALTHY');
  });

  test('DEGRADED when PING returns unexpected value', async () => {
    mockGetRedis.mockReturnValue({ ping: vi.fn().mockResolvedValue('OK') } as never);
    const { checkSingleIntegration } = await import('../lib/integration-health.js');
    const result = await checkSingleIntegration('redis');
    expect(result!.status).toBe('DEGRADED');
    expect(result!.message).toContain('OK');
  });

  test('DOWN when PING throws', async () => {
    mockGetRedis.mockReturnValue({ ping: vi.fn().mockRejectedValue(new Error('ECONNREFUSED')) } as never);
    const { checkSingleIntegration } = await import('../lib/integration-health.js');
    const result = await checkSingleIntegration('redis');
    expect(result!.status).toBe('DOWN');
  });

  test('NOT_CONFIGURED when REDIS_URL empty', async () => {
    vi.doMock('../config.js', () => ({
      config: {
        redisUrl: '',
        footballApiKey: 'key', footballApiBaseUrl: 'https://x.com',
        geminiApiKey: 'key', geminiModel: 'gemini-3.5-flash',
        telegramBotToken: 'token',
        googleClientId: 'cid', googleClientSecret: 'csec',
      },
    }));
    // Re-import after mock override
    vi.resetModules();
    const { checkSingleIntegration } = await import('../lib/integration-health.js');
    const result = await checkSingleIntegration('redis');
    expect(result!.status).toBe('NOT_CONFIGURED');
  });
});

// ── Football API probe ────────────────────────────────────────

describe('Football API probe', () => {
  test('HEALTHY with usage message when /status returns 200', async () => {
    mockFetchFootballApiStatus.mockResolvedValueOnce({
      ok: true,
      status: 200,
      data: {
        response: { account: { requests: { current: 42, limit_day: 100 } } },
      },
      text: JSON.stringify({
        response: { account: { requests: { current: 42, limit_day: 100 } } },
      }),
    });
    const { checkSingleIntegration } = await import('../lib/integration-health.js');
    const result = await checkSingleIntegration('football-api');
    expect(result!.status).toBe('HEALTHY');
    expect(result!.message).toContain('42/100');
  });

  test('DEGRADED when /status returns non-200', async () => {
    mockFetchFootballApiStatus.mockResolvedValueOnce({
      ok: false,
      status: 429,
      data: {},
      text: '',
    });
    const { checkSingleIntegration } = await import('../lib/integration-health.js');
    const result = await checkSingleIntegration('football-api');
    expect(result!.status).toBe('DEGRADED');
    expect(result!.message).toContain('429');
  });

  test('opens circuit when usage reports daily quota exhausted', async () => {
    mockFetchFootballApiStatus.mockResolvedValueOnce({
      ok: true,
      status: 200,
      data: {
        response: { account: { requests: { current: 7000, limit_day: 7000 } } },
      },
      text: JSON.stringify({
        response: { account: { requests: { current: 7000, limit_day: 7000 } } },
      }),
    });
    const { checkSingleIntegration } = await import('../lib/integration-health.js');
    const result = await checkSingleIntegration('football-api');
    expect(result!.status).toBe('HEALTHY');
    expect(result!.message).toContain('7000/7000');
    expect(mockOpenFootballApiCircuitUntilNextUtcMidnight).toHaveBeenCalledTimes(1);
  });

  test('opens circuit when /status payload contains daily limit error', async () => {
    mockFetchFootballApiStatus.mockResolvedValueOnce({
      ok: true,
      status: 200,
      data: {
        errors: {
          requests: 'You have reached the request limit for the day, Go to https://dashboard.api-football.com to upgrade your plan.',
        },
      },
      text: JSON.stringify({
        errors: {
          requests: 'You have reached the request limit for the day, Go to https://dashboard.api-football.com to upgrade your plan.',
        },
      }),
    });
    const { checkSingleIntegration } = await import('../lib/integration-health.js');
    const result = await checkSingleIntegration('football-api');
    expect(result!.status).toBe('DEGRADED');
    expect(mockOpenFootballApiCircuitUntilNextUtcMidnight).toHaveBeenCalledTimes(1);
  });

  test('does not probe Football API when daily-limit circuit is open', async () => {
    const fetchMock = mockFetch(200, {
      response: { account: { requests: { current: 42, limit_day: 100 } } },
    });
    global.fetch = fetchMock;
    mockGetFootballApiCircuitStatus.mockResolvedValueOnce({
      open: true,
      openUntil: '2026-05-24T00:00:00.000Z',
    });

    const { checkSingleIntegration } = await import('../lib/integration-health.js');
    const result = await checkSingleIntegration('football-api');

    expect(result!.status).toBe('DEGRADED');
    expect(result!.message).toContain('2026-05-24T00:00:00.000Z');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(mockFetchFootballApiStatus).not.toHaveBeenCalled();
  });

  test('DOWN when fetch throws (network error)', async () => {
    mockFetchFootballApiStatus.mockRejectedValueOnce(new Error('fetch failed'));
    const { checkSingleIntegration } = await import('../lib/integration-health.js');
    const result = await checkSingleIntegration('football-api');
    expect(result!.status).toBe('DOWN');
  });
});

// ── Gemini probe ──────────────────────────────────────────────

describe('Gemini probe', () => {
  test('HEALTHY when models endpoint returns 200', async () => {
    global.fetch = mockFetch(200, { models: [] });
    const { checkSingleIntegration } = await import('../lib/integration-health.js');
    const result = await checkSingleIntegration('gemini');
    expect(result!.status).toBe('HEALTHY');
  });

  test('DOWN when returns 403 (bad key)', async () => {
    global.fetch = mockFetch(403);
    const { checkSingleIntegration } = await import('../lib/integration-health.js');
    const result = await checkSingleIntegration('gemini');
    expect(result!.status).toBe('DOWN');
  });

  test('DOWN when network error', async () => {
    global.fetch = mockFetchError('network error');
    const { checkSingleIntegration } = await import('../lib/integration-health.js');
    const result = await checkSingleIntegration('gemini');
    expect(result!.status).toBe('DOWN');
  });
});

// ── Telegram probe ────────────────────────────────────────────

describe('Telegram probe', () => {
  test('HEALTHY with bot username when getMe returns ok:true', async () => {
    global.fetch = mockFetch(200, { ok: true, result: { username: 'tfi_bot' } });
    const { checkSingleIntegration } = await import('../lib/integration-health.js');
    const result = await checkSingleIntegration('telegram');
    expect(result!.status).toBe('HEALTHY');
    expect(result!.message).toContain('tfi_bot');
  });

  test('DOWN when getMe returns ok:false (invalid token)', async () => {
    global.fetch = mockFetch(200, { ok: false });
    const { checkSingleIntegration } = await import('../lib/integration-health.js');
    const result = await checkSingleIntegration('telegram');
    expect(result!.status).toBe('DOWN');
  });

  test('DOWN on network error', async () => {
    global.fetch = mockFetchError('timeout');
    const { checkSingleIntegration } = await import('../lib/integration-health.js');
    const result = await checkSingleIntegration('telegram');
    expect(result!.status).toBe('DOWN');
  });
});

// ── Google OAuth probe ────────────────────────────────────────

describe('Google OAuth probe', () => {
  test('HEALTHY when OIDC discovery endpoint reachable', async () => {
    global.fetch = mockFetch(200, { issuer: 'https://accounts.google.com' });
    const { checkSingleIntegration } = await import('../lib/integration-health.js');
    const result = await checkSingleIntegration('google-oauth');
    expect(result!.status).toBe('HEALTHY');
  });

  test('DEGRADED when endpoint returns non-200', async () => {
    global.fetch = mockFetch(503);
    const { checkSingleIntegration } = await import('../lib/integration-health.js');
    const result = await checkSingleIntegration('google-oauth');
    expect(result!.status).toBe('DEGRADED');
  });

  test('DOWN on network error', async () => {
    global.fetch = mockFetchError('DNS lookup failed');
    const { checkSingleIntegration } = await import('../lib/integration-health.js');
    const result = await checkSingleIntegration('google-oauth');
    expect(result!.status).toBe('DOWN');
  });
});
