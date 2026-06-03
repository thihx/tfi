import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  evaluateReplayPolicyExperimentGates,
  type ReplayPolicyExperimentGateConfig,
} from '../lib/replay-policy-experiment-gates.js';
import type { ReplayPolicyExperimentReport } from '../lib/replay-policy-experiment.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SERVER_ROOT = resolve(__dirname, '../..');

function loadConfig(path: string): ReplayPolicyExperimentGateConfig {
  const j = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
  if (typeof j.policyExperimentPath !== 'string') {
    throw new Error('Config must include policyExperimentPath');
  }
  return j as unknown as ReplayPolicyExperimentGateConfig;
}

function parseArgs(argv: string[]): { configPath: string } {
  let configPath = resolve(SERVER_ROOT, 'replay-policy-experiment-gates.json');
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
    console.error(`[replay-policy-experiment-gates] Config not found: ${configPath}`);
    process.exit(1);
  }

  const config = loadConfig(configPath);
  const reportAbs = resolve(SERVER_ROOT, config.policyExperimentPath);
  if (!existsSync(reportAbs)) {
    console.error(`[replay-policy-experiment-gates] policyExperimentPath not found: ${reportAbs}`);
    process.exit(1);
  }

  const report = JSON.parse(readFileSync(reportAbs, 'utf8')) as ReplayPolicyExperimentReport;
  const result = evaluateReplayPolicyExperimentGates(config, report);
  const m = result.metrics;
  console.log(
    `[replay-policy-experiment-gates] total=${m.totalCases} trusted=${m.trustedCounterfactualCandidates} selected=${m.combinedSelectedCount} losses=${m.combinedLossCount} pnl=${m.combinedPnlPercent.toFixed(4)} roi=${m.combinedRoiOnStaked.toFixed(4)} rescued=${m.originalWinsRescued} reintroduced=${m.originalLossesReintroduced}`,
  );

  if (result.ok) {
    console.log('[replay-policy-experiment-gates] OK');
    process.exit(0);
  }

  console.error('[replay-policy-experiment-gates] FAILED:');
  for (const line of result.failures) console.error(`  - ${line}`);
  process.exit(1);
}

const isMainModule =
  process.argv[1] != null && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;
if (isMainModule) main();
