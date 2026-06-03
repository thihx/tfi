import { describe, expect, it } from 'vitest';
import { evaluateDataDrivenQualityGates } from '../data-driven-quality-gates.js';
import type { SegmentPolicyActionPlan } from '../segment-policy-action-plan.js';

function actionPlan(partial?: Partial<SegmentPolicyActionPlan>): SegmentPolicyActionPlan {
  return {
    generatedAt: '2026-06-03T00:00:00.000Z',
    promptVersion: 'v-test',
    totalCases: 10,
    thresholds: {
      minSettledDirectional: 5,
      minReplayActionable: 3,
      blockAccuracyAtOrBelow: 0.35,
      blockRoiAtOrBelow: -0.25,
      capAccuracyAtOrBelow: 0.5,
      capRoiAtOrBelow: 0,
      defaultStakeCapPercent: 1.5,
      maxRows: 12,
    },
    qualityBlockers: {
      totalCases: 10,
      pushCount: 5,
      noBetCount: 5,
      actionableCount: 5,
      byReplayQualityAttribution: [
        { key: 'actionable', count: 5 },
        { key: 'provider_coverage', count: 2 },
        { key: 'model_policy_mismatch', count: 1 },
        { key: 'hard_policy_gate', count: 3 },
      ],
      byProviderCoverageStatus: [
        { key: 'ok', count: 8 },
        { key: 'provider_line_unavailable_or_stale', count: 2 },
      ],
      byReplayContextStatus: [{ key: 'ok', count: 10 }],
      byDecisionKind: [],
      byLlmDecisionDiagnostic: [],
      byMarketResolutionStatus: [],
      topWarnings: [],
      topHardPolicyWarnings: [],
      providerCoverageGroups: [],
      unresolvedMarketExamples: [],
      policyWarningExamples: [],
      opportunityRecall: {
        originalWinCount: 0,
        originalWinMissedCount: 0,
        originalWinMissRate: 0,
        candidateRescueCount: 0,
        byReplayQualityAttribution: [],
        byLlmDecisionDiagnostic: [],
        byMarketFamily: [],
        preservedNoBetReasons: [],
        candidateRescueExamples: [],
        preservedNoBetExamples: [],
      },
    },
    blocklistCandidates: [],
    stakeCapCandidates: [],
    reviewCandidates: [],
    suggestedBlocklistJson: { segmentKeys: [] },
    suggestedStakeCapJson: { caps: {} },
    ...partial,
  };
}

describe('evaluateDataDrivenQualityGates', () => {
  it('passes when provider coverage stays under configured thresholds', () => {
    const result = evaluateDataDrivenQualityGates(
      {
        actionPlanPath: 'x',
        promptVersion: 'v-test',
        minTotalCases: 5,
        maxProviderCoverageRate: 0.25,
        maxProviderCoverageCount: 2,
      },
      actionPlan(),
    );

    expect(result.ok).toBe(true);
    expect(result.metrics.providerCoverageRate).toBe(0.2);
    expect(result.metrics.modelPolicyMismatchCount).toBe(1);
  });

  it('fails when provider coverage exceeds the configured rate', () => {
    const result = evaluateDataDrivenQualityGates(
      {
        actionPlanPath: 'x',
        promptVersion: 'v-test',
        maxProviderCoverageRate: 0.1,
      },
      actionPlan(),
    );

    expect(result.ok).toBe(false);
    expect(result.failures.some((line) => line.includes('provider_coverage rate'))).toBe(true);
  });

  it('can fail when model-policy mismatch exceeds the configured rate', () => {
    const result = evaluateDataDrivenQualityGates(
      {
        actionPlanPath: 'x',
        promptVersion: 'v-test',
        maxModelPolicyMismatchRate: 0.05,
      },
      actionPlan(),
    );

    expect(result.ok).toBe(false);
    expect(result.failures.some((line) => line.includes('model_policy_mismatch rate'))).toBe(true);
  });
});
