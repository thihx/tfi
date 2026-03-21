// ============================================================
// Deterministic Settle Engine
//
// Rule-based settlement for standard football markets.
// Returns null when the market cannot be resolved deterministically
// (caller should fall back to AI only for unsupported cases).
// ============================================================

import { normalizeMarket } from './normalize-market.js';
import type { FinalSettlementResult, SettlementResult } from './settle-types.js';

export interface SettleInput {
  market: string;
  selection: string;
  homeScore: number;
  awayScore: number;
  statistics?: Array<{ type: string; home: string | number | null; away: string | number | null }>;
}

export interface SettleOutput {
  result: SettlementResult;
  explanation: string;
}

function statValue(stats: SettleInput['statistics'], typeName: string): number | null {
  if (!stats) return null;
  const entry = stats.find(s => s.type.toLowerCase().includes(typeName.toLowerCase()));
  if (!entry) return null;
  const h = typeof entry.home === 'number' ? entry.home : parseInt(String(entry.home ?? ''), 10);
  const a = typeof entry.away === 'number' ? entry.away : parseInt(String(entry.away ?? ''), 10);
  if (Number.isNaN(h) || Number.isNaN(a)) return null;
  return h + a;
}

function settleSingleLine(actual: number, line: number, side: 'over' | 'under'): FinalSettlementResult {
  if (actual === line) return 'push';
  const over = actual > line;
  return side === 'over' ? (over ? 'win' : 'loss') : (!over ? 'win' : 'loss');
}

function quarterLineParts(line: number): [number, number] | null {
  const scaled = Math.round(line * 4);
  const remainder = Math.abs(scaled % 4);
  if (remainder !== 1 && remainder !== 3) return null;
  return [line - 0.25, line + 0.25];
}

function combineSplitResults(
  first: FinalSettlementResult,
  second: FinalSettlementResult,
): FinalSettlementResult | null {
  if (first === second) return first;
  const pair = new Set([first, second]);
  if (pair.has('push') && pair.has('win')) return 'half_win';
  if (pair.has('push') && pair.has('loss')) return 'half_loss';
  return null;
}

function settleTotalMarket(actual: number, line: number, side: 'over' | 'under'): FinalSettlementResult | null {
  const split = quarterLineParts(line);
  if (!split) return settleSingleLine(actual, line, side);
  const [lineA, lineB] = split;
  return combineSplitResults(
    settleSingleLine(actual, lineA, side),
    settleSingleLine(actual, lineB, side),
  );
}

function settleHandicapMarket(scoreDiff: number, handicap: number): FinalSettlementResult | null {
  const split = quarterLineParts(handicap);
  if (!split) return settleAdjustedDiff(scoreDiff + handicap);
  const [lineA, lineB] = split;
  return combineSplitResults(
    settleAdjustedDiff(scoreDiff + lineA),
    settleAdjustedDiff(scoreDiff + lineB),
  );
}

function settleAdjustedDiff(adjustedDiff: number): FinalSettlementResult {
  if (adjustedDiff === 0) return 'push';
  return adjustedDiff > 0 ? 'win' : 'loss';
}

function explainTotalResult(actual: number, line: number, result: FinalSettlementResult): string {
  return `Actual ${actual} vs line ${line} -> ${result}`;
}

function explainHandicapResult(side: 'home' | 'away', handicap: number, adjustedDiff: number, result: FinalSettlementResult): string {
  return `AH ${side} ${handicap > 0 ? '+' : ''}${handicap}, adjusted diff ${adjustedDiff > 0 ? '+' : ''}${round(adjustedDiff)} -> ${result}`;
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Try to settle a bet deterministically.
 * Returns null if the market is unrecognized or stats are missing.
 */
export function settleByRule(input: SettleInput): SettleOutput | null {
  const market = normalizeMarket(input.selection, input.market);
  const totalGoals = input.homeScore + input.awayScore;

  const overMatch = market.match(/^over_(\d+(?:\.\d+)?)$/);
  if (overMatch) {
    const line = parseFloat(overMatch[1]!);
    const result = settleTotalMarket(totalGoals, line, 'over');
    return result ? { result, explanation: explainTotalResult(totalGoals, line, result) } : null;
  }

  const underMatch = market.match(/^under_(\d+(?:\.\d+)?)$/);
  if (underMatch) {
    const line = parseFloat(underMatch[1]!);
    const result = settleTotalMarket(totalGoals, line, 'under');
    return result ? { result, explanation: explainTotalResult(totalGoals, line, result) } : null;
  }

  if (market === 'btts_yes') {
    const bothScored = input.homeScore > 0 && input.awayScore > 0;
    return {
      result: bothScored ? 'win' : 'loss',
      explanation: `Score ${input.homeScore}-${input.awayScore}, BTTS Yes -> ${bothScored ? 'win' : 'loss'}`,
    };
  }

  if (market === 'btts_no') {
    const bothScored = input.homeScore > 0 && input.awayScore > 0;
    return {
      result: bothScored ? 'loss' : 'win',
      explanation: `Score ${input.homeScore}-${input.awayScore}, BTTS No -> ${bothScored ? 'loss' : 'win'}`,
    };
  }

  if (market === '1x2_home') {
    const result: FinalSettlementResult = input.homeScore > input.awayScore ? 'win' : 'loss';
    return {
      result,
      explanation: `Score ${input.homeScore}-${input.awayScore}, Home win -> ${result}`,
    };
  }

  if (market === '1x2_away') {
    const result: FinalSettlementResult = input.awayScore > input.homeScore ? 'win' : 'loss';
    return {
      result,
      explanation: `Score ${input.homeScore}-${input.awayScore}, Away win -> ${result}`,
    };
  }

  if (market === '1x2_draw') {
    const result: FinalSettlementResult = input.homeScore === input.awayScore ? 'win' : 'loss';
    return {
      result,
      explanation: `Score ${input.homeScore}-${input.awayScore}, Draw -> ${result}`,
    };
  }

  if (market.startsWith('corners')) {
    const totalCorners = statValue(input.statistics, 'Corner Kicks');
    if (totalCorners === null) {
      return {
        result: 'unresolved',
        explanation: 'Missing official corner statistics',
      };
    }

    const marketMatch = market.match(/^corners_(over|under)_(\d+(?:\.\d+)?)$/);
    const line = marketMatch
      ? parseFloat(marketMatch[2]!)
      : (() => {
          const lineMatch = input.selection.match(/(\d+(?:\.\d+)?)/);
          return lineMatch ? parseFloat(lineMatch[1]!) : null;
        })();
    if (line === null) return null;

    const side = marketMatch?.[1] === 'under' || /under/i.test(input.selection) ? 'under' : 'over';
    const result = settleTotalMarket(totalCorners, line, side);
    return result ? { result, explanation: explainTotalResult(totalCorners, line, result) } : null;
  }

  if (looksLikeCardsMarket(market, input.selection)) {
    const yellowCards = statValue(input.statistics, 'Yellow Cards');
    const redCards = statValue(input.statistics, 'Red Cards');
    if (yellowCards === null && redCards === null) {
      return {
        result: 'unresolved',
        explanation: 'Missing official card statistics',
      };
    }
    return null;
  }

  if (market.startsWith('asian_handicap')) {
    const marketMatch = market.match(/^asian_handicap_(home|away)_([+-]?\d+(?:\.\d+)?)$/);
    const selectionMatch = input.selection.match(/([+-]?\d+(?:\.\d+)?)/);
    const handicap = marketMatch?.[2]
      ? parseFloat(marketMatch[2]!)
      : selectionMatch
        ? parseFloat(selectionMatch[1]!)
        : null;
    if (handicap === null) return null;

    const side: 'home' | 'away' = marketMatch?.[1]
      ? marketMatch[1] as 'home' | 'away'
      : (/away/i.test(input.selection) ? 'away' : 'home');

    const scoreDiff = side === 'home'
      ? input.homeScore - input.awayScore
      : input.awayScore - input.homeScore;
    const result = settleHandicapMarket(scoreDiff, handicap);
    return result
      ? { result, explanation: explainHandicapResult(side, handicap, scoreDiff + handicap, result) }
      : null;
  }

  return null;
}

function looksLikeCardsMarket(market: string, selection: string): boolean {
  const combined = `${market} ${selection}`.toLowerCase();
  return /\bcard/.test(combined) || /\byellow\b/.test(combined) || /\bred\b/.test(combined);
}
