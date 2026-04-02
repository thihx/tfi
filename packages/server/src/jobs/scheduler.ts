// ============================================================
// Job Scheduler — self-rescheduling jobs with Redis-backed state
//
// - Self-rescheduling timers avoid interval drift assumptions.
// - A single pending rerun is retained for single-concurrency jobs.
// - Redis lock/state provide multi-instance coordination when available.
// - Heartbeat-based running state prevents stale "running=true" flags.
// ============================================================

import crypto from 'node:crypto';
import { config } from '../config.js';
import { getRedisClient } from '../lib/redis.js';
import { audit } from '../lib/audit.js';
import {
  getJobRunOverview,
  recordJobRun,
  type JobRunOverviewRow,
} from '../repos/job-runs.repo.js';
import { summarizeJobResultForAudit } from './job-result-serializer.js';
import { fetchMatchesJob, ADAPTIVE_SKIP_KEY } from './fetch-matches.job.js';
import { syncWatchlistMetadataJob } from './sync-watchlist-metadata.job.js';
import { autoAddTopLeagueWatchlistJob } from './auto-add-top-league-watchlist.job.js';
import { autoAddFavoriteTeamWatchlistJob } from './auto-add-favorite-team-watchlist.job.js';
import { refreshLiveMatchesJob } from './refresh-live-matches.job.js';
import { deliverTelegramNotificationsJob } from './deliver-telegram-notifications.job.js';
import { updatePredictionsJob } from './update-predictions.job.js';
import { expireWatchlistJob } from './expire-watchlist.job.js';
import { checkLiveTriggerJob } from './check-live-trigger.job.js';
import { autoSettleJob } from './auto-settle.job.js';
import { enrichWatchlistJob } from './enrich-watchlist.job.js';
import { housekeepingJob } from './purge-audit.job.js';
import { integrationHealthJob } from './integration-health.job.js';
import { healthWatchdogJob } from './health-watchdog.job.js';
import { syncReferenceDataJob } from './sync-reference-data.job.js';
import { refreshProviderInsightsJob } from './refresh-provider-insights.job.js';
import { refreshTacticalOverlaysJob } from './refresh-tactical-overlays.job.js';
import {
  type JobProgress,
  clearJobProgress,
  completeJobProgress,
  getJobProgress,
  reportJobProgress,
} from './job-progress.js';

export type { JobProgress };

type LockPolicy = 'strict' | 'degraded-local';

const RUN_STATE_TTL_SEC = 30 * 24 * 60 * 60;
const RUN_HEARTBEAT_INTERVAL_MS = 5_000;
const RUN_HEARTBEAT_STALE_MS = 30_000;

export interface JobInfo {
  name: string;
  label?: string;
  description?: string;
  group?: string;
  entityScopes?: string[];
  order?: number;
  intervalMs: number;
  lastRun: string | null;
  lastStartedAt: string | null;
  lastCompletedAt: string | null;
  lastHeartbeatAt: string | null;
  lastDurationMs: number | null;
  lastLagMs: number | null;
  lastError: string | null;
  running: boolean;
  enabled: boolean;
  runCount: number;
  progress: JobProgress | null;
  concurrency: number;
  activeRuns: number;
  pendingRuns: number;
  skipKey?: string;
  lockPolicy: LockPolicy;
  degradedLocking: boolean;
  history24h: JobRunOverviewRow | null;
}

interface ManagedJob {
  name: string;
  label?: string;
  description?: string;
  group?: string;
  entityScopes?: string[];
  order?: number;
  intervalMs: number;
  fn: () => Promise<unknown>;
  timer: ReturnType<typeof setTimeout> | null;
  heartbeatTimer: ReturnType<typeof setInterval> | null;
  nextDueAt: number | null;
  lastRun: string | null;
  lastStartedAt: string | null;
  lastCompletedAt: string | null;
  lastHeartbeatAt: string | null;
  lastDurationMs: number | null;
  lastLagMs: number | null;
  lastError: string | null;
  running: boolean;
  enabled: boolean;
  runCount: number;
  lockTtlMs: number;
  maxRunMs?: number;
  concurrency: number;
  activeRuns: number;
  pendingRuns: number;
  pendingScheduledAt: number | null;
  skipKey?: string;
  lockPolicy: LockPolicy;
  degradedLocking: boolean;
}

interface JobMetadata {
  label: string;
  description: string;
  group: 'pipeline' | 'monitoring' | 'maintenance' | 'reference-data';
  entityScopes?: string[];
  order: number;
  lockPolicy?: LockPolicy;
}

interface PersistedJobState {
  lastRun?: string;
  lastStartedAt?: string;
  lastCompletedAt?: string;
  lastHeartbeatAt?: string;
  lastDurationMs?: string;
  lastLagMs?: string;
  lastError?: string;
  runCount?: string;
  running?: string;
  ownerInstanceId?: string;
  degradedLocking?: string;
}

interface LockAcquireResult {
  acquired: boolean;
  degraded: boolean;
  reason?: 'held-by-other-instance' | 'redis-unavailable-strict';
}

const jobs: ManagedJob[] = [];
const instanceId = crypto.randomUUID();
let schedulerStartedAt = 0;

export function getSchedulerUptime(): number {
  return schedulerStartedAt > 0 ? Date.now() - schedulerStartedAt : 0;
}

const lockKey = (name: string) => `job:lock:${name}`;
const stateKey = (name: string) => `job:state:${name}`;

function safeNumber(value: string | undefined): number | null {
  if (value == null || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeHistorySummary(summary: Record<string, unknown> | null | undefined): Record<string, unknown> {
  return summary && typeof summary === 'object' && !Array.isArray(summary) ? summary : {};
}

async function recordJobRunBestEffort(input: Parameters<typeof recordJobRun>[0]): Promise<void> {
  try {
    await recordJobRun(input);
  } catch (err) {
    console.error('[scheduler] Failed to persist job run history:', err);
  }
}

function register(
  name: string,
  intervalMs: number,
  fn: () => Promise<unknown>,
  lockTtlMs?: number,
  skipKey?: string,
  concurrency = 1,
  maxRunMs?: number,
  metadata?: JobMetadata,
) {
  jobs.push({
    name,
    label: metadata?.label,
    description: metadata?.description,
    group: metadata?.group,
    entityScopes: metadata?.entityScopes,
    order: metadata?.order,
    intervalMs,
    fn,
    timer: null,
    heartbeatTimer: null,
    nextDueAt: null,
    lastRun: null,
    lastStartedAt: null,
    lastCompletedAt: null,
    lastHeartbeatAt: null,
    lastDurationMs: null,
    lastLagMs: null,
    lastError: null,
    running: false,
    enabled: intervalMs > 0,
    runCount: 0,
    lockTtlMs: lockTtlMs ?? Math.max(intervalMs * 3, 60_000),
    maxRunMs,
    concurrency,
    activeRuns: 0,
    pendingRuns: 0,
    pendingScheduledAt: null,
    skipKey,
    lockPolicy: metadata?.lockPolicy ?? 'strict',
    degradedLocking: false,
  });
}

function clearTimer(job: ManagedJob): void {
  if (job.timer) {
    clearTimeout(job.timer);
    job.timer = null;
  }
}

function stopHeartbeat(job: ManagedJob): void {
  if (job.heartbeatTimer) {
    clearInterval(job.heartbeatTimer);
    job.heartbeatTimer = null;
  }
}

async function acquireLock(job: ManagedJob): Promise<LockAcquireResult> {
  try {
    const redis = getRedisClient();
    const ttlSec = Math.ceil(job.lockTtlMs / 1000);
    const result = await redis.set(lockKey(job.name), instanceId, 'EX', ttlSec, 'NX');
    if (result === 'OK') return { acquired: true, degraded: false };
    return { acquired: false, degraded: false, reason: 'held-by-other-instance' };
  } catch (err) {
    if (job.lockPolicy === 'degraded-local') {
      console.warn(`[scheduler] Redis unavailable for "${job.name}", running in degraded local-lock mode:`, err);
      return { acquired: true, degraded: true };
    }
    console.error(`[scheduler] Redis unavailable for lock "${job.name}", skipping run:`, err);
    return { acquired: false, degraded: false, reason: 'redis-unavailable-strict' };
  }
}

async function releaseLock(job: ManagedJob): Promise<void> {
  if (job.degradedLocking) return;
  try {
    const redis = getRedisClient();
    const current = await redis.get(lockKey(job.name));
    if (current === instanceId) {
      await redis.del(lockKey(job.name));
    }
  } catch {
    // ignore
  }
}

async function persistState(job: ManagedJob): Promise<void> {
  try {
    const redis = getRedisClient();
    await redis.hset(stateKey(job.name), {
      lastRun: job.lastRun || '',
      lastStartedAt: job.lastStartedAt || '',
      lastCompletedAt: job.lastCompletedAt || '',
      lastHeartbeatAt: job.lastHeartbeatAt || '',
      lastDurationMs: job.lastDurationMs == null ? '' : String(job.lastDurationMs),
      lastLagMs: job.lastLagMs == null ? '' : String(job.lastLagMs),
      lastError: job.lastError || '',
      runCount: String(job.runCount),
      running: job.running ? '1' : '0',
      ownerInstanceId: job.running ? instanceId : '',
      degradedLocking: job.degradedLocking ? '1' : '0',
    });
    await redis.expire(stateKey(job.name), RUN_STATE_TTL_SEC);
  } catch {
    // ignore
  }
}

async function restoreState(job: ManagedJob): Promise<void> {
  try {
    const redis = getRedisClient();
    const state = await redis.hgetall(stateKey(job.name)) as PersistedJobState;
    if (state.lastRun) job.lastRun = state.lastRun;
    if (state.lastStartedAt) job.lastStartedAt = state.lastStartedAt;
    if (state.lastCompletedAt) job.lastCompletedAt = state.lastCompletedAt;
    if (state.lastHeartbeatAt) job.lastHeartbeatAt = state.lastHeartbeatAt;
    if (state.lastError) job.lastError = state.lastError;
    if (state.runCount) job.runCount = Number(state.runCount);
    job.lastDurationMs = safeNumber(state.lastDurationMs);
    job.lastLagMs = safeNumber(state.lastLagMs);
    job.degradedLocking = state.degradedLocking === '1';
  } catch {
    // ignore — start fresh
  }
}

function callWithTimeout(fn: () => Promise<unknown>, maxRunMs: number): Promise<unknown> {
  return new Promise<unknown>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Job timed out after ${Math.round(maxRunMs / 60_000)}m`));
    }, maxRunMs);
    fn().then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

function scheduleJob(job: ManagedJob, dueAt: number): void {
  clearTimer(job);
  job.nextDueAt = dueAt;
  if (!job.enabled) return;

  const delayMs = Math.max(0, dueAt - Date.now());
  job.timer = setTimeout(() => {
    job.timer = null;
    if (!job.enabled) return;
    scheduleJob(job, dueAt + job.intervalMs);
    void requestRun(job, dueAt);
  }, delayMs);
}

function startHeartbeat(job: ManagedJob): void {
  stopHeartbeat(job);
  const tick = () => {
    job.lastHeartbeatAt = new Date().toISOString();
    void persistState(job);
  };
  tick();
  job.heartbeatTimer = setInterval(tick, RUN_HEARTBEAT_INTERVAL_MS);
}

function queuePendingSingleRun(job: ManagedJob, scheduledAt: number): void {
  job.pendingRuns = 1;
  job.pendingScheduledAt = job.pendingScheduledAt == null
    ? scheduledAt
    : Math.min(job.pendingScheduledAt, scheduledAt);
}

async function requestRun(job: ManagedJob, scheduledAt: number): Promise<void> {
  if (job.concurrency === 1) {
    if (job.running) {
      queuePendingSingleRun(job, scheduledAt);
      return;
    }
    await runSingleJob(job, scheduledAt);
    return;
  }

  if (job.activeRuns >= job.concurrency) {
    if (job.pendingRuns < job.concurrency) {
      job.pendingRuns++;
      job.pendingScheduledAt = job.pendingScheduledAt == null
        ? scheduledAt
        : Math.min(job.pendingScheduledAt, scheduledAt);
      console.log(`[scheduler] Job "${job.name}" queued (${job.activeRuns}/${job.concurrency} active, ${job.pendingRuns} pending)`);
    } else {
      console.log(`[scheduler] Job "${job.name}" dropped — queue full (${job.concurrency}/${job.concurrency} active + ${job.pendingRuns} pending)`);
    }
    return;
  }

  await runConcurrentJob(job, scheduledAt);
}

async function runSingleJob(job: ManagedJob, scheduledAt: number): Promise<void> {
  const lock = await acquireLock(job);
  if (!lock.acquired) {
    if (lock.reason === 'redis-unavailable-strict') {
      job.lastError = 'Redis unavailable for distributed lock';
      await persistState(job);
      await recordJobRunBestEffort({
        jobName: job.name,
        scheduledAt: new Date(scheduledAt).toISOString(),
        startedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
        status: 'skipped',
        skipReason: lock.reason,
        lockPolicy: job.lockPolicy,
        degradedLocking: false,
        instanceId,
        lagMs: Math.max(0, Date.now() - scheduledAt),
        durationMs: 0,
        error: job.lastError,
      });
    } else {
      console.log(`[scheduler] Job "${job.name}" skipped — another instance holds the lock`);
    }
    return;
  }

  const startTs = Date.now();
  job.degradedLocking = lock.degraded;
  job.running = true;
  job.activeRuns = 1;
  job.lastStartedAt = new Date(startTs).toISOString();
  job.lastLagMs = Math.max(0, startTs - scheduledAt);
  await persistState(job);
  await clearJobProgress(job.name);
  await reportJobProgress(job.name, 'starting', 'Starting...', 0);
  startHeartbeat(job);

  try {
    const result = await (job.maxRunMs ? callWithTimeout(job.fn, job.maxRunMs) : job.fn());
    const summary = normalizeHistorySummary(summarizeJobResultForAudit(job.name, result));
    const completedAt = new Date().toISOString();
    job.lastRun = completedAt;
    job.lastCompletedAt = completedAt;
    job.lastError = null;
    job.lastDurationMs = Date.now() - startTs;
    job.runCount++;
    await completeJobProgress(job.name, result, null);
    await recordJobRunBestEffort({
      jobName: job.name,
      scheduledAt: new Date(scheduledAt).toISOString(),
      startedAt: job.lastStartedAt ?? new Date(startTs).toISOString(),
      completedAt,
      status: 'success',
      lockPolicy: job.lockPolicy,
      degradedLocking: lock.degraded,
      instanceId,
      lagMs: job.lastLagMs,
      durationMs: job.lastDurationMs,
      summary,
    });
    audit({
      category: 'JOB',
      action: `JOB_${job.name.toUpperCase().replace(/-/g, '_')}`,
      outcome: lock.degraded ? 'PARTIAL' : 'SUCCESS',
      actor: 'scheduler',
      duration_ms: job.lastDurationMs,
      metadata: {
        degradedLocking: lock.degraded,
        lagMs: job.lastLagMs,
        ...summary,
      },
    });
    console.log(`[scheduler] Job "${job.name}" completed (#${job.runCount})`, {
      degradedLocking: lock.degraded,
      lagMs: job.lastLagMs,
      durationMs: job.lastDurationMs,
    });
  } catch (err) {
    const completedAt = new Date().toISOString();
    job.lastRun = completedAt;
    job.lastCompletedAt = completedAt;
    job.lastDurationMs = Date.now() - startTs;
    job.lastError = err instanceof Error ? err.message : String(err);
    await completeJobProgress(job.name, null, job.lastError);
    await recordJobRunBestEffort({
      jobName: job.name,
      scheduledAt: new Date(scheduledAt).toISOString(),
      startedAt: job.lastStartedAt ?? new Date(startTs).toISOString(),
      completedAt,
      status: 'failure',
      lockPolicy: job.lockPolicy,
      degradedLocking: lock.degraded,
      instanceId,
      lagMs: job.lastLagMs,
      durationMs: job.lastDurationMs,
      error: job.lastError,
    });
    audit({
      category: 'JOB',
      action: `JOB_${job.name.toUpperCase().replace(/-/g, '_')}`,
      outcome: 'FAILURE',
      actor: 'scheduler',
      duration_ms: job.lastDurationMs,
      error: job.lastError,
      metadata: {
        degradedLocking: lock.degraded,
        lagMs: job.lastLagMs,
      },
    });
    console.error(`[scheduler] Job "${job.name}" failed:`, err);
  } finally {
    stopHeartbeat(job);
    job.running = false;
    job.activeRuns = 0;
    job.lastHeartbeatAt = null;
    await persistState(job);
    await releaseLock(job);

    if (job.pendingRuns > 0) {
      const pendingScheduledAt = job.pendingScheduledAt ?? Date.now();
      job.pendingRuns = 0;
      job.pendingScheduledAt = null;
      queueMicrotask(() => {
        void requestRun(job, pendingScheduledAt);
      });
    }
  }
}

async function runConcurrentJob(job: ManagedJob, scheduledAt: number): Promise<void> {
  const startTs = Date.now();
  job.activeRuns++;
  job.running = true;
  job.lastStartedAt = new Date(startTs).toISOString();
  job.lastLagMs = Math.max(0, startTs - scheduledAt);
  job.lastHeartbeatAt = job.lastStartedAt;
  await clearJobProgress(job.name);
  await reportJobProgress(job.name, 'starting', 'Starting...', 0);

  try {
    const result = await job.fn();
    const summary = normalizeHistorySummary(summarizeJobResultForAudit(job.name, result));
    const completedAt = new Date().toISOString();
    job.lastRun = completedAt;
    job.lastCompletedAt = completedAt;
    job.lastError = null;
    job.lastDurationMs = Date.now() - startTs;
    job.runCount++;
    await completeJobProgress(job.name, result, null);
    await recordJobRunBestEffort({
      jobName: job.name,
      scheduledAt: new Date(scheduledAt).toISOString(),
      startedAt: job.lastStartedAt ?? new Date(startTs).toISOString(),
      completedAt,
      status: 'success',
      lockPolicy: job.lockPolicy,
      degradedLocking: false,
      instanceId,
      lagMs: job.lastLagMs,
      durationMs: job.lastDurationMs,
      summary,
    });
    audit({
      category: 'JOB',
      action: `JOB_${job.name.toUpperCase().replace(/-/g, '_')}`,
      outcome: 'SUCCESS',
      actor: 'scheduler',
      duration_ms: job.lastDurationMs,
      metadata: {
        lagMs: job.lastLagMs,
        ...summary,
      },
    });
    console.log(`[scheduler] Job "${job.name}" completed (#${job.runCount})`);
  } catch (err) {
    const completedAt = new Date().toISOString();
    job.lastRun = completedAt;
    job.lastCompletedAt = completedAt;
    job.lastDurationMs = Date.now() - startTs;
    job.lastError = err instanceof Error ? err.message : String(err);
    await completeJobProgress(job.name, null, job.lastError);
    await recordJobRunBestEffort({
      jobName: job.name,
      scheduledAt: new Date(scheduledAt).toISOString(),
      startedAt: job.lastStartedAt ?? new Date(startTs).toISOString(),
      completedAt,
      status: 'failure',
      lockPolicy: job.lockPolicy,
      degradedLocking: false,
      instanceId,
      lagMs: job.lastLagMs,
      durationMs: job.lastDurationMs,
      error: job.lastError,
    });
    audit({
      category: 'JOB',
      action: `JOB_${job.name.toUpperCase().replace(/-/g, '_')}`,
      outcome: 'FAILURE',
      actor: 'scheduler',
      duration_ms: job.lastDurationMs,
      error: job.lastError,
      metadata: { lagMs: job.lastLagMs },
    });
    console.error(`[scheduler] Job "${job.name}" failed:`, err);
  } finally {
    job.activeRuns--;
    job.running = job.activeRuns > 0;
    job.lastHeartbeatAt = null;
    if (job.pendingRuns > 0) {
      job.pendingRuns--;
      const pendingScheduledAt = job.pendingScheduledAt ?? Date.now();
      job.pendingScheduledAt = null;
      console.log(`[scheduler] Job "${job.name}" dequeuing pending run (${job.pendingRuns} remaining)`);
      queueMicrotask(() => {
        void requestRun(job, pendingScheduledAt);
      });
    }
  }
}

export async function startScheduler() {
  if (jobs.length > 0) {
    stopScheduler();
    jobs.length = 0;
  }

  register(
    'fetch-matches',
    config.jobFetchMatchesMs,
    fetchMatchesJob,
    undefined,
    ADAPTIVE_SKIP_KEY,
    1,
    undefined,
    {
      label: 'Fetch Matches',
      description: 'Looks for today\'s and tomorrow\'s matches in the leagues you track, updates the match list, and saves finished games to history.',
      group: 'pipeline',
      entityScopes: ['matches', 'match-history-archive'],
      order: 1,
      lockPolicy: 'degraded-local',
    },
  );
  register(
    'sync-watchlist-metadata',
    config.jobSyncWatchlistMetadataMs,
    syncWatchlistMetadataJob,
    undefined,
    undefined,
    1,
    undefined,
    {
      label: 'Sync Watchlist Metadata',
      description: 'Keeps monitored watchlist rows aligned with the latest match table metadata, including kickoff and date values, and backfills any legacy operational entries.',
      group: 'pipeline',
      entityScopes: ['watchlist', 'monitored-matches'],
      order: 2,
      lockPolicy: 'degraded-local',
    },
  );
  register(
    'auto-add-top-league-watchlist',
    config.jobAutoAddTopLeagueWatchlistMs,
    autoAddTopLeagueWatchlistJob,
    undefined,
    undefined,
    1,
    undefined,
    {
      label: 'Auto Add Top League Watchlist',
      description: 'Scans not-started matches from top leagues and adds them to the operational watchlist when they are not already tracked.',
      group: 'pipeline',
      entityScopes: ['watchlist', 'matches', 'league-settings'],
      order: 6,
      lockPolicy: 'degraded-local',
    },
  );
  register(
    'auto-add-favorite-team-watchlist',
    config.jobAutoAddFavoriteTeamWatchlistMs,
    autoAddFavoriteTeamWatchlistJob,
    undefined,
    undefined,
    1,
    undefined,
    {
      label: 'Auto Add Favorite Team Watchlist',
      description: 'Adds upcoming matches for users\' favorite teams into their personal watchlists when those matches are not already followed.',
      group: 'pipeline',
      entityScopes: ['watchlist', 'matches', 'favorite-teams'],
      order: 7,
      lockPolicy: 'degraded-local',
    },
  );
  register(
    'refresh-live-matches',
    config.jobRefreshLiveMatchesMs,
    refreshLiveMatchesJob,
    undefined,
    undefined,
    1,
    config.jobRefreshLiveMatchesMaxRunMs,
    {
      label: 'Refresh Live Matches',
      description: 'Refreshes only the matches that are live or about to start, so scores and match state move faster without forcing a full match reload every few seconds.',
      group: 'pipeline',
      entityScopes: ['matches', 'live-scores', 'live-cards'],
      order: 8,
      lockPolicy: 'degraded-local',
    },
  );
  register(
    'deliver-telegram-notifications',
    config.jobDeliverTelegramNotificationsMs,
    deliverTelegramNotificationsJob,
    undefined,
    undefined,
    1,
    config.jobDeliverTelegramNotificationsMaxRunMs,
    {
      label: 'Deliver Telegram Notifications',
      description: 'Flushes pending Telegram alerts from the delivery queue so live analysis does not wait on network sends.',
      group: 'pipeline',
      entityScopes: ['notifications', 'telegram', 'delivery-queue'],
      order: 9,
      lockPolicy: 'strict',
    },
  );
  register(
    'sync-reference-data',
    config.jobSyncReferenceDataMs,
    syncReferenceDataJob,
    30 * 60_000,
    undefined,
    1,
    60 * 60_000,
    {
      label: 'Sync Reference Data',
      description: 'Refreshes basic league and team information that changes slowly. This helps other parts of the app read from saved local data instead of asking for the same details again.',
      group: 'reference-data',
      entityScopes: ['league-catalog', 'league-team-directory'],
      order: 3,
      lockPolicy: 'degraded-local',
    },
  );
  register(
    'refresh-tactical-overlays',
    config.jobRefreshTacticalOverlaysMs,
    refreshTacticalOverlaysJob,
    60 * 60_000,
    undefined,
    1,
    6 * 60 * 60_000,
    {
      label: 'Refresh Tactical Overlays',
      description: 'Refreshes tactical overlay fields for top-league team profiles using trusted source research without changing the quantitative core.',
      group: 'reference-data',
      entityScopes: ['team-profiles', 'tactical-overlay', 'top-leagues'],
      order: 4,
      lockPolicy: 'degraded-local',
    },
  );
  register(
    'enrich-watchlist',
    config.jobEnrichWatchlistMs,
    enrichWatchlistJob,
    45 * 60_000,
    undefined,
    1,
    30 * 60_000,
    {
      label: 'Enrich Watchlist',
      description: 'Adds more background to upcoming matches in the follow list, such as why the game may matter and whether there may be missing players or a busy schedule. It can also suggest a follow rule when there is enough context.',
      group: 'pipeline',
      entityScopes: ['watchlist', 'strategic-context', 'recommended-conditions'],
      order: 4,
      lockPolicy: 'degraded-local',
    },
  );
  register(
    'update-predictions',
    config.jobPredictionsMs,
    updatePredictionsJob,
    10 * 60_000,
    undefined,
    1,
    undefined,
    {
      label: 'Update Predictions',
      description: 'Gets pre-game outlooks for upcoming matches in the follow list and saves them for later use.',
      group: 'pipeline',
      entityScopes: ['watchlist', 'predictions'],
      order: 5,
      lockPolicy: 'degraded-local',
    },
  );
  register(
    'check-live-trigger',
    config.jobCheckLiveMs,
    checkLiveTriggerJob,
    undefined,
    undefined,
    1,
    config.jobCheckLiveMaxRunMs,
    {
      label: 'Check Live Matches',
      description: 'Looks for followed matches that are now live and decides which ones need a fresh review. For those matches, it runs the main review flow and may save a new result or send an alert.',
      group: 'pipeline',
      entityScopes: ['watchlist', 'live-pipeline', 'recommendations', 'notifications'],
      order: 10,
      lockPolicy: 'strict',
    },
  );
  register(
    'refresh-provider-insights',
    config.jobRefreshProviderInsightsMs,
    refreshProviderInsightsJob,
    undefined,
    undefined,
    1,
    undefined,
    {
      label: 'Refresh Provider Insights',
      description: 'Pre-warms saved match details for non-live followed games, such as match facts, event details, and provider snapshots, so the app can read recent local copies instead of asking again each time.',
      group: 'pipeline',
      entityScopes: ['provider-fixture-cache', 'provider-stats-cache', 'provider-events-cache', 'provider-odds-cache'],
      order: 10,
      lockPolicy: 'degraded-local',
    },
  );
  register(
    'auto-settle',
    config.jobAutoSettleMs,
    autoSettleJob,
    undefined,
    undefined,
    1,
    undefined,
    {
      label: 'Auto Settle',
      description: 'Checks finished matches and updates open picks and bets with their final outcome. It uses saved match history first and only asks for missing final details when needed.',
      group: 'pipeline',
      entityScopes: ['recommendations', 'bets', 'settlement-audit'],
      order: 11,
      lockPolicy: 'strict',
    },
  );
  register(
    'expire-watchlist',
    config.jobExpireWatchlistMs,
    expireWatchlistJob,
    undefined,
    undefined,
    1,
    undefined,
    {
      label: 'Expire Watchlist',
      description: 'Removes old follow-list entries after the match has been over long enough that the app no longer needs to keep watching them.',
      group: 'maintenance',
      entityScopes: ['watchlist'],
      order: 12,
      lockPolicy: 'degraded-local',
    },
  );
  register(
    'purge-audit',
    config.jobHousekeepingMs,
    housekeepingJob,
    undefined,
    undefined,
    1,
    undefined,
    {
      label: 'Housekeeping',
      description: 'Daily cleanup across all high-growth tables: purges expired audit logs, provider samples, pipeline runs, and match history; slims old recommendation text fields to save storage while preserving core bet data for AI retraining.',
      group: 'maintenance',
      entityScopes: ['audit-logs'],
      order: 13,
      lockPolicy: 'degraded-local',
    },
  );
  register(
    'integration-health',
    config.jobIntegrationHealthMs,
    integrationHealthJob,
    undefined,
    undefined,
    1,
    undefined,
    {
      label: 'Integration Health',
      description: 'Checks whether the key services the app depends on are working well. If one goes down or recovers, it sends a message so people notice quickly.',
      group: 'monitoring',
      entityScopes: ['postgres', 'redis', 'provider-apis', 'telegram'],
      order: 14,
      lockPolicy: 'strict',
    },
  );
  register(
    'health-watchdog',
    config.jobHealthWatchdogMs,
    healthWatchdogJob,
    undefined,
    undefined,
    1,
    undefined,
    {
      label: 'Health Watchdog',
      description: 'Watches the most important background jobs and looks for ones that stop running on time or appear stuck. If a problem starts or clears, it sends a message.',
      group: 'monitoring',
      entityScopes: ['scheduler', 'critical-jobs'],
      order: 15,
      lockPolicy: 'strict',
    },
  );

  schedulerStartedAt = Date.now();

  for (const job of jobs) {
    await restoreState(job);
  }

  for (const job of jobs) {
    if (job.skipKey) {
      try {
        await getRedisClient().del(job.skipKey);
      } catch {
        // ignore
      }
    }
  }

  for (const job of jobs) {
    if (!job.enabled) {
      console.log(`[scheduler] Job "${job.name}" disabled (interval=0)`);
      continue;
    }

    const now = Date.now();
    const lastCompletedTs = job.lastCompletedAt
      ? new Date(job.lastCompletedAt).getTime()
      : (job.lastRun ? new Date(job.lastRun).getTime() : 0);
    const overdue = lastCompletedTs > 0 && (now - lastCompletedTs) > job.intervalMs;
    const firstDueAt = overdue ? now : now + job.intervalMs;
    scheduleJob(job, firstDueAt);

    if (overdue) {
      console.log(`[scheduler] Job "${job.name}" is overdue (last completed ${job.lastCompletedAt ?? job.lastRun}), running immediately`);
    }

    console.log(`[scheduler] Job "${job.name}" every ${job.intervalMs / 1000}s (runs so far: ${job.runCount})`);
  }

  console.log(`[scheduler] ✅ ${jobs.filter((job) => job.enabled).length} jobs started (instance: ${instanceId.slice(0, 8)})`);
  audit({
    category: 'SYSTEM',
    action: 'SCHEDULER_START',
    actor: 'system',
    metadata: {
      enabledJobs: jobs.filter((job) => job.enabled).map((job) => job.name),
      instanceId: instanceId.slice(0, 8),
    },
  });
}

export function stopScheduler() {
  for (const job of jobs) {
    clearTimer(job);
    stopHeartbeat(job);
    job.nextDueAt = null;
  }
  console.log('[scheduler] All jobs stopped');
}

export async function getJobsStatus(): Promise<JobInfo[]> {
  const result: JobInfo[] = [];
  let redis: ReturnType<typeof getRedisClient> | null = null;
  let historyByJobName = new Map<string, JobRunOverviewRow>();
  try {
    redis = getRedisClient();
  } catch {
    redis = null;
  }
  try {
    historyByJobName = new Map((await getJobRunOverview(24)).map((row) => [row.jobName, row] as const));
  } catch {
    historyByJobName = new Map();
  }

  const now = Date.now();

  for (const job of jobs) {
    const progress = await getJobProgress(job.name);

    let lastRun = job.lastRun;
    let lastStartedAt = job.lastStartedAt;
    let lastCompletedAt = job.lastCompletedAt;
    let lastHeartbeatAt = job.lastHeartbeatAt;
    let lastDurationMs = job.lastDurationMs;
    let lastLagMs = job.lastLagMs;
    let lastError = job.lastError;
    let running = job.running;
    let degradedLocking = job.degradedLocking;
    let runCount = job.runCount;

    if (redis) {
      try {
        const state = await redis.hgetall(stateKey(job.name)) as PersistedJobState;
        const remoteLastCompleted = state.lastCompletedAt || state.lastRun || '';
        const localLastCompleted = lastCompletedAt || lastRun || '';
        if (state.lastRun && state.lastRun > (lastRun ?? '')) lastRun = state.lastRun;
        if (state.lastStartedAt && state.lastStartedAt > (lastStartedAt ?? '')) lastStartedAt = state.lastStartedAt;
        if (state.lastCompletedAt && state.lastCompletedAt > (lastCompletedAt ?? '')) lastCompletedAt = state.lastCompletedAt;
        if (state.lastHeartbeatAt && state.lastHeartbeatAt > (lastHeartbeatAt ?? '')) lastHeartbeatAt = state.lastHeartbeatAt;
        if (remoteLastCompleted >= localLastCompleted) {
          const remoteDuration = safeNumber(state.lastDurationMs);
          const remoteLag = safeNumber(state.lastLagMs);
          if (remoteDuration != null) lastDurationMs = remoteDuration;
          if (remoteLag != null) lastLagMs = remoteLag;
          if (state.lastError) lastError = state.lastError;
        }
        if (state.runCount) runCount = Math.max(runCount, Number(state.runCount));
        degradedLocking = degradedLocking || state.degradedLocking === '1';

        const heartbeatTs = state.lastHeartbeatAt ? Date.parse(state.lastHeartbeatAt) : NaN;
        const remoteRunning = state.running === '1'
          && Number.isFinite(heartbeatTs)
          && (now - heartbeatTs) <= RUN_HEARTBEAT_STALE_MS;
        if (remoteRunning && !running) running = true;
      } catch {
        // ignore — use in-memory fallback
      }
    }

    result.push({
      name: job.name,
      label: job.label,
      description: job.description,
      group: job.group,
      entityScopes: job.entityScopes,
      order: job.order,
      intervalMs: job.intervalMs,
      lastRun,
      lastStartedAt,
      lastCompletedAt,
      lastHeartbeatAt,
      lastDurationMs,
      lastLagMs,
      lastError,
      running,
      enabled: job.enabled,
      runCount,
      progress,
      skipKey: job.skipKey,
      concurrency: job.concurrency,
      activeRuns: job.activeRuns,
      pendingRuns: job.pendingRuns,
      lockPolicy: job.lockPolicy,
      degradedLocking,
      history24h: historyByJobName.get(job.name) ?? null,
    });
  }

  return result;
}

export function triggerJob(name: string): { triggered: boolean; queued?: boolean } | null {
  const job = jobs.find((entry) => entry.name === name);
  if (!job) return null;

  if (job.concurrency > 1) {
    if (job.activeRuns >= job.concurrency && job.pendingRuns >= job.concurrency) {
      return { triggered: false };
    }
    audit({ category: 'JOB', action: 'JOB_MANUAL_TRIGGER', actor: 'user', metadata: { jobName: name } });
    const willQueue = job.activeRuns >= job.concurrency;
    void requestRun(job, Date.now());
    return { triggered: true, queued: willQueue };
  }

  if (job.running) return { triggered: false };
  if (job.skipKey) {
    getRedisClient().del(job.skipKey).catch(() => {
      // ignore
    });
  }
  audit({ category: 'JOB', action: 'JOB_MANUAL_TRIGGER', actor: 'user', metadata: { jobName: name } });
  void requestRun(job, Date.now());
  return { triggered: true };
}

export function updateJobInterval(name: string, intervalMs: number): JobInfo | null {
  const job = jobs.find((entry) => entry.name === name);
  if (!job) return null;

  clearTimer(job);
  job.intervalMs = intervalMs;
  job.enabled = intervalMs > 0;
  job.lockTtlMs = Math.max(intervalMs * 3, 60_000);

  if (job.enabled) {
    scheduleJob(job, Date.now() + job.intervalMs);
    console.log(`[scheduler] Job "${job.name}" rescheduled every ${job.intervalMs / 1000}s`);
  } else {
    console.log(`[scheduler] Job "${job.name}" disabled`);
  }

  return {
    name: job.name,
    label: job.label,
    description: job.description,
    group: job.group,
    entityScopes: job.entityScopes,
    order: job.order,
    intervalMs: job.intervalMs,
    lastRun: job.lastRun,
    lastStartedAt: job.lastStartedAt,
    lastCompletedAt: job.lastCompletedAt,
    lastHeartbeatAt: job.lastHeartbeatAt,
    lastDurationMs: job.lastDurationMs,
    lastLagMs: job.lastLagMs,
    lastError: job.lastError,
    running: job.running,
    enabled: job.enabled,
    runCount: job.runCount,
    progress: null,
    concurrency: job.concurrency,
    activeRuns: job.activeRuns,
    pendingRuns: job.pendingRuns,
    skipKey: job.skipKey,
    lockPolicy: job.lockPolicy,
    degradedLocking: job.degradedLocking,
    history24h: null,
  };
}
