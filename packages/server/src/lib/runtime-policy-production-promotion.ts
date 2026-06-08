import type {
  RuntimePolicyShadowPocketId,
  RuntimePolicyShadowSignal,
} from './runtime-policy-shadow.js';

export interface RuntimePolicyProductionPromotionConfig {
  enabled: boolean;
  killSwitch: boolean;
  pocketIds: string[];
  rolloutPercent: number;
  maxStakePercent: number;
  evidenceAck: string;
  owner: string;
}

export interface RuntimePolicyProductionPromotionInput {
  matchId: string;
  shadowMode: boolean;
  advisoryOnly: boolean;
  policyBlocked: boolean;
  stakePercent: number | null;
  runtimePolicyShadow: RuntimePolicyShadowSignal;
  config: RuntimePolicyProductionPromotionConfig;
}

export interface RuntimePolicyProductionPromotionDecision {
  promoted: boolean;
  reason: string;
  pocketId: RuntimePolicyShadowPocketId | null;
  pocketLabel: string;
  stakePercent: number | null;
  rolloutPercent: number;
  rolloutRatio: number | null;
  matchedPocketIds: RuntimePolicyShadowPocketId[];
  configuredPocketIds: string[];
  evidenceAck: string;
  owner: string;
}

const REQUIRED_EVIDENCE_ACK = 'ready_for_human_review';

function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(value, 100));
}

function clampStake(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(value, 10));
}

function stableRatio(seed: string): number {
  let hash = 2166136261;
  for (let i = 0; i < seed.length; i += 1) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) / 4294967295;
}

function blocked(
  reason: string,
  base: Omit<RuntimePolicyProductionPromotionDecision, 'promoted' | 'reason' | 'stakePercent'>,
): RuntimePolicyProductionPromotionDecision {
  return {
    ...base,
    promoted: false,
    reason,
    stakePercent: null,
  };
}

export function evaluateRuntimePolicyProductionPromotion(
  input: RuntimePolicyProductionPromotionInput,
): RuntimePolicyProductionPromotionDecision {
  const rolloutPercent = clampPercent(input.config.rolloutPercent);
  const matchedPocketIds = input.runtimePolicyShadow.matchedPockets.map((pocket) => pocket.id);
  const configuredPocketIds = Array.isArray(input.config.pocketIds)
    ? input.config.pocketIds.map((id) => id.trim()).filter(Boolean)
    : [];
  const base = {
    pocketId: null,
    pocketLabel: '',
    rolloutPercent,
    rolloutRatio: null,
    matchedPocketIds,
    configuredPocketIds,
    evidenceAck: input.config.evidenceAck,
    owner: input.config.owner,
  };

  if (!input.config.enabled) return blocked('promotion_disabled', base);
  if (input.config.killSwitch) return blocked('promotion_kill_switch', base);
  if (input.shadowMode) return blocked('shadow_mode', base);
  if (input.advisoryOnly) return blocked('advisory_only', base);
  if (input.config.evidenceAck !== REQUIRED_EVIDENCE_ACK) return blocked('missing_ready_evidence_ack', base);
  if (!input.policyBlocked || !input.runtimePolicyShadow.hasPolicyBlockedSelection) {
    return blocked('not_policy_blocked_selection', base);
  }
  if (input.runtimePolicyShadow.marketResolutionStatus !== 'resolved') {
    return blocked('market_not_resolved', base);
  }
  if (input.runtimePolicyShadow.canonicalMarket === 'unknown' || input.runtimePolicyShadow.odds == null) {
    return blocked('canonical_market_or_odds_missing', base);
  }
  if (configuredPocketIds.length === 0) return blocked('no_configured_pockets', base);

  const allowed = new Set(configuredPocketIds);
  const pocket = input.runtimePolicyShadow.matchedPockets.find((candidate) => allowed.has(candidate.id));
  if (!pocket) return blocked('matched_pocket_not_configured', base);

  const pocketBase = {
    ...base,
    pocketId: pocket.id,
    pocketLabel: pocket.label,
  };
  if (rolloutPercent <= 0) return blocked('rollout_zero', pocketBase);

  const ratio = stableRatio(`${input.matchId}:${pocket.id}`);
  if (rolloutPercent < 100 && ratio >= rolloutPercent / 100) {
    return {
      ...pocketBase,
      promoted: false,
      reason: 'outside_rollout_sample',
      stakePercent: null,
      rolloutRatio: ratio,
    };
  }

  const candidateStake = input.stakePercent != null && input.stakePercent > 0
    ? input.stakePercent
    : pocket.stakeCapPercent;
  const stakePercent = Math.min(
    clampStake(candidateStake),
    clampStake(pocket.stakeCapPercent),
    clampStake(input.config.maxStakePercent),
  );
  if (stakePercent <= 0) {
    return {
      ...pocketBase,
      promoted: false,
      reason: 'stake_cap_zero',
      stakePercent: null,
      rolloutRatio: ratio,
    };
  }

  return {
    ...pocketBase,
    promoted: true,
    reason: 'promoted_controlled_pocket',
    stakePercent,
    rolloutRatio: ratio,
  };
}
