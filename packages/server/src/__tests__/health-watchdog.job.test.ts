// ============================================================
// Unit tests — health-watchdog.job.ts
// ============================================================

import { describe, test, expect, vi, beforeEach } from 'vitest';

// ── Mocks ─────────────────────────────────────────────────────

vi.mock('../jobs/scheduler.js', () => ({ getJobsStatus: vi.fn(), getSchedulerUptime: vi.fn() }));
vi.mock('../lib/telegram.js', () => ({ sendTelegramMessage: vi.fn() }));
vi.mock('../lib/redis.js', () => ({ getRedisClient: vi.fn() }));
vi.mock('../config.js', () => ({
  config: { telegramBotToken: 'bot:TOKEN' },
}));
vi.mock('../lib/audit.js', () => ({ audit: vi.fn() }));
vi.mock('../jobs/job-progress.js', () => ({ reportJobProgress: vi.fn() }));
vi.mock('../lib/telegram-runtime.js', () => ({
  loadOperationalTelegramSettings: vi.fn().mockResolvedValue({
    chatId: 'chat123',
    enabled: true,
  }),
}));

import { getJobsStatus, getSchedulerUptime } from '../jobs/scheduler.js';
import { sendTelegramMessage } from '../lib/telegram.js';
import { getRedisClient } from '../lib/redis.js';
import { healthWatchdogJob, _resetCooldownForTesting } from '../jobs/health-watchdog.job.js';

const mockGetJobsStatus = vi.mocked(getJobsStatus);
const mockGetSchedulerUptime = vi.mocked(getSchedulerUptime);
const mockSendTelegram = vi.mocked(sendTelegramMessage);
const mockGetRedis = vi.mocked(getRedisClient);

// ── Helpers ───────────────────────────────────────────────────

const NOW = Date.now();

/** Build a minimal JobInfo for a critical job */
function makeJob(overrides: {
  name?: string;
  intervalMs?: number;
  lastRun?: string | null;
  running?: boolean;
  skipKey?: string;
} = {}) {
  const intervalMs = overrides.intervalMs ?? 60_000;
  return {
    name: overrides.name ?? 'fetch-matches',
    intervalMs,
    lastRun: overrides.lastRun ?? new Date(NOW - intervalMs * 0.5).toISOString(), // recent
    lastError: null,
    running: overrides.running ?? false,
    enabled: true,
    runCount: 10,
    progress: null,
    skipKey: overrides.skipKey,
  };
}

/** Redis mock that returns null for all gets */
function makeRedisMock(overrides: {
  get?: (key: string) => Promise<string | null>;
  set?: () => Promise<string>;
  del?: () => Promise<number>;
} = {}) {
  return {
    get: vi.fn().mockImplementation(overrides.get ?? (() => Promise.resolve(null))),
    set: vi.fn().mockImplementation(overrides.set ?? (() => Promise.resolve('OK'))),
    del: vi.fn().mockImplementation(overrides.del ?? (() => Promise.resolve(1))),
  } as never;
}

beforeEach(() => {
  vi.clearAllMocks();
  // Reset module-level in-memory cooldown between tests to prevent inter-test interference
  _resetCooldownForTesting();
  // Default: scheduler has been up > 3 minutes (past startup grace)
  mockGetSchedulerUptime.mockReturnValue(10 * 60_000);
  // Default: Redis returns null (no prior alert state, no skip key)
  mockGetRedis.mockReturnValue(makeRedisMock());
});

// ── Startup grace ─────────────────────────────────────────────

describe('startup grace period', () => {
  test('returns empty result within first 3 minutes', async () => {
    mockGetSchedulerUptime.mockReturnValue(1 * 60_000); // 1 min uptime
    const result = await healthWatchdogJob();
    expect(result.checked).toBe(0);
    expect(mockSendTelegram).not.toHaveBeenCalled();
  });
});

// ── Healthy job — no alert ────────────────────────────────────

describe('healthy job', () => {
  test('no alert when job ran recently (within 2.5x interval)', async () => {
    const job = makeJob({ lastRun: new Date(NOW - 60_000).toISOString() }); // 1 min ago, interval 1 min
    mockGetJobsStatus.mockResolvedValue([job]);
    const result = await healthWatchdogJob();
    expect(result.alerted).toBe(0);
    expect(mockSendTelegram).not.toHaveBeenCalled();
  });

  test('non-critical job is ignored', async () => {
    const job = { ...makeJob(), name: 'purge-audit', lastRun: new Date(NOW - 999_999).toISOString() };
    mockGetJobsStatus.mockResolvedValue([job]);
    const result = await healthWatchdogJob();
    expect(result.checked).toBe(0);
    expect(mockSendTelegram).not.toHaveBeenCalled();
  });

  test('disabled job is ignored', async () => {
    const job = { ...makeJob(), enabled: false, lastRun: new Date(NOW - 999_999).toISOString() };
    mockGetJobsStatus.mockResolvedValue([job]);
    const result = await healthWatchdogJob();
    expect(result.checked).toBe(0);
    expect(mockSendTelegram).not.toHaveBeenCalled();
  });

  test('does not alert a 5-second job just because it ran longer than 50 seconds', async () => {
    const job = {
      ...makeJob({
        name: 'check-live-trigger',
        intervalMs: 5_000,
        running: true,
      }),
      lastStartedAt: new Date(NOW - 55_000).toISOString(),
      lastCompletedAt: new Date(NOW - 60_000).toISOString(),
      lastHeartbeatAt: new Date(NOW - 5_000).toISOString(),
    };
    mockGetJobsStatus.mockResolvedValue([job]);

    const result = await healthWatchdogJob();
    expect(result.alerted).toBe(0);
    expect(mockSendTelegram).not.toHaveBeenCalled();
  });
});

// ── Overdue job — alert sent ──────────────────────────────────

describe('overdue job', () => {
  test('sends alert when job last ran > 2.5x interval ago', async () => {
    const job = makeJob({ lastRun: new Date(NOW - 3 * 60_000).toISOString() }); // 3 min ago, 1 min interval
    mockGetJobsStatus.mockResolvedValue([job]);
    const result = await healthWatchdogJob();
    expect(result.alerted).toBe(1);
    expect(result.overdueJobs).toContain('fetch-matches');
    expect(mockSendTelegram).toHaveBeenCalledOnce();
    expect(mockSendTelegram.mock.calls[0][1]).toContain('overdue');
  });

  test('counts consecutive overdue from prior alert state', async () => {
    const job = makeJob({ lastRun: new Date(NOW - 3 * 60_000).toISOString() });
    mockGetJobsStatus.mockResolvedValue([job]);
    // Simulate prior alert state from 1 hour ago (past 30-min cooldown)
    mockGetRedis.mockReturnValue(makeRedisMock({
      get: (key: string) => {
        if (key.includes('watchdog:alert')) {
          return Promise.resolve(JSON.stringify({
            lastAlertedAt: new Date(NOW - 60 * 60_000).toISOString(),
            consecutiveOverdue: 3,
          }));
        }
        return Promise.resolve(null);
      },
    }));
    const result = await healthWatchdogJob();
    expect(result.alerted).toBe(1);
    expect(mockSendTelegram.mock.calls[0][1]).toContain('4x'); // consecutive = 3+1
  });
});

// ── In-memory cooldown (Redis unavailable) ────────────────────

describe('in-memory cooldown when Redis is unavailable', () => {
  test('sends alert only once per cooldown period even when Redis is down', async () => {
    const job = makeJob({ lastRun: new Date(NOW - 3 * 60_000).toISOString() });
    mockGetJobsStatus.mockResolvedValue([job]);
    // Redis unavailable — all calls throw
    mockGetRedis.mockImplementation(() => { throw new Error('ECONNREFUSED'); });

    // First watchdog run → should alert
    await healthWatchdogJob();
    expect(mockSendTelegram).toHaveBeenCalledOnce();
    vi.clearAllMocks();
    mockGetJobsStatus.mockResolvedValue([job]);
    mockGetRedis.mockImplementation(() => { throw new Error('ECONNREFUSED'); });

    // Second watchdog run (within cooldown, Redis still down) → should NOT alert again
    await healthWatchdogJob();
    expect(mockSendTelegram).not.toHaveBeenCalled();
  });
});

// ── Adaptive skip key awareness ───────────────────────────────

describe('adaptive skip key suppresses alert', () => {
  test('no alert when skip key shows job is intentionally sleeping', async () => {
    const skipKey = 'job:fetch-matches:next-run-at';
    const job = makeJob({
      lastRun: new Date(NOW - 3 * 60_000).toISOString(), // would normally be overdue
      skipKey,
    });
    mockGetJobsStatus.mockResolvedValue([job]);
    // Skip key set to 25 minutes in the future
    mockGetRedis.mockReturnValue(makeRedisMock({
      get: (key: string) =>
        Promise.resolve(key === skipKey ? String(NOW + 25 * 60_000) : null),
    }));

    const result = await healthWatchdogJob();
    expect(result.alerted).toBe(0);
    expect(result.overdueJobs).toHaveLength(0);
    expect(mockSendTelegram).not.toHaveBeenCalled();
  });

  test('alerts when skip key is expired (past nextRunAt)', async () => {
    const skipKey = 'job:fetch-matches:next-run-at';
    const job = makeJob({
      lastRun: new Date(NOW - 10 * 60_000).toISOString(), // 10 min ago — truly overdue
      skipKey,
    });
    mockGetJobsStatus.mockResolvedValue([job]);
    // Skip key is in the past (job should have run already but didn't)
    mockGetRedis.mockReturnValue(makeRedisMock({
      get: (key: string) =>
        Promise.resolve(key === skipKey ? String(NOW - 2 * 60_000) : null),
    }));

    const result = await healthWatchdogJob();
    expect(result.alerted).toBe(1);
    expect(mockSendTelegram).toHaveBeenCalledOnce();
  });

  test('alerts normally when job has no skip key', async () => {
    const job = makeJob({
      lastRun: new Date(NOW - 5 * 60_000).toISOString(),
      skipKey: undefined,
    });
    mockGetJobsStatus.mockResolvedValue([job]);
    const result = await healthWatchdogJob();
    expect(result.alerted).toBe(1);
  });

  test('falls through to alert when skip key Redis read fails', async () => {
    const skipKey = 'job:fetch-matches:next-run-at';
    const job = makeJob({
      lastRun: new Date(NOW - 5 * 60_000).toISOString(),
      skipKey,
    });
    mockGetJobsStatus.mockResolvedValue([job]);
    // Redis throws on get — cannot confirm skip status
    mockGetRedis.mockReturnValue({
      get: vi.fn().mockRejectedValue(new Error('ECONNREFUSED')),
      set: vi.fn(),
      del: vi.fn(),
    } as never);

    const result = await healthWatchdogJob();
    // Cannot confirm skip → treat as potentially overdue → alert
    expect(result.alerted).toBe(1);
  });
});

// ── Redis cooldown still works when available ─────────────────

describe('Redis-backed cooldown', () => {
  test('no alert when within 30-min cooldown', async () => {
    const job = makeJob({ lastRun: new Date(NOW - 5 * 60_000).toISOString() });
    mockGetJobsStatus.mockResolvedValue([job]);
    // Alert state set 10 minutes ago (within 30-min cooldown)
    mockGetRedis.mockReturnValue(makeRedisMock({
      get: (key: string) => {
        if (key.includes('watchdog:alert')) {
          return Promise.resolve(JSON.stringify({
            lastAlertedAt: new Date(NOW - 10 * 60_000).toISOString(),
            consecutiveOverdue: 1,
          }));
        }
        return Promise.resolve(null);
      },
    }));

    const result = await healthWatchdogJob();
    expect(result.alerted).toBe(0);
    expect(mockSendTelegram).not.toHaveBeenCalled();
  });

  test('alerts after 30-min cooldown expires', async () => {
    const job = makeJob({ lastRun: new Date(NOW - 5 * 60_000).toISOString() });
    mockGetJobsStatus.mockResolvedValue([job]);
    // Alert state set 31 minutes ago (past cooldown)
    mockGetRedis.mockReturnValue(makeRedisMock({
      get: (key: string) => {
        if (key.includes('watchdog:alert')) {
          return Promise.resolve(JSON.stringify({
            lastAlertedAt: new Date(NOW - 31 * 60_000).toISOString(),
            consecutiveOverdue: 1,
          }));
        }
        return Promise.resolve(null);
      },
    }));

    const result = await healthWatchdogJob();
    expect(result.alerted).toBe(1);
  });
});

// ── Recovery alert ────────────────────────────────────────────

describe('recovery', () => {
  test('sends recovery message when job recovers from overdue', async () => {
    const job = makeJob({ lastRun: new Date(NOW - 30_000).toISOString() }); // recently ran — healthy
    mockGetJobsStatus.mockResolvedValue([job]);
    // Prior alert state exists
    mockGetRedis.mockReturnValue(makeRedisMock({
      get: (key: string) => {
        if (key.includes('watchdog:alert')) {
          return Promise.resolve(JSON.stringify({
            lastAlertedAt: new Date(NOW - 5 * 60_000).toISOString(),
            consecutiveOverdue: 2,
          }));
        }
        return Promise.resolve(null);
      },
    }));

    const result = await healthWatchdogJob();
    expect(result.recovered).toContain('fetch-matches');
    expect(result.alerted).toBe(0);
    expect(mockSendTelegram).toHaveBeenCalledOnce();
    expect(mockSendTelegram.mock.calls[0][1]).toContain('khôi phục');
  });
});

// ── Stuck job ─────────────────────────────────────────────────

describe('stuck job', () => {
  test('alerts when job has been running for > 10x interval', async () => {
    const intervalMs = 60_000;
    const job = makeJob({
      running: true,
      intervalMs,
      lastRun: new Date(NOW - 11 * intervalMs).toISOString(), // started 11 min ago — stuck
    });
    mockGetJobsStatus.mockResolvedValue([job]);
    const result = await healthWatchdogJob();
    expect(result.alerted).toBe(1);
    expect(mockSendTelegram.mock.calls[0][1]).toContain('stuck');
  });

  test('alerts a 5-second job only after the absolute stuck floor is crossed', async () => {
    const intervalMs = 5_000;
    const job = {
      ...makeJob({
        name: 'check-live-trigger',
        running: true,
        intervalMs,
      }),
      lastStartedAt: new Date(NOW - 3 * 60_000).toISOString(),
      lastCompletedAt: new Date(NOW - 4 * 60_000).toISOString(),
      lastHeartbeatAt: new Date(NOW - 5_000).toISOString(),
    };
    mockGetJobsStatus.mockResolvedValue([job]);

    const result = await healthWatchdogJob();
    expect(result.alerted).toBe(1);
  });
});
