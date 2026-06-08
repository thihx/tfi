import { existsSync, readFileSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import {
  evaluateRuntimePolicyShadowReadinessGates,
  type RuntimePolicyShadowReadinessGateConfig,
} from '../lib/runtime-policy-shadow-readiness-gates.js';
import type { RuntimePolicyShadowReport } from '../lib/runtime-policy-shadow-report.js';
import type { RuntimePolicyShadowSkippedReport } from '../lib/runtime-policy-shadow-skipped-report.js';
import type { RuntimePolicyShadowSettlementReport } from '../lib/runtime-policy-shadow-settlement-report.js';
import type { RuntimePolicyShadowSkippedSettlementReport } from '../lib/runtime-policy-shadow-skipped-settlement-report.js';

const SERVER_ROOT = resolve(process.cwd());

function readArg(argv: string[], name: string): string | null {
  const prefix = `--${name}=`;
  const inline = argv.find((arg) => arg.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const idx = argv.indexOf(`--${name}`);
  if (idx >= 0) return argv[idx + 1] ?? null;
  return null;
}

function resolvePath(path: string): string {
  return isAbsolute(path) ? path : resolve(SERVER_ROOT, path);
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(resolvePath(path), 'utf8')) as T;
}

function optionalReadJson<T>(path: string | undefined): T | undefined {
  if (!path) return undefined;
  const resolved = resolvePath(path);
  if (!existsSync(resolved)) {
    throw new Error(`Report not found: ${resolved}`);
  }
  return readJson<T>(resolved);
}

function main(): void {
  const configPath = resolvePath(readArg(process.argv.slice(2), 'config') ?? 'runtime-policy-shadow-readiness-gates.json');
  if (!existsSync(configPath)) {
    console.error(`[runtime-policy-shadow-readiness-gates] Config not found: ${configPath}`);
    process.exitCode = 1;
    return;
  }

  const config = readJson<RuntimePolicyShadowReadinessGateConfig>(configPath);
  const result = evaluateRuntimePolicyShadowReadinessGates(config, {
    matchedReport: optionalReadJson<RuntimePolicyShadowReport>(config.matchedReportPath),
    skippedReport: optionalReadJson<RuntimePolicyShadowSkippedReport>(config.skippedReportPath),
    matchedSettlement: optionalReadJson<RuntimePolicyShadowSettlementReport>(config.matchedSettlementReportPath),
    skippedSettlement: optionalReadJson<RuntimePolicyShadowSkippedSettlementReport>(config.skippedSettlementReportPath),
  });

  for (const candidate of result.candidates) {
    console.log(
      `[runtime-policy-shadow-readiness-gates] ${candidate.id}: status=${candidate.status} telemetry=${candidate.metrics.telemetryEvents} settled=${candidate.metrics.settledRows} roi=${candidate.metrics.roiOnStaked}`,
    );
    for (const reason of candidate.hardNoPromoteReasons) {
      console.error(`  - ${reason}`);
    }
  }

  if (result.ok) {
    console.log('[runtime-policy-shadow-readiness-gates] OK');
  } else {
    console.error('[runtime-policy-shadow-readiness-gates] FAILED');
    process.exitCode = 1;
  }
}

main();
