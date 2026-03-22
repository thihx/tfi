import { normalizeMarket } from './normalize-market.js';

export interface AnalyticsRecommendationRow {
  id?: number;
  match_id: string;
  home_team: string;
  away_team: string;
  minute: number | null;
  score: string;
  selection: string;
  bet_market: string;
  stake_percent: number | null;
  result: string;
  pnl: number | null;
  odds: number | null;
  confidence: number | null;
}

export interface ExposureCluster {
  matchId: string;
  matchDisplay: string;
  thesisKey: string;
  label: string;
  count: number;
  settledCount: number;
  totalStake: number;
  totalPnl: number;
  latestMinute: number | null;
  canonicalMarkets: string[];
}

export interface ExposureSummary {
  stackedClusters: number;
  stackedRecommendations: number;
  stackedStake: number;
  maxClusterStake: number;
  topClusters: ExposureCluster[];
}

export interface MarketFamilyPerformanceRow {
  family: string;
  total: number;
  settled: number;
  neutral: number;
  wins: number;
  losses: number;
  winRate: number;
  totalStake: number;
  pnl: number;
  roi: number;
}

export interface LateEntryPerformanceRow {
  bucket: string;
  total: number;
  settled: number;
  neutral: number;
  wins: number;
  losses: number;
  winRate: number;
  totalStake: number;
  pnl: number;
  roi: number;
}

export interface PromptQualitySummary {
  totalRecommendations: number;
  sameThesisClusters: number;
  sameThesisStackedRows: number;
  sameThesisStackingRate: number;
  sameThesisStackedStake: number;
  cornersRows: number;
  cornersUsageRate: number;
  lateHighLineRows: number;
  lateHighLineRate: number;
  lateHighLineStake: number;
}

function round(value: number, decimals = 2): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function pct(numerator: number, denominator: number): number {
  if (denominator <= 0) return 0;
  return round((numerator / denominator) * 100, 1);
}

function isNeutralResult(result: string): boolean {
  return result === 'push' || result === 'half_win' || result === 'half_loss' || result === 'void';
}

function isSettledResult(result: string): boolean {
  return result === 'win'
    || result === 'loss'
    || result === 'push'
    || result === 'half_win'
    || result === 'half_loss'
    || result === 'void';
}

function parseScore(score: string): { home: number; away: number; total: number } | null {
  const match = score.trim().match(/^(\d+)\s*-\s*(\d+)$/);
  if (!match) return null;
  const home = Number(match[1]);
  const away = Number(match[2]);
  if (!Number.isFinite(home) || !Number.isFinite(away)) return null;
  return { home, away, total: home + away };
}

function getCorrelatedThesis(canonicalMarket: string): { thesisKey: string; label: string } | null {
  if (!canonicalMarket || canonicalMarket === 'unknown') return null;
  if (canonicalMarket.startsWith('over_')) return { thesisKey: 'goals_over', label: 'Goals Over thesis' };
  if (canonicalMarket.startsWith('under_')) return { thesisKey: 'goals_under', label: 'Goals Under thesis' };
  if (canonicalMarket.startsWith('corners_over_')) return { thesisKey: 'corners_over', label: 'Corners Over thesis' };
  if (canonicalMarket.startsWith('corners_under_')) return { thesisKey: 'corners_under', label: 'Corners Under thesis' };
  if (canonicalMarket.startsWith('asian_handicap_home_')) return { thesisKey: 'asian_handicap_home', label: 'Asian Handicap Home thesis' };
  if (canonicalMarket.startsWith('asian_handicap_away_')) return { thesisKey: 'asian_handicap_away', label: 'Asian Handicap Away thesis' };
  if (canonicalMarket === 'btts_yes') return { thesisKey: 'btts_yes', label: 'BTTS Yes thesis' };
  if (canonicalMarket === 'btts_no') return { thesisKey: 'btts_no', label: 'BTTS No thesis' };
  if (canonicalMarket === '1x2_home') return { thesisKey: '1x2_home', label: 'Home Win thesis' };
  if (canonicalMarket === '1x2_away') return { thesisKey: '1x2_away', label: 'Away Win thesis' };
  if (canonicalMarket === '1x2_draw') return { thesisKey: '1x2_draw', label: 'Draw thesis' };
  return null;
}

function getMarketFamily(canonicalMarket: string): string {
  if (!canonicalMarket || canonicalMarket === 'unknown') return 'other';
  if (canonicalMarket.startsWith('corners_')) return 'corners';
  if (canonicalMarket.startsWith('over_') || canonicalMarket.startsWith('under_')) return 'goals_totals';
  if (canonicalMarket.startsWith('asian_handicap_')) return 'asian_handicap';
  if (canonicalMarket.startsWith('btts_')) return 'btts';
  if (canonicalMarket.startsWith('1x2_')) return '1x2';
  return 'other';
}

function getTimingBucket(minute: number | null): string {
  if (minute == null) return 'Unknown';
  if (minute < 45) return '0-44';
  if (minute < 60) return '45-59';
  if (minute < 75) return '60-74';
  return '75+';
}

function getGoalsOverLine(canonicalMarket: string): number | null {
  const match = canonicalMarket.match(/^over_(\d+(?:\.\d+)?)$/);
  if (!match) return null;
  const line = Number(match[1]);
  return Number.isFinite(line) ? line : null;
}

function needsTwoOrMoreGoalsForFullWin(canonicalMarket: string, score: string): boolean {
  const line = getGoalsOverLine(canonicalMarket);
  if (line == null) return false;
  const parsedScore = parseScore(score);
  if (!parsedScore) return false;
  const additionalNeeded = Math.floor(line - parsedScore.total) + 1;
  return additionalNeeded >= 2;
}

function toCanonicalRow(row: AnalyticsRecommendationRow): AnalyticsRecommendationRow & {
  canonicalMarket: string;
  marketFamily: string;
  thesis: { thesisKey: string; label: string } | null;
} {
  const canonicalMarket = normalizeMarket(row.selection ?? '', row.bet_market ?? '');
  return {
    ...row,
    canonicalMarket,
    marketFamily: getMarketFamily(canonicalMarket),
    thesis: getCorrelatedThesis(canonicalMarket),
  };
}

export function summarizeExposureClusters(
  rows: AnalyticsRecommendationRow[],
  opts: { minCount?: number; limit?: number } = {},
): ExposureSummary {
  const minCount = opts.minCount ?? 2;
  const limit = opts.limit ?? 5;
  const clusters = new Map<string, ExposureCluster>();

  for (const rawRow of rows) {
    const row = toCanonicalRow(rawRow);
    if (!row.thesis) continue;

    const clusterKey = `${row.match_id}__${row.thesis.thesisKey}`;
    const existing = clusters.get(clusterKey) ?? {
      matchId: row.match_id,
      matchDisplay: row.home_team && row.away_team
        ? `${row.home_team} vs ${row.away_team}`
        : row.match_id,
      thesisKey: row.thesis.thesisKey,
      label: row.thesis.label,
      count: 0,
      settledCount: 0,
      totalStake: 0,
      totalPnl: 0,
      latestMinute: null,
      canonicalMarkets: [],
    };

    existing.count += 1;
    if (isSettledResult(row.result)) existing.settledCount += 1;
    existing.totalStake += Number(row.stake_percent ?? 0) || 0;
    existing.totalPnl += Number(row.pnl ?? 0) || 0;
    if (typeof row.minute === 'number') {
      existing.latestMinute = existing.latestMinute == null
        ? row.minute
        : Math.max(existing.latestMinute, row.minute);
    }
    if (row.canonicalMarket && !existing.canonicalMarkets.includes(row.canonicalMarket)) {
      existing.canonicalMarkets.push(row.canonicalMarket);
    }

    clusters.set(clusterKey, existing);
  }

  const filtered = Array.from(clusters.values())
    .filter((cluster) => cluster.count >= minCount)
    .map((cluster) => ({
      ...cluster,
      totalStake: round(cluster.totalStake),
      totalPnl: round(cluster.totalPnl),
    }))
    .sort((a, b) => b.totalStake - a.totalStake || b.count - a.count || b.totalPnl - a.totalPnl);

  return {
    stackedClusters: filtered.length,
    stackedRecommendations: filtered.reduce((sum, cluster) => sum + cluster.count, 0),
    stackedStake: round(filtered.reduce((sum, cluster) => sum + cluster.totalStake, 0)),
    maxClusterStake: filtered.length > 0 ? filtered[0]!.totalStake : 0,
    topClusters: filtered.slice(0, limit),
  };
}

export function summarizeMarketFamilyPerformance(rows: AnalyticsRecommendationRow[]): MarketFamilyPerformanceRow[] {
  const settledRows = rows.filter((row) => isSettledResult(row.result));
  const groups = new Map<string, {
    total: number;
    settled: number;
    neutral: number;
    wins: number;
    losses: number;
    totalStake: number;
    pnl: number;
  }>();

  for (const rawRow of settledRows) {
    const row = toCanonicalRow(rawRow);
    const group = groups.get(row.marketFamily) ?? {
      total: 0,
      settled: 0,
      neutral: 0,
      wins: 0,
      losses: 0,
      totalStake: 0,
      pnl: 0,
    };
    group.total += 1;
    group.settled += 1;
    if (row.result === 'win') group.wins += 1;
    else if (row.result === 'loss') group.losses += 1;
    else if (isNeutralResult(row.result)) group.neutral += 1;
    group.totalStake += Number(row.stake_percent ?? 0) || 0;
    group.pnl += Number(row.pnl ?? 0) || 0;
    groups.set(row.marketFamily, group);
  }

  return Array.from(groups.entries())
    .map(([family, group]) => {
      const decisive = group.wins + group.losses;
      return {
        family,
        total: group.total,
        settled: group.settled,
        neutral: group.neutral,
        wins: group.wins,
        losses: group.losses,
        winRate: decisive > 0 ? round((group.wins / decisive) * 100, 2) : 0,
        totalStake: round(group.totalStake),
        pnl: round(group.pnl),
        roi: group.totalStake > 0 ? round((group.pnl / group.totalStake) * 100, 2) : 0,
      };
    })
    .sort((a, b) => b.roi - a.roi || b.pnl - a.pnl || b.total - a.total);
}

export function summarizeLateEntryPerformance(rows: AnalyticsRecommendationRow[]): LateEntryPerformanceRow[] {
  const settledRows = rows.filter((row) => isSettledResult(row.result));
  const groups = new Map<string, {
    total: number;
    settled: number;
    neutral: number;
    wins: number;
    losses: number;
    totalStake: number;
    pnl: number;
  }>();

  for (const row of settledRows) {
    const bucket = getTimingBucket(row.minute);
    const group = groups.get(bucket) ?? {
      total: 0,
      settled: 0,
      neutral: 0,
      wins: 0,
      losses: 0,
      totalStake: 0,
      pnl: 0,
    };
    group.total += 1;
    group.settled += 1;
    if (row.result === 'win') group.wins += 1;
    else if (row.result === 'loss') group.losses += 1;
    else if (isNeutralResult(row.result)) group.neutral += 1;
    group.totalStake += Number(row.stake_percent ?? 0) || 0;
    group.pnl += Number(row.pnl ?? 0) || 0;
    groups.set(bucket, group);
  }

  const order = ['0-44', '45-59', '60-74', '75+', 'Unknown'];
  return order
    .map((bucket) => {
      const group = groups.get(bucket);
      if (!group) return null;
      const decisive = group.wins + group.losses;
      return {
        bucket,
        total: group.total,
        settled: group.settled,
        neutral: group.neutral,
        wins: group.wins,
        losses: group.losses,
        winRate: decisive > 0 ? round((group.wins / decisive) * 100, 2) : 0,
        totalStake: round(group.totalStake),
        pnl: round(group.pnl),
        roi: group.totalStake > 0 ? round((group.pnl / group.totalStake) * 100, 2) : 0,
      };
    })
    .filter((row): row is LateEntryPerformanceRow => row != null);
}

export function summarizePromptQuality(rows: AnalyticsRecommendationRow[]): PromptQualitySummary {
  const totalRecommendations = rows.length;
  const exposure = summarizeExposureClusters(rows, { minCount: 2, limit: 5 });
  let cornersRows = 0;
  let lateHighLineRows = 0;
  let lateHighLineStake = 0;

  for (const rawRow of rows) {
    const row = toCanonicalRow(rawRow);
    if (row.marketFamily === 'corners') cornersRows += 1;
    if ((row.minute ?? -1) >= 55 && needsTwoOrMoreGoalsForFullWin(row.canonicalMarket, row.score)) {
      lateHighLineRows += 1;
      lateHighLineStake += Number(row.stake_percent ?? 0) || 0;
    }
  }

  return {
    totalRecommendations,
    sameThesisClusters: exposure.stackedClusters,
    sameThesisStackedRows: exposure.stackedRecommendations,
    sameThesisStackingRate: pct(exposure.stackedRecommendations, totalRecommendations),
    sameThesisStackedStake: exposure.stackedStake,
    cornersRows,
    cornersUsageRate: pct(cornersRows, totalRecommendations),
    lateHighLineRows,
    lateHighLineRate: pct(lateHighLineRows, totalRecommendations),
    lateHighLineStake: round(lateHighLineStake),
  };
}
