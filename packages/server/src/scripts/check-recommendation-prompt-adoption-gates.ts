import { existsSync, readFileSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  evaluateRecommendationPromptAdoptionGates,
  type RecommendationPromptAdoptionGateConfig,
} from '../lib/recommendation-prompt-adoption-gates.js';
import type { RecommendationPromptAdoptionReport } from '../lib/recommendation-prompt-adoption-report.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SERVER_ROOT = resolve(__dirname, '../..');

function loadConfig(path: string): RecommendationPromptAdoptionGateConfig {
  const parsed = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
  if (typeof parsed.adoptionPath !== 'string') {
    throw new Error('Config must include adoptionPath');
  }
  return parsed as unknown as RecommendationPromptAdoptionGateConfig;
}

function parseArgs(argv: string[]): { configPath: string } {
  let configPath = resolve(SERVER_ROOT, 'recommendation-prompt-adoption-gates.json');
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--config' && argv[i + 1]) {
      configPath = resolve(process.cwd(), argv[i + 1]!);
      i++;
    }
  }
  return { configPath };
}

function resolveFromServerRoot(path: string): string {
  return isAbsolute(path) ? path : resolve(SERVER_ROOT, path);
}

function main(): void {
  const { configPath } = parseArgs(process.argv.slice(2));
  if (!existsSync(configPath)) {
    console.error(`[prompt-adoption-gates] Config not found: ${configPath}`);
    process.exit(1);
  }

  const config = loadConfig(configPath);
  const adoptionAbs = resolveFromServerRoot(config.adoptionPath);
  if (!existsSync(adoptionAbs)) {
    console.error(`[prompt-adoption-gates] adoptionPath not found: ${adoptionAbs}`);
    process.exit(1);
  }

  const report = JSON.parse(readFileSync(adoptionAbs, 'utf8')) as RecommendationPromptAdoptionReport;
  const result = evaluateRecommendationPromptAdoptionGates(config, report);
  const m = result.metrics;
  console.log(
    `[prompt-adoption-gates] total=${m.totalRows} actionable=${m.actionableRows} official=${m.officialPromptRows}/${m.totalRows} (${m.officialPromptRate.toFixed(4)}) officialWithDecisionContext=${m.officialPromptWithDecisionContext}/${m.totalRows} (${m.officialPromptWithDecisionContextRate.toFixed(4)}) nonOfficial=${m.nonOfficialPromptRows}/${m.totalRows} emptyPrompt=${m.emptyPromptVersionRows}/${m.totalRows} emptyDecisionContext=${m.emptyDecisionContextRows}/${m.totalRows} latestRowAgeHours=${m.latestRowAgeHours ?? '(missing)'} latestOfficialPromptRowAgeHours=${m.latestOfficialPromptRowAgeHours ?? '(missing)'}`,
  );

  if (result.ok) {
    console.log('[prompt-adoption-gates] OK');
    process.exit(0);
  }

  console.error('[prompt-adoption-gates] FAILED:');
  for (const line of result.failures) console.error(`  - ${line}`);
  process.exit(1);
}

const isMainModule =
  process.argv[1] != null && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;
if (isMainModule) main();
