import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import type { HotspotReportPayload } from '../lib/replay-segment-hotspots.js';
import {
  buildSegmentPolicyActionPlan,
  type SegmentPolicyActionPlanOptions,
} from '../lib/segment-policy-action-plan.js';
import { loadEvalCasesPayload } from '../lib/replay-vs-original-analysis.js';

const argv = process.argv.slice(2);
const hi = argv.indexOf('--hotspots-json');
if (hi < 0 || !argv[hi + 1]) {
  console.error(
    'Usage: tsx build-segment-policy-action-plan.ts --hotspots-json <segment-hotspots.json> [--eval-cases-json <eval-cases.json>] [--out-json <file>] [--min-settled N] [--min-actionable N] [--block-accuracy X] [--block-roi X] [--cap-accuracy X] [--cap-roi X] [--stake-cap N] [--max-rows N]',
  );
  process.exit(1);
}

function numberArg(flag: string): number | undefined {
  const i = argv.indexOf(flag);
  if (i < 0 || !argv[i + 1]) return undefined;
  const value = Number(argv[i + 1]);
  return Number.isFinite(value) ? value : undefined;
}

const hotspotsPath = resolve(process.cwd(), argv[hi + 1]!);
const evalCasesIndex = argv.indexOf('--eval-cases-json');
const evalCasesPath = evalCasesIndex >= 0 && argv[evalCasesIndex + 1]
  ? resolve(process.cwd(), argv[evalCasesIndex + 1]!)
  : undefined;
const outIndex = argv.indexOf('--out-json');
const outJson = outIndex >= 0 && argv[outIndex + 1]
  ? resolve(process.cwd(), argv[outIndex + 1]!)
  : undefined;

const options: SegmentPolicyActionPlanOptions = {
  minSettledDirectional: numberArg('--min-settled'),
  minReplayActionable: numberArg('--min-actionable'),
  blockAccuracyAtOrBelow: numberArg('--block-accuracy'),
  blockRoiAtOrBelow: numberArg('--block-roi'),
  capAccuracyAtOrBelow: numberArg('--cap-accuracy'),
  capRoiAtOrBelow: numberArg('--cap-roi'),
  defaultStakeCapPercent: numberArg('--stake-cap'),
  maxRows: numberArg('--max-rows'),
};

const report = JSON.parse(readFileSync(hotspotsPath, 'utf8')) as HotspotReportPayload;
const evaluatedCases = evalCasesPath
  ? (loadEvalCasesPayload(readFileSync(evalCasesPath, 'utf8')).variants[0]?.cases ?? [])
  : undefined;
const plan = buildSegmentPolicyActionPlan(report, options, evaluatedCases);
const text = `${JSON.stringify(plan, null, 2)}\n`;

if (outJson) {
  mkdirSync(dirname(outJson), { recursive: true });
  writeFileSync(outJson, text, 'utf8');
}

process.stdout.write(text);
