import { describe, expect, it } from 'vitest';
import type { EvaluatedReplayCase } from '../settled-replay-evaluation.js';
import { summarizeReplayVsOriginalForVariant } from '../replay-vs-original-analysis.js';

function row(partial: Partial<EvaluatedReplayCase>): EvaluatedReplayCase {
  return {
    promptVersion: 'v-test',
    scenarioName: 's',
    recommendationId: 1,
    minute: 40,
    score: '1-0',
    scoreState: 'one-goal-margin',
    minuteBand: '30-44',
    prematchStrength: '',
    evidenceMode: '',
    marketAvailabilityBucket: '',
    shouldPush: true,
    actionable: true,
    canonicalMarket: 'under_2.5',
    goalsUnder: true,
    goalsOver: false,
    settlementResult: 'win',
    directionalWin: true,
    replaySelection: 'Under 2.5',
    replayOdds: 1.9,
    replayStakePercent: 2,
    breakEvenRate: null,
    replayPnl: 1.8,
    originalBetMarket: 'under_2.5',
    originalResult: 'loss',
    decisionKind: 'ai_push',
    llmDecisionDiagnostic: 'actionable',
    marketResolutionStatus: 'resolved',
    providerCoverageStatus: 'ok',
    replayContextStatus: 'ok',
    replayQualityAttribution: 'actionable',
    replayWarnings: [],
    ...partial,
  };
}

describe('summarizeReplayVsOriginalForVariant', () => {
  it('aggregates onOriginalDirectionalLoss when replay pushes', () => {
    const cases: EvaluatedReplayCase[] = [
      row({ recommendationId: 1, originalResult: 'loss', actionable: true, directionalWin: true }),
      row({ recommendationId: 2, originalResult: 'loss', actionable: true, directionalWin: false }),
      row({ recommendationId: 3, originalResult: 'loss', actionable: false, directionalWin: null }),
    ];
    const s = summarizeReplayVsOriginalForVariant(cases);
    expect(s.onOriginalDirectionalLoss.total).toBe(3);
    expect(s.onOriginalDirectionalLoss.replayPushed).toBe(2);
    expect(s.onOriginalDirectionalLoss.replayWinAmongPushed).toBe(1);
    expect(s.onOriginalDirectionalLoss.replayLossAmongPushed).toBe(1);
    expect(s.onOriginalDirectionalLoss.replayAccAmongPushed).toBe(0.5);
    expect(s.opportunityTradeoff.originalDirectionalLossCount).toBe(3);
    expect(s.opportunityTradeoff.originalDirectionalLossReplayed).toBe(2);
    expect(s.opportunityTradeoff.originalDirectionalLossAvoided).toBe(1);
    expect(s.opportunityTradeoff.originalDirectionalLossAvoidanceRate).toBe(0.3333);
  });

  it('reports original winner recall versus missed winners', () => {
    const cases: EvaluatedReplayCase[] = [
      row({ recommendationId: 1, originalResult: 'win', actionable: true, directionalWin: true }),
      row({ recommendationId: 2, originalResult: 'win', actionable: false, directionalWin: null }),
      row({ recommendationId: 3, originalResult: 'half_win', actionable: false, directionalWin: null }),
      row({ recommendationId: 4, originalResult: 'loss', actionable: false, directionalWin: null }),
    ];
    const s = summarizeReplayVsOriginalForVariant(cases);
    expect(s.opportunityTradeoff.originalDirectionalWinCount).toBe(3);
    expect(s.opportunityTradeoff.originalDirectionalWinReplayed).toBe(1);
    expect(s.opportunityTradeoff.originalDirectionalWinMissed).toBe(2);
    expect(s.opportunityTradeoff.originalDirectionalWinRecallRate).toBe(0.3333);
    expect(s.opportunityTradeoff.originalDirectionalWinMissRate).toBe(0.6667);
    expect(s.opportunityTradeoff.originalDirectionalLossAvoidanceRate).toBe(1);
  });
});
