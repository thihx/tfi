/**
 * O/U Under bias: optional DB export, real-LLM evaluate (Step B), self-audit (Step C), odds audit (Step E).
 * Env: repo root .env / .env.local / .env.azure, then packages/server/.env (see config.ts).
 *
 * cd packages/server
 * npx tsx src/scripts/run-ou-under-replay-integration.ts
 * npx tsx src/scripts/run-ou-under-replay-integration.ts --structural --clear-llm-cache
 */
import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from '../config.js';
import { listReplayScenarioJsonBasenames } from '../lib/replay-scenario-files.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SERVER_ROOT = resolve(__dirname, '../..');
const DEFAULT_WORK_REL = 'replay-work/replay-settled';
const DEFAULT_CACHE_REL = 'replay-work/replay-llm-cache';
const STRUCTURAL_REL = 'fixtures/settled-replay-structural';

interface CliArgs {
  structural: boolean;
  skipExport: boolean;
  clearLlmCache: boolean;
  lookbackDays: number;
  exportLimit: number;
  selfAuditMax: number;
  promptVersions: string[];
  model: string;
  oddsMode: 'recorded' | 'live' | 'mock';
}

function parseArgs(argv: string[]): CliArgs {
  let structural = false;
  let skipExport = false;
  let clearLlmCache = false;
  let lookbackDays = 14;
  let exportLimit = 50;
  let selfAuditMax = 25;
  const promptVersions: string[] = [];
  let model = config.geminiModel;
  let oddsMode: CliArgs['oddsMode'] = 'mock';

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const n = argv[i + 1];
    if (a === '--structural') {
      structural = true;
      continue;
    }
    if (a === '--skip-export') {
      skipExport = true;
      continue;
    }
    if (a === '--clear-llm-cache') {
      clearLlmCache = true;
      continue;
    }
    if (a === '--lookback-days' && n) {
      lookbackDays = Math.max(1, Number(n) || 14);
      i++;
      continue;
    }
    if (a === '--limit' && n) {
      exportLimit = Math.max(1, Math.min(1000, Number(n) || 50));
      i++;
      continue;
    }
    if (a === '--self-audit-max' && n) {
      selfAuditMax = Math.max(1, Math.min(500, Number(n) || 25));
      i++;
      continue;
    }
    if (a === '--prompt-version' && n) {
      promptVersions.push(n);
      i++;
      continue;
    }
    if (a === '--model' && n) {
      model = n;
      i++;
      continue;
    }
    if (a === '--odds' && n && (n === 'recorded' || n === 'live' || n === 'mock')) {
      oddsMode = n;
      i++;
      continue;
    }
  }

  const fallback = [
    'v8-market-balance-followup-h',
    'v10-hybrid-legacy-b',
    config.liveAnalysisActivePromptVersion,
  ].filter((v): v is string => typeof v === 'string' && v.trim().length > 0);
  const versions = promptVersions.length > 0 ? [...new Set(promptVersions)] : [...new Set(fallback)];

  return {
    structural,
    skipExport,
    clearLlmCache,
    lookbackDays,
    exportLimit,
    selfAuditMax,
    promptVersions: versions,
    model,
    oddsMode,
  };
}

function sh(cmd: string): void {
  execSync(cmd, {
    stdio: 'inherit',
    cwd: SERVER_ROOT,
    env: {
      ...process.env,
      ALLOW_REAL_LLM_REPLAY: 'true',
    },
  });
}

function countScenarioJson(dir: string): number {
  if (!existsSync(dir)) return 0;
  return listReplayScenarioJsonBasenames(dir).length;
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));

  if (!config.geminiApiKey?.trim()) {
    console.error('[replay-integration] Missing GEMINI_API_KEY (packages/server/.env or repo .env / .env.azure).');
    process.exit(1);
  }

  const workDir = args.structural
    ? resolve(SERVER_ROOT, STRUCTURAL_REL)
    : resolve(SERVER_ROOT, DEFAULT_WORK_REL);
  const cacheAbs = resolve(SERVER_ROOT, DEFAULT_CACHE_REL);
  mkdirSync(cacheAbs, { recursive: true });

  if (args.clearLlmCache && existsSync(cacheAbs)) {
    console.log('[replay-integration] Clearing', DEFAULT_CACHE_REL);
    rmSync(cacheAbs, { recursive: true, force: true });
    mkdirSync(cacheAbs, { recursive: true });
  }

  if (!args.structural && !args.skipExport) {
    if (!config.databaseUrl?.trim()) {
      console.error('[replay-integration] Missing DATABASE_URL for export.');
      process.exit(1);
    }
    mkdirSync(workDir, { recursive: true });
    console.log('[replay-integration] Exporting to', DEFAULT_WORK_REL);
    sh(
      `npx tsx src/scripts/export-settled-replay-scenarios.ts --out-dir ${DEFAULT_WORK_REL} --lookback-days ${args.lookbackDays} --limit ${args.exportLimit} --market-family goals_totals`,
    );
  }

  const n = countScenarioJson(workDir);
  if (n === 0) {
    console.error(`[replay-integration] No scenario JSON in ${workDir}.`);
    process.exit(1);
  }
  console.log(`[replay-integration] ${n} scenarios in ${args.structural ? STRUCTURAL_REL : DEFAULT_WORK_REL}`);

  const promptFlags = args.promptVersions.map((v) => `--prompt-version ${v}`).join(' ');
  const relDir = args.structural ? STRUCTURAL_REL : DEFAULT_WORK_REL;
  const artifactPrefix = args.structural ? 'integration-structural-' : 'integration-';

  console.log('[replay-integration] Step B: evaluate-settled-prompt-variants (real LLM)');
  sh(
    `npx tsx src/scripts/evaluate-settled-prompt-variants.ts --dir ${relDir} ${promptFlags} --llm real --model ${args.model} --allow-real-llm --odds ${args.oddsMode} --delay-ms 750 --llm-cache-dir ${DEFAULT_CACHE_REL} --report-json replay-baselines/${artifactPrefix}replay-summary.json --report-md replay-baselines/${artifactPrefix}replay-summary.md --report-cases-json replay-baselines/${artifactPrefix}replay-cases.json`,
  );

  const primaryPrompt = args.promptVersions[0] ?? 'v8-market-balance-followup-h';
  console.log(`[replay-integration] Step C: self-audit (${primaryPrompt}, max ${args.selfAuditMax})`);
  sh(
    `npx tsx src/scripts/evaluate-settled-prompt-self-audit.ts --dir ${relDir} --prompt-version ${primaryPrompt} --model ${args.model} --allow-real-llm --odds ${args.oddsMode} --delay-ms 750 --max-scenarios ${args.selfAuditMax} --llm-cache-dir ${DEFAULT_CACHE_REL} --report-json replay-baselines/${artifactPrefix}self-audit.json --report-md replay-baselines/${artifactPrefix}self-audit.md`,
  );

  console.log('[replay-integration] Step E: audit-replay-odds-integrity');
  sh(
    `npx tsx src/scripts/audit-replay-odds-integrity.ts --dir ${relDir} --report-json replay-baselines/${artifactPrefix}odds-audit.json`,
  );

  console.log(`[replay-integration] Done. Artifacts: replay-baselines/${artifactPrefix}*`);
}

main();
