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
  });
});
