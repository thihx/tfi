import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { buildRecommendationSnapshotCoverageReport } from '../lib/recommendation-snapshot-coverage.js';

function parseArgs(argv: string[]): { lookbackDays: number; outJson?: string } {
  let lookbackDays = 90;
  let outJson: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const n = argv[i + 1];
    if (a === '--lookback-days' && n) {
      lookbackDays = Math.max(1, Number(n) || 90);
      i++;
      continue;
    }
    if (a === '--out-json' && n) {
      outJson = resolve(process.cwd(), n);
      i++;
      continue;
    }
  }
  return { lookbackDays, outJson };
}

async function main(): Promise<void> {
  const { lookbackDays, outJson } = parseArgs(process.argv.slice(2));
  const report = await buildRecommendationSnapshotCoverageReport(lookbackDays);
  if (outJson) {
    mkdirSync(dirname(outJson), { recursive: true });
    writeFileSync(outJson, JSON.stringify(report, null, 2));
  }
  console.log(JSON.stringify(report, null, 2));
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
