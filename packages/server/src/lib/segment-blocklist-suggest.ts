import type { HotspotReportPayload, SegmentHotspotRow } from './replay-segment-hotspots.js';

export interface SuggestSegmentBlocklistOptions {
  /** Extra segments: accuracy at or below this (requires minSettledDirectional). */
  maxReplayAccuracy?: number | null;
  /** Extra segments: ROI at or below this (requires minReplayActionable and staked > 0 for meaningful ROI). */
  maxReplayRoi?: number | null;
  minSettledDirectional?: number;
  minReplayActionable?: number;
  /** Union in first N rows from report.worstAccuracy (already volume-filtered). */
  worstAccuracyTop?: number;
  /** Union in first N rows from report.worstRoi. */
  worstRoiTop?: number;
}

function rowEligible(row: SegmentHotspotRow, minSettled: number, minActionable: number): boolean {
  return row.replayActionable >= minActionable && row.settledDirectional >= minSettled;
}

/**
 * Derive `segmentKey` candidates for `segment-policy-blocklist.json` from a hotspot report.
 * Uses union of optional threshold cuts plus top-N worst lists embedded in the report.
 */
export function suggestSegmentKeysFromHotspotReport(
  report: HotspotReportPayload,
  options?: SuggestSegmentBlocklistOptions,
): string[] {
  const minSettled = options?.minSettledDirectional ?? 5;
  const minActionable = options?.minReplayActionable ?? 1;
  const accTop = options?.worstAccuracyTop ?? 0;
  const roiTop = options?.worstRoiTop ?? 0;
  const maxAcc = options?.maxReplayAccuracy;
  const maxRoi = options?.maxReplayRoi;

  const keys = new Set<string>();

  if (accTop > 0) {
    for (const row of report.worstAccuracy.slice(0, accTop)) {
      keys.add(row.segmentKey);
    }
  }
  if (roiTop > 0) {
    for (const row of report.worstRoi.slice(0, roiTop)) {
      keys.add(row.segmentKey);
    }
  }

  for (const row of report.bySegment) {
    if (!rowEligible(row, minSettled, minActionable)) continue;
    if (maxAcc != null && row.replayAccuracy <= maxAcc) {
      keys.add(row.segmentKey);
    }
    if (maxRoi != null && row.totalReplayStaked > 0 && row.replayRoi <= maxRoi) {
      keys.add(row.segmentKey);
    }
  }

  return [...keys].sort();
}
