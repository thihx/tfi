// ============================================================
// useScheduler — React hook for the pipeline scheduler
// ============================================================

import { useState, useEffect, useCallback, useRef } from 'react';
import type { AppConfig } from '@/types';
import type { LiveMonitorConfig, PipelineContext } from './types';
import {
  startScheduler,
  stopScheduler,
  pauseScheduler,
  resumeScheduler,
  triggerManualRun,
  onSchedulerChange,
  getSchedulerState,
  type SchedulerState,
} from './scheduler';

export function useScheduler(appConfig: AppConfig) {
  const [state, setState] = useState<SchedulerState>(getSchedulerState);
  const appConfigRef = useRef(appConfig);

  useEffect(() => {
    appConfigRef.current = appConfig;
  }, [appConfig]);

  useEffect(() => {
    return onSchedulerChange(setState);
  }, []);

  const start = useCallback(
    (options?: { intervalMs?: number; configOverrides?: Partial<LiveMonitorConfig> }) => {
      startScheduler(appConfigRef.current, options);
    },
    [],
  );

  const stop = useCallback(() => stopScheduler(), []);
  const pause = useCallback(() => pauseScheduler(), []);
  const resume = useCallback(() => resumeScheduler(), []);

  const runOnce = useCallback(
    async (configOverrides?: Partial<LiveMonitorConfig>): Promise<PipelineContext> => {
      return triggerManualRun(appConfigRef.current, configOverrides);
    },
    [],
  );

  return {
    ...state,
    start,
    stop,
    pause,
    resume,
    runOnce,
  };
}
