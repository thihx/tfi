// ============================================================
// Pipeline Scheduler
// Manages periodic execution of the live monitor pipeline.
// Runs in the main thread with configurable interval.
// ============================================================

import type { AppConfig } from '@/types';
import type { LiveMonitorConfig, PipelineContext } from './types';
import { runPipeline } from './services/pipeline';
import { auditLog } from '@/lib/audit';

export type SchedulerStatus = 'idle' | 'running' | 'paused';

export interface SchedulerState {
  status: SchedulerStatus;
  intervalMs: number;
  lastRun: string | null;
  lastResult: PipelineContext | null;
  runCount: number;
  errorCount: number;
  nextRunAt: string | null;
}

export type SchedulerCallback = (state: SchedulerState) => void;

const DEFAULT_INTERVAL_MS = 5 * 60_000; // 5 minutes

let timerId: ReturnType<typeof setTimeout> | null = null;
let state: SchedulerState = {
  status: 'idle',
  intervalMs: DEFAULT_INTERVAL_MS,
  lastRun: null,
  lastResult: null,
  runCount: 0,
  errorCount: 0,
  nextRunAt: null,
};
let listeners: SchedulerCallback[] = [];
let appConfigRef: AppConfig | null = null;
let configOverridesRef: Partial<LiveMonitorConfig> | undefined;

function notify() {
  for (const cb of listeners) {
    cb({ ...state });
  }
}

async function tick() {
  if (state.status !== 'running' || !appConfigRef) return;

  try {
    const ctx = await runPipeline(appConfigRef, {
      triggeredBy: 'scheduled',
      configOverrides: configOverridesRef,
    });
    state.lastResult = ctx;
    state.runCount++;
    if (ctx.stage === 'error') state.errorCount++;
  } catch {
    state.errorCount++;
  }

  state.lastRun = new Date().toISOString();

  // Schedule next run
  if (state.status === 'running') {
    state.nextRunAt = new Date(Date.now() + state.intervalMs).toISOString();
    timerId = setTimeout(tick, state.intervalMs);
  }

  notify();
}

/**
 * Start the scheduler. Runs the pipeline immediately, then repeats at intervalMs.
 */
export function startScheduler(
  appConfig: AppConfig,
  options?: {
    intervalMs?: number;
    configOverrides?: Partial<LiveMonitorConfig>;
  },
) {
  stopScheduler();

  appConfigRef = appConfig;
  configOverridesRef = options?.configOverrides;
  state.intervalMs = options?.intervalMs ?? DEFAULT_INTERVAL_MS;
  state.status = 'running';
  state.nextRunAt = new Date().toISOString();

  auditLog(appConfig, { category: 'SCHEDULER', action: 'SCHEDULER_START', metadata: { intervalMs: state.intervalMs } });

  notify();
  tick();
}

/**
 * Stop the scheduler.
 */
export function stopScheduler() {
  if (timerId !== null) {
    clearTimeout(timerId);
    timerId = null;
  }
  state.status = 'idle';
  state.nextRunAt = null;

  if (appConfigRef) auditLog(appConfigRef, { category: 'SCHEDULER', action: 'SCHEDULER_STOP', metadata: { runCount: state.runCount, errorCount: state.errorCount } });

  notify();
}

/**
 * Pause the scheduler (keeps state, stops ticking).
 */
export function pauseScheduler() {
  if (timerId !== null) {
    clearTimeout(timerId);
    timerId = null;
  }
  state.status = 'paused';
  state.nextRunAt = null;

  if (appConfigRef) auditLog(appConfigRef, { category: 'SCHEDULER', action: 'SCHEDULER_PAUSE' });

  notify();
}

/**
 * Resume a paused scheduler.
 */
export function resumeScheduler() {
  if (state.status !== 'paused' || !appConfigRef) return;
  state.status = 'running';
  state.nextRunAt = new Date().toISOString();

  auditLog(appConfigRef, { category: 'SCHEDULER', action: 'SCHEDULER_RESUME' });

  notify();
  tick();
}

/**
 * Get current scheduler state (snapshot).
 */
export function getSchedulerState(): SchedulerState {
  return { ...state };
}

/**
 * Subscribe to scheduler state changes.
 * Returns an unsubscribe function.
 */
export function onSchedulerChange(cb: SchedulerCallback): () => void {
  listeners.push(cb);
  return () => {
    listeners = listeners.filter((l) => l !== cb);
  };
}

/**
 * Trigger a single manual run (outside of the schedule).
 */
export async function triggerManualRun(
  appConfig: AppConfig,
  configOverrides?: Partial<LiveMonitorConfig>,
): Promise<PipelineContext> {
  const ctx = await runPipeline(appConfig, {
    triggeredBy: 'manual',
    configOverrides,
  });
  state.lastRun = new Date().toISOString();
  state.lastResult = ctx;
  state.runCount++;
  if (ctx.stage === 'error') state.errorCount++;
  notify();
  return ctx;
}
