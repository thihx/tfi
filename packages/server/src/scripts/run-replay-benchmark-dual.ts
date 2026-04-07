/**
 * Run settled replay benchmark twice: without post-parse policy (model intent),
 * then with --apply-replay-policy (production parity). Writes both report triplets.
 *
 * Model: GEMINI_REPLAY_MODEL or gemini-2.5-flash (not GEMINI_MODEL from production).
 *
 * cd packages/server
 * npx tsx src/scripts/run-replay-benchmark-dual.ts --max-scenarios 20 --clear-llm-cache
 */
import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { config } from '../config.js';
import { listReplayScenarioJsonBasenames } from '../lib/replay-scenario-files.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SERVER_ROOT = resolve(__dirname, '../..');
const BENCH_DIR_REL = 'replay-benchmarks/goals-totals-benchmark';
const CACHE_REL = 'replay-work/replay-benchmark-llm-cache';
const DEFAULT_REPLAY_MODEL = 'gemini-2.5-flash';

function stripApplyReplayPolicyFlag(argv: string[]): string[] {
  return argv.filter((a) => a !== '--apply-replay-policy');
}

function parseArgs(argv: string[]): { max: number; clearCache: boolean; promptVersion: string } {
  let max = 120;
  let clearCache = false;
  let promptVersion = 'v8-market-balance-followup-j';
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const n = argv[i + 1];
    if (a === '--max-scenarios' && n) {
      max = Math.max(1, Math.min(500, Number(n) || max));
      i++;
      continue;
    }
    if (a === '--clear-llm-cache') {
      clearCache = true;
      continue;
    }
    if (a === '--prompt-version' && n) {
      promptVersion = n;
      i++;
      continue;
    }
  }
  return { max, clearCache, promptVersion };
}

function runPass(opts: {
  max: number;
  promptVersion: string;
  applyReplayPolicy: boolean;
  model: string;
}): void {
  const policyFlag = opts.applyReplayPolicy ? ' --apply-replay-policy' : '';
  const reportJson = opts.applyReplayPolicy
    ? 'replay-benchmarks/eval-last-summary-policy.json'
    : 'replay-benchmarks/eval-last-summary.json';
  const reportMd = opts.applyReplayPolicy
    ? 'replay-benchmarks/eval-last-summary-policy.md'
    : 'replay-benchmarks/eval-last-summary.md';
  const reportCases = opts.applyReplayPolicy
    ? 'replay-benchmarks/eval-last-cases-policy.json'
    : 'replay-benchmarks/eval-last-cases.json';
  const cmd =
    `npx tsx src/scripts/evaluate-settled-prompt-variants.ts --dir ${BENCH_DIR_REL} --prompt-version ${opts.promptVersion} --llm real --model ${opts.model} --allow-real-llm --odds mock --delay-ms 750 --max-scenarios ${opts.max}${policyFlag} --llm-cache-dir ${CACHE_REL} --report-json ${reportJson} --report-md ${reportMd} --report-cases-json ${reportCases}`;
  execSync(cmd, {
    stdio: 'inherit',
    cwd: SERVER_ROOT,
    env: {
      ...process.env,
      ALLOW_REAL_LLM_REPLAY: 'true',
      GEMINI_REPLAY_MODEL: opts.model,
    },
  });
  console.log(`[replay-benchmark-dual] Wrote ${reportJson}, ${reportMd}, ${reportCases}`);
}

function main(): void {
  const { max, clearCache, promptVersion } = parseArgs(stripApplyReplayPolicyFlag(process.argv.slice(2)));
  const replayModel = process.env['GEMINI_REPLAY_MODEL']?.trim() || DEFAULT_REPLAY_MODEL;
  if (!config.geminiApiKey?.trim()) {
    console.error('[replay-benchmark-dual] Missing GEMINI_API_KEY.');
    process.exit(1);
  }
  const benchAbs = resolve(SERVER_ROOT, BENCH_DIR_REL);
  mkdirSync(benchAbs, { recursive: true });
  const n = listReplayScenarioJsonBasenames(benchAbs).length;
  if (n === 0) {
    console.error(`[replay-benchmark-dual] No scenarios in ${BENCH_DIR_REL}. Run: npm run replay:benchmark:export`);
    process.exit(1);
  }

  const cacheAbs = resolve(SERVER_ROOT, CACHE_REL);
  mkdirSync(cacheAbs, { recursive: true });
  if (clearCache && existsSync(cacheAbs)) {
    console.log('[replay-benchmark-dual] Clearing', CACHE_REL);
    rmSync(cacheAbs, { recursive: true, force: true });
    mkdirSync(cacheAbs, { recursive: true });
  }

  console.log(
    `[replay-benchmark-dual] cohort first ${max}, ${promptVersion}, model=${replayModel}: (1) no post-parse policy, (2) with policy`,
  );
  runPass({ max, promptVersion, applyReplayPolicy: false, model: replayModel });
  runPass({ max, promptVersion, applyReplayPolicy: true, model: replayModel });
  console.log('[replay-benchmark-dual] Compare eval-last-summary*.json / *.md; gates: npm run replay:benchmark:check-gates && npm run replay:benchmark:check-gates:policy');
}

const isMainModule =
  process.argv[1] != null && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;
if (isMainModule) {
  main();
}
