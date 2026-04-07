/**
 * Evaluate a fixed goals_totals benchmark folder with v8j (or --prompt-version) and capped cohort.
 * Prereq: npm run replay:benchmark:export
 *
 * cd packages/server
 * npx tsx src/scripts/run-replay-benchmark-eval.ts --max-scenarios 20 --clear-llm-cache
 */
import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { config } from '../config.js';
import { listReplayScenarioJsonBasenames } from '../lib/replay-scenario-files.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SERVER_ROOT = resolve(__dirname, '../..');
const DEFAULT_BENCH_DIR_REL = 'replay-benchmarks/goals-totals-benchmark';
const CACHE_REL = 'replay-work/replay-benchmark-llm-cache';

function parseArgs(argv: string[]): {
  max: number;
  clearCache: boolean;
  promptVersion: string;
  applyReplayPolicy: boolean;
  benchDirRel: string;
  oddsMode: 'recorded' | 'mock';
  delayMs: number;
} {
  let max = 120;
  let clearCache = false;
  let promptVersion = 'v8-market-balance-followup-j';
  let applyReplayPolicy = false;
  let benchDirRel = DEFAULT_BENCH_DIR_REL;
  let oddsMode: 'recorded' | 'mock' = 'mock';
  let delayMs = 750;
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
    if (a === '--apply-replay-policy') {
      applyReplayPolicy = true;
      continue;
    }
    if (a === '--bench-dir' && n) {
      benchDirRel = n.replace(/\\/g, '/').replace(/^\/+/, '');
      i++;
      continue;
    }
    if (a === '--odds' && n && (n === 'recorded' || n === 'mock')) {
      oddsMode = n;
      i++;
      continue;
    }
    if (a === '--delay-ms' && n) {
      delayMs = Math.max(0, Math.min(10_000, Number(n) || 0));
      i++;
      continue;
    }
  }
  return { max, clearCache, promptVersion, applyReplayPolicy, benchDirRel, oddsMode, delayMs };
}

function main(): void {
  const { max, clearCache, promptVersion, applyReplayPolicy, benchDirRel, oddsMode, delayMs } = parseArgs(process.argv.slice(2));
  if (!config.geminiApiKey?.trim()) {
    console.error('[replay-benchmark] Missing GEMINI_API_KEY.');
    process.exit(1);
  }
  const benchAbs = resolve(SERVER_ROOT, benchDirRel);
  mkdirSync(benchAbs, { recursive: true });
  const n = listReplayScenarioJsonBasenames(benchAbs).length;
  if (n === 0) {
    console.error(`[replay-benchmark] No scenarios in ${benchDirRel}. Run: npm run replay:benchmark:export`);
    process.exit(1);
  }

  const cacheAbs = resolve(SERVER_ROOT, CACHE_REL);
  mkdirSync(cacheAbs, { recursive: true });
  if (clearCache && existsSync(cacheAbs)) {
    console.log('[replay-benchmark] Clearing', CACHE_REL);
    rmSync(cacheAbs, { recursive: true, force: true });
    mkdirSync(cacheAbs, { recursive: true });
  }

  const model = process.env['GEMINI_REPLAY_MODEL']?.trim() || 'gemini-2.5-flash';
  console.log(
    `[replay-benchmark] dir=${benchDirRel} scenarios=${n}, first ${max}, ${promptVersion}, model=${model}, odds=${oddsMode}, delayMs=${delayMs}${applyReplayPolicy ? ' (post-parse policy ON)' : ''}`,
  );
  const policyFlag = applyReplayPolicy ? ' --apply-replay-policy' : '';
  const reportJson = applyReplayPolicy ? 'replay-benchmarks/eval-last-summary-policy.json' : 'replay-benchmarks/eval-last-summary.json';
  const reportMd = applyReplayPolicy ? 'replay-benchmarks/eval-last-summary-policy.md' : 'replay-benchmarks/eval-last-summary.md';
  const reportCases = applyReplayPolicy ? 'replay-benchmarks/eval-last-cases-policy.json' : 'replay-benchmarks/eval-last-cases.json';
  const cmd =
    `npx tsx src/scripts/evaluate-settled-prompt-variants.ts --dir ${benchDirRel} --prompt-version ${promptVersion} --llm real --model ${model} --allow-real-llm --odds ${oddsMode} --delay-ms ${delayMs} --max-scenarios ${max}${policyFlag} --llm-cache-dir ${CACHE_REL} --report-json ${reportJson} --report-md ${reportMd} --report-cases-json ${reportCases}`;
  execSync(cmd, {
    stdio: 'inherit',
    cwd: SERVER_ROOT,
    env: { ...process.env, ALLOW_REAL_LLM_REPLAY: 'true' },
  });
  console.log(`[replay-benchmark] Wrote ${reportJson}, ${reportMd}, ${reportCases}`);
  console.log('[replay-benchmark] Check gates: npm run replay:benchmark:check-gates');
}

const isMainModule =
  process.argv[1] != null && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;
if (isMainModule) {
  main();
}
