import { describe, expect, it } from 'vitest';
import { evaluateRuntimePolicyProductionPromotion } from '../runtime-policy-production-promotion.js';
import type { RuntimePolicyShadowSignal } from '../runtime-policy-shadow.js';

function signal(partial: Partial<RuntimePolicyShadowSignal> = {}): RuntimePolicyShadowSignal {
  return {
    hasPolicyBlockedSelection: true,
    canonicalMarket: 'under_4.5',
    minuteBand: '75+',
    scoreState: 'two-plus-margin',
    odds: 2.05,
    confidence: 7,
    valuePercent: 8,
    valueBand: '8+',
    riskLevel: 'MEDIUM',
    stakePercent: 3,
    watchSignalKey: 'none',
    watchSignalLabel: 'none',
    evidenceMode: 'full_live_data',
    marketResolutionStatus: 'resolved',
    prematchStrength: 'moderate',
    marketAvailabilityBucket: 'totals_only',
    policyWarnings: ['POLICY_BLOCK_GOALS_UNDER_THIN_CUSHION_LOW_CONF_GLOBAL'],
    skippedReason: '',
    matchedPockets: [{
      id: 'late_under_45_two_plus',
      label: 'Late Under 4.5 75+ two-plus shadow',
      stakeCapPercent: 1,
      reason: 'shadow',
    }],
    ...partial,
  };
}

const baseConfig = {
  enabled: true,
  killSwitch: false,
  pocketIds: ['late_under_45_two_plus'],
  rolloutPercent: 100,
  maxStakePercent: 1,
  evidenceAck: 'ready_for_human_review',
  owner: 'ops',
};

describe('evaluateRuntimePolicyProductionPromotion', () => {
  it('keeps shadow-only when disabled or missing evidence acknowledgement', () => {
    expect(evaluateRuntimePolicyProductionPromotion({
      matchId: '100',
      shadowMode: false,
      advisoryOnly: false,
      policyBlocked: true,
      stakePercent: 3,
      runtimePolicyShadow: signal(),
      config: { ...baseConfig, enabled: false },
    })).toMatchObject({ promoted: false, reason: 'promotion_disabled' });

    expect(evaluateRuntimePolicyProductionPromotion({
      matchId: '100',
      shadowMode: false,
      advisoryOnly: false,
      policyBlocked: true,
      stakePercent: 3,
      runtimePolicyShadow: signal(),
      config: { ...baseConfig, evidenceAck: '' },
    })).toMatchObject({ promoted: false, reason: 'missing_ready_evidence_ack' });
  });

  it('honors kill switch, allowlist, and rollout', () => {
    expect(evaluateRuntimePolicyProductionPromotion({
      matchId: '100',
      shadowMode: false,
      advisoryOnly: false,
      policyBlocked: true,
      stakePercent: 3,
      runtimePolicyShadow: signal(),
      config: { ...baseConfig, killSwitch: true },
    })).toMatchObject({ promoted: false, reason: 'promotion_kill_switch' });

    expect(evaluateRuntimePolicyProductionPromotion({
      matchId: '100',
      shadowMode: false,
      advisoryOnly: false,
      policyBlocked: true,
      stakePercent: 3,
      runtimePolicyShadow: signal(),
      config: { ...baseConfig, pocketIds: ['medium_risk_thin_edge_shadow_v1'] },
    })).toMatchObject({ promoted: false, reason: 'matched_pocket_not_configured' });

    expect(evaluateRuntimePolicyProductionPromotion({
      matchId: '100',
      shadowMode: false,
      advisoryOnly: false,
      policyBlocked: true,
      stakePercent: 3,
      runtimePolicyShadow: signal(),
      config: { ...baseConfig, rolloutPercent: 0 },
    })).toMatchObject({ promoted: false, reason: 'rollout_zero' });
  });

  it('promotes a configured pocket with capped stake only when all guards pass', () => {
    const decision = evaluateRuntimePolicyProductionPromotion({
      matchId: '100',
      shadowMode: false,
      advisoryOnly: false,
      policyBlocked: true,
      stakePercent: 3,
      runtimePolicyShadow: signal(),
      config: baseConfig,
    });

    expect(decision).toMatchObject({
      promoted: true,
      reason: 'promoted_controlled_pocket',
      pocketId: 'late_under_45_two_plus',
      stakePercent: 1,
      rolloutPercent: 100,
      evidenceAck: 'ready_for_human_review',
      owner: 'ops',
    });
    expect(decision.rolloutRatio).toBeGreaterThanOrEqual(0);
    expect(decision.rolloutRatio).toBeLessThanOrEqual(1);
  });
});
