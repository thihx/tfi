/**
 * Head-to-head benchmark: baseline Gemini model vs candidate on the same settled replay cohort.
 *
 * Task parity: live analysis prompt + parse + optional --apply-replay-policy + mock odds.
 *
 * cd packages/server
 * npx tsx src/scripts/compare-gemini-model-benchmark.ts --max-scenarios 12 --apply-replay-policy
 *
 * Env: GEMINI_API_KEY, ALLOW_REAL_LLM_REPLAY=true (set automatically)
 */
import 'dotenv/config';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { config } from '../config.js';
import { generateGeminiContent, normalizeGeminiModelName } from '../lib/gemini.js';
import { runReplayScenario } from '../lib/pipeline-replay.js';
import type { SettledReplayScenario } from '../lib/db-replay-scenarios.js';
import {
  buildEvaluatedReplayCase,
  summarizeSettledReplayVariant,
  type EvaluatedReplayCase,
} from '../lib/settled-replay-evaluation.js';
import { settleMatch } from '../jobs/auto-settle.job.js';
import {
  buildReplayLlmCachePath,
  loadReplayLlmCache,
  saveReplayLlmCache,
} from '../lib/replay-llm-cache.js';
import { listReplayScenarioJsonBasenames } from '../lib/replay-scenario-files.js';
import {
  buildReplayMarketOpportunity,
  classifyReplayMarketAvailability,
} from '../lib/replay-market-opportunities.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SERVER_ROOT = resolve(__dirname, '../..');

interface BenchArgs {
  benchDir: string;
  promptVersion: string;
  baselineModel: string;
  candidateModel: string;
  maxScenarios: number;
  applyReplayPolicy: boolean;
  delayMs: number;
  smokeOnly: boolean;
}

interface ScenarioBenchRow {
  scenarioName: string;
  recommendationId: number;
  baseline: ModelRunMetrics;
  candidate: ModelRunMetrics;
}

interface ModelRunMetrics {
  model: string;
  ok: boolean;
  error?: string;
  llmLatencyMs: number | null;
  totalLatencyMs: number | null;
  promptChars: number | null;
  shouldPush: boolean;
  canonicalMarket: string;
  sameAsOriginalPush: boolean | null;
  settlementResult: EvaluatedReplayCase['settlementResult'];
  directionalWin: boolean | null;
}

function parseArgs(argv: string[]): BenchArgs {
  let benchDir = resolve(SERVER_ROOT, 'replay-benchmarks/all-markets-benchmark');
  let promptVersion = process.env['LIVE_ANALYSIS_ACTIVE_PROMPT_VERSION']?.trim() || 'v10-hybrid-legacy-g';
  /** Production today is often gemini-3.5-flash (.env.azure); config default may still say 3.0-flash. */
  let baselineModel = process.env['GEMINI_MODEL']?.trim() || config.geminiModel || 'gemini-3.5-flash';
  let candidateModel = 'gemini-3.5-flash';
  let maxScenarios = 12;
  let applyReplayPolicy = true;
  let delayMs = 800;
  let smokeOnly = false;

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const n = argv[i + 1];
    if (a === '--dir' && n) { benchDir = resolve(process.cwd(), n); i++; continue; }
    if (a === '--prompt-version' && n) { promptVersion = n; i++; continue; }
    if (a === '--baseline-model' && n) { baselineModel = n; i++; continue; }
    if (a === '--candidate-model' && n) { candidateModel = n; i++; continue; }
    if (a === '--max-scenarios' && n) { maxScenarios = Math.max(1, Math.min(80, Number(n) || maxScenarios)); i++; continue; }
    if (a === '--apply-replay-policy') { applyReplayPolicy = true; continue; }
    if (a === '--no-replay-policy') { applyReplayPolicy = false; continue; }
    if (a === '--delay-ms' && n) { delayMs = Math.max(0, Number(n) || 0); i++; continue; }
    if (a === '--smoke-only') { smokeOnly = true; continue; }
  }

  return { benchDir, promptVersion, baselineModel, candidateModel, maxScenarios, applyReplayPolicy, delayMs, smokeOnly };
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function median(values: number[]): number | null {
  const nums = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (nums.length === 0) return null;
  const mid = Math.floor(nums.length / 2);
  return nums.length % 2 === 0 ? (nums[mid - 1]! + nums[mid]!) / 2 : nums[mid]!;
}

function pct(n: number, d: number): number {
  return d > 0 ? (n / d) * 100 : 0;
}

async function smokeTestModel(model: string): Promise<{ ok: boolean; latencyMs: number; error?: string }> {
  const started = Date.now();
  try {
    const data = await generateGeminiContent('Reply with JSON only: {"ok":true}', {
      model,
      timeoutMs: 60_000,
      temperature: 0,
      maxOutputTokens: 64,
      responseMimeType: 'application/json',
    });
    const text = JSON.stringify(data).slice(0, 200);
    if (!text) return { ok: false, latencyMs: Date.now() - started, error: 'empty response' };
    return { ok: true, latencyMs: Date.now() - started };
  } catch (err) {
    return {
      ok: false,
      latencyMs: Date.now() - started,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

function loadScenario(filePath: string): SettledReplayScenario {
  return JSON.parse(readFileSync(filePath, 'utf8')) as SettledReplayScenario;
}

async function evaluateOneModel(
  scenario: SettledReplayScenario,
  model: string,
  promptVersion: string,
  cacheDir: string,
  applyReplayPolicy: boolean,
): Promise<ModelRunMetrics> {
  const cachePath = buildReplayLlmCachePath(
    cacheDir,
    scenario,
    promptVersion,
    'mock',
    `model-${normalizeGeminiModelName(model).replace(/\./g, '-')}`,
  );
  const cached = loadReplayLlmCache(cachePath);

  try {
    const output = await runReplayScenario({
      ...scenario,
      pipelineOptions: {
        ...(scenario.pipelineOptions ?? {}),
        modelOverride: model,
      },
    }, {
      llmMode: 'real',
      oddsMode: 'mock',
      shadowMode: true,
      advisoryOnly: true,
      promptVersionOverride: promptVersion as never,
      capturedAiText: cached?.aiText,
      applySettledReplayPolicy: applyReplayPolicy,
    });

    if (!cached && output.result.debug?.aiText) {
      saveReplayLlmCache(cachePath, {
        generatedAt: new Date().toISOString(),
        recommendationId: scenario.metadata.recommendationId,
        scenarioName: scenario.name,
        promptVersion,
        oddsMode: 'mock',
        aiText: output.result.debug.aiText,
        prompt: output.result.debug.prompt ?? null,
        selection: output.result.selection || null,
      });
    }

    const parsed = (output.result.debug?.parsed ?? {}) as Record<string, unknown>;
    const replayOdds = Number(parsed.mapped_odd ?? 0) || 2;
    const replayStake = Number(parsed.stake_percent ?? 1) || 1;
    let settlementResult: EvaluatedReplayCase['settlementResult'] = null;
    if (output.result.shouldPush && output.result.selection) {
      const settled = await settleMatch(
        {
          matchId: scenario.settlementContext.matchId,
          homeTeam: scenario.settlementContext.homeTeam,
          awayTeam: scenario.settlementContext.awayTeam,
          homeScore: scenario.settlementContext.regularHomeScore,
          awayScore: scenario.settlementContext.regularAwayScore,
          finalStatus: scenario.settlementContext.finalStatus,
          settlementScope: 'regular_time',
          statistics: scenario.settlementContext.settlementStats,
        },
        [{
          id: 1,
          market: String(parsed.bet_market || ''),
          selection: output.result.selection,
          odds: replayOdds,
          stakePercent: replayStake,
        }],
      );
      settlementResult = settled.get(1)?.result ?? 'unresolved';
    }

    const evaluated = buildEvaluatedReplayCase(
      promptVersion,
      scenario,
      output,
      settlementResult,
      replayOdds,
      replayStake,
      null,
      classifyReplayMarketAvailability(buildReplayMarketOpportunity(scenario)),
    );

    const originalPushed = String(scenario.metadata?.originalResult ?? '').trim().toLowerCase() !== 'duplicate'
      && String(scenario.metadata?.originalSelection ?? '').trim() !== '';

    return {
      model,
      ok: true,
      llmLatencyMs: output.result.debug?.llmLatencyMs ?? null,
      totalLatencyMs: output.result.debug?.totalLatencyMs ?? null,
      promptChars: output.result.debug?.promptChars ?? null,
      shouldPush: evaluated.shouldPush,
      canonicalMarket: evaluated.canonicalMarket,
      sameAsOriginalPush: evaluated.shouldPush === originalPushed,
      settlementResult: evaluated.settlementResult,
      directionalWin: evaluated.directionalWin,
    };
  } catch (err) {
    return {
      model,
      ok: false,
      error: err instanceof Error ? err.message : String(err),
      llmLatencyMs: null,
      totalLatencyMs: null,
      promptChars: null,
      shouldPush: false,
      canonicalMarket: '',
      sameAsOriginalPush: null,
      settlementResult: null,
      directionalWin: null,
    };
  }
}

function buildMarkdownReport(summary: Record<string, unknown>): string {
  const s = summary as {
    generatedAt: string;
    promptVersion: string;
    applyReplayPolicy: boolean;
    scenarioCount: number;
    baselineModel: string;
    candidateModel: string;
    smoke: { baseline: { ok: boolean; latencyMs: number; error?: string }; candidate: { ok: boolean; latencyMs: number; error?: string } };
    baseline: ReturnType<typeof summarizeVariantMetrics>;
    candidate: ReturnType<typeof summarizeVariantMetrics>;
    headToHead: { pushAgreementPct: number; marketAgreementPct: number; bothWinWhenPush: number; baselineOnlyWin: number; candidateOnlyWin: number };
  };

  return [
    '# Gemini model benchmark (same replay task)',
    '',
    `- Generated: ${s.generatedAt}`,
    `- Prompt: ${s.promptVersion}`,
    `- Post-parse policy: ${s.applyReplayPolicy ? 'yes' : 'no'}`,
    `- Scenarios: ${s.scenarioCount}`,
    `- Baseline: \`${s.baselineModel}\``,
    `- Candidate: \`${s.candidateModel}\``,
    '',
    '## API smoke (minimal JSON prompt)',
    '',
    `| Model | OK | Latency ms |`,
    `| --- | --- | --- |`,
    `| ${s.baselineModel} | ${s.smoke.baseline.ok ? 'yes' : 'no'} | ${s.smoke.baseline.latencyMs} |`,
    `| ${s.candidateModel} | ${s.smoke.candidate.ok ? 'yes' : 'no'} | ${s.smoke.candidate.latencyMs} |`,
    '',
    '## Speed (replay pipeline)',
    '',
    `| Metric | ${s.baselineModel} | ${s.candidateModel} | Delta (candidate - baseline) |`,
    `| --- | --- | --- | --- |`,
    `| Median LLM latency ms | ${fmt(s.baseline.medianLlmMs)} | ${fmt(s.candidate.medianLlmMs)} | ${fmtDelta(s.baseline.medianLlmMs, s.candidate.medianLlmMs)} |`,
    `| Median total latency ms | ${fmt(s.baseline.medianTotalMs)} | ${fmt(s.candidate.medianTotalMs)} | ${fmtDelta(s.baseline.medianTotalMs, s.candidate.medianTotalMs)} |`,
    `| Median prompt chars | ${fmt(s.baseline.medianPromptChars)} | ${fmt(s.candidate.medianPromptChars)} | ${fmtDelta(s.baseline.medianPromptChars, s.candidate.medianPromptChars)} |`,
    `| Errors | ${s.baseline.errors} | ${s.candidate.errors} | |`,
    '',
    '## Prediction quality (settled replay cohort)',
    '',
    `| Metric | ${s.baselineModel} | ${s.candidateModel} |`,
    `| --- | --- | --- |`,
    `| Push rate | ${pctStr(s.baseline.pushRate)} | ${pctStr(s.candidate.pushRate)} |`,
    `| Push agreement vs original | ${pctStr(s.baseline.pushMatchOriginal)} | ${pctStr(s.candidate.pushMatchOriginal)} |`,
    `| Directional accuracy (settled pushes) | ${pctStr(s.baseline.accuracy)} | ${pctStr(s.candidate.accuracy)} |`,
    `| Replay ROI (mock stakes) | ${pctStr(s.baseline.roi)} | ${pctStr(s.candidate.roi)} |`,
    '',
    '## Head-to-head (same scenario)',
    '',
    `- Push decision agreement: ${s.headToHead.pushAgreementPct.toFixed(1)}%`,
    `- Same canonical market when both push: ${s.headToHead.marketAgreementPct.toFixed(1)}%`,
    `- Both win (when both pushed & settled): ${s.headToHead.bothWinWhenPush}`,
    `- Baseline win only: ${s.headToHead.baselineOnlyWin}`,
    `- Candidate win only: ${s.headToHead.candidateOnlyWin}`,
    '',
    '## Recommendation rubric',
    '',
    '- **Speed:** prefer candidate if median LLM latency drops ≥15% with ≤1 extra error.',
    '- **Quality:** candidate must not lower directional accuracy by >3pp on this cohort without a compensating ROI gain.',
    '- **Stability:** both models must pass smoke; check API errors for thinking_config / model ID.',
    '',
  ].join('\n');
}

function fmt(v: number | null | undefined): string {
  return v == null || !Number.isFinite(v) ? '—' : String(Math.round(v));
}

function fmtDelta(a: number | null | undefined, b: number | null | undefined): string {
  if (a == null || b == null || !Number.isFinite(a) || !Number.isFinite(b)) return '—';
  const d = b - a;
  const sign = d > 0 ? '+' : '';
  return `${sign}${Math.round(d)}`;
}

function pctStr(v: number | null | undefined): string {
  return v == null || !Number.isFinite(v) ? '—' : `${v.toFixed(1)}%`;
}

function summarizeVariantMetrics(rows: ModelRunMetrics[]) {
  const okRows = rows.filter((r) => r.ok);
  const cases: EvaluatedReplayCase[] = okRows.map((r) => ({
    promptVersion: 'bench',
    scenarioName: '',
    recommendationId: 0,
    minute: null,
    score: '',
    scoreState: '',
    minuteBand: '',
    prematchStrength: '',
    evidenceMode: '',
    marketAvailabilityBucket: '',
    shouldPush: r.shouldPush,
    actionable: r.shouldPush,
    canonicalMarket: r.canonicalMarket,
    goalsUnder: r.canonicalMarket.startsWith('under_'),
    goalsOver: r.canonicalMarket.startsWith('over_'),
    settlementResult: r.settlementResult,
    directionalWin: r.directionalWin,
    replaySelection: '',
    replayOdds: null,
    replayStakePercent: 1,
    breakEvenRate: null,
    replayPnl: null,
    originalBetMarket: '',
    originalResult: '',
  }));

  const variant = summarizeSettledReplayVariant('bench', cases);
  const pushMatchOriginal = okRows.filter((r) => r.sameAsOriginalPush === true).length;

  return {
    medianLlmMs: median(okRows.map((r) => r.llmLatencyMs ?? NaN).filter(Number.isFinite)),
    medianTotalMs: median(okRows.map((r) => r.totalLatencyMs ?? NaN).filter(Number.isFinite)),
    medianPromptChars: median(okRows.map((r) => r.promptChars ?? NaN).filter(Number.isFinite)),
    errors: rows.length - okRows.length,
    pushRate: variant.pushRate * 100,
    pushMatchOriginal: pct(pushMatchOriginal, okRows.length),
    accuracy: variant.accuracy * 100,
    roi: variant.roi * 100,
  };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (!config.geminiApiKey?.trim()) {
    console.error('[gemini-benchmark] GEMINI_API_KEY required.');
    process.exit(1);
  }
  process.env['ALLOW_REAL_LLM_REPLAY'] = 'true';

  const baselineNorm = normalizeGeminiModelName(args.baselineModel);
  const candidateNorm = normalizeGeminiModelName(args.candidateModel);

  console.log('[gemini-benchmark] Smoke test...');
  const smokeBaseline = await smokeTestModel(baselineNorm);
  const smokeCandidate = await smokeTestModel(candidateNorm);
  console.log('[gemini-benchmark] smoke', { baseline: smokeBaseline, candidate: smokeCandidate });

  if (!smokeBaseline.ok || !smokeCandidate.ok) {
    console.error('[gemini-benchmark] Smoke failed — fix model ID / API access before cohort benchmark.');
    console.error('  baseline:', smokeBaseline.error ?? 'ok');
    console.error('  candidate:', smokeCandidate.error ?? 'ok');
    process.exit(1);
  }

  if (args.smokeOnly) {
    console.log('[gemini-benchmark] --smoke-only: done.');
    return;
  }

  const names = listReplayScenarioJsonBasenames(args.benchDir).slice(0, args.maxScenarios);
  if (names.length === 0) {
    console.error(`[gemini-benchmark] No scenarios in ${args.benchDir}`);
    process.exit(1);
  }

  const cacheRoot = resolve(SERVER_ROOT, 'replay-work/gemini-model-bench');
  const baselineCache = resolve(cacheRoot, baselineNorm.replace(/\./g, '-'));
  const candidateCache = resolve(cacheRoot, candidateNorm.replace(/\./g, '-'));
  mkdirSync(baselineCache, { recursive: true });
  mkdirSync(candidateCache, { recursive: true });

  const rows: ScenarioBenchRow[] = [];

  for (let i = 0; i < names.length; i++) {
    const filePath = resolve(args.benchDir, names[i]!);
    const scenario = loadScenario(filePath);
    console.log(`[gemini-benchmark] [${i + 1}/${names.length}] ${scenario.name}`);

    const baseline = await evaluateOneModel(
      scenario,
      baselineNorm,
      args.promptVersion,
      baselineCache,
      args.applyReplayPolicy,
    );
    await sleep(args.delayMs);
    const candidate = await evaluateOneModel(
      scenario,
      candidateNorm,
      args.promptVersion,
      candidateCache,
      args.applyReplayPolicy,
    );
    await sleep(args.delayMs);

    rows.push({
      scenarioName: scenario.name,
      recommendationId: scenario.metadata.recommendationId,
      baseline,
      candidate,
    });
  }

  const baselineMetrics = summarizeVariantMetrics(rows.map((r) => r.baseline));
  const candidateMetrics = summarizeVariantMetrics(rows.map((r) => r.candidate));

  let pushAgree = 0;
  let marketAgree = 0;
  let bothWin = 0;
  let baselineOnlyWin = 0;
  let candidateOnlyWin = 0;
  let comparable = 0;

  for (const row of rows) {
    if (!row.baseline.ok || !row.candidate.ok) continue;
    comparable++;
    if (row.baseline.shouldPush === row.candidate.shouldPush) pushAgree++;
    if (row.baseline.shouldPush && row.candidate.shouldPush && row.baseline.canonicalMarket === row.candidate.canonicalMarket) {
      marketAgree++;
    }
    const bWin = row.baseline.directionalWin === true;
    const cWin = row.candidate.directionalWin === true;
    if (bWin && cWin) bothWin++;
    if (bWin && !cWin) baselineOnlyWin++;
    if (cWin && !bWin) candidateOnlyWin++;
  }

  const summary = {
    generatedAt: new Date().toISOString(),
    promptVersion: args.promptVersion,
    applyReplayPolicy: args.applyReplayPolicy,
    scenarioCount: rows.length,
    baselineModel: baselineNorm,
    candidateModel: candidateNorm,
    smoke: { baseline: smokeBaseline, candidate: smokeCandidate },
    baseline: baselineMetrics,
    candidate: candidateMetrics,
    headToHead: {
      comparable,
      pushAgreementPct: pct(pushAgree, comparable),
      marketAgreementPct: pct(marketAgree, comparable),
      bothWinWhenPush: bothWin,
      baselineOnlyWin,
      candidateOnlyWin,
    },
    rows,
  };

  const outDir = resolve(SERVER_ROOT, 'replay-benchmarks/gemini-model-compare');
  mkdirSync(outDir, { recursive: true });
  const jsonPath = resolve(outDir, 'latest.json');
  const mdPath = resolve(outDir, 'latest.md');
  writeFileSync(jsonPath, JSON.stringify(summary, null, 2));
  writeFileSync(mdPath, buildMarkdownReport(summary));

  console.log(`[gemini-benchmark] Wrote ${jsonPath}`);
  console.log(`[gemini-benchmark] Wrote ${mdPath}`);
}

const isMain = process.argv[1] != null && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;
if (isMain) {
  main().catch((err) => {
    console.error('[gemini-benchmark] Failed:', err);
    process.exit(1);
  });
}
