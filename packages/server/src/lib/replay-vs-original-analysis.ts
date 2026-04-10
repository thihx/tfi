import type { EvaluatedReplayCase } from './settled-replay-evaluation.js';
import { classifyReplayMarketFamily } from './settled-replay-evaluation.js';

export interface EvalCasesFilePayload {
  generatedAt?: string;
  applySettledReplayPolicy?: boolean;
  promptVersions?: string[];
  variants: Array<{
    promptVersion: string;
    cases: EvaluatedReplayCase[];
  }>;
}

export interface OriginalResultBucketStat {
  originalResult: string;
  total: number;
  replayPush: number;
  replayPushSettled: number;
  replayWins: number;
  replayLosses: number;
  replayAccuracy: number;
  totalReplayPnl: number;
  replayRoiOnStaked: number;
  totalReplayStaked: number;
}

export interface ReplayVsOriginalSummary {
  promptVersion: string;
  scenarioCount: number;
  byOriginalResult: OriginalResultBucketStat[];
  /** Original directional loss cohort: replay still pushed and settled. */
  onOriginalDirectionalLoss: {
    total: number;
    replayPushed: number;
    replayWinAmongPushed: number;
    replayLossAmongPushed: number;
    replayAccAmongPushed: number;
  };
  /** Original directional win cohort: replay pushed and settled (risk of worse path). */
  onOriginalDirectionalWin: {
    total: number;
    replayPushed: number;
    replayWinAmongPushed: number;
    replayLossAmongPushed: number;
  };
}

const DIRECTIONAL_ORIGINAL_WIN = new Set(['win', 'half_win']);
const DIRECTIONAL_ORIGINAL_LOSS = new Set(['loss', 'half_loss']);

function ratio(num: number, den: number): number {
  return den > 0 ? Math.round((num / den) * 10000) / 10000 : 0;
}

function parsePayload(raw: unknown): EvalCasesFilePayload {
  if (!raw || typeof raw !== 'object') throw new Error('Invalid JSON: expected object');
  const o = raw as Record<string, unknown>;
  if (!Array.isArray(o['variants'])) throw new Error('Invalid JSON: missing variants[]');
  return raw as EvalCasesFilePayload;
}

export function loadEvalCasesPayload(jsonText: string): EvalCasesFilePayload {
  return parsePayload(JSON.parse(jsonText) as unknown);
}

export function summarizeReplayVsOriginalForVariant(cases: EvaluatedReplayCase[]): ReplayVsOriginalSummary {
  const promptVersion = cases[0]?.promptVersion ?? '';

  const byResult = new Map<string, EvaluatedReplayCase[]>();
  for (const row of cases) {
    const k = String(row.originalResult || '').trim() || '(empty)';
    const list = byResult.get(k) ?? [];
    list.push(row);
    byResult.set(k, list);
  }

  const byOriginalResult: OriginalResultBucketStat[] = [...byResult.entries()]
    .map(([originalResult, rows]) => {
      let replayPush = 0;
      let replayWins = 0;
      let replayLosses = 0;
      let totalReplayPnl = 0;
      let totalReplayStaked = 0;
      let replayPushSettled = 0;
      for (const r of rows) {
        if (r.actionable) {
          replayPush++;
          if (r.directionalWin != null) {
            replayPushSettled++;
            totalReplayStaked += r.replayStakePercent || 0;
            if (r.directionalWin === true) replayWins++;
            else replayLosses++;
            totalReplayPnl += r.replayPnl ?? 0;
          }
        }
      }
      const dec = replayWins + replayLosses;
      return {
        originalResult,
        total: rows.length,
        replayPush,
        replayPushSettled,
        replayWins,
        replayLosses,
        replayAccuracy: ratio(replayWins, dec),
        totalReplayPnl: Math.round(totalReplayPnl * 10000) / 10000,
        totalReplayStaked: Math.round(totalReplayStaked * 10000) / 10000,
        replayRoiOnStaked: ratio(totalReplayPnl, totalReplayStaked),
      };
    })
    .sort((a, b) => b.total - a.total);

  let lossTotal = 0;
  let lossReplayPushed = 0;
  let lossReplayWin = 0;
  let lossReplayLoss = 0;

  let winTotal = 0;
  let winReplayPushed = 0;
  let winReplayWinAmong = 0;
  let winReplayLossAmong = 0;

  for (const r of cases) {
    const orig = String(r.originalResult || '');
    if (DIRECTIONAL_ORIGINAL_LOSS.has(orig)) {
      lossTotal++;
      if (r.actionable) {
        lossReplayPushed++;
        if (r.directionalWin === true) lossReplayWin++;
        if (r.directionalWin === false) lossReplayLoss++;
      }
    }
    if (DIRECTIONAL_ORIGINAL_WIN.has(orig)) {
      winTotal++;
      if (r.actionable) {
        winReplayPushed++;
        if (r.directionalWin === true) winReplayWinAmong++;
        if (r.directionalWin === false) winReplayLossAmong++;
      }
    }
  }

  const pushedSettled = lossReplayWin + lossReplayLoss;

  return {
    promptVersion,
    scenarioCount: cases.length,
    byOriginalResult,
    onOriginalDirectionalLoss: {
      total: lossTotal,
      replayPushed: lossReplayPushed,
      replayWinAmongPushed: lossReplayWin,
      replayLossAmongPushed: lossReplayLoss,
      replayAccAmongPushed: ratio(lossReplayWin, pushedSettled),
    },
    onOriginalDirectionalWin: {
      total: winTotal,
      replayPushed: winReplayPushed,
      replayWinAmongPushed: winReplayWinAmong,
      replayLossAmongPushed: winReplayLossAmong,
    },
  };
}

function csvEscape(s: string): string {
  if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function evaluatedCasesToCsv(cases: EvaluatedReplayCase[]): string {
  const headers = [
    'recommendationId',
    'scenarioName',
    'minute',
    'minuteBand',
    'scoreState',
    'originalBetMarket',
    'originalMarketFamily',
    'originalResult',
    'shouldPush',
    'actionable',
    'canonicalMarket',
    'replaySelection',
    'settlementResult',
    'directionalWin',
    'replayOdds',
    'replayStakePercent',
    'replayPnl',
  ];
  const lines = [headers.join(',')];
  for (const r of cases) {
    const fam = classifyReplayMarketFamily(String(r.originalBetMarket || ''));
    const row = [
      String(r.recommendationId),
      csvEscape(String(r.scenarioName || '')),
      r.minute == null ? '' : String(r.minute),
      csvEscape(r.minuteBand),
      csvEscape(r.scoreState),
      csvEscape(r.originalBetMarket),
      csvEscape(fam),
      csvEscape(r.originalResult),
      r.shouldPush ? '1' : '0',
      r.actionable ? '1' : '0',
      csvEscape(r.canonicalMarket),
      csvEscape(r.replaySelection),
      csvEscape(String(r.settlementResult ?? '')),
      r.directionalWin == null ? '' : r.directionalWin ? '1' : '0',
      r.replayOdds == null ? '' : String(r.replayOdds),
      String(r.replayStakePercent ?? ''),
      r.replayPnl == null ? '' : String(r.replayPnl),
    ];
    lines.push(row.join(','));
  }
  return lines.join('\n');
}

export function buildReplayVsOriginalReport(payload: EvalCasesFilePayload): {
  generatedAt: string;
  source: { applySettledReplayPolicy?: boolean };
  variants: ReplayVsOriginalSummary[];
} {
  return {
    generatedAt: new Date().toISOString(),
    source: { applySettledReplayPolicy: payload.applySettledReplayPolicy },
    variants: payload.variants.map((v) => summarizeReplayVsOriginalForVariant(v.cases)),
  };
}
