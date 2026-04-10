import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import {
  buildReplayVsOriginalReport,
  evaluatedCasesToCsv,
  loadEvalCasesPayload,
} from '../lib/replay-vs-original-analysis.js';

function parseArgs(argv: string[]): {
  casesJson: string;
  outJson?: string;
  outCsv?: string;
  csvVariantIndex: number;
} {
  let casesJson = '';
  let outJson: string | undefined;
  let outCsv: string | undefined;
  let csvVariantIndex = 0;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const n = argv[i + 1];
    if (a === '--cases-json' && n) {
      casesJson = resolve(process.cwd(), n);
      i++;
    } else if (a === '--out-json' && n) {
      outJson = resolve(process.cwd(), n);
      i++;
    } else if (a === '--out-csv' && n) {
      outCsv = resolve(process.cwd(), n);
      i++;
    } else if (a === '--csv-variant-index' && n) {
      csvVariantIndex = Math.max(0, Number(n) || 0);
      i++;
    }
  }
  if (!casesJson) {
    throw new Error(
      'Usage: tsx src/scripts/summarize-replay-vs-original.ts --cases-json <eval-cases.json> [--out-json <file>] [--out-csv <file>] [--csv-variant-index N]',
    );
  }
  return { casesJson, outJson, outCsv, csvVariantIndex };
}

function main(): void {
  const { casesJson, outJson, outCsv, csvVariantIndex } = parseArgs(process.argv.slice(2));
  const payload = loadEvalCasesPayload(readFileSync(casesJson, 'utf8'));
  const report = buildReplayVsOriginalReport(payload);
  if (outJson) {
    mkdirSync(dirname(outJson), { recursive: true });
    writeFileSync(outJson, JSON.stringify(report, null, 2));
  }
  if (outCsv) {
    const variant = payload.variants[csvVariantIndex];
    if (!variant) {
      throw new Error(`No variant at index ${csvVariantIndex}`);
    }
    mkdirSync(dirname(outCsv), { recursive: true });
    writeFileSync(outCsv, evaluatedCasesToCsv(variant.cases), 'utf8');
  }
  console.log(JSON.stringify(report, null, 2));
}

main();
