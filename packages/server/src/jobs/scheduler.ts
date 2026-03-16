// ============================================================
// Job Scheduler — manages periodic jobs with setInterval
// ============================================================

import { config } from '../config.js';
import { fetchMatchesJob } from './fetch-matches.job.js';
import { updatePredictionsJob } from './update-predictions.job.js';
import { expireWatchlistJob } from './expire-watchlist.job.js';
import { checkLiveTriggerJob } from './check-live-trigger.job.js';

export interface JobInfo {
  name: string;
  intervalMs: number;
  lastRun: string | null;
  lastError: string | null;
  running: boolean;
  enabled: boolean;
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
}

const jobs: ManagedJob[] = [];

function register(name: string, intervalMs: number, fn: () => Promise<unknown>) {
  jobs.push({ name, intervalMs, fn, timer: null, lastRun: null, lastError: null, running: false, enabled: intervalMs > 0 });
}

async function runJob(job: ManagedJob) {
  if (job.running) return;
  job.running = true;
  try {
    await job.fn();
    job.lastRun = new Date().toISOString();
    job.lastError = null;
  } catch (err) {
    job.lastError = err instanceof Error ? err.message : String(err);
    console.error(`[scheduler] Job "${job.name}" failed:`, err);
  } finally {
    job.running = false;
  }
}

export function startScheduler() {
  // Register all jobs
  register('fetch-matches', config.jobFetchMatchesMs, fetchMatchesJob);
  register('update-predictions', config.jobPredictionsMs, updatePredictionsJob);
  register('expire-watchlist', config.jobExpireWatchlistMs, expireWatchlistJob);
  register('check-live-trigger', config.jobCheckLiveMs, checkLiveTriggerJob);

  for (const job of jobs) {
    if (!job.enabled) {
      console.log(`[scheduler] Job "${job.name}" disabled (interval=0)`);
      continue;
    }
    job.timer = setInterval(() => runJob(job), job.intervalMs);
    console.log(`[scheduler] Job "${job.name}" scheduled every ${job.intervalMs / 1000}s`);
  }

  console.log(`[scheduler] ✅ ${jobs.filter((j) => j.enabled).length} jobs started`);
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
  return jobs.map(({ name, intervalMs, lastRun, lastError, running, enabled }) => ({
    name, intervalMs, lastRun, lastError, running, enabled,
  }));
}

export async function triggerJob(name: string): Promise<JobInfo | null> {
  const job = jobs.find((j) => j.name === name);
  if (!job) return null;
  await runJob(job);
  return { name: job.name, intervalMs: job.intervalMs, lastRun: job.lastRun, lastError: job.lastError, running: job.running, enabled: job.enabled };
}
