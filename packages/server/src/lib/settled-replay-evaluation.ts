import { normalizeMarket } from './normalize-market.js';
import type { ReplayRunOutput } from './pipeline-replay.js';
import type { FinalSettlementResult } from './settle-types.js';
import type { SettledReplayScenario } from './db-replay-scenarios.js';

export interface EvaluatedReplayCase {
  promptVersion: string;
  scenarioName: string;
  recommendationId: number;
  minute: number | null;
  score: string;
  scoreState: string;
  minuteBand: string;
  prematchStrength: string;
  evidenceMode: string;
  marketAvailabilityBucket: string;
  shouldPush: boolean;
  actionable: boolean;
  canonicalMarket: string;
  goalsUnder: boolean;
  goalsOver: boolean;
  settlementResult: FinalSettlementResult | 'unresolved' | null;
  directionalWin: boolean | null;
  replaySelection: string;
  replayOdds: number | null;
  replayStakePercent: number;
  breakEvenRate: number | null;
  replayPnl: number | null;
  originalBetMarket: string;
  originalResult: string;
}

export interface ReplayCohortSummary {
  bucket: string;
  total: number;
  pushCount: number;
  noBetCount: number;
  goalsUnderCount: number;
  goalsOverCount: number;
  underShare: number;
  settledDirectionalCount: number;
  winCount: number;
  lossCount: number;
  accuracy: number;
  avgOdds: number;
  avgBreakEvenRate: number;
  totalStaked: number;
  totalPnl: number;
  roi: number;
}

/** Grouping for replay stats: goals totals vs corners vs side vs BTTS vs rest. */
export function classifyReplayMarketFamily(canonicalMarket: string): string {
  const m = String(canonicalMarket || '').trim().toLowerCase();
  if (!m || m === 'unknown') return 'other';
  if (m.startsWith('corners_')) return 'corners';
  if (m.startsWith('under_')) return 'goals_under';
  if (m.startsWith('over_')) return 'goals_over';
  if (m.startsWith('btts_')) return 'btts';
  if (m.startsWith('asian_handicap_')) return 'asian_handicap';
  if (m.startsWith('1x2_')) return '1x2';
  return 'other';
}

export interface MarketFamilyReplayStat {
  family: string;
  /** Actionable pushes in this family. */
  pushCount: number;
  /** pushCount / all actionable pushes in the variant. */
  shareOfActionable: number;
  /** pushCount / total scenarios (includes no-bet rows). */
  pushRateOfCohort: number;
  settledDirectionalCount: number;
  winCount: number;
  lossCount: number;
  /** Win rate on settled directional legs (excludes push/void/unresolved). */
  accuracy: number;
  avgOdds: number;
  totalStaked: number;
  totalPnl: number;
  roi: number;
}

/** Per canonical market (e.g. btts_no, over_2.5), actionable pushes only. */
export interface CanonicalMarketReplayStat {
  canonicalMarket: string;
  family: string;
  pushCount: number;
  pushRateOfCohort: number;
  settledDirectionalCount: number;
  winCount: number;
  lossCount: number;
  accuracy: number;
  avgOdds: number;
  totalStaked: number;
  totalPnl: number;
  roi: number;
}

/** Cross-tab: time or score slice × market family. */
export interface MarketFamilySliceStat {
  /** Minute band, fine window, or score-state label. */
  slice: string;
  family: string;
  /** Actionable pushes in this cell. */
  pushCount: number;
  /** Total scenarios in this slice (push + no-bet). */
  sliceTotal: number;
  /** pushCount / sliceTotal — penetration of this family within the time/score window. */
  pushRateInSlice: number;
  settledDirectionalCount: number;
  winCount: number;
  lossCount: number;
  accuracy: number;
  avgOdds: number;
  totalStaked: number;
  totalPnl: number;
  roi: number;
}

export interface SettledReplayVariantSummary {
  promptVersion: string;
  totalScenarios: number;
  pushCount: number;
  noBetCount: number;
  pushRate: number;
  noBetRate: number;
  goalsUnderCount: number;
  goalsOverCount: number;
  goalsUnderShare: number;
  settledDirectionalCount: number;
  winCount: number;
  lossCount: number;
  accuracy: number;
  avgOdds: number;
  avgBreakEvenRate: number;
  totalStaked: number;
  totalPnl: number;
  roi: number;
  byMinuteBand: ReplayCohortSummary[];
  byScoreState: ReplayCohortSummary[];
  byPrematchStrength: ReplayCohortSummary[];
  byEvidenceMode: ReplayCohortSummary[];
  byMarketAvailability: ReplayCohortSummary[];
  /** Actionable pushes only: counts and P/L by market family. */
  byMarketFamily: MarketFamilyReplayStat[];
  /** Top canonical markets by push count (actionable only). */
  byCanonicalMarketTop: CanonicalMarketReplayStat[];
  /** Finer minute windows for hotspot diagnosis (e.g. 37-44 vs 30-36). */
  byFineTimeWindow: ReplayCohortSummary[];
  /** Minute band × family: push rate within band, win rate, ROI per cell. */
  byMinuteBandMarketFamily: MarketFamilySliceStat[];
  /** Score state × family. */
  byScoreStateMarketFamily: MarketFamilySliceStat[];
  marketCounts: Array<{ market: string; count: number }>;
}

function ratio(numerator: number, denominator: number): number {
  if (denominator <= 0) return 0;
  return Math.round((numerator / denominator) * 10000) / 10000;
}

function roundMetric(value: number): number {
  return Math.round(value * 10000) / 10000;
}

export function getReplayMinuteBand(minute: number | null): string {
  if (minute == null || minute < 0) return 'unknown';
  if (minute <= 29) return '00-29';
  if (minute <= 44) return '30-44';
  if (minute <= 59) return '45-59';
  if (minute <= 74) return '60-74';
  return '75+';
}

/** Narrower bands inside the problematic 30-44 window and late match. */
export function getReplayFineTimeWindow(minute: number | null): string {
  if (minute == null || minute < 0) return 'unknown';
  if (minute <= 14) return '00-14';
  if (minute <= 29) return '15-29';
  if (minute <= 36) return '30-36';
  if (minute <= 44) return '37-44';
  if (minute <= 52) return '45-52';
  if (minute <= 59) return '53-59';
  if (minute <= 69) return '60-69';
  if (minute <= 74) return '70-74';
  return '75+';
}

export function getReplayScoreState(score: string): string {
  const match = String(score || '').trim().match(/^(\d+)\s*[-:]\s*(\d+)$/);
  if (!match) return 'unknown';
  const home = Number(match[1] ?? 0);
  const away = Number(match[2] ?? 0);
  const diff = Math.abs(home - away);
  if (home === 0 && away === 0) return '0-0';
  if (diff === 0) return 'level';
  if (diff === 1) return 'one-goal-margin';
  return 'two-plus-margin';
}

function isActionableReplay(output: ReplayRunOutput, canonicalMarket: string): boolean {
  if (!output.result.shouldPush) return false;
  if (!canonicalMarket || canonicalMarket === 'unknown') return false;
  if (/^none$/i.test(canonicalMarket)) return false;
  if (/^no_bet$/i.test(canonicalMarket)) return false;
  if (/^\s*no bet\b/i.test(output.result.selection || '')) return false;
  return true;
}

export function buildEvaluatedReplayCase(
  promptVersion: string,
  scenario: SettledReplayScenario,
  output: ReplayRunOutput,
  settlementResult: FinalSettlementResult | 'unresolved' | null,
  replayOdds?: number | null,
  replayStakePercent?: number | null,
  replayPnl?: number | null,
  marketAvailabilityBucket = 'unknown',
): EvaluatedReplayCase {
  const parsed = (output.result.debug?.parsed ?? {}) as Record<string, unknown>;
  const canonicalMarket = normalizeMarket(output.result.selection || '', String(parsed.bet_market || ''));
  const actionable = isActionableReplay(output, canonicalMarket);
  const normalizedOdds = actionable && Number.isFinite(Number(replayOdds)) && Number(replayOdds) > 0
    ? Number(replayOdds)
    : null;
  const normalizedStakePercent = actionable && Number.isFinite(Number(replayStakePercent)) && Number(replayStakePercent) > 0
    ? Number(replayStakePercent)
    : 0;
  const directionalWin = settlementResult === 'win' || settlementResult === 'half_win'
    ? true
    : settlementResult === 'loss' || settlementResult === 'half_loss'
      ? false
      : null;

  return {
    promptVersion,
    scenarioName: scenario.name,
    recommendationId: scenario.metadata.recommendationId,
    minute: scenario.metadata.minute,
    score: scenario.metadata.score,
    scoreState: getReplayScoreState(scenario.metadata.score),
    minuteBand: getReplayMinuteBand(scenario.metadata.minute),
    prematchStrength: scenario.metadata.prematchStrength || 'unknown',
    evidenceMode: scenario.metadata.evidenceMode || 'unknown',
    marketAvailabilityBucket,
    shouldPush: output.result.shouldPush,
    actionable,
    canonicalMarket,
    goalsUnder: actionable && canonicalMarket.startsWith('under_') && !canonicalMarket.startsWith('corners_'),
    goalsOver: actionable && canonicalMarket.startsWith('over_') && !canonicalMarket.startsWith('corners_'),
    settlementResult,
    directionalWin,
    replaySelection: output.result.selection || '',
    replayOdds: normalizedOdds,
    replayStakePercent: normalizedStakePercent,
    breakEvenRate: normalizedOdds ? roundMetric(1 / normalizedOdds) : null,
    replayPnl: actionable && replayPnl != null ? roundMetric(replayPnl) : null,
    originalBetMarket: scenario.metadata.originalBetMarket || '',
    originalResult: scenario.metadata.originalResult || '',
  };
}

function summarizeBucket(bucket: string, rows: EvaluatedReplayCase[]): ReplayCohortSummary {
  const pushCount = rows.filter((row) => row.actionable).length;
  const noBetCount = rows.filter((row) => !row.actionable).length;
  const goalsUnderCount = rows.filter((row) => row.goalsUnder).length;
  const goalsOverCount = rows.filter((row) => row.goalsOver).length;
  const settledDirectional = rows.filter((row) => row.actionable && row.directionalWin != null);
  const winCount = settledDirectional.filter((row) => row.directionalWin === true).length;
  const lossCount = settledDirectional.filter((row) => row.directionalWin === false).length;
  const actionableRows = rows.filter((row) => row.actionable);
  const actionableWithOdds = actionableRows.filter((row) => row.replayOdds != null);
  const actionableWithBreakEven = actionableRows.filter((row) => row.breakEvenRate != null);
  const actionableWithPnl = actionableRows.filter((row) => row.replayPnl != null);
  const totalStaked = actionableRows.reduce((sum, row) => sum + (row.replayStakePercent || 0), 0);
  const totalPnl = actionableWithPnl.reduce((sum, row) => sum + (row.replayPnl || 0), 0);

  return {
    bucket,
    total: rows.length,
    pushCount,
    noBetCount,
    goalsUnderCount,
    goalsOverCount,
    underShare: ratio(goalsUnderCount, goalsUnderCount + goalsOverCount),
    settledDirectionalCount: settledDirectional.length,
    winCount,
    lossCount,
    accuracy: ratio(winCount, winCount + lossCount),
    avgOdds: ratio(
      actionableWithOdds.reduce((sum, row) => sum + (row.replayOdds || 0), 0),
      actionableWithOdds.length,
    ),
    avgBreakEvenRate: ratio(
      actionableWithBreakEven.reduce((sum, row) => sum + (row.breakEvenRate || 0), 0),
      actionableWithBreakEven.length,
    ),
    totalStaked: roundMetric(totalStaked),
    totalPnl: roundMetric(totalPnl),
    roi: ratio(totalPnl, totalStaked),
  };
}

function summarizeByMarketFamily(
  actionable: EvaluatedReplayCase[],
  totalScenarios: number,
): MarketFamilyReplayStat[] {
  if (actionable.length === 0) return [];
  const byFam = new Map<string, EvaluatedReplayCase[]>();
  for (const row of actionable) {
    const fam = classifyReplayMarketFamily(row.canonicalMarket || '');
    const list = byFam.get(fam) ?? [];
    list.push(row);
    byFam.set(fam, list);
  }
  return [...byFam.entries()]
    .map(([family, items]) => {
      const settled = items.filter((r) => r.directionalWin != null);
      const wins = settled.filter((r) => r.directionalWin === true).length;
      const losses = settled.filter((r) => r.directionalWin === false).length;
      const withOdds = items.filter((r) => r.replayOdds != null);
      const staked = items.reduce((s, r) => s + (r.replayStakePercent || 0), 0);
      const withPnl = items.filter((r) => r.replayPnl != null);
      const pnl = withPnl.reduce((s, r) => s + (r.replayPnl || 0), 0);
      return {
        family,
        pushCount: items.length,
        shareOfActionable: ratio(items.length, actionable.length),
        pushRateOfCohort: ratio(items.length, totalScenarios),
        settledDirectionalCount: settled.length,
        winCount: wins,
        lossCount: losses,
        accuracy: ratio(wins, wins + losses),
        avgOdds: ratio(
          withOdds.reduce((s, r) => s + (r.replayOdds || 0), 0),
          withOdds.length,
        ),
        totalStaked: roundMetric(staked),
        totalPnl: roundMetric(pnl),
        roi: ratio(pnl, staked),
      };
    })
    .sort((a, b) => b.pushCount - a.pushCount || a.family.localeCompare(b.family));
}

const CANONICAL_MARKET_TOP_LIMIT = 25;

function summarizeTopCanonicalMarkets(
  actionable: EvaluatedReplayCase[],
  totalScenarios: number,
): CanonicalMarketReplayStat[] {
  if (actionable.length === 0) return [];
  const byMarket = new Map<string, EvaluatedReplayCase[]>();
  for (const row of actionable) {
    const key = row.canonicalMarket || 'unknown';
    const list = byMarket.get(key) ?? [];
    list.push(row);
    byMarket.set(key, list);
  }
  return [...byMarket.entries()]
    .map(([canonicalMarket, items]) => {
      const settled = items.filter((r) => r.directionalWin != null);
      const wins = settled.filter((r) => r.directionalWin === true).length;
      const losses = settled.filter((r) => r.directionalWin === false).length;
      const withOdds = items.filter((r) => r.replayOdds != null);
      const staked = items.reduce((s, r) => s + (r.replayStakePercent || 0), 0);
      const withPnl = items.filter((r) => r.replayPnl != null);
      const pnl = withPnl.reduce((s, r) => s + (r.replayPnl || 0), 0);
      return {
        canonicalMarket,
        family: classifyReplayMarketFamily(canonicalMarket),
        pushCount: items.length,
        pushRateOfCohort: ratio(items.length, totalScenarios),
        settledDirectionalCount: settled.length,
        winCount: wins,
        lossCount: losses,
        accuracy: ratio(wins, wins + losses),
        avgOdds: ratio(
          withOdds.reduce((s, r) => s + (r.replayOdds || 0), 0),
          withOdds.length,
        ),
        totalStaked: roundMetric(staked),
        totalPnl: roundMetric(pnl),
        roi: ratio(pnl, staked),
      };
    })
    .sort((a, b) => b.pushCount - a.pushCount || a.canonicalMarket.localeCompare(b.canonicalMarket))
    .slice(0, CANONICAL_MARKET_TOP_LIMIT);
}

function crossTabMarketFamilyBySlice(
  allRows: EvaluatedReplayCase[],
  sliceLabel: (row: EvaluatedReplayCase) => string,
): MarketFamilySliceStat[] {
  const sliceTotals = new Map<string, number>();
  for (const row of allRows) {
    const s = sliceLabel(row);
    sliceTotals.set(s, (sliceTotals.get(s) ?? 0) + 1);
  }
  const cells = new Map<string, EvaluatedReplayCase[]>();
  for (const row of allRows) {
    if (!row.actionable) continue;
    const slice = sliceLabel(row);
    const fam = classifyReplayMarketFamily(row.canonicalMarket || '');
    const key = `${slice}\0${fam}`;
    const list = cells.get(key) ?? [];
    list.push(row);
    cells.set(key, list);
  }
  return [...cells.entries()]
    .map(([key, items]) => {
      const parts = key.split('\0');
      const slice = parts[0] ?? '';
      const family = parts[1] ?? '';
      const sliceTotal = sliceTotals.get(slice) ?? 0;
      const settled = items.filter((r) => r.directionalWin != null);
      const wins = settled.filter((r) => r.directionalWin === true).length;
      const losses = settled.filter((r) => r.directionalWin === false).length;
      const withOdds = items.filter((r) => r.replayOdds != null);
      const staked = items.reduce((s, r) => s + (r.replayStakePercent || 0), 0);
      const withPnl = items.filter((r) => r.replayPnl != null);
      const pnl = withPnl.reduce((s, r) => s + (r.replayPnl || 0), 0);
      return {
        slice,
        family,
        pushCount: items.length,
        sliceTotal,
        pushRateInSlice: ratio(items.length, sliceTotal),
        settledDirectionalCount: settled.length,
        winCount: wins,
        lossCount: losses,
        accuracy: ratio(wins, wins + losses),
        avgOdds: ratio(
          withOdds.reduce((s, r) => s + (r.replayOdds || 0), 0),
          withOdds.length,
        ),
        totalStaked: roundMetric(staked),
        totalPnl: roundMetric(pnl),
        roi: ratio(pnl, staked),
      };
    })
    .sort((a, b) => a.slice.localeCompare(b.slice) || b.pushCount - a.pushCount || a.family.localeCompare(b.family));
}

function groupAndSummarize(
  rows: EvaluatedReplayCase[],
  pickBucket: (row: EvaluatedReplayCase) => string,
): ReplayCohortSummary[] {
  const grouped = new Map<string, EvaluatedReplayCase[]>();
  for (const row of rows) {
    const bucket = pickBucket(row);
    const list = grouped.get(bucket) ?? [];
    list.push(row);
    grouped.set(bucket, list);
  }

  return [...grouped.entries()]
    .map(([bucket, items]) => summarizeBucket(bucket, items))
    .sort((a, b) => a.bucket.localeCompare(b.bucket));
}

export function summarizeSettledReplayVariant(
  promptVersion: string,
  rows: EvaluatedReplayCase[],
): SettledReplayVariantSummary {
  const actionable = rows.filter((row) => row.actionable);
  const goalsUnderCount = actionable.filter((row) => row.goalsUnder).length;
  const goalsOverCount = actionable.filter((row) => row.goalsOver).length;
  const settledDirectional = actionable.filter((row) => row.directionalWin != null);
  const winCount = settledDirectional.filter((row) => row.directionalWin === true).length;
  const lossCount = settledDirectional.filter((row) => row.directionalWin === false).length;
  const actionableWithOdds = actionable.filter((row) => row.replayOdds != null);
  const actionableWithBreakEven = actionable.filter((row) => row.breakEvenRate != null);
  const actionableWithPnl = actionable.filter((row) => row.replayPnl != null);
  const totalStaked = actionable.reduce((sum, row) => sum + (row.replayStakePercent || 0), 0);
  const totalPnl = actionableWithPnl.reduce((sum, row) => sum + (row.replayPnl || 0), 0);

  const marketCounts = new Map<string, number>();
  for (const row of actionable) {
    const key = row.canonicalMarket || 'unknown';
    marketCounts.set(key, (marketCounts.get(key) ?? 0) + 1);
  }

  return {
    promptVersion,
    totalScenarios: rows.length,
    pushCount: actionable.length,
    noBetCount: rows.length - actionable.length,
    pushRate: ratio(actionable.length, rows.length),
    noBetRate: ratio(rows.length - actionable.length, rows.length),
    goalsUnderCount,
    goalsOverCount,
    goalsUnderShare: ratio(goalsUnderCount, goalsUnderCount + goalsOverCount),
    settledDirectionalCount: settledDirectional.length,
    winCount,
    lossCount,
    accuracy: ratio(winCount, winCount + lossCount),
    avgOdds: ratio(
      actionableWithOdds.reduce((sum, row) => sum + (row.replayOdds || 0), 0),
      actionableWithOdds.length,
    ),
    avgBreakEvenRate: ratio(
      actionableWithBreakEven.reduce((sum, row) => sum + (row.breakEvenRate || 0), 0),
      actionableWithBreakEven.length,
    ),
    totalStaked: roundMetric(totalStaked),
    totalPnl: roundMetric(totalPnl),
    roi: ratio(totalPnl, totalStaked),
    byMinuteBand: groupAndSummarize(rows, (row) => row.minuteBand),
    byScoreState: groupAndSummarize(rows, (row) => row.scoreState),
    byPrematchStrength: groupAndSummarize(rows, (row) => row.prematchStrength || 'unknown'),
    byEvidenceMode: groupAndSummarize(rows, (row) => row.evidenceMode || 'unknown'),
    byMarketAvailability: groupAndSummarize(rows, (row) => row.marketAvailabilityBucket || 'unknown'),
    byMarketFamily: summarizeByMarketFamily(actionable, rows.length),
    byCanonicalMarketTop: summarizeTopCanonicalMarkets(actionable, rows.length),
    byFineTimeWindow: groupAndSummarize(rows, (row) => getReplayFineTimeWindow(row.minute)),
    byMinuteBandMarketFamily: crossTabMarketFamilyBySlice(rows, (row) => row.minuteBand),
    byScoreStateMarketFamily: crossTabMarketFamilyBySlice(rows, (row) => row.scoreState),
    marketCounts: [...marketCounts.entries()]
      .map(([market, count]) => ({ market, count }))
      .sort((a, b) => b.count - a.count || a.market.localeCompare(b.market)),
  };
}
