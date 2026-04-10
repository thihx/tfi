import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { loadEvalCasesPayload } from '../lib/replay-vs-original-analysis.js';
import { buildHotspotReport } from '../lib/replay-segment-hotspots.js';

const argv = process.argv.slice(2);
const ij = argv.indexOf('--cases-json');
if (ij < 0 || !argv[ij + 1]) {
  console.error('Usage: tsx summarize-replay-segment-hotspots.ts --cases-json <file> [--variant-index 0] [--out-json <file>]');
  process.exit(1);
}
const casesJson = resolve(process.cwd(), argv[ij + 1]!);
let variantIndex = 0;
let outJson: string | undefined;
let minSettled = 5;
let minStaked = 5;
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--variant-index' && argv[i + 1]) variantIndex = Math.max(0, Number(argv[i + 1]) || 0);
  if (argv[i] === '--out-json' && argv[i + 1]) outJson = resolve(process.cwd(), argv[i + 1]!);
  if (argv[i] === '--min-settled' && argv[i + 1]) minSettled = Math.max(1, Number(argv[i + 1]) || 5);
  if (argv[i] === '--min-staked' && argv[i + 1]) minStaked = Math.max(1, Number(argv[i + 1]) || 5);
}
const payload = loadEvalCasesPayload(readFileSync(casesJson, 'utf8'));
const variant = payload.variants[variantIndex];
if (!variant) throw new Error(`No variant at index ${variantIndex}`);
const report = buildHotspotReport(variant.promptVersion, variant.cases, {
  minSettledForWorst: minSettled,
  minStakedForRoi: minStaked,
});
if (outJson) {
  mkdirSync(dirname(outJson), { recursive: true });
  writeFileSync(outJson, JSON.stringify(report, null, 2));
}
console.log(JSON.stringify(report, null, 2));
