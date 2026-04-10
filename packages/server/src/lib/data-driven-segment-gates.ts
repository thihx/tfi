import type { HotspotReportPayload, SegmentHotspotRow } from './replay-segment-hotspots.js';

export interface DataDrivenSegmentGateRule {
  segmentKey: string;
  /** Require at least this many settled directional legs before checking accuracy/ROI. Default 5. */
  minSettledDirectional?: number;
  minReplayAccuracy?: number | null;
  minReplayRoi?: number | null;
}

export interface DataDrivenSegmentGateConfig {
  /** Path relative to packages/server or absolute (resolved in CLI). */
  hotspotPath: string;
  /** When set, must match `promptVersion` on the hotspot report. */
  promptVersion?: string;
  minTotalCases?: number;
  rules: DataDrivenSegmentGateRule[];
}

export interface DataDrivenSegmentGateResult {
  ok: boolean;
  failures: string[];
  report: HotspotReportPayload | null;
}

function findSegment(rows: SegmentHotspotRow[], key: string): SegmentHotspotRow | undefined {
  return rows.find((r) => r.segmentKey === key);
}

export function evaluateDataDrivenSegmentGates(
  config: DataDrivenSegmentGateConfig,
  report: HotspotReportPayload,
): DataDrivenSegmentGateResult {
  const failures: string[] = [];

  if (!report || typeof report !== 'object') {
    return { ok: false, failures: ['Invalid hotspot report'], report: null };
  }

  const wantPv = config.promptVersion?.trim();
  if (wantPv && report.promptVersion !== wantPv) {
    failures.push(`promptVersion mismatch: report=${report.promptVersion} config=${wantPv}`);
  }

  const minCases = config.minTotalCases ?? 1;
  if (report.totalCases < minCases) {
    failures.push(`totalCases ${report.totalCases} < minTotalCases ${minCases}`);
  }

  for (const rule of config.rules ?? []) {
    const key = String(rule.segmentKey || '').trim();
    if (!key) continue;
    const row = findSegment(report.bySegment, key);
    if (!row) {
      continue;
    }
    const minSettled = rule.minSettledDirectional ?? 5;
    if (row.settledDirectional < minSettled) {
      failures.push(
        `segment ${key}: settledDirectional ${row.settledDirectional} < minSettledDirectional ${minSettled} (thin segment)`,
      );
      continue;
    }
    if (rule.minReplayAccuracy != null && row.replayAccuracy < rule.minReplayAccuracy) {
      failures.push(
        `segment ${key}: replayAccuracy ${row.replayAccuracy.toFixed(4)} < minReplayAccuracy ${rule.minReplayAccuracy}`,
      );
    }
    if (rule.minReplayRoi != null && row.replayRoi < rule.minReplayRoi) {
      failures.push(`segment ${key}: replayRoi ${row.replayRoi.toFixed(4)} < minReplayRoi ${rule.minReplayRoi}`);
    }
  }

  return { ok: failures.length === 0, failures, report };
}
