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
export const SETTLEMENT_RESULTS = [...FINAL_SETTLEMENT_RESULTS, 'unresolved'] as const;
export type SettlementResult = typeof SETTLEMENT_RESULTS[number];
export const FINAL_SETTLEMENT_RESULTS_SQL = FINAL_SETTLEMENT_RESULTS.map((result) => `'${result}'`).join(',');

export const DECISIVE_SETTLEMENT_RESULTS = ['win', 'loss'] as const;
export type DecisiveSettlementResult = typeof DECISIVE_SETTLEMENT_RESULTS[number];
export const DECISIVE_SETTLEMENT_RESULTS_SQL = DECISIVE_SETTLEMENT_RESULTS.map((result) => `'${result}'`).join(',');

export const DIRECTIONAL_WIN_SETTLEMENT_RESULTS = ['win', 'half_win'] as const;
export type DirectionalWinSettlementResult = typeof DIRECTIONAL_WIN_SETTLEMENT_RESULTS[number];
export const DIRECTIONAL_WIN_SETTLEMENT_RESULTS_SQL = DIRECTIONAL_WIN_SETTLEMENT_RESULTS.map((result) => `'${result}'`).join(',');

export const DIRECTIONAL_LOSS_SETTLEMENT_RESULTS = ['loss', 'half_loss'] as const;
export type DirectionalLossSettlementResult = typeof DIRECTIONAL_LOSS_SETTLEMENT_RESULTS[number];
export const DIRECTIONAL_LOSS_SETTLEMENT_RESULTS_SQL = DIRECTIONAL_LOSS_SETTLEMENT_RESULTS.map((result) => `'${result}'`).join(',');

export const DIRECTIONAL_SETTLEMENT_RESULTS = [
  ...DIRECTIONAL_WIN_SETTLEMENT_RESULTS,
  ...DIRECTIONAL_LOSS_SETTLEMENT_RESULTS,
] as const;
export type DirectionalSettlementResult = typeof DIRECTIONAL_SETTLEMENT_RESULTS[number];
export const DIRECTIONAL_SETTLEMENT_RESULTS_SQL = DIRECTIONAL_SETTLEMENT_RESULTS.map((result) => `'${result}'`).join(',');

export const PUSH_VOID_SETTLEMENT_RESULTS = ['push', 'void'] as const;
export type PushVoidSettlementResult = typeof PUSH_VOID_SETTLEMENT_RESULTS[number];
export const PUSH_VOID_SETTLEMENT_RESULTS_SQL = PUSH_VOID_SETTLEMENT_RESULTS.map((result) => `'${result}'`).join(',');

export const SETTLEMENT_METHODS = ['rules', 'ai', 'manual', 'legacy'] as const;
export type SettlementMethod = typeof SETTLEMENT_METHODS[number];

export const SETTLEMENT_STATUSES = ['pending', 'unresolved', 'resolved', 'corrected'] as const;
export type SettlementStatus = typeof SETTLEMENT_STATUSES[number];

export interface SettlementPersistenceMeta {
  status?: SettlementStatus;
  method?: SettlementMethod;
  settlePromptVersion?: string;
  note?: string;
  trusted?: boolean;
}

export interface RegulationScore {
  home: number;
  away: number;
}

export function isFinalSettlementResult(value: string): value is FinalSettlementResult {
  return (FINAL_SETTLEMENT_RESULTS as readonly string[]).includes(value);
}

export function isSettlementResult(value: string): value is SettlementResult {
  return (SETTLEMENT_RESULTS as readonly string[]).includes(value);
}

export function isDirectionalWinSettlementResult(value: string): value is DirectionalWinSettlementResult {
  return (DIRECTIONAL_WIN_SETTLEMENT_RESULTS as readonly string[]).includes(value);
}

export function isDirectionalLossSettlementResult(value: string): value is DirectionalLossSettlementResult {
  return (DIRECTIONAL_LOSS_SETTLEMENT_RESULTS as readonly string[]).includes(value);
}

export function isDirectionalSettlementResult(value: string): value is DirectionalSettlementResult {
  return (DIRECTIONAL_SETTLEMENT_RESULTS as readonly string[]).includes(value);
}

export function isPushVoidSettlementResult(value: string): value is PushVoidSettlementResult {
  return (PUSH_VOID_SETTLEMENT_RESULTS as readonly string[]).includes(value);
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
  if (result === 'half_win') return true;
  if (result === 'half_loss') return false;
  return null;
}

export function round(n: number): number {
  return Math.round(n * 100) / 100;
}
