import { describe, expect, it } from 'vitest';
import { buildRuntimePolicyShadowSignal } from '../runtime-policy-shadow.js';

const totalsOnlyOdds = {
  ou: { line: 2.5, over: 2.1, under: 1.8 },
  btts: { yes: 2.2, no: 1.7 },
};

describe('buildRuntimePolicyShadowSignal', () => {
  it('matches the strict BTTS Yes clean-context shadow pocket', () => {
    const signal = buildRuntimePolicyShadowSignal({
      selection: 'BTTS Yes @2.20',
      betMarket: 'btts_yes',
      minute: 70,
      score: '3-1',
      odds: 2.2,
      confidence: 8,
      valuePercent: 6,
      riskLevel: 'MEDIUM',
      stakePercent: 2,
      policyBlocked: true,
      policyWarnings: ['LATE_MIDGAME_INSUFFICIENT_CONFIDENCE'],
      evidenceMode: 'full_live_data',
      marketResolutionStatus: 'resolved',
      prematchStrength: 'strong',
      oddsCanonical: totalsOnlyOdds,
      minOdds: 1.5,
    });

    expect(signal.marketAvailabilityBucket).toBe('totals_only');
    expect(signal.confidence).toBe(8);
    expect(signal.valuePercent).toBe(6);
    expect(signal.valueBand).toBe('6-7');
    expect(signal.riskLevel).toBe('MEDIUM');
    expect(signal.stakePercent).toBe(2);
    expect(signal.watchSignalKey).toBe('btts_yes_medium_edge_6_7_odds_2_plus');
    expect(signal.marketResolutionStatus).toBe('resolved');
    expect(signal.matchedPockets.map((pocket) => pocket.id)).toEqual(['btts_yes_60_74_two_plus']);
    expect(signal.matchedPockets[0]?.stakeCapPercent).toBe(1);
    expect(signal.skippedReason).toBe('');
  });

  it('does not match BTTS when a side market is playable', () => {
    const signal = buildRuntimePolicyShadowSignal({
      selection: 'BTTS Yes @2.20',
      betMarket: 'btts_yes',
      minute: 70,
      score: '3-1',
      odds: 2.2,
      confidence: 8,
      valuePercent: 7,
      riskLevel: 'MEDIUM',
      policyBlocked: true,
      policyWarnings: ['LATE_MIDGAME_INSUFFICIENT_CONFIDENCE'],
      evidenceMode: 'full_live_data',
      prematchStrength: 'strong',
      oddsCanonical: {
        ...totalsOnlyOdds,
        '1x2': { home: 1.62, draw: 4.4, away: 5.5 },
      },
      minOdds: 1.5,
    });

    expect(signal.marketAvailabilityBucket).toBe('playable_side_market');
    expect(signal.matchedPockets).toEqual([]);
    expect(signal.watchSignalKey).toBe('btts_yes_medium_edge_6_7_odds_2_plus');
    expect(signal.skippedReason).toContain('marketAvailabilityBucket=playable_side_market');
  });

  it('matches late Under 4.5 and Over 1.5 shadow pockets', () => {
    const lateUnder = buildRuntimePolicyShadowSignal({
      selection: 'Under 4.5 Goals @2.05',
      betMarket: 'under_4.5',
      minute: 82,
      score: '3-0',
      odds: 2.05,
      confidence: 7,
      policyBlocked: true,
      policyWarnings: ['POLICY_BLOCK_THIN_LATE_UNDER'],
      evidenceMode: 'full_live_data',
      prematchStrength: 'moderate',
      oddsCanonical: totalsOnlyOdds,
      minOdds: 1.5,
    });
    const over = buildRuntimePolicyShadowSignal({
      selection: 'Over 1.5 Goals @1.55',
      betMarket: 'over_1.5',
      minute: 65,
      score: '1-0',
      odds: 1.55,
      confidence: 7,
      policyBlocked: true,
      policyWarnings: ['OVER_1_5_BLOCKED_LATE_MIDGAME'],
      evidenceMode: 'full_live_data',
      prematchStrength: 'weak',
      oddsCanonical: totalsOnlyOdds,
      minOdds: 1.5,
    });

    expect(lateUnder.matchedPockets.map((pocket) => pocket.id)).toEqual(['late_under_45_two_plus']);
    expect(over.matchedPockets.map((pocket) => pocket.id)).toEqual(['over_15_60_74_one_goal']);
  });

  it('does not create a shadow candidate when production policy did not block', () => {
    const signal = buildRuntimePolicyShadowSignal({
      selection: 'Over 1.5 Goals @1.55',
      betMarket: 'over_1.5',
      minute: 65,
      score: '1-0',
      odds: 1.55,
      confidence: 7,
      policyBlocked: false,
      policyWarnings: [],
      evidenceMode: 'full_live_data',
      prematchStrength: 'strong',
      oddsCanonical: totalsOnlyOdds,
      minOdds: 1.5,
    });

    expect(signal.hasPolicyBlockedSelection).toBe(false);
    expect(signal.matchedPockets).toEqual([]);
  });
});
