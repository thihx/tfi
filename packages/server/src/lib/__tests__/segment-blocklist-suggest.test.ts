import { describe, expect, it } from 'vitest';
import { suggestSegmentKeysFromHotspotReport } from '../segment-blocklist-suggest.js';
import type { HotspotReportPayload, SegmentHotspotRow } from '../replay-segment-hotspots.js';

function row(partial: Partial<SegmentHotspotRow>): SegmentHotspotRow {
  return {
    segmentKey: 'a::b',
    minuteBand: 'a',
    marketFamily: 'b',
    canonicalMarketTop: 'x',
    totalScenarios: 10,
    replayActionable: 8,
    settledDirectional: 6,
    replayWins: 3,
    replayLosses: 3,
    replayAccuracy: 0.5,
    totalReplayPnl: 0,
    totalReplayStaked: 10,
    replayRoi: 0,
    originalDirectionalLossCount: 0,
    ...partial,
  };
}

describe('suggestSegmentKeysFromHotspotReport', () => {
  it('unions worst-accuracy and worst-roi top slices', () => {
    const r: HotspotReportPayload = {
      generatedAt: '',
      promptVersion: 'v',
      totalCases: 1,
      bySegment: [],
      worstAccuracy: [row({ segmentKey: '30-44::goals_under' })],
      worstRoi: [row({ segmentKey: '75+::1x2' })],
    };
    const keys = suggestSegmentKeysFromHotspotReport(r, { worstAccuracyTop: 5, worstRoiTop: 5 });
    expect(keys.sort()).toEqual(['30-44::goals_under', '75+::1x2'].sort());
  });

  it('adds segments at or below maxReplayAccuracy', () => {
    const r: HotspotReportPayload = {
      generatedAt: '',
      promptVersion: 'v',
      totalCases: 1,
      bySegment: [
        row({ segmentKey: '00-29::goals_over', replayAccuracy: 0.2, settledDirectional: 10, replayActionable: 10 }),
        row({ segmentKey: '30-44::btts', replayAccuracy: 0.8, settledDirectional: 10, replayActionable: 10 }),
      ],
      worstAccuracy: [],
      worstRoi: [],
    };
    const keys = suggestSegmentKeysFromHotspotReport(r, {
      worstAccuracyTop: 0,
      worstRoiTop: 0,
      maxReplayAccuracy: 0.45,
      minSettledDirectional: 5,
    });
    expect(keys).toContain('00-29::goals_over');
    expect(keys).not.toContain('30-44::btts');
  });
});
