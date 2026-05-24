export type ThesisWatchStatus = 'pending' | 'promoted' | 'expired' | 'cancelled';

export type ThesisWatchGateType =
  | 'ah_wait_ou_over'
  | 'corners_over_line'
  | 'goals_over_line';

export interface ThesisWatchGatePayload {
  ouMainOverLineMax?: number;
  cornersPreferredMaxLine?: number;
  goalsOverRemapMaxLine?: number;
  intendedMarketLine?: number | null;
}

export interface ThesisWatchIntent {
  watchKey: string;
  gateType: ThesisWatchGateType;
  gatePayload: ThesisWatchGatePayload;
  selection: string;
  betMarket: string;
  confidence: number;
  valuePercent: number;
  stakePercent: number;
  riskLevel: string;
  reasoningEn: string;
  reasoningVi: string;
  lastBlockReason: string;
}

export interface ThesisWatchRow {
  id: number;
  match_id: string;
  watch_key: string;
  status: ThesisWatchStatus;
  gate_type: ThesisWatchGateType;
  gate_payload: ThesisWatchGatePayload;
  selection: string;
  bet_market: string;
  confidence: number;
  value_percent: number;
  stake_percent: number;
  risk_level: string;
  reasoning_en: string;
  reasoning_vi: string;
  source: string;
  last_block_reason: string;
  created_at: string;
  updated_at: string;
  expires_at: string;
  promoted_at: string | null;
}
