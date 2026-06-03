import { describe, expect, it } from 'vitest';
import { buildSegmentPolicyActionPlan } from '../segment-policy-action-plan.js';
import type { HotspotReportPayload, SegmentHotspotRow } from '../replay-segment-hotspots.js';
import type { EvaluatedReplayCase } from '../settled-replay-evaluation.js';

function row(partial: Partial<SegmentHotspotRow>): SegmentHotspotRow {
  return {
    segmentKey: '30-44::goals_under',
    minuteBand: '30-44',
    marketFamily: 'goals_under',
    canonicalMarketTop: 'under_2.5',
    totalScenarios: 12,
    replayActionable: 8,
    settledDirectional: 6,
    replayWins: 3,
    replayLosses: 3,
    replayAccuracy: 0.5,
    totalReplayPnl: 0,
    totalReplayStaked: 10,
    replayRoi: 0,
    originalDirectionalLossCount: 3,
    ...partial,
  };
}

function report(rows: SegmentHotspotRow[]): HotspotReportPayload {
  return {
    generatedAt: '2026-06-02T00:00:00.000Z',
    promptVersion: 'v10-hybrid-legacy-g',
    totalCases: 30,
    bySegment: rows,
    worstAccuracy: [],
    worstRoi: [],
  };
}

function replayCase(partial: Partial<EvaluatedReplayCase>): EvaluatedReplayCase {
  return {
    promptVersion: 'v10-hybrid-legacy-g',
    scenarioName: 'case-1',
    recommendationId: 1,
    minute: 60,
    score: '1-1',
    scoreState: 'level',
    minuteBand: '60-74',
    prematchStrength: 'moderate',
    evidenceMode: 'full_live_data',
    marketAvailabilityBucket: 'totals_only',
    shouldPush: false,
    actionable: false,
    canonicalMarket: 'under_2.75',
    goalsUnder: false,
    goalsOver: false,
    settlementResult: null,
    directionalWin: null,
    replaySelection: 'Under 2.75 Goals @2.20',
    replayOdds: null,
    replayStakePercent: 0,
    breakEvenRate: null,
    replayPnl: null,
    originalBetMarket: 'under_2.75',
    originalResult: 'win',
    decisionKind: 'no_bet',
    llmDecisionDiagnostic: 'market_not_available_in_odds',
    marketResolutionStatus: 'odds_unavailable',
    providerCoverageStatus: 'provider_line_unavailable_or_stale',
    replayContextStatus: 'ok',
    replayQualityAttribution: 'provider_coverage',
    replayWarnings: ['ODDS_INVALID'],
    ...partial,
  };
}

describe('buildSegmentPolicyActionPlan', () => {
  it('promotes severe low-performing segments to blocklist candidates', () => {
    const plan = buildSegmentPolicyActionPlan(report([
      row({ segmentKey: '00-29::1x2', marketFamily: '1x2', replayAccuracy: 0.2, replayRoi: -0.4 }),
      row({ segmentKey: '60-74::goals_over', marketFamily: 'goals_over', replayAccuracy: 0.7, replayRoi: 0.2 }),
    ]));

    expect(plan.suggestedBlocklistJson.segmentKeys).toEqual(['00-29::1x2']);
    expect(plan.blocklistCandidates[0]?.reason).toContain('accuracy');
  });

  it('suggests stake caps for moderate weak segments without blocklisting them', () => {
    const plan = buildSegmentPolicyActionPlan(report([
      row({ segmentKey: '45-59::asian_handicap', marketFamily: 'asian_handicap', replayAccuracy: 0.45, replayRoi: -0.1 }),
    ]), {
      defaultStakeCapPercent: 1,
    });

    expect(plan.suggestedBlocklistJson.segmentKeys).toEqual([]);
    expect(plan.suggestedStakeCapJson.caps).toEqual({ '45-59::asian_handicap': 1 });
  });

  it('keeps production-loss replay-actionable segments in review candidates', () => {
    const plan = buildSegmentPolicyActionPlan(report([
      row({
        segmentKey: '75+::btts',
        marketFamily: 'btts',
        replayAccuracy: 0.8,
        replayRoi: 0.3,
        originalDirectionalLossCount: 6,
      }),
    ]));

    expect(plan.reviewCandidates[0]?.segmentKey).toBe('75+::btts');
    expect(plan.reviewCandidates[0]?.reason).toContain('production-loss');
  });

  it('reports replay quality blockers even when no segment action is safe yet', () => {
    const plan = buildSegmentPolicyActionPlan(report([]), undefined, [
      replayCase({
        scenarioName: 'missing-line',
        replayContextStatus: 'memory_no_history',
        replayWarnings: ['ODDS_INVALID', 'MEMORY_FLAG_NO_HISTORY'],
      }),
      replayCase({
        scenarioName: 'policy-blocked',
        canonicalMarket: 'over_3.5',
        replaySelection: 'Over 3.5 Goals @1.78',
        llmDecisionDiagnostic: 'policy_blocked',
        marketResolutionStatus: 'resolved',
        providerCoverageStatus: 'ok',
        replayContextStatus: 'memory_no_history',
        replayQualityAttribution: 'hard_policy_gate',
        replayWarnings: ['REQUIRED_CONDITIONS_NOT_MET', 'MEMORY_FLAG_NO_HISTORY'],
      }),
    ]);

    expect(plan.blocklistCandidates).toEqual([]);
    expect(plan.qualityBlockers.byMarketResolutionStatus).toContainEqual({ key: 'odds_unavailable', count: 1 });
    expect(plan.qualityBlockers.byLlmDecisionDiagnostic).toContainEqual({ key: 'policy_blocked', count: 1 });
    expect(plan.qualityBlockers.byReplayQualityAttribution).toContainEqual({ key: 'provider_coverage', count: 1 });
    expect(plan.qualityBlockers.byReplayQualityAttribution).toContainEqual({ key: 'hard_policy_gate', count: 1 });
    expect(plan.qualityBlockers.byReplayContextStatus).toContainEqual({ key: 'memory_no_history', count: 2 });
    expect(plan.qualityBlockers.topWarnings).toContainEqual({ key: 'MEMORY_FLAG_NO_HISTORY', count: 2 });
    expect(plan.qualityBlockers.topHardPolicyWarnings).toContainEqual({ key: 'REQUIRED_CONDITIONS_NOT_MET', count: 1 });
    expect(plan.qualityBlockers.topHardPolicyWarnings).not.toContainEqual({ key: 'MEMORY_FLAG_NO_HISTORY', count: 2 });
    expect(plan.qualityBlockers.unresolvedMarketExamples[0]?.scenarioName).toBe('missing-line');
    expect(plan.qualityBlockers.providerCoverageGroups[0]).toEqual(expect.objectContaining({
      groupKey: 'under_2.75::60-74',
      canonicalMarket: 'under_2.75',
      marketFamily: 'goals_under',
      count: 1,
    }));
    expect(plan.qualityBlockers.policyWarningExamples[0]?.scenarioName).toBe('policy-blocked');
    expect(plan.qualityBlockers.modelSelectedPolicyBlocked.total).toBe(1);
    expect(plan.qualityBlockers.modelSelectedPolicyBlocked.examples[0]).toEqual(expect.objectContaining({
      scenarioName: 'policy-blocked',
      originalResult: 'win',
      replayQualityAttribution: 'hard_policy_gate',
    }));
  });

  it('summarizes opportunity recall, loss avoidance, and narrow rescue candidates', () => {
    const plan = buildSegmentPolicyActionPlan(report([]), undefined, [
      replayCase({
        scenarioName: 'late-under-45-rescue',
        minute: 80,
        score: '1-3',
        scoreState: 'two-plus-margin',
        minuteBand: '75+',
        evidenceMode: 'full_live_data',
        canonicalMarket: 'under_4.5',
        replaySelection: 'Under 4.5 Goals @2.025',
        replayOdds: null,
        breakEvenRate: null,
        llmDecisionDiagnostic: 'policy_blocked',
        marketResolutionStatus: 'resolved',
        providerCoverageStatus: 'ok',
        replayContextStatus: 'ok',
        replayQualityAttribution: 'model_policy_mismatch',
        replayWarnings: ['POLICY_BLOCK_GOALS_UNDER_THIN_CUSHION_LOW_CONF_GLOBAL'],
      }),
      replayCase({
        scenarioName: 'btts-rescue',
        score: '0-2',
        scoreState: 'two-plus-margin',
        minuteBand: '60-74',
        evidenceMode: 'full_live_data',
        canonicalMarket: 'btts_yes',
        originalBetMarket: 'btts_yes',
        replaySelection: 'BTTS Yes @2.20',
        llmDecisionDiagnostic: 'policy_blocked',
        marketResolutionStatus: 'resolved',
        providerCoverageStatus: 'ok',
        replayContextStatus: 'ok',
        replayQualityAttribution: 'hard_policy_gate',
        replayWarnings: ['POLICY_BLOCK_MEDIUM_RISK_THIN_EDGE_GLOBAL'],
      }),
      replayCase({
        scenarioName: 'over-15-rescue',
        score: '1-0',
        scoreState: 'one-goal-margin',
        minuteBand: '60-74',
        evidenceMode: 'full_live_data',
        canonicalMarket: 'over_1.5',
        originalBetMarket: 'over_1.5',
        replaySelection: 'Over 1.5 Goals @1.55',
        llmDecisionDiagnostic: 'policy_blocked',
        marketResolutionStatus: 'resolved',
        providerCoverageStatus: 'ok',
        replayContextStatus: 'ok',
        replayQualityAttribution: 'model_policy_mismatch',
        replayWarnings: ['OVER_1_5_BLOCKED_LATE_MIDGAME'],
      }),
      replayCase({
        scenarioName: 'pre-llm-preserved',
        originalResult: 'win',
        llmDecisionDiagnostic: 'pre_llm_blocked',
        replayQualityAttribution: 'pre_llm_blocked',
        replayWarnings: [],
      }),
      replayCase({
        scenarioName: 'original-loss-not-opportunity',
        originalResult: 'loss',
        llmDecisionDiagnostic: 'pre_llm_blocked',
        replayQualityAttribution: 'pre_llm_blocked',
      }),
      replayCase({
        scenarioName: 'policy-saved-loss',
        originalResult: 'loss',
        canonicalMarket: 'under_2.5',
        replaySelection: 'Under 2.5 Goals @1.70',
        llmDecisionDiagnostic: 'policy_blocked',
        marketResolutionStatus: 'resolved',
        providerCoverageStatus: 'ok',
        replayContextStatus: 'ok',
        replayQualityAttribution: 'model_policy_mismatch',
        replayWarnings: ['POLICY_BLOCK_GOALS_UNDER_THIN_CUSHION_LOW_CONF_GLOBAL'],
      }),
    ]);

    expect(plan.qualityBlockers.opportunityRecall.originalWinCount).toBe(4);
    expect(plan.qualityBlockers.opportunityRecall.originalWinMissedCount).toBe(4);
    expect(plan.qualityBlockers.opportunityRecall.originalLossCount).toBe(2);
    expect(plan.qualityBlockers.opportunityRecall.originalLossAvoidedCount).toBe(2);
    expect(plan.qualityBlockers.opportunityRecall.originalLossAvoidanceRate).toBe(1);
    expect(plan.qualityBlockers.opportunityRecall.candidateRescueCount).toBe(3);
    expect(plan.qualityBlockers.opportunityRecall.byReplayQualityAttribution).toContainEqual({
      key: 'model_policy_mismatch',
      count: 2,
    });
    expect(plan.qualityBlockers.opportunityRecall.preservedNoBetReasons).toContainEqual({
      key: 'pre_llm_firewall_or_low_evidence',
      count: 1,
    });
    expect(plan.qualityBlockers.opportunityRecall.candidateRescueExamples[0]?.scenarioName).toBe('late-under-45-rescue');
    expect(plan.qualityBlockers.opportunityRecall.candidateRescueExamples.map((row) => row.scenarioName))
      .toEqual(['late-under-45-rescue', 'btts-rescue', 'over-15-rescue']);
    expect(plan.qualityBlockers.opportunityRecall.preservedNoBetExamples[0]?.scenarioName).toBe('pre-llm-preserved');
    expect(plan.qualityBlockers.modelSelectedPolicyBlocked.total).toBe(4);
    expect(plan.qualityBlockers.modelSelectedPolicyBlocked.originalWinCount).toBe(3);
    expect(plan.qualityBlockers.modelSelectedPolicyBlocked.originalLossCount).toBe(1);
    expect(plan.qualityBlockers.modelSelectedPolicyBlocked.byMarketFamily).toContainEqual({ key: 'btts', count: 1 });
    expect(plan.qualityBlockers.modelSelectedPolicyBlocked.examples.map((row) => row.scenarioName))
      .toEqual(['late-under-45-rescue', 'btts-rescue', 'over-15-rescue', 'policy-saved-loss']);
  });
});
