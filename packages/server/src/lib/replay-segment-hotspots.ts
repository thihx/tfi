import type { EvaluatedReplayCase } from './settled-replay-evaluation.js';
import { classifyReplayMarketFamily } from './settled-replay-evaluation.js';

export interface SegmentHotspotRow {
  segmentKey: string;
  minuteBand: string;
  marketFamily: string;
  /** From replay output when actionable. */
  canonicalMarketTop: string;
  totalScenarios: number;
  replayActionable: number;
  settledDirectional: number;
  replayWins: number;
  replayLosses: number;
  replayAccuracy: number;
  totalReplayPnl: number;
  totalReplayStaked: number;
  replayRoi: number;
  /** Share of segment that were production losses (directional). */
  originalDirectionalLossCount: number;
}

function ratio(n: number, d: number): number {
  return d > 0 ? Math.round((n / d) * 10000) / 10000 : 0;
}

const LOSS_ORIG = new Set(['loss', 'half_loss']);

function segmentKey(minuteBand: string, family: string): string {
  return `${minuteBand}::${family}`;
}

/**
 * Roll up replay eval cases by minute band × market family (replay canonical).
 * Focus: actionable pushes and their settled directional outcomes + PnL.
 */
export function summarizeReplaySegmentHotspots(cases: EvaluatedReplayCase[]): SegmentHotspotRow[] {
  type Acc = {
    minuteBand: string;
    marketFamily: string;
    canonicalCounts: Map<string, number>;
    total: number;
    actionable: number;
    settled: number;
    wins: number;
    losses: number;
    pnl: number;
    staked: number;
    origLoss: number;
  };
  const map = new Map<string, Acc>();

  for (const r of cases) {
    const family = r.actionable
      ? classifyReplayMarketFamily(r.canonicalMarket)
      : classifyReplayMarketFamily(r.originalBetMarket);
    const key = segmentKey(r.minuteBand, family);
    let acc = map.get(key);
    if (!acc) {
      acc = {
        minuteBand: r.minuteBand,
        marketFamily: family,
        canonicalCounts: new Map(),
        total: 0,
        actionable: 0,
        settled: 0,
        wins: 0,
        losses: 0,
        pnl: 0,
        staked: 0,
        origLoss: 0,
      };
      map.set(key, acc);
    }
    acc.total++;
    if (LOSS_ORIG.has(String(r.originalResult || ''))) acc.origLoss++;

    if (r.actionable) {
      acc.actionable++;
      const cm = String(r.canonicalMarket || 'unknown').trim() || 'unknown';
      acc.canonicalCounts.set(cm, (acc.canonicalCounts.get(cm) ?? 0) + 1);
      if (r.directionalWin != null) {
        acc.settled++;
        acc.staked += r.replayStakePercent || 0;
        acc.pnl += r.replayPnl ?? 0;
        if (r.directionalWin === true) acc.wins++;
        else acc.losses++;
      }
    }
  }

  const rows: SegmentHotspotRow[] = [];
  for (const acc of map.values()) {
    let canonicalMarketTop = 'unknown';
    let topN = 0;
    for (const [m, n] of acc.canonicalCounts) {
      if (n > topN) {
        topN = n;
        canonicalMarketTop = m;
      }
    }
    const dec = acc.wins + acc.losses;
    rows.push({
      segmentKey: segmentKey(acc.minuteBand, acc.marketFamily),
      minuteBand: acc.minuteBand,
      marketFamily: acc.marketFamily,
      canonicalMarketTop,
      totalScenarios: acc.total,
      replayActionable: acc.actionable,
      settledDirectional: dec,
      replayWins: acc.wins,
      replayLosses: acc.losses,
      replayAccuracy: ratio(acc.wins, dec),
      totalReplayPnl: Math.round(acc.pnl * 10000) / 10000,
      totalReplayStaked: Math.round(acc.staked * 10000) / 10000,
      replayRoi: ratio(acc.pnl, acc.staked),
      originalDirectionalLossCount: acc.origLoss,
    });
  }

  rows.sort((a, b) => {
    if (b.replayActionable !== a.replayActionable) return b.replayActionable - a.replayActionable;
    return b.totalScenarios - a.totalScenarios;
  });

  return rows;
}

export interface HotspotReportPayload {
  generatedAt: string;
  promptVersion: string;
  totalCases: number;
  bySegment: SegmentHotspotRow[];
  /** Worst segments by replay accuracy among those with min settled legs. */
  worstAccuracy: SegmentHotspotRow[];
  /** Worst ROI among segments with min staked. */
  worstRoi: SegmentHotspotRow[];
}

export function buildHotspotReport(
  promptVersion: string,
  cases: EvaluatedReplayCase[],
  options?: { minSettledForWorst?: number; minStakedForRoi?: number },
): HotspotReportPayload {
  const minSettled = options?.minSettledForWorst ?? 5;
  const minStaked = options?.minStakedForRoi ?? 5;
  const bySegment = summarizeReplaySegmentHotspots(cases);

  const worstAccuracy = [...bySegment]
    .filter((r) => r.settledDirectional >= minSettled && r.replayActionable > 0)
    .sort((a, b) => a.replayAccuracy - b.replayAccuracy || a.settledDirectional - b.settledDirectional)
    .slice(0, 15);

  const worstRoi = [...bySegment]
    .filter((r) => r.totalReplayStaked >= minStaked && r.replayActionable > 0)
    .sort((a, b) => a.replayRoi - b.replayRoi || a.totalReplayStaked - b.totalReplayStaked)
    .slice(0, 15);

  return {
    generatedAt: new Date().toISOString(),
    promptVersion,
    totalCases: cases.length,
    bySegment,
    worstAccuracy,
    worstRoi,
  };
}
