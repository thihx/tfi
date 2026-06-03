import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import {
  buildRuntimePolicyShadowSkippedSettlementReport,
  formatRuntimePolicyShadowSkippedSettlementMarkdown,
} from '../lib/runtime-policy-shadow-skipped-settlement-report.js';

interface Args {
  lookbackDays: number;
  maxRows: number;
  stakePercent: number;
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

function parseNonNegativeNumber(raw: string | null, fallback: number): number {
  const n = Number(raw ?? fallback);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

function parseArgs(argv: string[]): Args {
  const outJson = readArg(argv, 'out-json');
  const outMd = readArg(argv, 'out-md');
  return {
    lookbackDays: parsePositiveInt(readArg(argv, 'lookback-days'), 30),
    maxRows: parsePositiveInt(readArg(argv, 'max-rows'), 1000),
    stakePercent: parseNonNegativeNumber(readArg(argv, 'stake-percent'), 1),
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
  const report = await buildRuntimePolicyShadowSkippedSettlementReport({
    lookbackDays: args.lookbackDays,
    maxRows: args.maxRows,
    stakePercent: args.stakePercent,
  });
  const json = JSON.stringify(report, null, 2);
  if (args.outJson) writeText(args.outJson, `${json}\n`);
  if (args.outMd) writeText(args.outMd, formatRuntimePolicyShadowSkippedSettlementMarkdown(report));
  console.log(json);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.stack || err.message : String(err));
  process.exitCode = 1;
});
