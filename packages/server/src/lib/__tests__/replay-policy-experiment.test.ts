import { describe, expect, it } from 'vitest';
import { buildReplayPolicyExperimentReport } from '../replay-policy-experiment.js';
import type { EvaluatedReplayCase } from '../settled-replay-evaluation.js';

function row(partial: Partial<EvaluatedReplayCase>): EvaluatedReplayCase {
  return {
    promptVersion: 'v-test',
    scenarioName: 'case-1',
    recommendationId: 1,
    minute: 67,
    score: '0-2',
    scoreState: 'two-plus-margin',
    minuteBand: '60-74',
    prematchStrength: 'strong',
    evidenceMode: 'full_live_data',
    marketAvailabilityBucket: 'totals_only',
    shouldPush: false,
    actionable: false,
    canonicalMarket: 'btts_yes',
    goalsUnder: false,
    goalsOver: false,
    settlementResult: null,
    directionalWin: null,
    replaySelection: 'BTTS Yes @2.20',
    replayOdds: null,
    replayStakePercent: 0,
    breakEvenRate: null,
    replayPnl: null,
    originalBetMarket: 'btts_yes',
    originalResult: 'win',
    decisionKind: 'no_bet',
    llmDecisionDiagnostic: 'policy_blocked',
    marketResolutionStatus: 'resolved',
    providerCoverageStatus: 'ok',
    replayContextStatus: 'ok',
    replayQualityAttribution: 'hard_policy_gate',
    replayWarnings: ['POLICY_BLOCK_MEDIUM_RISK_THIN_EDGE_GLOBAL'],
    ...partial,
  };
}

describe('buildReplayPolicyExperimentReport', () => {
  it('simulates the three configured policy pockets without changing runtime policy', () => {
    const report = buildReplayPolicyExperimentReport([
      row({ scenarioName: 'btts', recommendationId: 1 }),
      row({
        scenarioName: 'under-45',
        recommendationId: 2,
        minute: 80,
        score: '1-3',
        scoreState: 'two-plus-margin',
        minuteBand: '75+',
        canonicalMarket: 'under_4.5',
        originalBetMarket: 'under_4.5',
        replaySelection: 'Under 4.5 Goals @2.025',
      }),
      row({
        scenarioName: 'over-15',
        recommendationId: 3,
        minute: 61,
        score: '1-0',
        scoreState: 'one-goal-margin',
        minuteBand: '60-74',
        canonicalMarket: 'over_1.5',
        originalBetMarket: 'over_1.5',
        replaySelection: 'Over 1.5 Goals @1.55',
        replayQualityAttribution: 'model_policy_mismatch',
      }),
    ]);

    expect(report.trustedCounterfactualCandidates).toBe(3);
    expect(report.combined.selectedCount).toBe(3);
    expect(report.combined.winCount).toBe(3);
    expect(report.combined.totalStakedPercent).toBe(3);
    expect(report.combined.totalPnlPercent).toBe(2.775);
    expect(report.experiments.map((experiment) => experiment.selectedCount)).toEqual([1, 1, 1]);
  });

  it('keeps a policy-saved loss visible when it matches a configured pocket', () => {
    const report = buildReplayPolicyExperimentReport([
      row({
        scenarioName: 'under-45-loss',
        recommendationId: 4,
        minute: 82,
        score: '1-3',
        scoreState: 'two-plus-margin',
        minuteBand: '75+',
        canonicalMarket: 'under_4.5',
        originalBetMarket: 'under_4.5',
        replaySelection: 'Under 4.5 Goals @2.05',
        originalResult: 'loss',
      }),
    ]);

    expect(report.combined.selectedCount).toBe(1);
    expect(report.combined.lossCount).toBe(1);
    expect(report.combined.originalLossesReintroduced).toBe(1);
    expect(report.combined.totalPnlPercent).toBe(-1);
  });

  it('keeps the BTTS pocket shadow-only and limited to clean strong-prematch totals contexts', () => {
    const report = buildReplayPolicyExperimentReport([
      row({
        scenarioName: 'btts-clean-win',
        recommendationId: 5,
        prematchStrength: 'strong',
        marketAvailabilityBucket: 'totals_only',
      }),
      row({
        scenarioName: 'btts-moderate-loss',
        recommendationId: 6,
        prematchStrength: 'moderate',
        marketAvailabilityBucket: 'playable_side_market',
        originalResult: 'loss',
      }),
    ]);

    const bttsExperiment = report.experiments.find((experiment) => experiment.id === 'btts_yes_60_74_two_plus');

    expect(bttsExperiment?.selectedCount).toBe(1);
    expect(bttsExperiment?.selections.map((selection) => selection.scenarioName)).toEqual(['btts-clean-win']);
    expect(report.skippedPolicyBlockedSelections.map((selection) => selection.scenarioName)).toEqual([
      'btts-moderate-loss',
    ]);
    expect(report.skippedPolicyBlockedSelections[0]?.reason).toContain('prematchStrength=moderate');
    expect(report.skippedPolicyBlockedSelections[0]?.reason).toContain('marketAvailabilityBucket=playable_side_market');
    expect(report.skippedPolicyBlockedSelections[0]).toMatchObject({
      minute: 67,
      score: '0-2',
      originalResult: 'loss',
      odds: 2.2,
      replayQualityAttribution: 'hard_policy_gate',
      llmDecisionDiagnostic: 'policy_blocked',
      warnings: ['POLICY_BLOCK_MEDIUM_RISK_THIN_EDGE_GLOBAL'],
    });
    expect(report.combined.lossCount).toBe(0);
  });

  it('explains trusted skipped Over 1.5 selections outside the shadow minute band', () => {
    const report = buildReplayPolicyExperimentReport([
      row({
        scenarioName: 'late-over-15',
        recommendationId: 7,
        minute: 79,
        score: '0-1',
        scoreState: 'one-goal-margin',
        minuteBand: '75+',
        canonicalMarket: 'over_1.5',
        originalBetMarket: 'over_1.5',
        replaySelection: 'Over 1.5 Goals @2.00',
      }),
    ]);

    expect(report.combined.selectedCount).toBe(0);
    expect(report.skippedPolicyBlockedSelections).toMatchObject([
      {
        scenarioName: 'late-over-15',
        reason: expect.stringContaining('minuteBand=75+'),
      },
    ]);
  });

  it('skips untrusted blocked selections when replay market differs from original market', () => {
    const report = buildReplayPolicyExperimentReport([
      row({
        scenarioName: 'different-market',
        canonicalMarket: 'btts_yes',
        originalBetMarket: 'under_2.5',
        replaySelection: 'BTTS Yes @2.20',
      }),
    ]);

    expect(report.trustedCounterfactualCandidates).toBe(0);
    expect(report.combined.selectedCount).toBe(0);
    expect(report.skippedPolicyBlockedSelections).toEqual([]);
  });
});
