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
import { fetchMatchesJob } from './fetch-matches.job.js';
import { updatePredictionsJob } from './update-predictions.job.js';
import { expireWatchlistJob } from './expire-watchlist.job.js';
import { checkLiveTriggerJob } from './check-live-trigger.job.js';
import { autoSettleJob } from './auto-settle.job.js';
import { enrichWatchlistJob } from './enrich-watchlist.job.js';
import { purgeAuditJob } from './purge-audit.job.js';
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
  intervalMs: number;
  lastRun: string | null;
  lastError: string | null;
  running: boolean;
  enabled: boolean;
  runCount: number;
  progress: JobProgress | null;
}

interface ManagedJob {
  name: string;
  intervalMs: number;
  fn: () => Promise<unknown>;
  timer: ReturnType<typeof setInterval> | null;
  lastRun: string | null;
  lastError: string | null;
  running: boolean;
  enabled: boolean;
  runCount: number;
  lockTtlMs: number;
}

const jobs: ManagedJob[] = [];
const instanceId = crypto.randomUUID();

// Redis key helpers (keyPrefix 'tfi:' is applied by ioredis)
const lockKey = (name: string) => `job:lock:${name}`;
const stateKey = (name: string) => `job:state:${name}`;

function register(name: string, intervalMs: number, fn: () => Promise<unknown>, lockTtlMs?: number) {
  jobs.push({
    name, intervalMs, fn,
    timer: null, lastRun: null, lastError: null,
    running: false, enabled: intervalMs > 0, runCount: 0,
    lockTtlMs: lockTtlMs ?? Math.max(intervalMs * 3, 60_000),
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

async function runJob(job: ManagedJob) {
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
    job.running = false;
    await persistState(job);
    await releaseLock(job);
  }
}

export async function startScheduler() {
  // Register all jobs
  // Register in logical pipeline order:
  // 1. Ingest data → 2. Enrich → 3. Predict → 4. Live analysis → 5. Settle → 6. Cleanup
  register('fetch-matches', config.jobFetchMatchesMs, fetchMatchesJob);
  register('enrich-watchlist', config.jobEnrichWatchlistMs, enrichWatchlistJob, 10 * 60_000);
  register('update-predictions', config.jobPredictionsMs, updatePredictionsJob, 10 * 60_000);
  register('check-live-trigger', config.jobCheckLiveMs, checkLiveTriggerJob);
  register('auto-settle', config.jobAutoSettleMs, autoSettleJob);
  register('expire-watchlist', config.jobExpireWatchlistMs, expireWatchlistJob);
  register('purge-audit', config.jobAuditPurgeMs, purgeAuditJob);

  // Restore state from Redis
  for (const job of jobs) {
    await restoreState(job);
  }

  for (const job of jobs) {
    if (!job.enabled) {
      console.log(`[scheduler] Job "${job.name}" disabled (interval=0)`);
      continue;
    }
    job.timer = setInterval(() => runJob(job), job.intervalMs);
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
  for (const job of jobs) {
    const progress = await getJobProgress(job.name);
    result.push({
      name: job.name, intervalMs: job.intervalMs, lastRun: job.lastRun,
      lastError: job.lastError, running: job.running, enabled: job.enabled,
      runCount: job.runCount, progress,
    });
  }
  return result;
}

export function triggerJob(name: string): { triggered: boolean } | null {
  const job = jobs.find((j) => j.name === name);
  if (!job) return null;
  if (job.running) return { triggered: false };
  // Fire and forget — progress tracked via Redis
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

  if (job.enabled) {
    job.timer = setInterval(() => runJob(job), job.intervalMs);
    console.log(`[scheduler] Job "${job.name}" rescheduled every ${job.intervalMs / 1000}s`);
  } else {
    console.log(`[scheduler] Job "${job.name}" disabled`);
  }

  return { name: job.name, intervalMs: job.intervalMs, lastRun: job.lastRun, lastError: job.lastError, running: job.running, enabled: job.enabled, runCount: job.runCount, progress: null };
}
