import { describe, expect, it } from 'vitest';
import type { EvaluatedReplayCase } from '../settled-replay-evaluation.js';
import { buildHotspotReport } from '../replay-segment-hotspots.js';

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

describe('buildHotspotReport', () => {
  it('merges two cases in the same minute band × market family segment', () => {
    const cases: EvaluatedReplayCase[] = [
      row({ recommendationId: 1, minuteBand: '30-44', actionable: true, directionalWin: true }),
      row({ recommendationId: 2, minuteBand: '30-44', actionable: true, directionalWin: false }),
    ];
    const r = buildHotspotReport('v-test', cases, { minSettledForWorst: 1, minStakedForRoi: 1 });
    expect(r.totalCases).toBe(2);
    expect(r.bySegment.length).toBeGreaterThanOrEqual(1);
    const seg30 = r.bySegment.find((s) => s.minuteBand === '30-44');
    expect(seg30?.totalScenarios).toBe(2);
    expect(seg30?.replayActionable).toBe(2);
    expect(seg30?.settledDirectional).toBe(2);
    expect(seg30?.replayWins).toBe(1);
    expect(seg30?.replayLosses).toBe(1);
  });
});
