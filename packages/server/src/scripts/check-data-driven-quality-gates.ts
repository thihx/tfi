import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  evaluateDataDrivenQualityGates,
  type DataDrivenQualityGateConfig,
} from '../lib/data-driven-quality-gates.js';
import type { SegmentPolicyActionPlan } from '../lib/segment-policy-action-plan.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SERVER_ROOT = resolve(__dirname, '../..');

function loadConfig(path: string): DataDrivenQualityGateConfig {
  const j = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
  if (typeof j.actionPlanPath !== 'string') {
    throw new Error('Config must include actionPlanPath');
  }
  return j as unknown as DataDrivenQualityGateConfig;
}

function parseArgs(argv: string[]): { configPath: string } {
  let configPath = resolve(SERVER_ROOT, 'data-driven-quality-gates.json');
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
    console.error(`[data-driven-quality-gates] Config not found: ${configPath}`);
    process.exit(1);
  }

  const config = loadConfig(configPath);
  const actionPlanAbs = resolve(SERVER_ROOT, config.actionPlanPath);
  if (!existsSync(actionPlanAbs)) {
    console.error(`[data-driven-quality-gates] actionPlanPath not found: ${actionPlanAbs}`);
    process.exit(1);
  }

  const actionPlan = JSON.parse(readFileSync(actionPlanAbs, 'utf8')) as SegmentPolicyActionPlan;
  const result = evaluateDataDrivenQualityGates(config, actionPlan);
  const m = result.metrics;
  console.log(
    `[data-driven-quality-gates] ${actionPlan.promptVersion}: total=${m.totalCases} providerCoverage=${m.providerCoverageCount}/${m.totalCases} (${m.providerCoverageRate.toFixed(4)}) replayContextGap=${m.replayContextGapCount}/${m.totalCases} hardPolicyGate=${m.hardPolicyGateCount}/${m.totalCases} modelPolicyMismatch=${m.modelPolicyMismatchCount}/${m.totalCases} emptyDiagnostic=${m.emptyLlmDecisionDiagnosticCount}/${m.totalCases} emptyMarketResolution=${m.emptyMarketResolutionStatusCount}/${m.totalCases}`,
  );

  if (result.ok) {
    console.log('[data-driven-quality-gates] OK');
    process.exit(0);
  }

  console.error('[data-driven-quality-gates] FAILED:');
  for (const line of result.failures) console.error(`  - ${line}`);
  process.exit(1);
}

const isMainModule =
  process.argv[1] != null && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;
if (isMainModule) main();
