// ============================================================
// Server Pipeline Gates
// ============================================================

import { parseBetMarketLineSuffix, sameOddsLine } from './odds-line-utils.js';

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
  status?: string | null;
}

export interface SnapshotBaseline {
  minute: number;
  home_score: number;
  away_score: number;
  status?: string | null;
  odds?: Record<string, unknown> | null;
  stats?: Record<string, unknown> | null;
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

interface SelectedBaseline {
  baseline: PipelineStalenessResult['baseline'];
  baselineMinute: number | null;
  baselineRec: RecommendationBaseline | null;
  baselineSnapshot: SnapshotBaseline | null;
}

function hasMissingSide(value: { home: string | null; away: string | null } | undefined): boolean {
  if (!value) return true;
  const home = String(value.home ?? '').trim();
  const away = String(value.away ?? '').trim();
  const missing = (s: string) => !s || s === '-' || s.toUpperCase() === 'NA';
  return missing(home) || missing(away);
}

function normalizeStatSide(value: unknown): string {
  const raw = String(value ?? '').trim();
  if (!raw || raw === '-' || raw.toUpperCase() === 'NA') return '';
  return raw;
}

function normalizeStatPair(value: unknown): { home: string; away: string } {
  if (!value || typeof value !== 'object') {
    return { home: '', away: '' };
  }
  const pair = value as { home?: unknown; away?: unknown };
  return {
    home: normalizeStatSide(pair.home),
    away: normalizeStatSide(pair.away),
  };
}

function hasMeaningfulStatsDelta(
  current: MinimalStatsCompact,
  previous: Record<string, unknown> | null | undefined,
): boolean {
  if (!previous || typeof previous !== 'object') return true;
  const prev = previous as Record<string, unknown>;
  const keys: Array<keyof MinimalStatsCompact> = [
    'shots',
    'shots_on_target',
    'corners',
    'fouls',
    'possession',
  ];

  for (const key of keys) {
    const currentPair = normalizeStatPair(current[key]);
    const previousPair = normalizeStatPair(prev[key] as unknown);
    if (currentPair.home !== previousPair.home || currentPair.away !== previousPair.away) {
      return true;
    }
  }

  return false;
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

  if (marketLower.startsWith('ht_over_')) {
    const line = parseBetMarketLineSuffix('ht_over_', marketLower);
    if (line == null) return oc.ht_ou?.over ?? null;
    if (sameOddsLine(line, oc.ht_ou?.line)) return oc.ht_ou?.over ?? null;
    if (sameOddsLine(line, oc.ht_ou_adjacent?.line)) return oc.ht_ou_adjacent?.over ?? null;
    return null;
  }
  if (marketLower.startsWith('ht_under_')) {
    const line = parseBetMarketLineSuffix('ht_under_', marketLower);
    if (line == null) return oc.ht_ou?.under ?? null;
    if (sameOddsLine(line, oc.ht_ou?.line)) return oc.ht_ou?.under ?? null;
    if (sameOddsLine(line, oc.ht_ou_adjacent?.line)) return oc.ht_ou_adjacent?.under ?? null;
    return null;
  }

  if (marketLower.startsWith('ht_1x2_')) {
    if (marketLower.endsWith('_home')) return oc['ht_1x2']?.home ?? null;
    if (marketLower.endsWith('_away')) return oc['ht_1x2']?.away ?? null;
    if (marketLower.endsWith('_draw')) return oc['ht_1x2']?.draw ?? null;
  }

  if (marketLower.startsWith('ht_btts_')) {
    if (marketLower.endsWith('_yes')) return oc.ht_btts?.yes ?? null;
    if (marketLower.endsWith('_no')) return oc.ht_btts?.no ?? null;
  }

  if (marketLower.startsWith('ht_asian_handicap_')) {
    const htAhExtras = Array.isArray((oc as Record<string, unknown>)['ht_ah_extra'])
      ? (oc as { ht_ah_extra?: Array<{ line?: number; home?: number | null; away?: number | null }> }).ht_ah_extra
      : undefined;
    if (marketLower.includes('_home_')) {
      const line = parseBetMarketLineSuffix('ht_asian_handicap_home_', marketLower);
      if (line == null) return oc.ht_ah?.home ?? null;
      if (sameOddsLine(line, oc.ht_ah?.line)) return oc.ht_ah?.home ?? null;
      if (sameOddsLine(line, oc.ht_ah_adjacent?.line)) return oc.ht_ah_adjacent?.home ?? null;
      for (const row of htAhExtras ?? []) {
        if (row?.line == null || row.home == null) continue;
        if (sameOddsLine(line, row.line)) return row.home;
      }
      return null;
    }
    if (marketLower.includes('_away_')) {
      const line = parseBetMarketLineSuffix('ht_asian_handicap_away_', marketLower);
      if (line == null) return oc.ht_ah?.away ?? null;
      const matchMain =
        sameOddsLine(line, oc.ht_ah?.line) || sameOddsLine(-line, oc.ht_ah?.line);
      if (matchMain) return oc.ht_ah?.away ?? null;
      const matchAdj =
        sameOddsLine(line, oc.ht_ah_adjacent?.line) || sameOddsLine(-line, oc.ht_ah_adjacent?.line);
      if (matchAdj) return oc.ht_ah_adjacent?.away ?? null;
      for (const row of htAhExtras ?? []) {
        if (row?.line == null || row.away == null) continue;
        if (sameOddsLine(line, row.line) || sameOddsLine(-line, row.line)) return row.away;
      }
      return null;
    }
  }

  if (
    (marketLower.includes('over_') || marketLower.includes('under_'))
    && !marketLower.startsWith('corners_')
    && !marketLower.startsWith('ht_')
  ) {
    if (marketLower.startsWith('over_')) {
      const line = parseBetMarketLineSuffix('over_', marketLower);
      if (line == null) return oc.ou?.over ?? null;
      if (sameOddsLine(line, oc.ou?.line)) return oc.ou?.over ?? null;
      if (sameOddsLine(line, oc.ou_adjacent?.line)) return oc.ou_adjacent?.over ?? null;
      return null;
    }
    if (marketLower.startsWith('under_')) {
      const line = parseBetMarketLineSuffix('under_', marketLower);
      if (line == null) return oc.ou?.under ?? null;
      if (sameOddsLine(line, oc.ou?.line)) return oc.ou?.under ?? null;
      if (sameOddsLine(line, oc.ou_adjacent?.line)) return oc.ou_adjacent?.under ?? null;
      return null;
    }
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
    const ahExtras = Array.isArray((oc as Record<string, unknown>)['ah_extra'])
      ? (oc as { ah_extra?: Array<{ line?: number; home?: number | null; away?: number | null }> }).ah_extra
      : undefined;
    if (marketLower.includes('_home_')) {
      const line = parseBetMarketLineSuffix('asian_handicap_home_', marketLower);
      if (line == null) return oc.ah?.home ?? null;
      if (sameOddsLine(line, oc.ah?.line)) return oc.ah?.home ?? null;
      if (sameOddsLine(line, oc.ah_adjacent?.line)) return oc.ah_adjacent?.home ?? null;
      for (const row of ahExtras ?? []) {
        if (row?.line == null || row.home == null) continue;
        if (sameOddsLine(line, row.line)) return row.home;
      }
      return null;
    }
    if (marketLower.includes('_away_')) {
      const line = parseBetMarketLineSuffix('asian_handicap_away_', marketLower);
      if (line == null) return oc.ah?.away ?? null;
      const matchMain =
        sameOddsLine(line, oc.ah?.line) || sameOddsLine(-line, oc.ah?.line);
      if (matchMain) return oc.ah?.away ?? null;
      const matchAdj =
        sameOddsLine(line, oc.ah_adjacent?.line) || sameOddsLine(-line, oc.ah_adjacent?.line);
      if (matchAdj) return oc.ah_adjacent?.away ?? null;
      for (const row of ahExtras ?? []) {
        if (row?.line == null || row.away == null) continue;
        if (sameOddsLine(line, row.line) || sameOddsLine(-line, row.line)) return row.away;
      }
      return null;
    }
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
  setIfFinite('ou_adjacent.line', oc.ou_adjacent?.line);
  setIfFinite('ou_adjacent.over', oc.ou_adjacent?.over);
  setIfFinite('ou_adjacent.under', oc.ou_adjacent?.under);
  setIfFinite('ah.line', oc.ah?.line);
  setIfFinite('ah.home', oc.ah?.home);
  setIfFinite('ah.away', oc.ah?.away);
  setIfFinite('ah_adjacent.line', oc.ah_adjacent?.line);
  setIfFinite('ah_adjacent.home', oc.ah_adjacent?.home);
  setIfFinite('ah_adjacent.away', oc.ah_adjacent?.away);
  setIfFinite('btts.yes', oc.btts?.yes);
  setIfFinite('btts.no', oc.btts?.no);
  setIfFinite('ht_1x2.home', oc['ht_1x2']?.home);
  setIfFinite('ht_1x2.draw', oc['ht_1x2']?.draw);
  setIfFinite('ht_1x2.away', oc['ht_1x2']?.away);
  setIfFinite('ht_ou.line', oc.ht_ou?.line);
  setIfFinite('ht_ou.over', oc.ht_ou?.over);
  setIfFinite('ht_ou.under', oc.ht_ou?.under);
  setIfFinite('ht_ou_adjacent.line', oc.ht_ou_adjacent?.line);
  setIfFinite('ht_ou_adjacent.over', oc.ht_ou_adjacent?.over);
  setIfFinite('ht_ou_adjacent.under', oc.ht_ou_adjacent?.under);
  setIfFinite('ht_ah.line', oc.ht_ah?.line);
  setIfFinite('ht_ah.home', oc.ht_ah?.home);
  setIfFinite('ht_ah.away', oc.ht_ah?.away);
  setIfFinite('ht_ah_adjacent.line', oc.ht_ah_adjacent?.line);
  setIfFinite('ht_ah_adjacent.home', oc.ht_ah_adjacent?.home);
  setIfFinite('ht_ah_adjacent.away', oc.ht_ah_adjacent?.away);
  setIfFinite('ht_btts.yes', oc.ht_btts?.yes);
  setIfFinite('ht_btts.no', oc.ht_btts?.no);
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

function selectLatestBaseline(
  recommendation: RecommendationBaseline | null | undefined,
  snapshot: SnapshotBaseline | null | undefined,
): SelectedBaseline {
  const safeRecommendation = recommendation ?? null;
  const safeSnapshot = snapshot ?? null;
  const recMinute = safeRecommendation?.minute ?? null;
  const snapshotMinute = safeSnapshot?.minute ?? null;

  let baseline: PipelineStalenessResult['baseline'] = 'none';
  let baselineMinute: number | null = null;
  let baselineRec: RecommendationBaseline | null = null;
  let baselineSnapshot: SnapshotBaseline | null = null;

  if (recMinute != null && snapshotMinute != null) {
    if (recMinute >= snapshotMinute) {
      baseline = 'recommendation';
      baselineMinute = recMinute;
      baselineRec = safeRecommendation;
    } else {
      baseline = 'snapshot';
      baselineMinute = snapshotMinute;
      baselineSnapshot = safeSnapshot;
    }
  } else if (recMinute != null) {
    baseline = 'recommendation';
    baselineMinute = recMinute;
    baselineRec = safeRecommendation;
  } else if (snapshotMinute != null) {
    baseline = 'snapshot';
    baselineMinute = snapshotMinute;
    baselineSnapshot = safeSnapshot;
  }

  return { baseline, baselineMinute, baselineRec, baselineSnapshot };
}

export function resolveReanalyzeCooldownMinutes(
  status: string | null | undefined,
  minute: number,
  baseMinutes: number,
): number {
  const base = Number.isFinite(baseMinutes) && baseMinutes > 0
    ? Math.max(1, Math.round(baseMinutes))
    : 10;
  const currentMinute = Number.isFinite(minute) ? minute : 0;
  const statusRaw = String(status || '').trim().toUpperCase();

  let target = base;
  if (statusRaw === '2H') {
    if (currentMinute >= 80) target = 1;
    else target = 2;
  } else if (statusRaw === '1H') {
    if (currentMinute >= 35) target = 3;
    else if (currentMinute >= 20) target = 4;
    else target = 5;
  } else if (['HT', 'INT', 'LIVE', 'ET', 'BT'].includes(statusRaw)) {
    target = 2;
  }

  return Math.max(1, Math.min(base, target));
}

export function checkCoarseStalenessServer(input: {
  minute: number;
  status?: string | null;
  score: string;
  previousRecommendation?: RecommendationBaseline | null;
  previousSnapshot?: SnapshotBaseline | null;
  settings: Pick<PipelineStalenessSettings, 'reanalyzeMinMinutes'>;
  forceAnalyze?: boolean;
}): PipelineStalenessResult {
  if (input.forceAnalyze) {
    return { isStale: false, reason: 'force_analyze', baseline: 'none' };
  }

  const currentMinute = Number.isFinite(input.minute) ? input.minute : 0;
  if (currentMinute <= 0) {
    return { isStale: false, reason: 'minute_unknown', baseline: 'none' };
  }

  const { baseline, baselineMinute, baselineRec, baselineSnapshot } = selectLatestBaseline(
    input.previousRecommendation,
    input.previousSnapshot,
  );

  if (baselineMinute === null) {
    return { isStale: false, reason: 'first_analysis', baseline: 'none' };
  }

  const baselineStatus = String(baselineRec?.status ?? baselineSnapshot?.status ?? '').trim().toUpperCase();
  const currentStatus = String(input.status || '').trim().toUpperCase();
  if (baselineStatus && currentStatus && baselineStatus !== currentStatus) {
    return { isStale: false, reason: 'phase_changed', baseline };
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

  const effectiveCooldown = resolveReanalyzeCooldownMinutes(
    currentStatus || baselineStatus,
    currentMinute,
    input.settings.reanalyzeMinMinutes,
  );
  const minuteDelta = Math.max(0, currentMinute - baselineMinute);
  if (minuteDelta < effectiveCooldown) {
    return { isStale: true, reason: 'no_significant_change', baseline };
  }

  return { isStale: false, reason: 'time_elapsed', baseline };
}

export function checkStalenessServer(input: {
  minute: number;
  status?: string | null;
  score: string;
  statsCompact?: MinimalStatsCompact;
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

  const { baseline, baselineMinute, baselineRec, baselineSnapshot } = selectLatestBaseline(
    input.previousRecommendation,
    input.previousSnapshot,
  );

  if (baselineMinute === null) {
    return { isStale: false, reason: 'first_analysis', baseline: 'none' };
  }

  const currentMinute = Number.isFinite(input.minute) ? input.minute : 0;
  const minuteDelta = Math.max(0, currentMinute - baselineMinute);
  const baselineStatus = String(baselineRec?.status ?? baselineSnapshot?.status ?? '').trim().toUpperCase();
  const currentStatus = String(input.status || '').trim().toUpperCase();

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

  if (baselineStatus && currentStatus && baselineStatus !== currentStatus) {
    return { isStale: false, reason: 'phase_changed', baseline };
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

  const effectiveCooldown = resolveReanalyzeCooldownMinutes(
    currentStatus || baselineStatus,
    currentMinute,
    input.settings.reanalyzeMinMinutes,
  );
  if (
    baselineSnapshot?.stats
    && input.statsCompact
    && !hasMeaningfulStatsDelta(input.statsCompact, baselineSnapshot.stats)
  ) {
    return { isStale: true, reason: 'snapshot_stats_unchanged', baseline };
  }
  if (minuteDelta < effectiveCooldown) {
    return { isStale: true, reason: 'no_significant_change', baseline };
  }

  return { isStale: false, reason: 'time_elapsed', baseline };
}
