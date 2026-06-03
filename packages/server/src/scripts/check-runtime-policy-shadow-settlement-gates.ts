import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  evaluateRuntimePolicyShadowSettlementGates,
  type RuntimePolicyShadowSettlementGateConfig,
} from '../lib/runtime-policy-shadow-settlement-gates.js';
import type { RuntimePolicyShadowSettlementReport } from '../lib/runtime-policy-shadow-settlement-report.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SERVER_ROOT = resolve(__dirname, '../..');

function loadConfig(path: string): RuntimePolicyShadowSettlementGateConfig {
  const j = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
  if (typeof j.settlementReportPath !== 'string') {
    throw new Error('Config must include settlementReportPath');
  }
  return j as unknown as RuntimePolicyShadowSettlementGateConfig;
}

function parseArgs(argv: string[]): { configPath: string } {
  let configPath = resolve(SERVER_ROOT, 'runtime-policy-shadow-settlement-gates.json');
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
    console.error(`[runtime-policy-shadow-settlement-gates] Config not found: ${configPath}`);
    process.exit(1);
  }

  const config = loadConfig(configPath);
  const reportAbs = resolveMaybeRelativeToServer(config.settlementReportPath);
  if (!existsSync(reportAbs)) {
    console.error(`[runtime-policy-shadow-settlement-gates] settlementReportPath not found: ${reportAbs}`);
    process.exit(1);
  }

  const report = JSON.parse(readFileSync(reportAbs, 'utf8')) as RuntimePolicyShadowSettlementReport;
  const result = evaluateRuntimePolicyShadowSettlementGates(config, report);
  const m = result.metrics;
  console.log(
    `[runtime-policy-shadow-settlement-gates] total=${m.totalPocketRows} settled=${m.settledRows} unresolved=${m.unresolvedRows} settledRate=${m.settledRate.toFixed(4)} wins=${m.wins} losses=${m.losses} pnl=${m.totalPnlPercent.toFixed(4)} roi=${m.roiOnStaked.toFixed(4)}`,
  );

  if (result.ok) {
    console.log('[runtime-policy-shadow-settlement-gates] OK');
    process.exit(0);
  }

  console.error('[runtime-policy-shadow-settlement-gates] FAILED:');
  for (const line of result.failures) console.error(`  - ${line}`);
  process.exit(1);
}

const isMainModule =
  process.argv[1] != null && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;
if (isMainModule) main();
