import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import type { HotspotReportPayload } from '../lib/replay-segment-hotspots.js';
import { suggestSegmentKeysFromHotspotReport } from '../lib/segment-blocklist-suggest.js';

const argv = process.argv.slice(2);
const hi = argv.indexOf('--hotspots-json');
if (hi < 0 || !argv[hi + 1]) {
  console.error(
    'Usage: tsx suggest-segment-policy-blocklist.ts --hotspots-json <segment-hotspots.json> [--worst-accuracy-top N] [--worst-roi-top N] [--max-accuracy X] [--max-roi X] [--min-settled N] [--out-json <file>]',
  );
  process.exit(1);
}

const hotspotsPath = resolve(process.cwd(), argv[hi + 1]!);
let worstAccuracyTop = 8;
let worstRoiTop = 8;
let maxAccuracy: number | null = null;
let maxRoi: number | null = null;
let minSettled = 5;
let minActionable = 1;
let outJson: string | undefined;

for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--worst-accuracy-top' && argv[i + 1]) {
    worstAccuracyTop = Math.max(0, Number(argv[i + 1]) || 0);
    i++;
  } else if (argv[i] === '--worst-roi-top' && argv[i + 1]) {
    worstRoiTop = Math.max(0, Number(argv[i + 1]) || 0);
    i++;
  } else if (argv[i] === '--max-accuracy' && argv[i + 1]) {
    maxAccuracy = Number(argv[i + 1]);
    i++;
  } else if (argv[i] === '--max-roi' && argv[i + 1]) {
    maxRoi = Number(argv[i + 1]);
    i++;
  } else if (argv[i] === '--min-settled' && argv[i + 1]) {
    minSettled = Math.max(1, Number(argv[i + 1]) || 5);
    i++;
  } else if (argv[i] === '--min-actionable' && argv[i + 1]) {
    minActionable = Math.max(1, Number(argv[i + 1]) || 1);
    i++;
  } else if (argv[i] === '--out-json' && argv[i + 1]) {
    outJson = resolve(process.cwd(), argv[i + 1]!);
    i++;
  }
}

const report = JSON.parse(readFileSync(hotspotsPath, 'utf8')) as HotspotReportPayload;
const segmentKeys = suggestSegmentKeysFromHotspotReport(report, {
  worstAccuracyTop,
  worstRoiTop,
  maxReplayAccuracy: maxAccuracy,
  maxReplayRoi: maxRoi,
  minSettledDirectional: minSettled,
  minReplayActionable: minActionable,
});

const payload = { segmentKeys };
const text = `${JSON.stringify(payload, null, 2)}\n`;
if (outJson) {
  mkdirSync(dirname(outJson), { recursive: true });
  writeFileSync(outJson, text, 'utf8');
}
process.stdout.write(text);
