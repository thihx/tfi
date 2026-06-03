import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import {
  buildCurrentRuntimeNoSaveDiagnosticsReport,
  formatCurrentRuntimeNoSaveDiagnosticsMarkdown,
} from '../lib/current-runtime-no-save-diagnostics-report.js';

interface Args {
  lookbackHours: number;
  maxSamples: number;
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
    maxSamples: parsePositiveInt(readArg(argv, 'max-samples'), 50),
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
  const report = await buildCurrentRuntimeNoSaveDiagnosticsReport({
    lookbackHours: args.lookbackHours,
    maxSamples: args.maxSamples,
  });
  const json = JSON.stringify(report, null, 2);
  if (args.outJson) writeText(args.outJson, `${json}\n`);
  if (args.outMd) writeText(args.outMd, formatCurrentRuntimeNoSaveDiagnosticsMarkdown(report));
  console.log(json);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.stack || err.message : String(err));
  process.exitCode = 1;
});
