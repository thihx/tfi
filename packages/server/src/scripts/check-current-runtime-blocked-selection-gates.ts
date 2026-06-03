import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  evaluateCurrentRuntimeBlockedSelectionGates,
  type CurrentRuntimeBlockedSelectionGateConfig,
} from '../lib/current-runtime-blocked-selection-gates.js';
import type { CurrentRuntimeBlockedSelectionReview } from '../lib/current-runtime-blocked-selection-review.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SERVER_ROOT = resolve(__dirname, '../..');

function loadConfig(path: string): CurrentRuntimeBlockedSelectionGateConfig {
  const j = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
  if (typeof j.blockedSelectionReportPath !== 'string') {
    throw new Error('Config must include blockedSelectionReportPath');
  }
  return j as unknown as CurrentRuntimeBlockedSelectionGateConfig;
}

function parseArgs(argv: string[]): { configPath: string } {
  let configPath = resolve(SERVER_ROOT, 'current-runtime-blocked-selection-gates.json');
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--config' && argv[i + 1]) {
      configPath = resolve(process.cwd(), argv[i + 1]!);
      i++;
    }
  }
  return { configPath };
}

function resolveMaybeRelativeToServer(path: string): string {
  return resolve(SERVER_ROOT, path);
}

function main(): void {
  const { configPath } = parseArgs(process.argv.slice(2));
  if (!existsSync(configPath)) {
    console.error(`[current-runtime-blocked-selection-gates] Config not found: ${configPath}`);
    process.exit(1);
  }

  const config = loadConfig(configPath);
  const reportAbs = resolveMaybeRelativeToServer(config.blockedSelectionReportPath);
  if (!existsSync(reportAbs)) {
    console.error(`[current-runtime-blocked-selection-gates] blockedSelectionReportPath not found: ${reportAbs}`);
    process.exit(1);
  }

  const report = JSON.parse(readFileSync(reportAbs, 'utf8')) as CurrentRuntimeBlockedSelectionReview;
  const result = evaluateCurrentRuntimeBlockedSelectionGates(config, report);
  const m = result.metrics;
  console.log(
    `[current-runtime-blocked-selection-gates] total=${m.totalSelections} settled=${m.settledRows} unresolved=${m.unresolvedRows} settledRate=${m.settledRate.toFixed(4)} wins=${m.wins} losses=${m.losses} pnl=${m.totalPnlPercent.toFixed(4)} roi=${m.roiOnStaked.toFixed(4)}`,
  );

  if (result.ok) {
    console.log('[current-runtime-blocked-selection-gates] OK');
    process.exit(0);
  }

  console.error('[current-runtime-blocked-selection-gates] FAILED:');
  for (const line of result.failures) console.error(`  - ${line}`);
  process.exit(1);
}

const isMainModule =
  process.argv[1] != null && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;
if (isMainModule) main();
