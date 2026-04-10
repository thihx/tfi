import { getReplayMinuteBand, classifyReplayMarketFamily } from './settled-replay-evaluation.js';

/** Same key shape as `segmentKey` in segment hotspot reports (`minuteBand::marketFamily`). */
export function buildRecommendationSegmentKey(minute: number, canonicalMarket: string): string {
  return `${getReplayMinuteBand(minute)}::${classifyReplayMarketFamily(canonicalMarket)}`;
}

export interface SegmentPolicyBlocklistFile {
  segmentKeys?: string[];
}

export function parseSegmentPolicyBlocklistJson(raw: string): Set<string> {
  const j = JSON.parse(raw) as SegmentPolicyBlocklistFile;
  const keys = Array.isArray(j.segmentKeys) ? j.segmentKeys : [];
  return new Set(keys.map((k) => String(k).trim()).filter(Boolean));
}
