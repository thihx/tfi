// ============================================================
// Server Pipeline Gates
// ============================================================

export interface MinimalStatsCompact {
  possession?: { home: string | null; away: string | null };
  shots?: { home: string | null; away: string | null };
  shots_on_target?: { home: string | null; away: string | null };
  corners?: { home: string | null; away: string | null };
  fouls?: { home: string | null; away: string | null };
}

export interface MinimalEventCompact {
  minute: number;
  type: string;
  detail: string;
}

export interface RecommendationBaseline {
  minute: number | null;
  odds: number | null;
  bet_market: string;
  selection: string;
  score?: string | null;
}

export interface SnapshotBaseline {
  minute: number;
  home_score: number;
  away_score: number;
  odds?: Record<string, unknown> | null;
}

export interface PipelineProceedSettings {
  minMinute: number;
  maxMinute: number;
  secondHalfStartMinute: number;
}

export interface PipelineProceedResult {
  shouldProceed: boolean;
  statsAvailable: boolean;
  reason: string;
  skippedFilters: string[];
  originalWouldProceed: boolean;
  statsMeta: {
    missing: number;
    total: number;
    missingRatio: number;
    statsQuality: 'GOOD' | 'FAIR' | 'POOR' | 'VERY_POOR' | 'UNKNOWN';
  };
}

export interface PipelineStalenessSettings {
  reanalyzeMinMinutes: number;
  oddsMovementThreshold: number;
}

export interface PipelineStalenessResult {
  isStale: boolean;
  reason: string;
  baseline: 'none' | 'recommendation' | 'snapshot';
}

function hasMissingSide(value: { home: string | null; away: string | null } | undefined): boolean {
  if (!value) return true;
  const home = String(value.home ?? '').trim();
  const away = String(value.away ?? '').trim();
  const missing = (s: string) => !s || s === '-' || s.toUpperCase() === 'NA';
  return missing(home) || missing(away);
}

export function checkShouldProceedServer(
  status: string,
  minute: number,
  statsCompact: MinimalStatsCompact,
  settings: PipelineProceedSettings,
  forceAnalyze = false,
): PipelineProceedResult {
  const statusRaw = String(status || '').toUpperCase();
  const currentMinute = Number.isFinite(minute) ? minute : 0;
  const skippedFilters: string[] = [];
  const reasons: string[] = [];
  let shouldProceed = true;

  const liveStatuses = ['1H', '2H'];

  if (!liveStatuses.includes(statusRaw)) {
    if (forceAnalyze) {
      skippedFilters.push(`Status ${statusRaw || 'UNKNOWN'} not live (BYPASSED by force)`);
    } else {
      shouldProceed = false;
      reasons.push(`Status ${statusRaw || 'UNKNOWN'} not live`);
    }
  }

  if (shouldProceed || forceAnalyze) {
    let effectiveMinMinute = settings.minMinute;
    if (statusRaw === '2H') {
      const secondHalfThreshold = 45 + settings.secondHalfStartMinute;
      if (secondHalfThreshold > effectiveMinMinute) {
        effectiveMinMinute = secondHalfThreshold;
      }
    }

    if (currentMinute < effectiveMinMinute) {
      if (forceAnalyze) {
        skippedFilters.push(`Minute ${currentMinute}' below minimum (${effectiveMinMinute}') (BYPASSED)`);
      } else if (shouldProceed) {
        shouldProceed = false;
        reasons.push(`Minute ${currentMinute}' below minimum window (${effectiveMinMinute}')`);
      }
    }

    if (currentMinute > settings.maxMinute) {
      if (forceAnalyze) {
        skippedFilters.push(`Minute ${currentMinute}' beyond maximum (${settings.maxMinute}') (BYPASSED)`);
      } else if (shouldProceed) {
        shouldProceed = false;
        reasons.push(`Minute ${currentMinute}' beyond maximum window (${settings.maxMinute}')`);
      }
    }
  }

  const trackedFields = [
    statsCompact.possession,
    statsCompact.shots,
    statsCompact.shots_on_target,
    statsCompact.corners,
    statsCompact.fouls,
  ];
  const total = trackedFields.length;
  const missing = trackedFields.filter(hasMissingSide).length;
  const missingRatio = total ? Number((missing / total).toFixed(2)) : 1;
  let statsQuality: PipelineProceedResult['statsMeta']['statsQuality'] = 'UNKNOWN';
  if (missingRatio > 0.75) statsQuality = 'VERY_POOR';
  else if (missingRatio > 0.5) statsQuality = 'POOR';
  else if (missingRatio > 0.25) statsQuality = 'FAIR';
  else statsQuality = 'GOOD';

  const statsAvailable = statsQuality === 'GOOD' || statsQuality === 'FAIR';

  if (
    (shouldProceed || forceAnalyze) &&
    liveStatuses.includes(statusRaw) &&
    currentMinute < 15 &&
    (statsQuality === 'POOR' || statsQuality === 'VERY_POOR')
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
    shouldProceed: finalShouldProceed,
    statsAvailable,
    reason: finalShouldProceed
      ? forceAnalyze
        ? 'FORCE_ANALYZE'
        : 'LIVE_IN_WINDOW'
      : reasons.join(' | '),
    skippedFilters,
    originalWouldProceed: shouldProceed,
    statsMeta: {
      missing,
      total,
      missingRatio,
      statsQuality,
    },
  };
}

function normalizeEventType(value: string): string {
  return String(value || '').trim().toLowerCase();
}

function extractMarketOdd(
  market: string,
  selection: string,
  canonical: Record<string, unknown> | null | undefined,
): number | null {
  const oc = (canonical ?? {}) as Record<string, Record<string, number | null> & { line?: number | null }>;
  const marketLower = String(market || '').toLowerCase();
  const selectionLower = String(selection || '').toLowerCase();

  if ((marketLower.includes('over_') || marketLower.includes('under_')) && !marketLower.startsWith('corners_')) {
    if (marketLower.startsWith('over_')) return oc.ou?.over ?? null;
    if (marketLower.startsWith('under_')) return oc.ou?.under ?? null;
  }

  if (marketLower.startsWith('1x2_')) {
    if (marketLower.endsWith('_home')) return oc['1x2']?.home ?? null;
    if (marketLower.endsWith('_away')) return oc['1x2']?.away ?? null;
    if (marketLower.endsWith('_draw')) return oc['1x2']?.draw ?? null;
  }

  if (marketLower.startsWith('btts_')) {
    if (marketLower.endsWith('_yes')) return oc.btts?.yes ?? null;
    if (marketLower.endsWith('_no')) return oc.btts?.no ?? null;
  }

  if (marketLower.startsWith('asian_handicap_')) {
    if (marketLower.includes('_home_')) return oc.ah?.home ?? null;
    if (marketLower.includes('_away_')) return oc.ah?.away ?? null;
  }

  if (marketLower.startsWith('corners_')) {
    if (marketLower.startsWith('corners_over_')) return oc.corners_ou?.over ?? null;
    if (marketLower.startsWith('corners_under_')) return oc.corners_ou?.under ?? null;
  }

  if (/home win/i.test(selectionLower)) return oc['1x2']?.home ?? null;
  if (/away win/i.test(selectionLower)) return oc['1x2']?.away ?? null;
  if (/\bdraw\b/i.test(selectionLower)) return oc['1x2']?.draw ?? null;
  if (/btts yes/i.test(selectionLower)) return oc.btts?.yes ?? null;
  if (/btts no/i.test(selectionLower)) return oc.btts?.no ?? null;
  if (/corners over/i.test(selectionLower)) return oc.corners_ou?.over ?? null;
  if (/corners under/i.test(selectionLower)) return oc.corners_ou?.under ?? null;
  if (/^home\s+[+-]?\d/.test(selectionLower)) return oc.ah?.home ?? null;
  if (/^away\s+[+-]?\d/.test(selectionLower)) return oc.ah?.away ?? null;
  if (/over/i.test(selectionLower)) return oc.ou?.over ?? null;
  if (/under/i.test(selectionLower)) return oc.ou?.under ?? null;

  return null;
}

function flattenOdds(canonical: Record<string, unknown> | null | undefined): Map<string, number> {
  const map = new Map<string, number>();
  const oc = (canonical ?? {}) as Record<string, Record<string, number | null> & { line?: number | null }>;

  const setIfFinite = (key: string, value: unknown) => {
    const num = typeof value === 'number' ? value : Number(value);
    if (Number.isFinite(num)) {
      map.set(key, num);
    }
  };

  setIfFinite('1x2.home', oc['1x2']?.home);
  setIfFinite('1x2.draw', oc['1x2']?.draw);
  setIfFinite('1x2.away', oc['1x2']?.away);
  setIfFinite('ou.line', oc.ou?.line);
  setIfFinite('ou.over', oc.ou?.over);
  setIfFinite('ou.under', oc.ou?.under);
  setIfFinite('ah.line', oc.ah?.line);
  setIfFinite('ah.home', oc.ah?.home);
  setIfFinite('ah.away', oc.ah?.away);
  setIfFinite('btts.yes', oc.btts?.yes);
  setIfFinite('btts.no', oc.btts?.no);
  setIfFinite('corners_ou.line', oc.corners_ou?.line);
  setIfFinite('corners_ou.over', oc.corners_ou?.over);
  setIfFinite('corners_ou.under', oc.corners_ou?.under);

  return map;
}

function oddsChangedMeaningfully(
  current: Record<string, unknown> | null | undefined,
  previous: Record<string, unknown> | null | undefined,
  threshold: number,
): boolean {
  const currentOdds = flattenOdds(current);
  const previousOdds = flattenOdds(previous);

  for (const [key, prevValue] of previousOdds.entries()) {
    const currentValue = currentOdds.get(key);
    if (currentValue === undefined) return true;
    if (Math.abs(currentValue - prevValue) > threshold) return true;
  }

  for (const key of currentOdds.keys()) {
    if (!previousOdds.has(key)) return true;
  }

  return false;
}

export function checkStalenessServer(input: {
  minute: number;
  score: string;
  eventsCompact: MinimalEventCompact[];
  oddsCanonical: Record<string, unknown> | null | undefined;
  previousRecommendation?: RecommendationBaseline | null;
  previousSnapshot?: SnapshotBaseline | null;
  settings: PipelineStalenessSettings;
  forceAnalyze?: boolean;
}): PipelineStalenessResult {
  if (input.forceAnalyze) {
    return { isStale: false, reason: 'force_analyze', baseline: 'none' };
  }

  const recommendation = input.previousRecommendation ?? null;
  const snapshot = input.previousSnapshot ?? null;
  const recMinute = recommendation?.minute ?? null;
  const snapshotMinute = snapshot?.minute ?? null;

  let baseline: PipelineStalenessResult['baseline'] = 'none';
  let baselineMinute: number | null = null;
  let baselineRec: RecommendationBaseline | null = null;
  let baselineSnapshot: SnapshotBaseline | null = null;

  if (recMinute != null && snapshotMinute != null) {
    if (recMinute >= snapshotMinute) {
      baseline = 'recommendation';
      baselineMinute = recMinute;
      baselineRec = recommendation;
    } else {
      baseline = 'snapshot';
      baselineMinute = snapshotMinute;
      baselineSnapshot = snapshot;
    }
  } else if (recMinute != null) {
    baseline = 'recommendation';
    baselineMinute = recMinute;
    baselineRec = recommendation;
  } else if (snapshotMinute != null) {
    baseline = 'snapshot';
    baselineMinute = snapshotMinute;
    baselineSnapshot = snapshot;
  }

  if (baselineMinute === null) {
    return { isStale: false, reason: 'first_analysis', baseline: 'none' };
  }

  const currentMinute = Number.isFinite(input.minute) ? input.minute : 0;
  const minuteDelta = Math.max(0, currentMinute - baselineMinute);

  const newGoalSinceBaseline = input.eventsCompact.some(
    (event) => normalizeEventType(event.type) === 'goal' && event.minute > baselineMinute,
  );
  if (newGoalSinceBaseline) {
    return { isStale: false, reason: 'goal_scored', baseline };
  }

  const newRedCardSinceBaseline = input.eventsCompact.some(
    (event) =>
      normalizeEventType(event.type) === 'card'
      && event.minute > baselineMinute
      && String(event.detail || '').toLowerCase().includes('red'),
  );
  if (newRedCardSinceBaseline) {
    return { isStale: false, reason: 'red_card', baseline };
  }

  if (baselineRec?.score && baselineRec.score !== input.score) {
    return { isStale: false, reason: 'score_changed', baseline };
  }

  if (baselineSnapshot) {
    const snapshotScore = `${baselineSnapshot.home_score}-${baselineSnapshot.away_score}`;
    if (snapshotScore !== input.score) {
      return { isStale: false, reason: 'score_changed', baseline };
    }
  }

  if (
    baselineRec?.odds != null
    && baselineRec.bet_market
    && baselineRec.selection
  ) {
    const currentOdd = extractMarketOdd(baselineRec.bet_market, baselineRec.selection, input.oddsCanonical);
    if (currentOdd != null && Math.abs(currentOdd - baselineRec.odds) > input.settings.oddsMovementThreshold) {
      return { isStale: false, reason: 'odds_movement', baseline };
    }
  } else if (
    baselineSnapshot?.odds
    && oddsChangedMeaningfully(input.oddsCanonical, baselineSnapshot.odds, input.settings.oddsMovementThreshold)
  ) {
    return { isStale: false, reason: 'odds_movement', baseline };
  }

  if (minuteDelta < input.settings.reanalyzeMinMinutes) {
    return { isStale: true, reason: 'no_significant_change', baseline };
  }

  return { isStale: false, reason: 'time_elapsed', baseline };
}
