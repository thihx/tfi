import { describe, expect, it } from 'vitest';
import { evaluateDataDrivenSegmentGates } from '../data-driven-segment-gates.js';
import type { HotspotReportPayload } from '../replay-segment-hotspots.js';

function report(partial: Partial<HotspotReportPayload>): HotspotReportPayload {
  return {
    generatedAt: new Date().toISOString(),
    promptVersion: 'v1',
    totalCases: 30,
    bySegment: [],
    worstAccuracy: [],
    worstRoi: [],
    ...partial,
  };
}

describe('evaluateDataDrivenSegmentGates', () => {
  it('passes when segment metrics meet thresholds', () => {
    const r = evaluateDataDrivenSegmentGates(
      {
        hotspotPath: 'x',
        promptVersion: 'v1',
        minTotalCases: 10,
        rules: [
          {
            segmentKey: '30-44::goals_under',
            minSettledDirectional: 3,
            minReplayAccuracy: 0.4,
            minReplayRoi: -0.1,
          },
        ],
      },
      report({
        bySegment: [
          {
            segmentKey: '30-44::goals_under',
            minuteBand: '30-44',
            marketFamily: 'goals_under',
            canonicalMarketTop: 'under_2.5',
            totalScenarios: 10,
            replayActionable: 8,
            settledDirectional: 6,
            replayWins: 4,
            replayLosses: 2,
            replayAccuracy: 2 / 3,
            totalReplayPnl: 1,
            totalReplayStaked: 10,
            replayRoi: 0.1,
            originalDirectionalLossCount: 0,
          },
        ],
      }),
    );
    expect(r.ok).toBe(true);
  });

  it('fails when replay accuracy is below rule minimum', () => {
    const r = evaluateDataDrivenSegmentGates(
      {
        hotspotPath: 'x',
        rules: [{ segmentKey: '30-44::goals_under', minReplayAccuracy: 0.9 }],
      },
      report({
        bySegment: [
          {
            segmentKey: '30-44::goals_under',
            minuteBand: '30-44',
            marketFamily: 'goals_under',
            canonicalMarketTop: 'under_2.5',
            totalScenarios: 10,
            replayActionable: 8,
            settledDirectional: 10,
            replayWins: 2,
            replayLosses: 8,
            replayAccuracy: 0.2,
            totalReplayPnl: -5,
            totalReplayStaked: 16,
            replayRoi: -0.3,
            originalDirectionalLossCount: 0,
          },
        ],
      }),
    );
    expect(r.ok).toBe(false);
    expect(r.failures.some((f) => f.includes('replayAccuracy'))).toBe(true);
  });

  it('fails when totalCases below minTotalCases', () => {
    const r = evaluateDataDrivenSegmentGates(
      { hotspotPath: 'x', minTotalCases: 100, rules: [] },
      report({ totalCases: 5 }),
    );
    expect(r.ok).toBe(false);
  });
});
