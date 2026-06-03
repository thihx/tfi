import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  evaluateRecommendationSnapshotCoverageGates,
  type RecommendationSnapshotCoverageGateConfig,
} from '../lib/recommendation-snapshot-coverage-gates.js';
import type { RecommendationSnapshotCoverageReport } from '../lib/recommendation-snapshot-coverage.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SERVER_ROOT = resolve(__dirname, '../..');

function loadConfig(path: string): RecommendationSnapshotCoverageGateConfig {
  const j = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
  if (typeof j.coveragePath !== 'string') {
    throw new Error('Config must include coveragePath');
  }
  return j as unknown as RecommendationSnapshotCoverageGateConfig;
}

function parseArgs(argv: string[]): { configPath: string } {
  let configPath = resolve(SERVER_ROOT, 'recommendation-snapshot-coverage-gates.json');
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
    console.error(`[snapshot-coverage-gates] Config not found: ${configPath}`);
    process.exit(1);
  }

  const config = loadConfig(configPath);
  const coverageAbs = resolve(SERVER_ROOT, config.coveragePath);
  if (!existsSync(coverageAbs)) {
    console.error(`[snapshot-coverage-gates] coveragePath not found: ${coverageAbs}`);
    process.exit(1);
  }

  const report = JSON.parse(readFileSync(coverageAbs, 'utf8')) as RecommendationSnapshotCoverageReport;
  const result = evaluateRecommendationSnapshotCoverageGates(config, report);
  const m = result.metrics;
  console.log(
    `[snapshot-coverage-gates] exportEligible=${m.exportEligible} officialPrompt=${m.officialPrompt} currentRuntimeReady=${m.currentRuntimeReady}/${m.exportEligible} (${m.currentRuntimeReadyRate.toFixed(4)}) emptyDecisionContext=${m.emptyDecisionContext}/${m.exportEligible} (${m.emptyDecisionContextRate.toFixed(4)}) emptyPromptVersion=${m.emptyPromptVersion}/${m.exportEligible} nonOfficialPrompt=${m.nonOfficialPrompt}/${m.exportEligible}`,
  );

  if (result.ok) {
    console.log('[snapshot-coverage-gates] OK');
    process.exit(0);
  }

  console.error('[snapshot-coverage-gates] FAILED:');
  for (const line of result.failures) console.error(`  - ${line}`);
  process.exit(1);
}

const isMainModule =
  process.argv[1] != null && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;
if (isMainModule) main();
