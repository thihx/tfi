import { existsSync, readFileSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from '../config.js';
import { parseSegmentPolicyStakeCapJson } from './segment-policy-stake-cap.js';

const serverPackageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

let cached: ReadonlyMap<string, number> | undefined;

/** Lazy-read caps from `SEGMENT_POLICY_STAKE_CAP_PATH` (relative to packages/server if not absolute). */
export function getSegmentPolicyStakeCaps(): ReadonlyMap<string, number> {
  if (cached) return cached;
  const p = config.segmentPolicyStakeCapPath?.trim();
  if (!p) {
    cached = new Map();
    return cached;
  }
  const abs = isAbsolute(p) ? p : resolve(serverPackageRoot, p);
  if (!existsSync(abs)) {
    cached = new Map();
    return cached;
  }
  try {
    cached = parseSegmentPolicyStakeCapJson(readFileSync(abs, 'utf8'));
  } catch {
    cached = new Map();
  }
  return cached;
}
