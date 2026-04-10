export interface SegmentPolicyStakeCapFile {
  /** Max stake percent per `minuteBand::marketFamily` (same keys as segment blocklist). */
  caps?: Record<string, number>;
}

export function parseSegmentPolicyStakeCapJson(raw: string): Map<string, number> {
  const j = JSON.parse(raw) as SegmentPolicyStakeCapFile;
  const caps = j.caps && typeof j.caps === 'object' ? j.caps : {};
  const map = new Map<string, number>();
  for (const [k, v] of Object.entries(caps)) {
    const key = String(k).trim();
    const n = Number(v);
    if (!key || !Number.isFinite(n) || n < 0) continue;
    map.set(key, n);
  }
  return map;
}
