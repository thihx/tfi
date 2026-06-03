import { describe, expect, it } from 'vitest';
import { evaluateReplayPolicyExperimentGates } from '../replay-policy-experiment-gates.js';
import type { ReplayPolicyExperimentReport } from '../replay-policy-experiment.js';

function report(partial: Partial<ReplayPolicyExperimentReport> = {}): ReplayPolicyExperimentReport {
  return {
    generatedAt: '2026-06-03T00:00:00.000Z',
    totalCases: 54,
    trustedCounterfactualCandidates: 4,
    skippedPolicyBlockedSelections: [],
    experiments: [
      {
        id: 'btts_yes_60_74_two_plus',
        label: 'BTTS Yes',
        stakeCapPercent: 1,
        selectedCount: 1,
        winCount: 1,
        lossCount: 0,
        pushLikeCount: 0,
        totalStakedPercent: 1,
        totalPnlPercent: 1.2,
        roiOnStaked: 1.2,
        originalWinsRescued: 1,
        originalLossesReintroduced: 0,
        selections: [],
      },
      {
        id: 'late_under_45_two_plus',
        label: 'Late Under 4.5',
        stakeCapPercent: 1,
        selectedCount: 1,
        winCount: 1,
        lossCount: 0,
        pushLikeCount: 0,
        totalStakedPercent: 1,
        totalPnlPercent: 1.025,
        roiOnStaked: 1.025,
        originalWinsRescued: 1,
        originalLossesReintroduced: 0,
        selections: [],
      },
      {
        id: 'over_15_60_74_one_goal',
        label: 'Over 1.5',
        stakeCapPercent: 1,
        selectedCount: 1,
        winCount: 1,
        lossCount: 0,
        pushLikeCount: 0,
        totalStakedPercent: 1,
        totalPnlPercent: 0.55,
        roiOnStaked: 0.55,
        originalWinsRescued: 1,
        originalLossesReintroduced: 0,
        selections: [],
      },
    ],
    combined: {
      selectedCount: 3,
      winCount: 3,
      lossCount: 0,
      pushLikeCount: 0,
      totalStakedPercent: 3,
      totalPnlPercent: 2.775,
      roiOnStaked: 0.925,
      originalWinsRescued: 3,
      originalLossesReintroduced: 0,
      selections: [],
    },
    ...partial,
  };
}

describe('evaluateReplayPolicyExperimentGates', () => {
  it('passes a replay-only candidate experiment that satisfies safety gates', () => {
    const result = evaluateReplayPolicyExperimentGates(
      {
        policyExperimentPath: 'report.json',
        minTotalCases: 50,
        minTrustedCounterfactualCandidates: 4,
        minCombinedSelectedCount: 3,
        minOriginalWinsRescued: 3,
        minCombinedRoiOnStaked: 0.25,
        maxCombinedLossCount: 0,
        maxOriginalLossesReintroduced: 0,
        requiredExperiments: [
          { id: 'btts_yes_60_74_two_plus', minSelectedCount: 1, maxLossCount: 0 },
          { id: 'late_under_45_two_plus', minSelectedCount: 1, maxLossCount: 0 },
          { id: 'over_15_60_74_one_goal', minSelectedCount: 1, maxLossCount: 0 },
        ],
      },
      report(),
    );

    expect(result.ok).toBe(true);
    expect(result.failures).toEqual([]);
  });

  it('fails when a pocket reintroduces losses or lacks enough cohort support', () => {
    const result = evaluateReplayPolicyExperimentGates(
      {
        policyExperimentPath: 'report.json',
        minTotalCases: 60,
        maxOriginalLossesReintroduced: 0,
        requiredExperiments: [{ id: 'late_under_45_two_plus', minSelectedCount: 2, maxLossCount: 0 }],
      },
      report({
        totalCases: 54,
        combined: {
          selectedCount: 4,
          winCount: 3,
          lossCount: 1,
          pushLikeCount: 0,
          totalStakedPercent: 4,
          totalPnlPercent: 1.775,
          roiOnStaked: 0.4438,
          originalWinsRescued: 3,
          originalLossesReintroduced: 1,
          selections: [],
        },
      }),
    );

    expect(result.ok).toBe(false);
    expect(result.failures).toContain('totalCases 54 < minTotalCases 60');
    expect(result.failures).toContain(
      'combined.originalLossesReintroduced 1 > maxOriginalLossesReintroduced 0',
    );
    expect(result.failures).toContain('late_under_45_two_plus.selectedCount 1 < minSelectedCount 2');
  });

  it('fails when an individual pocket misses stricter rescue, PnL, ROI, or loss-reintroduction gates', () => {
    const result = evaluateReplayPolicyExperimentGates(
      {
        policyExperimentPath: 'report.json',
        requiredExperiments: [
          {
            id: 'over_15_60_74_one_goal',
            minSelectedCount: 1,
            minWinCount: 1,
            minOriginalWinsRescued: 1,
            minTotalPnlPercent: 0.75,
            minRoiOnStaked: 0.75,
            maxLossCount: 0,
            maxOriginalLossesReintroduced: 0,
          },
        ],
      },
      report({
        experiments: [
          {
            id: 'over_15_60_74_one_goal',
            label: 'Over 1.5',
            stakeCapPercent: 1,
            selectedCount: 2,
            winCount: 0,
            lossCount: 1,
            pushLikeCount: 1,
            totalStakedPercent: 2,
            totalPnlPercent: -1,
            roiOnStaked: -0.5,
            originalWinsRescued: 0,
            originalLossesReintroduced: 1,
            selections: [],
          },
        ],
      }),
    );

    expect(result.ok).toBe(false);
    expect(result.failures).toEqual([
      'over_15_60_74_one_goal.winCount 0 < minWinCount 1',
      'over_15_60_74_one_goal.originalWinsRescued 0 < minOriginalWinsRescued 1',
      'over_15_60_74_one_goal.totalPnlPercent -1 < minTotalPnlPercent 0.75',
      'over_15_60_74_one_goal.lossCount 1 > maxLossCount 0',
      'over_15_60_74_one_goal.originalLossesReintroduced 1 > maxOriginalLossesReintroduced 0',
      'over_15_60_74_one_goal.roiOnStaked -0.5 < minRoiOnStaked 0.75',
    ]);
  });
});
