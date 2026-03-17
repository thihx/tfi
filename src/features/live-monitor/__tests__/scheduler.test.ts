// ============================================================
// Scheduler Tests
// Tests start/stop/pause/resume, tick, manual run, concurrency
// ============================================================

import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock the pipeline module before importing scheduler
vi.mock('../services/pipeline', () => ({
  runPipeline: vi.fn(),
}));

import {
  startScheduler,
  stopScheduler,
  pauseScheduler,
  resumeScheduler,
  getSchedulerState,
  onSchedulerChange,
  triggerManualRun,
} from '../scheduler';
import { runPipeline } from '../services/pipeline';
import type { PipelineContext } from '../types';
import { createAppConfig } from './fixtures';

const appConfig = createAppConfig();

function makeCtx(stage: PipelineContext['stage'] = 'complete'): PipelineContext {
  return {
    config: {} as PipelineContext['config'],
    stage,
    startedAt: new Date().toISOString(),
    triggeredBy: 'scheduled',
    results: [],
  };
}

/** Capture current counts to compute deltas (state persists across tests) */
function baselineCounts() {
  const s = getSchedulerState();
  return { runCount: s.runCount, errorCount: s.errorCount };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.resetAllMocks();
  stopScheduler(); // reset status
  (runPipeline as ReturnType<typeof vi.fn>).mockResolvedValue(makeCtx());
});

afterEach(() => {
  stopScheduler();
  vi.useRealTimers();
});

describe('startScheduler', () => {
  test('sets status to running', () => {
    startScheduler(appConfig);
    expect(getSchedulerState().status).toBe('running');
  });

  test('triggers immediate pipeline run', async () => {
    startScheduler(appConfig);
    await vi.advanceTimersByTimeAsync(0);
    expect(runPipeline).toHaveBeenCalledTimes(1);
    expect(runPipeline).toHaveBeenCalledWith(appConfig, expect.objectContaining({
      triggeredBy: 'scheduled',
    }));
  });

  test('uses custom intervalMs', () => {
    startScheduler(appConfig, { intervalMs: 10_000 });
    expect(getSchedulerState().intervalMs).toBe(10_000);
  });

  test('passes configOverrides to pipeline', async () => {
    const overrides = { MIN_CONFIDENCE: 8 };
    startScheduler(appConfig, { configOverrides: overrides });
    await vi.advanceTimersByTimeAsync(0);
    expect(runPipeline).toHaveBeenCalledWith(appConfig, expect.objectContaining({
      configOverrides: overrides,
    }));
  });

  test('stops previous scheduler before starting new one', () => {
    startScheduler(appConfig, { intervalMs: 5000 });
    startScheduler(appConfig, { intervalMs: 10000 });
    expect(getSchedulerState().intervalMs).toBe(10000);
  });
});

describe('stopScheduler', () => {
  test('sets status to idle', () => {
    startScheduler(appConfig);
    stopScheduler();
    expect(getSchedulerState().status).toBe('idle');
  });

  test('clears nextRunAt', () => {
    startScheduler(appConfig);
    stopScheduler();
    expect(getSchedulerState().nextRunAt).toBeNull();
  });

  test('prevents further ticks', async () => {
    startScheduler(appConfig, { intervalMs: 1000 });
    await vi.advanceTimersByTimeAsync(0); // initial tick
    stopScheduler();
    await vi.advanceTimersByTimeAsync(5000);
    expect(runPipeline).toHaveBeenCalledTimes(1); // only the initial
  });
});

describe('pauseScheduler', () => {
  test('sets status to paused', () => {
    startScheduler(appConfig);
    pauseScheduler();
    expect(getSchedulerState().status).toBe('paused');
  });

  test('clears nextRunAt', () => {
    startScheduler(appConfig);
    pauseScheduler();
    expect(getSchedulerState().nextRunAt).toBeNull();
  });

  test('stops ticking while paused', async () => {
    startScheduler(appConfig, { intervalMs: 1000 });
    await vi.advanceTimersByTimeAsync(0); // initial
    pauseScheduler();
    await vi.advanceTimersByTimeAsync(5000);
    expect(runPipeline).toHaveBeenCalledTimes(1);
  });
});

describe('resumeScheduler', () => {
  test('sets status back to running after pause', () => {
    startScheduler(appConfig);
    pauseScheduler();
    resumeScheduler();
    expect(getSchedulerState().status).toBe('running');
  });

  test('resumes ticking after pause', async () => {
    startScheduler(appConfig, { intervalMs: 1000 });
    await vi.advanceTimersByTimeAsync(0); // initial
    pauseScheduler();
    resumeScheduler();
    await vi.advanceTimersByTimeAsync(0); // resume tick
    expect(runPipeline).toHaveBeenCalledTimes(2);
  });

  test('does nothing if not paused', () => {
    resumeScheduler();
    expect(getSchedulerState().status).toBe('idle');
  });

  test('does nothing if idle', () => {
    resumeScheduler();
    expect(runPipeline).not.toHaveBeenCalled();
  });
});

describe('tick cycle', () => {
  test('schedules next tick after completing', async () => {
    startScheduler(appConfig, { intervalMs: 5000 });
    await vi.advanceTimersByTimeAsync(0); // initial tick
    const calls1 = (runPipeline as ReturnType<typeof vi.fn>).mock.calls.length;

    await vi.advanceTimersByTimeAsync(5000); // second tick
    const calls2 = (runPipeline as ReturnType<typeof vi.fn>).mock.calls.length;
    expect(calls2).toBe(calls1 + 1);
  });

  test('increments runCount', async () => {
    const base = baselineCounts();
    startScheduler(appConfig, { intervalMs: 1000 });
    await vi.advanceTimersByTimeAsync(0);
    expect(getSchedulerState().runCount).toBe(base.runCount + 1);

    await vi.advanceTimersByTimeAsync(1000);
    expect(getSchedulerState().runCount).toBe(base.runCount + 2);
  });

  test('increments errorCount on pipeline error stage', async () => {
    const base = baselineCounts();
    (runPipeline as ReturnType<typeof vi.fn>).mockResolvedValue(makeCtx('error'));
    startScheduler(appConfig);
    await vi.advanceTimersByTimeAsync(0);
    expect(getSchedulerState().errorCount).toBe(base.errorCount + 1);
  });

  test('increments errorCount on pipeline throw', async () => {
    const base = baselineCounts();
    (runPipeline as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('boom'));
    startScheduler(appConfig);
    await vi.advanceTimersByTimeAsync(0);
    expect(getSchedulerState().errorCount).toBe(base.errorCount + 1);
  });

  test('updates lastRun after each tick', async () => {
    startScheduler(appConfig, { intervalMs: 1000 });
    await vi.advanceTimersByTimeAsync(0);
    const last1 = getSchedulerState().lastRun;
    expect(last1).not.toBeNull();
  });

  test('stores lastResult', async () => {
    const ctx = makeCtx();
    (runPipeline as ReturnType<typeof vi.fn>).mockResolvedValue(ctx);
    startScheduler(appConfig);
    await vi.advanceTimersByTimeAsync(0);
    expect(getSchedulerState().lastResult?.stage).toBe('complete');
  });
});

describe('onSchedulerChange', () => {
  test('notifies listeners on state changes', () => {
    const listener = vi.fn();
    const unsub = onSchedulerChange(listener);
    startScheduler(appConfig);
    expect(listener).toHaveBeenCalled();
    unsub();
  });

  test('unsubscribe stops notifications', () => {
    const listener = vi.fn();
    const unsub = onSchedulerChange(listener);
    unsub();
    startScheduler(appConfig);
    expect(listener).not.toHaveBeenCalled();
  });

  test('notifies multiple listeners', () => {
    const l1 = vi.fn();
    const l2 = vi.fn();
    const u1 = onSchedulerChange(l1);
    const u2 = onSchedulerChange(l2);
    startScheduler(appConfig);
    expect(l1).toHaveBeenCalled();
    expect(l2).toHaveBeenCalled();
    u1();
    u2();
  });
});

describe('triggerManualRun', () => {
  test('runs pipeline with manual triggeredBy', async () => {
    await triggerManualRun(appConfig);
    expect(runPipeline).toHaveBeenCalledWith(appConfig, expect.objectContaining({
      triggeredBy: 'manual',
    }));
  });

  test('updates scheduler state after manual run', async () => {
    const base = baselineCounts();
    await triggerManualRun(appConfig);
    const s = getSchedulerState();
    expect(s.runCount).toBe(base.runCount + 1);
    expect(s.lastRun).not.toBeNull();
    expect(s.lastResult?.stage).toBe('complete');
  });

  test('increments errorCount on error result', async () => {
    const base = baselineCounts();
    (runPipeline as ReturnType<typeof vi.fn>).mockResolvedValue(makeCtx('error'));
    await triggerManualRun(appConfig);
    expect(getSchedulerState().errorCount).toBe(base.errorCount + 1);
  });

  test('passes configOverrides', async () => {
    const overrides = { MIN_ODDS: 2.0 };
    await triggerManualRun(appConfig, overrides);
    expect(runPipeline).toHaveBeenCalledWith(appConfig, expect.objectContaining({
      configOverrides: overrides,
    }));
  });

  test('returns pipeline context', async () => {
    const ctx = await triggerManualRun(appConfig);
    expect(ctx.stage).toBe('complete');
  });
});
