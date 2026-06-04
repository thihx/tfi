import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { runDataDrivenReplayBatch, type DataDrivenBatchOptions } from '../lib/data-driven-replay-batch.js';
import type { SettledReplayVariantSummary } from '../lib/settled-replay-evaluation.js';
import { LIVE_ANALYSIS_PROMPT_VERSION } from '../lib/live-analysis-prompt.js';
import { config } from '../config.js';
import { closePool } from '../db/pool.js';
import { closeRedis } from '../lib/redis.js';

type PrematchProfileMode = 'full' | 'none' | 'league-only' | 'team-only';

interface ExperimentOptions {
  lookbackDays: number;
  limit: number;
  maxScenarios: number;
  marketFamily: DataDrivenBatchOptions['marketFamily'];
  llmMode: 'mock' | 'real';
  allowRealLlm: boolean;
  oddsMode: 'recorded' | 'live' | 'mock';
  delayMs: number;
  applyReplayPolicy: boolean;
  promptVersion: string;
  llmModel: string;
  modes: PrematchProfileMode[];
}

interface ModeReport {
  mode: PrematchProfileMode;
  evalCasesJson: string;
  evalSummaryJson: string;
  summary: SettledReplayVariantSummary;
  deltaVsFull: {
    pushCount: number;
    noBetCount: number;
    settledDirectionalCount: number;
    winCount: number;
    lossCount: number;
    accuracy: number;
    roi: number;
    totalPnl: number;
  };
}

const serverRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const DEFAULT_MODES: PrematchProfileMode[] = ['full', 'none', 'league-only', 'team-only'];

function parseArgs(argv: string[]): ExperimentOptions {
  let lookbackDays = 30;
  let limit = 160;
  let maxScenarios = 80;
  let marketFamily: DataDrivenBatchOptions['marketFamily'] = 'all';
  let llmMode: 'mock' | 'real' = 'mock';
  let allowRealLlm = process.env['ALLOW_REAL_LLM_REPLAY'] === 'true';
  let oddsMode: 'recorded' | 'live' | 'mock' = 'recorded';
  let delayMs = 0;
  let applyReplayPolicy = true;
  let promptVersion = LIVE_ANALYSIS_PROMPT_VERSION;
  let llmModel = process.env['GEMINI_REPLAY_MODEL']?.trim() || config.geminiModel;
  let modes = DEFAULT_MODES;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = argv[i + 1];
    if (arg === '--lookback-days' && next) {
      lookbackDays = Math.max(1, Number(next) || lookbackDays);
      i++;
    } else if (arg === '--limit' && next) {
      limit = Math.max(1, Math.min(2000, Number(next) || limit));
      i++;
    } else if (arg === '--max-scenarios' && next) {
      maxScenarios = Math.max(1, Math.min(1000, Number(next) || maxScenarios));
      i++;
    } else if (arg === '--market-family' && next && ['all', 'goals_totals', 'goals_under', 'goals_over', 'first_half'].includes(next)) {
      marketFamily = next as DataDrivenBatchOptions['marketFamily'];
      i++;
    } else if (arg === '--llm' && next && (next === 'mock' || next === 'real')) {
      llmMode = next;
      i++;
    } else if (arg === '--allow-real-llm') {
      allowRealLlm = true;
    } else if (arg === '--odds' && next && (next === 'recorded' || next === 'live' || next === 'mock')) {
      oddsMode = next;
      i++;
    } else if (arg === '--delay-ms' && next) {
      delayMs = Math.max(0, Math.min(10_000, Number(next) || 0));
      i++;
    } else if (arg === '--no-apply-replay-policy') {
      applyReplayPolicy = false;
    } else if (arg === '--prompt-version' && next) {
      promptVersion = next;
      i++;
    } else if (arg === '--model' && next) {
      llmModel = next;
      i++;
    } else if (arg === '--modes' && next) {
      const parsedModes = next
        .split(',')
        .map((mode) => mode.trim())
        .filter((mode): mode is PrematchProfileMode => DEFAULT_MODES.includes(mode as PrematchProfileMode));
      if (parsedModes.length > 0) modes = [...new Set(parsedModes)];
      i++;
    }
  }

  return {
    lookbackDays,
    limit,
    maxScenarios,
    marketFamily,
    llmMode,
    allowRealLlm,
    oddsMode,
    delayMs,
    applyReplayPolicy,
    promptVersion,
    llmModel,
    modes,
  };
}

function readVariantSummary(evalSummaryJson: string): SettledReplayVariantSummary {
  const payload = JSON.parse(readFileSync(evalSummaryJson, 'utf8')) as {
    variants?: SettledReplayVariantSummary[];
  };
  const variant = payload.variants?.[0];
  if (!variant) throw new Error(`No variant found in ${evalSummaryJson}`);
  return variant;
}

function delta(current: SettledReplayVariantSummary, baseline: SettledReplayVariantSummary): ModeReport['deltaVsFull'] {
  return {
    pushCount: current.pushCount - baseline.pushCount,
    noBetCount: current.noBetCount - baseline.noBetCount,
    settledDirectionalCount: current.settledDirectionalCount - baseline.settledDirectionalCount,
    winCount: current.winCount - baseline.winCount,
    lossCount: current.lossCount - baseline.lossCount,
    accuracy: Number((current.accuracy - baseline.accuracy).toFixed(4)),
    roi: Number((current.roi - baseline.roi).toFixed(4)),
    totalPnl: Number((current.totalPnl - baseline.totalPnl).toFixed(4)),
  };
}

function buildMarkdown(report: {
  generatedAt: string;
  runRoot: string;
  exportedScenarioCount: number;
  options: ExperimentOptions;
  modes: ModeReport[];
}): string {
  const evaluatedScenarioCount = report.modes[0]?.summary.totalScenarios ?? 0;
  const lines = [
    '# Prematch Profile Replay Experiment',
    '',
    `- Generated: ${report.generatedAt}`,
    `- Run root: ${report.runRoot}`,
    `- Exported scenarios: ${report.exportedScenarioCount}`,
    `- Evaluated scenarios per mode: ${evaluatedScenarioCount}`,
    `- LLM: ${report.options.llmMode}`,
    `- Odds: ${report.options.oddsMode}`,
    `- Replay policy: ${report.options.applyReplayPolicy ? 'applied' : 'skipped'}`,
    `- Prompt: ${report.options.promptVersion}`,
    '',
    '| Mode | Push | No Bet | Settled | Win | Loss | Accuracy | ROI | PnL | Delta Push | Delta ROI | Delta PnL |',
    '| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |',
  ];

  for (const mode of report.modes) {
    const s = mode.summary;
    const d = mode.deltaVsFull;
    lines.push([
      mode.mode,
      s.pushCount,
      s.noBetCount,
      s.settledDirectionalCount,
      s.winCount,
      s.lossCount,
      s.accuracy.toFixed(4),
      s.roi.toFixed(4),
      s.totalPnl.toFixed(4),
      d.pushCount,
      d.roi.toFixed(4),
      d.totalPnl.toFixed(4),
    ].join(' | ').replace(/^/, '| ').replace(/$/, ' |'));
  }

  lines.push('', '## Market Family Snapshot', '');
  for (const mode of report.modes) {
    lines.push(`### ${mode.mode}`, '');
    const families = mode.summary.byMarketFamily.slice(0, 8);
    if (families.length === 0) {
      lines.push('- No actionable market-family rows.', '');
      continue;
    }
    for (const row of families) {
      lines.push(`- ${row.family}: push=${row.pushCount}, settled=${row.settledDirectionalCount}, acc=${row.accuracy.toFixed(4)}, roi=${row.roi.toFixed(4)}, pnl=${row.totalPnl.toFixed(4)}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  if (options.llmMode === 'real' && !options.allowRealLlm) {
    throw new Error('Refusing real LLM without --allow-real-llm.');
  }

  const batch = await runDataDrivenReplayBatch({
    lookbackDays: options.lookbackDays,
    limit: options.limit,
    marketFamily: options.marketFamily,
    maxScenarios: options.maxScenarios,
    evalPromptVersions: [options.promptVersion],
    llmMode: 'mock',
    allowRealLlm: false,
    oddsMode: options.oddsMode,
    delayMs: 0,
    applyReplayPolicy: options.applyReplayPolicy,
    skipEval: true,
    llmModel: options.llmModel,
    postSummarize: false,
    postSegmentHotspots: false,
    postActionPlan: false,
  });

  if (batch.scenarioCount === 0) {
    throw new Error('No scenarios exported for prematch profile experiment.');
  }

  const scenarioRelDir = relative(serverRoot, join(batch.runRoot, 'scenarios')).replace(/\\/g, '/');
  const experimentDir = join(batch.runRoot, 'prematch-profile-experiment');
  mkdirSync(experimentDir, { recursive: true });

  const reports: ModeReport[] = [];
  for (const mode of options.modes) {
    const modeDir = join(experimentDir, mode);
    mkdirSync(modeDir, { recursive: true });
    const evalSummaryJson = join(modeDir, 'eval-summary.json');
    const evalSummaryMd = join(modeDir, 'eval-summary.md');
    const evalCasesJson = join(modeDir, 'eval-cases.json');
    const cacheDir = join(modeDir, 'llm-cache');
    mkdirSync(cacheDir, { recursive: true });
    const cmd = [
      'npx tsx src/scripts/evaluate-settled-prompt-variants.ts',
      `--dir ${scenarioRelDir}`,
      `--prompt-version ${options.promptVersion}`,
      `--llm ${options.llmMode}`,
      `--model ${options.llmModel}`,
      options.llmMode === 'real' ? '--allow-real-llm' : '',
      `--odds ${options.oddsMode}`,
      `--delay-ms ${options.delayMs}`,
      `--max-scenarios ${options.maxScenarios}`,
      options.applyReplayPolicy ? '--apply-replay-policy' : '',
      `--prematch-profile-mode ${mode}`,
      `--llm-cache-dir ${relative(serverRoot, cacheDir).replace(/\\/g, '/')}`,
      `--report-json ${relative(serverRoot, evalSummaryJson).replace(/\\/g, '/')}`,
      `--report-md ${relative(serverRoot, evalSummaryMd).replace(/\\/g, '/')}`,
      `--report-cases-json ${relative(serverRoot, evalCasesJson).replace(/\\/g, '/')}`,
    ].filter(Boolean).join(' ');
    const env = { ...process.env };
    if (options.llmMode === 'real') env['ALLOW_REAL_LLM_REPLAY'] = 'true';
    const run = spawnSync(cmd, { cwd: serverRoot, shell: true, stdio: 'inherit', env });
    if (run.status !== 0) {
      throw new Error(`Prematch profile experiment mode ${mode} failed with ${run.status ?? 'unknown'}`);
    }
    if (!existsSync(evalCasesJson)) {
      throw new Error(`Missing eval cases for prematch profile experiment mode ${mode}: ${evalCasesJson}`);
    }
    reports.push({
      mode,
      evalCasesJson,
      evalSummaryJson,
      summary: readVariantSummary(evalSummaryJson),
      deltaVsFull: {
        pushCount: 0,
        noBetCount: 0,
        settledDirectionalCount: 0,
        winCount: 0,
        lossCount: 0,
        accuracy: 0,
        roi: 0,
        totalPnl: 0,
      },
    });
  }

  const baseline = reports.find((entry) => entry.mode === 'full')?.summary ?? reports[0]?.summary;
  if (!baseline) throw new Error('No baseline summary available.');
  for (const entry of reports) entry.deltaVsFull = delta(entry.summary, baseline);

  const report = {
    generatedAt: new Date().toISOString(),
    runRoot: batch.runRoot,
    exportedScenarioCount: batch.scenarioCount,
    evaluatedScenarioCount: reports[0]?.summary.totalScenarios ?? 0,
    options,
    modes: reports,
  };
  writeFileSync(join(experimentDir, 'prematch-profile-experiment.json'), JSON.stringify(report, null, 2));
  writeFileSync(join(experimentDir, 'prematch-profile-experiment.md'), buildMarkdown(report));
  console.log('[prematch-profile-experiment] report=', join(experimentDir, 'prematch-profile-experiment.md'));
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  })
  .finally(async () => {
    await Promise.allSettled([closePool(), closeRedis()]);
  });
