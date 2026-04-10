import { describe, expect, it } from 'vitest';
import { evaluateDataDrivenDeltaGates } from '../data-driven-replay-gates.js';
import type { ReplayVsOriginalSummary } from '../replay-vs-original-analysis.js';

function variant(partial: Partial<ReplayVsOriginalSummary>): ReplayVsOriginalSummary {
  return {
    promptVersion: 'v1',
    scenarioCount: 30,
    byOriginalResult: [],
    onOriginalDirectionalLoss: {
      total: 20,
      replayPushed: 10,
      replayWinAmongPushed: 6,
      replayLossAmongPushed: 4,
      replayAccAmongPushed: 0.6,
    },
    onOriginalDirectionalWin: {
      total: 10,
      replayPushed: 5,
      replayWinAmongPushed: 3,
      replayLossAmongPushed: 2,
    },
    ...partial,
  };
}

describe('evaluateDataDrivenDeltaGates', () => {
  it('passes when metrics meet thresholds', () => {
    const r = evaluateDataDrivenDeltaGates(
      {
        deltaPath: 'x',
        promptVersion: 'v1',
        minScenarios: 20,
        onOriginalDirectionalLoss: { minTotal: 10, minReplayPushed: 5, minAccuracyAmongPushed: 0.5 },
        onOriginalDirectionalWin: { minTotal: 5, minReplayPushed: 3, maxLossRateAmongPushed: 0.5 },
      },
      { variants: [variant({})] },
    );
    expect(r.ok).toBe(true);
  });

  it('fails when accuracy among loss-cohort pushes is too low', () => {
    const r = evaluateDataDrivenDeltaGates(
      {
        deltaPath: 'x',
        promptVersion: 'v1',
        onOriginalDirectionalLoss: { minAccuracyAmongPushed: 0.9 },
      },
      {
        variants: [
          variant({
            onOriginalDirectionalLoss: {
              total: 20,
              replayPushed: 10,
              replayWinAmongPushed: 2,
              replayLossAmongPushed: 8,
              replayAccAmongPushed: 0.2,
            },
          }),
        ],
      },
    );
    expect(r.ok).toBe(false);
    expect(r.failures.some((f) => f.includes('replayAccAmongPushed'))).toBe(true);
  });
});
