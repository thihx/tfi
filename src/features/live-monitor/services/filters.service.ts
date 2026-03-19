// ============================================================
// Filters Service
// Equivalent to: "Check Should Proceed" + "Should Proceed?" + "Should Push?" + "Should Save?"
// ============================================================

import type { LiveMonitorConfig, MergedMatchData, ParsedAiResponse } from '../types';

interface ProceedResult {
  should_proceed: boolean;
  proceed_reason: string;
  stats_available: boolean;
  stats_meta: {
    missing: number;
    total: number;
    missing_ratio: number;
    stats_quality: string;
  };
  skipped_filters: string[];
  original_would_proceed: boolean;
}

/**
 * Check Should Proceed - evaluates 4 filters.
 * Mirrors the "Check Should Proceed" + "Should Proceed?" nodes exactly.
 */
export function checkShouldProceed(
  matchData: MergedMatchData,
  config: LiveMonitorConfig,
): MergedMatchData & ProceedResult {
  const match = matchData.match || {};
  const stats = matchData.stats || {};
  const forceAnalyze = matchData.force_analyze === true;
  const isManualPush = matchData.is_manual_push === true;

  const statusRaw = String(match.status || '').toUpperCase();
  const minute = Number(match.minute ?? 0) || 0;

  const MIN_MINUTE = Number(config.MIN_MINUTE ?? 5);
  const MAX_MINUTE = Number(config.MAX_MINUTE ?? 85);
  const SECOND_HALF_START_MINUTE = Number(config.SECOND_HALF_START_MINUTE ?? 5);

  let shouldProceed = true;
  const reasons: string[] = [];
  const skippedFilters: string[] = [];

  const LIVE_STATUSES = ['1H', '2H'];

  // FILTER 1: Status check
  if (!LIVE_STATUSES.includes(statusRaw)) {
    if (forceAnalyze) {
      skippedFilters.push(`Status ${statusRaw || 'UNKNOWN'} not live (BYPASSED by force)`);
    } else {
      shouldProceed = false;
      reasons.push(`Status ${statusRaw || 'UNKNOWN'} not live`);
    }
  }

  // FILTER 2: Minute window check
  if (shouldProceed || forceAnalyze) {
    let effectiveMinMinute = MIN_MINUTE;

    if (statusRaw === '2H') {
      const secondHalfThreshold = 45 + SECOND_HALF_START_MINUTE;
      if (secondHalfThreshold > effectiveMinMinute) {
        effectiveMinMinute = secondHalfThreshold;
      }
    }

    if (minute < effectiveMinMinute) {
      if (forceAnalyze) {
        skippedFilters.push(
          `Minute ${minute}' below minimum (${effectiveMinMinute}') (BYPASSED)`,
        );
      } else if (shouldProceed) {
        shouldProceed = false;
        reasons.push(`Minute ${minute}' below minimum window (${effectiveMinMinute}')`);
      }
    }

    if (minute > MAX_MINUTE) {
      if (forceAnalyze) {
        skippedFilters.push(
          `Minute ${minute}' beyond maximum (${MAX_MINUTE}') (BYPASSED)`,
        );
      } else if (shouldProceed) {
        shouldProceed = false;
        reasons.push(`Minute ${minute}' beyond maximum window (${MAX_MINUTE}')`);
      }
    }
  }

  // FILTER 3: Stats quality check
  const fields = [
    stats.possession,
    stats.shots,
    stats.shots_on_target,
    stats.corners,
    stats.fouls,
  ];

  let total = 0;
  let missing = 0;

  for (const v of fields) {
    if (v === undefined) continue;
    total++;
    const s = String(v).trim();
    if (!s || s === '-' || s.toUpperCase() === 'NA') missing++;
  }

  const missing_ratio = total ? Number((missing / total).toFixed(2)) : 1;
  let stats_quality = 'UNKNOWN';
  if (missing_ratio > 0.75) stats_quality = 'VERY_POOR';
  else if (missing_ratio > 0.5) stats_quality = 'POOR';
  else if (missing_ratio > 0.25) stats_quality = 'FAIR';
  else stats_quality = 'GOOD';

  const stats_available = stats_quality === 'GOOD' || stats_quality === 'FAIR';

  // FILTER 4: Early game with poor stats
  if (
    (shouldProceed || forceAnalyze) &&
    LIVE_STATUSES.includes(statusRaw) &&
    minute < 15 &&
    (stats_quality === 'POOR' || stats_quality === 'VERY_POOR')
  ) {
    if (forceAnalyze) {
      skippedFilters.push('Early game with poor stats (BYPASSED)');
    } else if (shouldProceed) {
      shouldProceed = false;
      reasons.push('Early game with poor stats');
    }
  }

  const finalShouldProceed = forceAnalyze ? true : shouldProceed;

  return {
    ...matchData,
    stats_available,
    stats_meta: {
      missing,
      total,
      missing_ratio,
      stats_quality,
    },
    should_proceed: finalShouldProceed,
    proceed_reason: finalShouldProceed
      ? forceAnalyze
        ? 'FORCE_ANALYZE'
        : 'LIVE_IN_WINDOW'
      : reasons.join(' | '),
    force_analyze: forceAnalyze,
    is_manual_push: isManualPush,
    skipped_filters: skippedFilters,
    original_would_proceed: shouldProceed,
  };
}

/**
 * Should Push? - determines whether to send notifications.
 * Only push when AI recommends OR condition triggered with valid bet.
 * "No Bet" results are excluded via condition_triggered_should_push logic.
 */
export function shouldPush(data: ParsedAiResponse): boolean {
  return !!(
    data.ai_should_push ||
    data.condition_triggered_should_push
  );
}

/**
 * Should Save? - determines whether to save recommendation.
 * Must be consistent with shouldPush: if we notify, we must also save.
 * "No Bet" results are NOT saved.
 */
export function shouldSave(data: ParsedAiResponse): boolean {
  return !!(
    data.ai_should_push ||
    data.condition_triggered_should_push
  );
}
