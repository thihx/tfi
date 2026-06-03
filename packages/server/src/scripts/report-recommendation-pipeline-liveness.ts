import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import {
  buildRecommendationPipelineLivenessReport,
  formatRecommendationPipelineLivenessMarkdown,
} from '../lib/recommendation-pipeline-liveness-report.js';

interface Args {
  lookbackHours: number;
  maxRecentRows: number;
  jobName: string;
  outJson?: string;
  outMd?: string;
}

function readArg(argv: string[], name: string): string | null {
  const prefix = `--${name}=`;
  const inline = argv.find((arg) => arg.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const idx = argv.indexOf(`--${name}`);
  if (idx >= 0) return argv[idx + 1] ?? null;
  return null;
}

function parsePositiveInt(raw: string | null, fallback: number): number {
  const n = Number(raw ?? fallback);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

function parseArgs(argv: string[]): Args {
  const outJson = readArg(argv, 'out-json');
  const outMd = readArg(argv, 'out-md');
  return {
    lookbackHours: parsePositiveInt(readArg(argv, 'lookback-hours'), 336),
    maxRecentRows: parsePositiveInt(readArg(argv, 'max-recent-rows'), 25),
    jobName: readArg(argv, 'job-name') || 'check-live-trigger',
    outJson: outJson ? resolve(process.cwd(), outJson) : undefined,
    outMd: outMd ? resolve(process.cwd(), outMd) : undefined,
  };
}

function writeText(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text, 'utf8');
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const report = await buildRecommendationPipelineLivenessReport({
    lookbackHours: args.lookbackHours,
    maxRecentRows: args.maxRecentRows,
    jobName: args.jobName,
  });
  const json = JSON.stringify(report, null, 2);
  if (args.outJson) writeText(args.outJson, `${json}\n`);
  if (args.outMd) writeText(args.outMd, formatRecommendationPipelineLivenessMarkdown(report));
  console.log(json);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.stack || err.message : String(err));
  process.exitCode = 1;
});
