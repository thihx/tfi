// ============================================================
// Job Scheduler — periodic jobs with Redis-based lock + state
//
// - SETNX lock prevents concurrent runs of the same job
// - Job state (lastRun, lastError, runCount) persisted in Redis
// - Survives server restarts
// ============================================================

import { config } from '../config.js';
import { getRedisClient } from '../lib/redis.js';
import { audit } from '../lib/audit.js';
import { fetchMatchesJob, ADAPTIVE_SKIP_KEY } from './fetch-matches.job.js';
import { refreshLiveMatchesJob } from './refresh-live-matches.job.js';
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
import {
  type JobProgress,
  clearJobProgress,
  reportJobProgress,
  completeJobProgress,
  getJobProgress,
} from './job-progress.js';
import crypto from 'node:crypto';

export type { JobProgress };

export interface JobInfo {
  name: string;
  label?: string;
  description?: string;
  group?: string;
  entityScopes?: string[];
  order?: number;
  intervalMs: number;
  lastRun: string | null;
  lastError: string | null;
  running: boolean;
  enabled: boolean;
  runCount: number;
  progress: JobProgress | null;
  /** Max number of concurrent runs allowed. 1 = single-threaded (default). */
  concurrency: number;
  /** Number of runs currently executing (for concurrency > 1 jobs). */
  activeRuns: number;
  /** Number of runs waiting for a free slot in the queue. */
  pendingRuns: number;
  /** Redis key used for intentional skip/defer (e.g. adaptive polling). Exposed so watchdog can distinguish intentional sleep from a real miss. */
  skipKey?: string;
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
  timer: ReturnType<typeof setInterval> | null;
  lastRun: string | null;
  lastError: string | null;
  running: boolean;
  enabled: boolean;
  runCount: number;
  lockTtlMs: number;
  /** Hard timeout for a single run. If exceeded, the run is aborted with an error and running is reset. */
  maxRunMs?: number;
  /** Max concurrent runs. 1 = single (default). Jobs with concurrency > 1 skip the Redis distributed lock. */
  concurrency: number;
  /** Active run count for concurrent jobs. */
  activeRuns: number;
  /** Pending (queued) run count — max = concurrency. */
  pendingRuns: number;
  skipKey?: string;
}

interface JobMetadata {
  label: string;
  description: string;
  group: 'pipeline' | 'monitoring' | 'maintenance' | 'reference-data';
  entityScopes?: string[];
  order: number;
}

const jobs: ManagedJob[] = [];
const instanceId = crypto.randomUUID();
let schedulerStartedAt = 0;

/** Returns how long the scheduler has been running (ms). */
export function getSchedulerUptime(): number {
  return schedulerStartedAt > 0 ? Date.now() - schedulerStartedAt : 0;
}

// Redis key helpers (keyPrefix 'tfi:' is applied by ioredis)
const lockKey = (name: string) => `job:lock:${name}`;
const stateKey = (name: string) => `job:state:${name}`;

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
    intervalMs, fn,
    timer: null, lastRun: null, lastError: null,
    running: false, enabled: intervalMs > 0, runCount: 0,
    lockTtlMs: lockTtlMs ?? Math.max(intervalMs * 3, 60_000),
    maxRunMs,
    concurrency, activeRuns: 0, pendingRuns: 0,
    skipKey,
  });
}

async function acquireLock(job: ManagedJob): Promise<boolean> {
  try {
    const redis = getRedisClient();
    const ttlSec = Math.ceil(job.lockTtlMs / 1000);
    const result = await redis.set(lockKey(job.name), instanceId, 'EX', ttlSec, 'NX');
    return result === 'OK';
  } catch (err) {
    // Redis down → refuse to run to prevent concurrent execution
    console.error(`[scheduler] Redis unavailable for lock "${job.name}", skipping run:`, err);
    return false;
  }
}

async function releaseLock(job: ManagedJob): Promise<void> {
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
      lastError: job.lastError || '',
      runCount: String(job.runCount),
      running: job.running ? '1' : '0',
    });
  } catch {
    // ignore
  }
}

async function restoreState(job: ManagedJob): Promise<void> {
  try {
    const redis = getRedisClient();
    const state = await redis.hgetall(stateKey(job.name));
    if (state.lastRun) job.lastRun = state.lastRun;
    if (state.lastError) job.lastError = state.lastError;
    if (state.runCount) job.runCount = Number(state.runCount);
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
      (r) => { clearTimeout(timer); resolve(r); },
      (e) => { clearTimeout(timer); reject(e); },
    );
  });
}

async function runJob(job: ManagedJob) {
  if (job.concurrency === 1) {
    // ── Single-run path: existing behavior (Redis distributed lock) ──────────
    if (job.running) return;

    const locked = await acquireLock(job);
    if (!locked) {
      console.log(`[scheduler] Job "${job.name}" skipped — another instance holds the lock`);
      return;
    }

    job.running = true;
    await persistState(job);
    await clearJobProgress(job.name);
    await reportJobProgress(job.name, 'starting', 'Starting...', 0);

    const jobStart = Date.now();
    try {
      const result = await (job.maxRunMs ? callWithTimeout(job.fn, job.maxRunMs) : job.fn());
      job.lastRun = new Date().toISOString();
      job.lastError = null;
      job.runCount++;
      await completeJobProgress(job.name, result, null);
      audit({ category: 'JOB', action: `JOB_${job.name.toUpperCase().replace(/-/g, '_')}`, outcome: 'SUCCESS', actor: 'scheduler', duration_ms: Date.now() - jobStart, metadata: result && typeof result === 'object' ? result as Record<string, unknown> : null });
      console.log(`[scheduler] Job "${job.name}" completed (#${job.runCount})`, result);
    } catch (err) {
      job.lastError = err instanceof Error ? err.message : String(err);
      await completeJobProgress(job.name, null, job.lastError);
      audit({ category: 'JOB', action: `JOB_${job.name.toUpperCase().replace(/-/g, '_')}`, outcome: 'FAILURE', actor: 'scheduler', duration_ms: Date.now() - jobStart, error: job.lastError });
      console.error(`[scheduler] Job "${job.name}" failed:`, err);
    } finally {
      job.running = false;
      await persistState(job);
      await releaseLock(job);
    }
  } else {
    // ── Multi-run path: in-process concurrency with queue ───────────────────
    // No Redis distributed lock — each instance manages its own concurrency.
    if (job.activeRuns >= job.concurrency) {
      // At capacity — queue if there's room (max queue = concurrency)
      if (job.pendingRuns < job.concurrency) {
        job.pendingRuns++;
        console.log(`[scheduler] Job "${job.name}" queued (${job.activeRuns}/${job.concurrency} active, ${job.pendingRuns} pending)`);
      } else {
        console.log(`[scheduler] Job "${job.name}" dropped — queue full (${job.concurrency}/${job.concurrency} active + ${job.pendingRuns} pending)`);
      }
      return;
    }

    job.activeRuns++;
    job.running = true;
    await clearJobProgress(job.name);
    await reportJobProgress(job.name, 'starting', 'Starting...', 0);

    const jobStart = Date.now();
    try {
      const result = await job.fn();
      job.lastRun = new Date().toISOString();
      job.lastError = null;
      job.runCount++;
      await completeJobProgress(job.name, result, null);
      audit({ category: 'JOB', action: `JOB_${job.name.toUpperCase().replace(/-/g, '_')}`, outcome: 'SUCCESS', actor: 'scheduler', duration_ms: Date.now() - jobStart, metadata: result && typeof result === 'object' ? result as Record<string, unknown> : null });
      console.log(`[scheduler] Job "${job.name}" completed (#${job.runCount})`, result);
    } catch (err) {
      job.lastError = err instanceof Error ? err.message : String(err);
      await completeJobProgress(job.name, null, job.lastError);
      audit({ category: 'JOB', action: `JOB_${job.name.toUpperCase().replace(/-/g, '_')}`, outcome: 'FAILURE', actor: 'scheduler', duration_ms: Date.now() - jobStart, error: job.lastError });
      console.error(`[scheduler] Job "${job.name}" failed:`, err);
    } finally {
      job.activeRuns--;
      job.running = job.activeRuns > 0;
      // Dequeue next pending run
      if (job.pendingRuns > 0) {
        job.pendingRuns--;
        console.log(`[scheduler] Job "${job.name}" dequeuing pending run (${job.pendingRuns} remaining)`);
        runJob(job);
      }
    }
  }
}

export async function startScheduler() {
  // Register all jobs
  // Register in logical pipeline order:
  // 1. Ingest data → 2. Enrich → 3. Predict → 4. Live analysis → 5. Settle → 6. Cleanup
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
      description: 'Looks for today\'s and tomorrow\'s matches in the leagues you track, updates the match list, saves finished games to history, and adds some new matches to the follow list when they fit the rules.',
      group: 'pipeline',
      entityScopes: ['matches', 'watchlist-candidates', 'match-history-archive'],
      order: 1,
    },
  );
  register(
    'refresh-live-matches',
    config.jobRefreshLiveMatchesMs,
    refreshLiveMatchesJob,
    undefined,
    undefined,
    1,
    undefined,
    {
      label: 'Refresh Live Matches',
      description: 'Refreshes only the matches that are live or about to start, so scores and match state move faster without forcing a full match reload every few seconds.',
      group: 'pipeline',
      entityScopes: ['matches', 'live-scores', 'live-cards'],
      order: 2,
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
    },
  );
  register(
    'check-live-trigger',
    config.jobCheckLiveMs,
    checkLiveTriggerJob,
    undefined,
    undefined,
    1,
    undefined,
    {
      label: 'Check Live Matches',
      description: 'Looks for followed matches that are now live and decides which ones need a fresh review. For those matches, it runs the main review flow and may save a new result or send an alert.',
      group: 'pipeline',
      entityScopes: ['watchlist', 'live-pipeline', 'recommendations', 'notifications'],
      order: 6,
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
      description: 'Refreshes saved match details for live and followed games, such as match facts, event details, and price snapshots, so the app can read recent local copies instead of asking again each time.',
      group: 'pipeline',
      entityScopes: ['provider-fixture-cache', 'provider-stats-cache', 'provider-events-cache', 'provider-odds-cache'],
      order: 7,
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
      order: 8,
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
      order: 9,
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
      order: 10,
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
      order: 11,
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
      order: 12,
    },
  );

  schedulerStartedAt = Date.now();

  // Restore state from Redis
  for (const job of jobs) {
    await restoreState(job);
  }

  // Clear any stale adaptive skip keys so jobs run promptly after restart
  for (const job of jobs) {
    if (job.skipKey) {
      try {
        await getRedisClient().del(job.skipKey);
      } catch { /* ignore */ }
    }
  }

  for (const job of jobs) {
    if (!job.enabled) {
      console.log(`[scheduler] Job "${job.name}" disabled (interval=0)`);
      continue;
    }
    job.timer = setInterval(() => runJob(job), job.intervalMs);

    // If the job is overdue (lastRun + interval < now), run it immediately
    // instead of waiting for the full interval to elapse.
    const lastRunTs = job.lastRun ? new Date(job.lastRun).getTime() : 0;
    const overdue = lastRunTs > 0 && (Date.now() - lastRunTs) > job.intervalMs;
    if (overdue) {
      console.log(`[scheduler] Job "${job.name}" is overdue (last ran ${job.lastRun}), running immediately`);
      runJob(job);
    }

    console.log(`[scheduler] Job "${job.name}" every ${job.intervalMs / 1000}s (runs so far: ${job.runCount})`);
  }

  console.log(`[scheduler] ✅ ${jobs.filter((j) => j.enabled).length} jobs started (instance: ${instanceId.slice(0, 8)})`);  audit({ category: 'SYSTEM', action: 'SCHEDULER_START', actor: 'system', metadata: { enabledJobs: jobs.filter((j) => j.enabled).map((j) => j.name), instanceId: instanceId.slice(0, 8) } });}

export function stopScheduler() {
  for (const job of jobs) {
    if (job.timer) {
      clearInterval(job.timer);
      job.timer = null;
    }
  }
  console.log('[scheduler] All jobs stopped');
}

export async function getJobsStatus(): Promise<JobInfo[]> {
  const result: JobInfo[] = [];
  let redis: ReturnType<typeof getRedisClient> | null = null;
  try { redis = getRedisClient(); } catch { /* unavailable */ }

  for (const job of jobs) {
    const progress = await getJobProgress(job.name);

    // Merge with Redis state so multi-instance deployments (e.g. local + Azure)
    // see the most recent run even if it was completed by another instance.
    let lastRun = job.lastRun;
    let lastError = job.lastError;
    let running = job.running;
    if (redis) {
      try {
        const state = await redis.hgetall(stateKey(job.name));
        if (state.lastRun && state.lastRun > (lastRun ?? '')) lastRun = state.lastRun;
        if (state.lastError && !lastError) lastError = state.lastError;
        // A job marked running in Redis by another instance takes precedence
        if (state.running === '1' && !running) running = true;
      } catch { /* ignore — use in-memory fallback */ }
    }

    result.push({
      name: job.name,
      label: job.label,
      description: job.description,
      group: job.group,
      entityScopes: job.entityScopes,
      order: job.order,
      intervalMs: job.intervalMs, lastRun,
      lastError, running, enabled: job.enabled,
      runCount: job.runCount, progress, skipKey: job.skipKey,
      concurrency: job.concurrency,
      activeRuns: job.activeRuns,
      pendingRuns: job.pendingRuns,
    });
  }
  return result;
}

export function triggerJob(name: string): { triggered: boolean; queued?: boolean } | null {
  const job = jobs.find((j) => j.name === name);
  if (!job) return null;

  // For concurrent jobs: only reject when queue is full
  if (job.concurrency > 1) {
    if (job.activeRuns >= job.concurrency && job.pendingRuns >= job.concurrency) {
      return { triggered: false }; // queue full
    }
    audit({ category: 'JOB', action: 'JOB_MANUAL_TRIGGER', actor: 'user', metadata: { jobName: name } });
    const willQueue = job.activeRuns >= job.concurrency;
    runJob(job);
    return { triggered: true, queued: willQueue };
  }

  // Single-run: reject if already running
  if (job.running) return { triggered: false };
  // Clear adaptive skip key so manual trigger always runs immediately
  if (job.skipKey) {
    getRedisClient().del(job.skipKey).catch(() => { /* ignore */ });
  }
  audit({ category: 'JOB', action: 'JOB_MANUAL_TRIGGER', actor: 'user', metadata: { jobName: name } });
  runJob(job);
  return { triggered: true };
}

export function updateJobInterval(name: string, intervalMs: number): JobInfo | null {
  const job = jobs.find((j) => j.name === name);
  if (!job) return null;

  if (job.timer) {
    clearInterval(job.timer);
    job.timer = null;
  }

  job.intervalMs = intervalMs;
  job.enabled = intervalMs > 0;
  job.lockTtlMs = Math.max(intervalMs * 3, 60_000);

  if (job.enabled) {
    job.timer = setInterval(() => runJob(job), job.intervalMs);
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
    lastError: job.lastError,
    running: job.running,
    enabled: job.enabled,
    runCount: job.runCount,
    progress: null,
    concurrency: job.concurrency,
    activeRuns: job.activeRuns,
    pendingRuns: job.pendingRuns,
  };
}
