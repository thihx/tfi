// ============================================================
// Settlement Types and Helpers
// ============================================================

export const FINAL_SETTLEMENT_RESULTS = [
  'win',
  'loss',
  'push',
  'half_win',
  'half_loss',
  'void',
] as const;

export type FinalSettlementResult = typeof FINAL_SETTLEMENT_RESULTS[number];
export type SettlementResult = FinalSettlementResult | 'unresolved';

export interface RegulationScore {
  home: number;
  away: number;
}

export function isFinalSettlementResult(value: string): value is FinalSettlementResult {
  return (FINAL_SETTLEMENT_RESULTS as readonly string[]).includes(value);
}

export function calcSettlementPnl(
  result: FinalSettlementResult,
  odds: number,
  stakePercent: number,
): number {
  switch (result) {
    case 'win':
      return round((odds - 1) * stakePercent);
    case 'loss':
      return round(-stakePercent);
    case 'half_win':
      return round(((odds - 1) * stakePercent) / 2);
    case 'half_loss':
      return round(-stakePercent / 2);
    case 'push':
    case 'void':
      return 0;
  }
}

export function settlementWasCorrect(result: FinalSettlementResult): boolean | null {
  if (result === 'win') return true;
  if (result === 'loss') return false;
  return null;
}

export function round(n: number): number {
  return Math.round(n * 100) / 100;
}
