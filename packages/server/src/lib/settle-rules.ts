// ============================================================
// Deterministic Settle Engine
//
// Rule-based settlement for standard football markets.
// Returns null when the market cannot be resolved deterministically
// (caller should fall back to AI for explanation-only).
// ============================================================

import { normalizeMarket } from './normalize-market.js';

export interface SettleInput {
  market: string;       // raw bet_market or selection
  selection: string;    // original selection text
  homeScore: number;
  awayScore: number;
  statistics?: Array<{ type: string; home: string | number | null; away: string | number | null }>;
}

export interface SettleOutput {
  result: 'win' | 'loss' | 'push';
  explanation: string;
}

function statValue(stats: SettleInput['statistics'], typeName: string): number | null {
  if (!stats) return null;
  const entry = stats.find(s => s.type.toLowerCase().includes(typeName.toLowerCase()));
  if (!entry) return null;
  const h = typeof entry.home === 'number' ? entry.home : parseInt(String(entry.home ?? ''), 10);
  const a = typeof entry.away === 'number' ? entry.away : parseInt(String(entry.away ?? ''), 10);
  if (isNaN(h) || isNaN(a)) return null;
  return h + a;
}

function compareLineResult(actual: number, line: number, side: 'over' | 'under'): SettleOutput {
  if (actual === line) return { result: 'push', explanation: `Actual ${actual} = line ${line} → Push` };
  const over = actual > line;
  const result = (side === 'over' ? over : !over) ? 'win' : 'loss';
  return { result, explanation: `Actual ${actual} vs line ${line} → ${result === 'win' ? 'Win' : 'Loss'}` };
}

/**
 * Try to settle a bet deterministically.
 * Returns null if the market is unrecognized or stats are missing.
 */
export function settleByRule(input: SettleInput): SettleOutput | null {
  const market = normalizeMarket(input.selection, input.market);
  const totalGoals = input.homeScore + input.awayScore;

  // ── Over/Under Goals ──
  const overMatch = market.match(/^over_(\d+\.?\d*)$/);
  if (overMatch) {
    const line = parseFloat(overMatch[1]!);
    return compareLineResult(totalGoals, line, 'over');
  }
  const underMatch = market.match(/^under_(\d+\.?\d*)$/);
  if (underMatch) {
    const line = parseFloat(underMatch[1]!);
    return compareLineResult(totalGoals, line, 'under');
  }

  // ── BTTS ──
  if (market === 'btts_yes') {
    const btts = input.homeScore > 0 && input.awayScore > 0;
    return { result: btts ? 'win' : 'loss', explanation: `Score ${input.homeScore}-${input.awayScore}, ${btts ? 'both teams scored' : 'not both scored'} → ${btts ? 'Win' : 'Loss'}` };
  }
  if (market === 'btts_no') {
    const btts = input.homeScore > 0 && input.awayScore > 0;
    return { result: btts ? 'loss' : 'win', explanation: `Score ${input.homeScore}-${input.awayScore}, ${btts ? 'both teams scored' : 'not both scored'} → ${btts ? 'Loss' : 'Win'}` };
  }

  // ── 1X2 ──
  if (market === '1x2_home') {
    const r = input.homeScore > input.awayScore ? 'win' : input.homeScore === input.awayScore ? 'loss' : 'loss';
    return { result: r as 'win' | 'loss', explanation: `Score ${input.homeScore}-${input.awayScore}, Home ${input.homeScore > input.awayScore ? 'wins' : 'does not win'} → ${r === 'win' ? 'Win' : 'Loss'}` };
  }
  if (market === '1x2_away') {
    const r = input.awayScore > input.homeScore ? 'win' : 'loss';
    return { result: r as 'win' | 'loss', explanation: `Score ${input.homeScore}-${input.awayScore}, Away ${input.awayScore > input.homeScore ? 'wins' : 'does not win'} → ${r === 'win' ? 'Win' : 'Loss'}` };
  }
  if (market === '1x2_draw') {
    const r = input.homeScore === input.awayScore ? 'win' : 'loss';
    return { result: r as 'win' | 'loss', explanation: `Score ${input.homeScore}-${input.awayScore}, ${input.homeScore === input.awayScore ? 'Draw' : 'No draw'} → ${r === 'win' ? 'Win' : 'Loss'}` };
  }

  // ── Corners (Over/Under) ──
  if (market.startsWith('corners')) {
    const totalCorners = statValue(input.statistics, 'Corner Kicks');
    if (totalCorners === null) return null;  // no stats → fall back to AI
    // Parse line from selection text
    const marketMatch = market.match(/^corners_(over|under)_(\d+\.?\d*)$/);
    const line = marketMatch
      ? parseFloat(marketMatch[2]!)
      : (() => {
          const lineMatch = input.selection.match(/(\d+\.?\d*)/);
          return lineMatch ? parseFloat(lineMatch[1]!) : null;
        })();
    if (line === null) return null;
    const side = marketMatch?.[1] === 'under' || /under/i.test(input.selection) ? 'under' : 'over';
    return compareLineResult(totalCorners, line, side);
  }

  // ── Asian Handicap ──
  if (market.startsWith('asian_handicap')) {
    // Parse handicap value and side from selection
    const marketMatch = market.match(/^asian_handicap_(home|away)_([+-]?\d+\.?\d*)$/);
    const selectionMatch = input.selection.match(/([+-]?\d+\.?\d*)/);
    const handicap = marketMatch?.[2]
      ? parseFloat(marketMatch[2])
      : selectionMatch
        ? parseFloat(selectionMatch[1]!)
        : null;
    if (handicap === null) return null;
    const isHome = marketMatch?.[1]
      ? marketMatch[1] === 'home'
      : !/away/i.test(input.selection);
    const diff = isHome
      ? (input.homeScore - input.awayScore + handicap)
      : (input.awayScore - input.homeScore + handicap);
    if (diff === 0) return { result: 'push', explanation: `Adjusted diff = 0 → Push` };
    const result = diff > 0 ? 'win' : 'loss';
    return { result, explanation: `AH diff ${diff > 0 ? '+' : ''}${diff} → ${result === 'win' ? 'Win' : 'Loss'}` };
  }

  // Market not recognized → fall back to AI
  return null;
}
