// ============================================================
// Job Scheduler — periodic jobs with Redis-based lock + state
//
// - SETNX lock prevents concurrent runs of the same job
// - Job state (lastRun, lastError, runCount) persisted in Redis
// - Survives server restarts
// ============================================================

import { config } from '../config.js';
import { getRedisClient } from '../lib/redis.js';
import { fetchMatchesJob } from './fetch-matches.job.js';
import { updatePredictionsJob } from './update-predictions.job.js';
import { expireWatchlistJob } from './expire-watchlist.job.js';
import { checkLiveTriggerJob } from './check-live-trigger.job.js';
import { autoSettleJob } from './auto-settle.job.js';
import crypto from 'node:crypto';

export interface JobInfo {
  name: string;
  intervalMs: number;
  lastRun: string | null;
  lastError: string | null;
  running: boolean;
  enabled: boolean;
  runCount: number;
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
  } catch {
    // Redis down → allow job to run (graceful degradation)
    return true;
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

  try {
    const result = await job.fn();
    job.lastRun = new Date().toISOString();
    job.lastError = null;
    job.runCount++;
    console.log(`[scheduler] Job "${job.name}" completed (#${job.runCount})`, result);
  } catch (err) {
    job.lastError = err instanceof Error ? err.message : String(err);
    console.error(`[scheduler] Job "${job.name}" failed:`, err);
  } finally {
    job.running = false;
    await persistState(job);
    await releaseLock(job);
  }
}

export async function startScheduler() {
  // Register all jobs
  register('fetch-matches', config.jobFetchMatchesMs, fetchMatchesJob);
  register('update-predictions', config.jobPredictionsMs, updatePredictionsJob, 10 * 60_000);
  register('expire-watchlist', config.jobExpireWatchlistMs, expireWatchlistJob);
  register('check-live-trigger', config.jobCheckLiveMs, checkLiveTriggerJob);
  register('auto-settle', config.jobAutoSettleMs, autoSettleJob);

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

  console.log(`[scheduler] ✅ ${jobs.filter((j) => j.enabled).length} jobs started (instance: ${instanceId.slice(0, 8)})`);
}

export function stopScheduler() {
  for (const job of jobs) {
    if (job.timer) {
      clearInterval(job.timer);
      job.timer = null;
    }
  }
  console.log('[scheduler] All jobs stopped');
}

export function getJobsStatus(): JobInfo[] {
  return jobs.map(({ name, intervalMs, lastRun, lastError, running, enabled, runCount }) => ({
    name, intervalMs, lastRun, lastError, running, enabled, runCount,
  }));
}

export async function triggerJob(name: string): Promise<JobInfo | null> {
  const job = jobs.find((j) => j.name === name);
  if (!job) return null;
  await runJob(job);
  return { name: job.name, intervalMs: job.intervalMs, lastRun: job.lastRun, lastError: job.lastError, running: job.running, enabled: job.enabled, runCount: job.runCount };
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

  return { name: job.name, intervalMs: job.intervalMs, lastRun: job.lastRun, lastError: job.lastError, running: job.running, enabled: job.enabled, runCount: job.runCount };
}
