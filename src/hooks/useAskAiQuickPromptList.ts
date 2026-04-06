import { useEffect, useMemo, useState } from 'react';
import { loadMonitorConfig } from '@/features/live-monitor/config';
import {
  mergeAskAiQuickPromptsForLocale,
  type AskAiPromptLocale,
} from '@/lib/askAiQuickPrompts';

/** Resolves Ask AI chip list for the current UI locale, including per-user lines from settings. */
export function useAskAiQuickPromptList(locale: AskAiPromptLocale) {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const on = () => setTick((t) => t + 1);
    window.addEventListener('tfi:settings-updated', on);
    return () => window.removeEventListener('tfi:settings-updated', on);
  }, []);

  return useMemo(() => {
    const cfg = loadMonitorConfig();
    return mergeAskAiQuickPromptsForLocale(locale, cfg.ASK_AI_QUICK_PROMPTS_BY_LOCALE);
  }, [locale, tick]);
}