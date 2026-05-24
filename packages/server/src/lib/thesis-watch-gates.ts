import { normalizeMarket } from './normalize-market.js';
import { sameOddsLine } from './odds-line-utils.js';
import {
  DEFAULT_LINE_PATIENCE_CONFIG,
  formatSelectionForMarket,
  type LinePatienceOddsCanonical,
} from './line-patience-policy.js';
import type {
  ThesisWatchGatePayload,
  ThesisWatchGateType,
  ThesisWatchIntent,
  ThesisWatchRow,
} from './thesis-watch-types.js';

function hasUsablePrice(price: number | null | undefined): boolean {
  return price != null && Number.isFinite(price) && price > 0;
}

function getMarketLine(canonicalMarket: string): number | null {
  const match = String(canonicalMarket || '').trim().match(/_(\d+(?:\.\d+)?)$/);
  if (!match) return null;
  const line = Number(match[1]);
  return Number.isFinite(line) ? line : null;
}

function listGoalsOuQuotes(canonical: LinePatienceOddsCanonical) {
  const rows: Array<{ line: number; over: number | null; under: number | null }> = [];
  if (canonical.ou?.line != null) {
    rows.push({
      line: canonical.ou.line,
      over: canonical.ou.over ?? null,
      under: canonical.ou.under ?? null,
    });
  }
  if (canonical.ou_adjacent?.line != null) {
    const adj = canonical.ou_adjacent;
    if (!rows.some((r) => sameOddsLine(r.line, adj.line))) {
      rows.push({ line: adj.line, over: adj.over ?? null, under: adj.under ?? null });
    }
  }
  return rows;
}

function hasGoalsOverLineAtMost(canonical: LinePatienceOddsCanonical, maxLine: number): boolean {
  return listGoalsOuQuotes(canonical).some(
    (q) => q.line <= maxLine && hasUsablePrice(q.over),
  );
}

export function isThesisWatchGateSatisfied(
  gateType: ThesisWatchGateType,
  gatePayload: ThesisWatchGatePayload,
  oddsCanonical: LinePatienceOddsCanonical,
): boolean {
  const ouMax = gatePayload.ouMainOverLineMax ?? DEFAULT_LINE_PATIENCE_CONFIG.ahWaitOuMainOverLineMax;
  const cornersMax = gatePayload.cornersPreferredMaxLine ?? DEFAULT_LINE_PATIENCE_CONFIG.cornersOverPreferredMaxLine;
  const goalsMax = gatePayload.goalsOverRemapMaxLine ?? DEFAULT_LINE_PATIENCE_CONFIG.goalsOverRemapMaxLine;

  if (gateType === 'ah_wait_ou_over') {
    const mainOuLine = oddsCanonical.ou?.line ?? null;
    if (mainOuLine != null && mainOuLine <= ouMax) return true;
    return hasGoalsOverLineAtMost(oddsCanonical, ouMax);
  }

  if (gateType === 'corners_over_line') {
    const mainLine = oddsCanonical.corners_ou?.line ?? null;
    const intended = gatePayload.intendedMarketLine ?? null;
    if (mainLine == null || intended == null) return false;
    if (mainLine < intended) return true;
    return sameOddsLine(mainLine, intended) && mainLine <= cornersMax;
  }

  if (gateType === 'goals_over_line') {
    const intended = gatePayload.intendedMarketLine ?? null;
    if (intended == null) return false;
    const best = listGoalsOuQuotes(oddsCanonical)
      .filter((q) => hasUsablePrice(q.over) && q.line <= goalsMax)
      .sort((a, b) => b.line - a.line)[0];
    if (!best) return false;
    return best.line < intended || (sameOddsLine(best.line, intended) && best.line <= goalsMax);
  }

  return false;
}

function formatLineSuffix(line: number): string {
  return Number.isInteger(line) ? String(line) : String(line);
}

/** Align stored thesis with live ladder before LLP on promote (fixes corners/goals aggressive line). */
export function resolveThesisWatchPromoteMarket(
  watch: Pick<ThesisWatchRow, 'gate_type' | 'gate_payload' | 'selection' | 'bet_market'>,
  oddsCanonical: LinePatienceOddsCanonical,
): { selection: string; betMarket: string } {
  const base = {
    selection: watch.selection,
    betMarket: watch.bet_market,
  };

  if (watch.gate_type === 'corners_over_line') {
    const intended = watch.gate_payload.intendedMarketLine ?? null;
    const mainLine = oddsCanonical.corners_ou?.line ?? null;
    const cornersMax =
      watch.gate_payload.cornersPreferredMaxLine ?? DEFAULT_LINE_PATIENCE_CONFIG.cornersOverPreferredMaxLine;
    if (mainLine == null) return base;

    let targetLine = mainLine;
    if (intended != null && mainLine < intended) {
      targetLine = mainLine;
    } else if (intended != null && sameOddsLine(mainLine, intended) && mainLine > cornersMax) {
      targetLine = cornersMax;
    } else if (mainLine > cornersMax) {
      targetLine = cornersMax;
    }

    const betMarket = `corners_over_${formatLineSuffix(targetLine)}`;
    return {
      betMarket,
      selection: formatSelectionForMarket(betMarket),
    };
  }

  if (watch.gate_type === 'goals_over_line') {
    const intended = watch.gate_payload.intendedMarketLine ?? null;
    const goalsMax =
      watch.gate_payload.goalsOverRemapMaxLine ?? DEFAULT_LINE_PATIENCE_CONFIG.goalsOverRemapMaxLine;
    const best = listGoalsOuQuotes(oddsCanonical)
      .filter((q) => hasUsablePrice(q.over) && q.line <= goalsMax)
      .sort((a, b) => b.line - a.line)[0];
    if (!best) return base;
    if (intended != null && best.line >= intended && !sameOddsLine(best.line, intended)) {
      return base;
    }

    const betMarket = `over_${formatLineSuffix(best.line)}`;
    return {
      betMarket,
      selection: formatSelectionForMarket(betMarket),
    };
  }

  return base;
}

const DEFER_WARNING_TO_GATE: Record<string, ThesisWatchGateType> = {
  LLP_BLOCK_AH_WAIT_OU_OVER_LINE: 'ah_wait_ou_over',
  LLP_BLOCK_CORNERS_OVER_AGGRESSIVE_LINE: 'corners_over_line',
  LLP_BLOCK_OVER_AGGRESSIVE_LINE: 'goals_over_line',
};

export function buildThesisWatchIntentFromLlpBlock(args: {
  warnings: string[];
  selection: string;
  betMarket: string;
  confidence: number;
  valuePercent: number;
  stakePercent: number;
  riskLevel: string;
  reasoningEn: string;
  reasoningVi: string;
  oddsCanonical: LinePatienceOddsCanonical;
}): ThesisWatchIntent | null {
  const deferCode = args.warnings.find((w) => DEFER_WARNING_TO_GATE[w]);
  if (!deferCode) return null;

  const gateType = DEFER_WARNING_TO_GATE[deferCode]!;
  const canonical = normalizeMarket(args.selection, args.betMarket);
  const marketLine = getMarketLine(canonical);
  const gatePayload: ThesisWatchGatePayload = {
    ouMainOverLineMax: DEFAULT_LINE_PATIENCE_CONFIG.ahWaitOuMainOverLineMax,
    cornersPreferredMaxLine: DEFAULT_LINE_PATIENCE_CONFIG.cornersOverPreferredMaxLine,
    goalsOverRemapMaxLine: DEFAULT_LINE_PATIENCE_CONFIG.goalsOverRemapMaxLine,
    intendedMarketLine: marketLine,
  };

  return {
    watchKey: `${gateType}::${canonical}`,
    gateType,
    gatePayload,
    selection: args.selection,
    betMarket: canonical,
    confidence: args.confidence,
    valuePercent: args.valuePercent,
    stakePercent: args.stakePercent,
    riskLevel: args.riskLevel,
    reasoningEn: args.reasoningEn,
    reasoningVi: args.reasoningVi,
    lastBlockReason: deferCode,
  };
}
