import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

interface SchedulerLoadOptions {
  configOverrides?: Record<string, number>;
  redisFactory?: (() => unknown) | null;
}

async function loadScheduler(options: SchedulerLoadOptions = {}) {
  vi.resetModules();

  const fetchMatchesJob = vi.fn().mockResolvedValue({ saved: 1, leagues: 1 });
  const syncWatchlistMetadataJob = vi.fn().mockResolvedValue({ backfilled: 0, synced: 0 });
  const autoAddTopLeagueWatchlistJob = vi.fn().mockResolvedValue({ candidates: 0, added: 0, skippedExisting: 0 });
  const autoAddFavoriteTeamWatchlistJob = vi.fn().mockResolvedValue({ candidateMatches: 0, targetUsers: 0, added: 0, skippedExisting: 0 });
  const refreshLiveMatchesJob = vi.fn().mockResolvedValue({ tracked: 0, refreshed: 0, live: 0, statsRefreshed: 0 });
  const deliverTelegramNotificationsJob = vi.fn().mockResolvedValue({ pending: 0, delivered: 0, failed: 0 });
  const syncReferenceDataJob = vi.fn().mockResolvedValue({});
  const refreshTacticalOverlaysJob = vi.fn().mockResolvedValue({});
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
      jobSyncWatchlistMetadataMs: 0,
      jobAutoAddTopLeagueWatchlistMs: 0,
      jobAutoAddFavoriteTeamWatchlistMs: 0,
      jobRefreshLiveMatchesMs: 0,
      jobDeliverTelegramNotificationsMs: 0,
      jobSyncReferenceDataMs: 0,
      jobRefreshTacticalOverlaysMs: 0,
      jobEnrichWatchlistMs: 0,
      jobPredictionsMs: 0,
      jobCheckLiveMs: 0,
      jobRefreshProviderInsightsMs: 0,
      jobAutoSettleMs: 0,
      jobExpireWatchlistMs: 0,
      jobHousekeepingMs: 0,
      jobIntegrationHealthMs: 0,
      jobHealthWatchdogMs: 0,
      jobRefreshLiveMatchesMaxRunMs: 90_000,
      jobCheckLiveMaxRunMs: 120_000,
      jobDeliverTelegramNotificationsMaxRunMs: 60_000,
      ...options.configOverrides,
    },
  }));
  vi.doMock('../lib/redis.js', () => ({
    getRedisClient: vi.fn().mockImplementation(
      options.redisFactory ?? (() => redisDefault),
    ),
  }));
  vi.doMock('../lib/audit.js', () => ({ audit: vi.fn() }));
  vi.doMock('../repos/job-runs.repo.js', () => ({
    recordJobRun: vi.fn().mockResolvedValue(undefined),
    getJobRunOverview: vi.fn().mockResolvedValue([]),
    getRecentJobRuns: vi.fn().mockResolvedValue([]),
    purgeJobRuns: vi.fn().mockResolvedValue(0),
  }));
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
  vi.doMock('../jobs/sync-watchlist-metadata.job.js', () => ({ syncWatchlistMetadataJob }));
  vi.doMock('../jobs/auto-add-top-league-watchlist.job.js', () => ({ autoAddTopLeagueWatchlistJob }));
  vi.doMock('../jobs/auto-add-favorite-team-watchlist.job.js', () => ({ autoAddFavoriteTeamWatchlistJob }));
  vi.doMock('../jobs/refresh-live-matches.job.js', () => ({ refreshLiveMatchesJob }));
  vi.doMock('../jobs/deliver-telegram-notifications.job.js', () => ({ deliverTelegramNotificationsJob }));
  vi.doMock('../jobs/sync-reference-data.job.js', () => ({ syncReferenceDataJob }));
  vi.doMock('../jobs/refresh-tactical-overlays.job.js', () => ({ refreshTacticalOverlaysJob }));
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
  const jobRunsRepo = await import('../repos/job-runs.repo.js');
  return {
    scheduler,
    fetchMatchesJob,
    checkLiveTriggerJob,
    refreshLiveMatchesJob,
    deliverTelegramNotificationsJob,
    redisDefault,
    jobRunsRepo,
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

describe('scheduler cadence resilience', () => {
  test('queues one pending rerun when a single-concurrency job overruns its interval', async () => {
    let resolveFirstRun: (() => void) | null = null;
    let resolveSecondRun: (() => void) | null = null;
    const { scheduler, fetchMatchesJob } = await loadScheduler({
      configOverrides: { jobFetchMatchesMs: 10 },
    });
    vi.mocked(fetchMatchesJob)
      .mockImplementationOnce(() => new Promise((resolve) => {
        resolveFirstRun = () => resolve({ saved: 1, leagues: 1 });
      }))
      .mockImplementationOnce(() => new Promise((resolve) => {
        resolveSecondRun = () => resolve({ saved: 1, leagues: 1 });
      }));

    await scheduler.startScheduler();
    await vi.advanceTimersByTimeAsync(15);
    expect(fetchMatchesJob).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(20);
    expect(fetchMatchesJob).toHaveBeenCalledTimes(1);

    resolveFirstRun?.();
    await vi.advanceTimersByTimeAsync(1);

    expect(fetchMatchesJob).toHaveBeenCalledTimes(2);
    scheduler.stopScheduler();
    resolveSecondRun?.();
  });

  test('persists skipped strict-lock attempts into job run history', async () => {
    const { scheduler, jobRunsRepo } = await loadScheduler({
      configOverrides: { jobCheckLiveMs: 10 },
      redisFactory: () => {
        throw new Error('redis down');
      },
    });

    await scheduler.startScheduler();
    await vi.advanceTimersByTimeAsync(15);

    expect(jobRunsRepo.recordJobRun).toHaveBeenCalledWith(expect.objectContaining({
      jobName: 'check-live-trigger',
      status: 'skipped',
      skipReason: 'redis-unavailable-strict',
    }));
    scheduler.stopScheduler();
  });

  test('fails a live job once maxRunMs is exceeded instead of leaving it hung indefinitely', async () => {
    let releaseRun: (() => void) | null = null;
    const { scheduler, refreshLiveMatchesJob, jobRunsRepo } = await loadScheduler({
      configOverrides: {
        jobRefreshLiveMatchesMs: 10,
        jobRefreshLiveMatchesMaxRunMs: 25,
      },
    });
    vi.mocked(refreshLiveMatchesJob).mockImplementationOnce(() => new Promise((resolve) => {
      releaseRun = () => resolve({ tracked: 1, refreshed: 1, live: 1, statsRefreshed: 1 });
    }));

    await scheduler.startScheduler();
    await vi.advanceTimersByTimeAsync(50);

    expect(jobRunsRepo.recordJobRun).toHaveBeenCalledWith(expect.objectContaining({
      jobName: 'refresh-live-matches',
      status: 'failure',
      error: expect.stringContaining('timed out'),
    }));

    scheduler.stopScheduler();
    releaseRun?.();
  });
});
