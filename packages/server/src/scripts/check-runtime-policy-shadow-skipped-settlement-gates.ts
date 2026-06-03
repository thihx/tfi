import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  evaluateRuntimePolicyShadowSkippedSettlementGates,
  type RuntimePolicyShadowSkippedSettlementGateConfig,
} from '../lib/runtime-policy-shadow-skipped-settlement-gates.js';
import type { RuntimePolicyShadowSkippedSettlementReport } from '../lib/runtime-policy-shadow-skipped-settlement-report.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SERVER_ROOT = resolve(__dirname, '../..');

function loadConfig(path: string): RuntimePolicyShadowSkippedSettlementGateConfig {
  const j = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
  if (typeof j.skippedSettlementReportPath !== 'string') {
    throw new Error('Config must include skippedSettlementReportPath');
  }
  return j as unknown as RuntimePolicyShadowSkippedSettlementGateConfig;
}

function parseArgs(argv: string[]): { configPath: string } {
  let configPath = resolve(SERVER_ROOT, 'runtime-policy-shadow-skipped-settlement-gates.json');
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--config' && argv[i + 1]) {
      configPath = resolve(process.cwd(), argv[i + 1]!);
      i++;
    }
  }
  return { configPath };
}

function main(): void {
  const { configPath } = parseArgs(process.argv.slice(2));
  if (!existsSync(configPath)) {
    console.error(`[runtime-policy-shadow-skipped-settlement-gates] Config not found: ${configPath}`);
    process.exit(1);
  }

  const config = loadConfig(configPath);
  const reportAbs = resolve(SERVER_ROOT, config.skippedSettlementReportPath);
  if (!existsSync(reportAbs)) {
    console.error(`[runtime-policy-shadow-skipped-settlement-gates] skippedSettlementReportPath not found: ${reportAbs}`);
    process.exit(1);
  }

  const report = JSON.parse(readFileSync(reportAbs, 'utf8')) as RuntimePolicyShadowSkippedSettlementReport;
  const result = evaluateRuntimePolicyShadowSkippedSettlementGates(config, report);
  const m = result.metrics;
  console.log(
    `[runtime-policy-shadow-skipped-settlement-gates] total=${m.totalEvents} settled=${m.settledRows} unresolved=${m.unresolvedRows} settledRate=${m.settledRate.toFixed(4)} wins=${m.wins} losses=${m.losses} pnl=${m.totalPnlPercent.toFixed(4)} roi=${m.roiOnStaked.toFixed(4)}`,
  );

  if (result.ok) {
    console.log('[runtime-policy-shadow-skipped-settlement-gates] OK');
    process.exit(0);
  }

  console.error('[runtime-policy-shadow-skipped-settlement-gates] FAILED:');
  for (const line of result.failures) console.error(`  - ${line}`);
  process.exit(1);
}

const isMainModule =
  process.argv[1] != null && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;
if (isMainModule) main();
