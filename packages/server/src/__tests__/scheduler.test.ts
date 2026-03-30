import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

interface SchedulerLoadOptions {
  configOverrides?: Record<string, number>;
  redisFactory?: (() => unknown) | null;
}

async function loadScheduler(options: SchedulerLoadOptions = {}) {
  vi.resetModules();

  const fetchMatchesJob = vi.fn().mockResolvedValue({ saved: 1, leagues: 1 });
  const refreshLiveMatchesJob = vi.fn().mockResolvedValue({ tracked: 0, refreshed: 0, live: 0, statsRefreshed: 0 });
  const syncReferenceDataJob = vi.fn().mockResolvedValue({});
  const enrichWatchlistJob = vi.fn().mockResolvedValue({});
  const updatePredictionsJob = vi.fn().mockResolvedValue({});
  const checkLiveTriggerJob = vi.fn().mockResolvedValue({ liveCount: 0 });
  const refreshProviderInsightsJob = vi.fn().mockResolvedValue({});
  const autoSettleJob = vi.fn().mockResolvedValue({});
  const expireWatchlistJob = vi.fn().mockResolvedValue({});
  const housekeepingJob = vi.fn().mockResolvedValue({});
  const integrationHealthJob = vi.fn().mockResolvedValue({});
  const healthWatchdogJob = vi.fn().mockResolvedValue({});

  const redisDefault = {
    set: vi.fn().mockResolvedValue('OK'),
    get: vi.fn().mockResolvedValue(null),
    del: vi.fn().mockResolvedValue(1),
    hset: vi.fn().mockResolvedValue(1),
    hgetall: vi.fn().mockResolvedValue({}),
    expire: vi.fn().mockResolvedValue(1),
  };

  vi.doMock('../config.js', () => ({
    config: {
      jobFetchMatchesMs: 0,
      jobRefreshLiveMatchesMs: 0,
      jobSyncReferenceDataMs: 0,
      jobEnrichWatchlistMs: 0,
      jobPredictionsMs: 0,
      jobCheckLiveMs: 0,
      jobRefreshProviderInsightsMs: 0,
      jobAutoSettleMs: 0,
      jobExpireWatchlistMs: 0,
      jobHousekeepingMs: 0,
      jobIntegrationHealthMs: 0,
      jobHealthWatchdogMs: 0,
      ...options.configOverrides,
    },
  }));
  vi.doMock('../lib/redis.js', () => ({
    getRedisClient: vi.fn().mockImplementation(
      options.redisFactory ?? (() => redisDefault),
    ),
  }));
  vi.doMock('../lib/audit.js', () => ({ audit: vi.fn() }));
  vi.doMock('../jobs/job-progress.js', () => ({
    clearJobProgress: vi.fn().mockResolvedValue(undefined),
    completeJobProgress: vi.fn().mockResolvedValue(undefined),
    getJobProgress: vi.fn().mockResolvedValue(null),
    reportJobProgress: vi.fn().mockResolvedValue(undefined),
  }));
  vi.doMock('../jobs/fetch-matches.job.js', () => ({
    fetchMatchesJob,
    ADAPTIVE_SKIP_KEY: 'job:fetch-matches:next-run-at',
  }));
  vi.doMock('../jobs/refresh-live-matches.job.js', () => ({ refreshLiveMatchesJob }));
  vi.doMock('../jobs/sync-reference-data.job.js', () => ({ syncReferenceDataJob }));
  vi.doMock('../jobs/enrich-watchlist.job.js', () => ({ enrichWatchlistJob }));
  vi.doMock('../jobs/update-predictions.job.js', () => ({ updatePredictionsJob }));
  vi.doMock('../jobs/check-live-trigger.job.js', () => ({ checkLiveTriggerJob }));
  vi.doMock('../jobs/refresh-provider-insights.job.js', () => ({ refreshProviderInsightsJob }));
  vi.doMock('../jobs/auto-settle.job.js', () => ({ autoSettleJob }));
  vi.doMock('../jobs/expire-watchlist.job.js', () => ({ expireWatchlistJob }));
  vi.doMock('../jobs/purge-audit.job.js', () => ({ housekeepingJob }));
  vi.doMock('../jobs/integration-health.job.js', () => ({ integrationHealthJob }));
  vi.doMock('../jobs/health-watchdog.job.js', () => ({ healthWatchdogJob }));

  const scheduler = await import('../jobs/scheduler.js');
  return {
    scheduler,
    fetchMatchesJob,
    checkLiveTriggerJob,
    refreshLiveMatchesJob,
    redisDefault,
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-03-31T00:00:00Z'));
});

afterEach(async () => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe('scheduler lock policies', () => {
  test('runs degraded-local jobs when Redis lock is unavailable', async () => {
    const { scheduler, fetchMatchesJob } = await loadScheduler({
      configOverrides: { jobFetchMatchesMs: 10 },
      redisFactory: () => {
        throw new Error('redis down');
      },
    });

    await scheduler.startScheduler();
    await vi.advanceTimersByTimeAsync(15);

    expect(fetchMatchesJob).toHaveBeenCalledTimes(1);
    scheduler.stopScheduler();
  });

  test('skips strict-lock jobs when Redis lock is unavailable', async () => {
    const { scheduler, checkLiveTriggerJob } = await loadScheduler({
      configOverrides: { jobCheckLiveMs: 10 },
      redisFactory: () => {
        throw new Error('redis down');
      },
    });

    await scheduler.startScheduler();
    await vi.advanceTimersByTimeAsync(15);

    expect(checkLiveTriggerJob).not.toHaveBeenCalled();
    scheduler.stopScheduler();
  });
});

describe('scheduler remote state hygiene', () => {
  test('ignores stale remote running flags when heartbeat is old', async () => {
    const staleHeartbeat = new Date(Date.now() - 60_000).toISOString();
    const { scheduler } = await loadScheduler({
      redisFactory: () => ({
        set: vi.fn().mockResolvedValue('OK'),
        get: vi.fn().mockResolvedValue(null),
        del: vi.fn().mockResolvedValue(1),
        hset: vi.fn().mockResolvedValue(1),
        hgetall: vi.fn().mockResolvedValue({
          running: '1',
          lastHeartbeatAt: staleHeartbeat,
          lastStartedAt: new Date(Date.now() - 60_000).toISOString(),
          ownerInstanceId: 'other-instance',
        }),
        expire: vi.fn().mockResolvedValue(1),
      }),
    });

    await scheduler.startScheduler();
    const jobs = await scheduler.getJobsStatus();
    const fetchJob = jobs.find((job) => job.name === 'fetch-matches');

    expect(fetchJob).toBeTruthy();
    expect(fetchJob?.running).toBe(false);
    scheduler.stopScheduler();
  });
});
