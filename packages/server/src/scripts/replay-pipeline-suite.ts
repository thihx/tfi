import { mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, extname, join, resolve } from 'node:path';
import {
  loadReplayScenarioFromFile,
  runReplayScenario,
  type ReplayRunOptions,
  type ReplayRunOutput,
} from '../lib/pipeline-replay.js';

interface SuiteArgs {
  dirPath: string;
  options: ReplayRunOptions;
  delayMs: number;
  retries: number;
  reportJsonPath?: string;
  reportMdPath?: string;
}

function parseArgs(argv: string[]): SuiteArgs {
  let dirPath = '';
  let delayMs = 750;
  let retries = 0;
  const options: ReplayRunOptions = {};
  let reportJsonPath: string | undefined;
  let reportMdPath: string | undefined;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = argv[i + 1];
    if (arg === '--dir' && next) {
      dirPath = next;
      i++;
      continue;
    }
    if (arg === '--llm' && next && (next === 'real' || next === 'mock')) {
      options.llmMode = next;
      i++;
      continue;
    }
    if (arg === '--odds' && next && (next === 'recorded' || next === 'live' || next === 'mock')) {
      options.oddsMode = next;
      i++;
      continue;
    }
    if (arg === '--delay-ms' && next) {
      delayMs = Math.max(0, Number(next) || 0);
      i++;
      continue;
    }
    if (arg === '--retries' && next) {
      retries = Math.max(0, Number(next) || 0);
      i++;
      continue;
    }
    if (arg === '--no-shadow') {
      options.shadowMode = false;
      continue;
    }
    if (arg === '--sample-provider-data') {
      options.sampleProviderData = true;
      continue;
    }
    if (arg === '--report-json' && next) {
      reportJsonPath = next;
      i++;
      continue;
    }
    if (arg === '--report-md' && next) {
      reportMdPath = next;
      i++;
      continue;
    }
    if (arg === '--prompt-version' && next) {
      options.promptVersionOverride = next as ReplayRunOptions['promptVersionOverride'];
      i++;
      continue;
    }
  }

  if (!dirPath) {
    throw new Error('Usage: tsx src/scripts/replay-pipeline-suite.ts --dir <folder> [--llm real|mock] [--odds recorded|live|mock] [--delay-ms N] [--retries N] [--report-json <file>] [--report-md <file>] [--prompt-version <version>] [--no-shadow] [--sample-provider-data]');
  }

  return {
    dirPath: resolve(process.cwd(), dirPath),
    options,
    delayMs,
    retries,
    reportJsonPath: reportJsonPath ? resolve(process.cwd(), reportJsonPath) : undefined,
    reportMdPath: reportMdPath ? resolve(process.cwd(), reportMdPath) : undefined,
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}

function toMedian(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[middle] ?? null;
  const left = sorted[middle - 1];
  const right = sorted[middle];
  if (left == null || right == null) return null;
  return Math.round(((left + right) / 2) * 100) / 100;
}

function buildMetricSummary(outputs: ReplayRunOutput[]) {
  const promptChars = outputs
    .map((item) => item.result.debug?.promptChars)
    .filter((value): value is number => typeof value === 'number');
  const promptTokens = outputs
    .map((item) => item.result.debug?.promptEstimatedTokens)
    .filter((value): value is number => typeof value === 'number');
  const aiTextChars = outputs
    .map((item) => item.result.debug?.aiTextChars)
    .filter((value): value is number => typeof value === 'number');
  const aiTextTokens = outputs
    .map((item) => item.result.debug?.aiTextEstimatedTokens)
    .filter((value): value is number => typeof value === 'number');
  const llmLatencyMs = outputs
    .map((item) => item.result.debug?.llmLatencyMs)
    .filter((value): value is number => typeof value === 'number');
  const totalLatencyMs = outputs
    .map((item) => item.result.debug?.totalLatencyMs)
    .filter((value): value is number => typeof value === 'number');
  const promptVersions = [...new Set(outputs
    .map((item) => item.result.debug?.promptVersion)
    .filter((value): value is string => typeof value === 'string' && value.length > 0))];
  const oddsInvalidCount = outputs.filter((item) => {
    const warnings = (item.result.debug?.parsed?.warnings ?? []) as unknown[];
    return warnings.some((warning) => String(warning) === 'ODDS_INVALID');
  }).length;
  const aiPushBlockedCount = outputs.filter((item) => {
    const parsed = (item.result.debug?.parsed ?? {}) as Record<string, unknown>;
    return parsed.ai_should_push === true && item.result.shouldPush === false;
  }).length;
  const fencedJsonCount = outputs.filter((item) => {
    const aiText = String(item.result.debug?.aiText ?? '').trimStart();
    return aiText.startsWith('```');
  }).length;

  return {
    promptVersions,
    medianPromptChars: toMedian(promptChars),
    medianPromptEstimatedTokens: toMedian(promptTokens),
    medianAiTextChars: toMedian(aiTextChars),
    medianAiTextEstimatedTokens: toMedian(aiTextTokens),
    medianLlmLatencyMs: toMedian(llmLatencyMs),
    medianTotalLatencyMs: toMedian(totalLatencyMs),
    oddsInvalidCount,
    aiPushBlockedCount,
    fencedJsonCount,
  };
}

function buildMarkdownReport(outputs: ReplayRunOutput[]): string {
  const passed = outputs.filter((item) => item.allPassed).length;
  const metrics = buildMetricSummary(outputs);
  const lines: string[] = [
    '# Prompt Replay Suite Report',
    '',
    `- Total scenarios: ${outputs.length}`,
    `- Passed assertions: ${passed}/${outputs.length}`,
    `- Prompt version(s): ${metrics.promptVersions.join(', ') || '(unknown)'}`,
    `- Median prompt chars: ${metrics.medianPromptChars ?? 'n/a'}`,
    `- Median prompt est. tokens: ${metrics.medianPromptEstimatedTokens ?? 'n/a'}`,
    `- Median response chars: ${metrics.medianAiTextChars ?? 'n/a'}`,
    `- Median response est. tokens: ${metrics.medianAiTextEstimatedTokens ?? 'n/a'}`,
    `- Median LLM latency ms: ${metrics.medianLlmLatencyMs ?? 'n/a'}`,
    `- Median total latency ms: ${metrics.medianTotalLatencyMs ?? 'n/a'}`,
    `- ODDS_INVALID warnings: ${metrics.oddsInvalidCount}`,
    `- AI push blocked by runtime: ${metrics.aiPushBlockedCount}`,
    `- Markdown-fenced JSON responses: ${metrics.fencedJsonCount}`,
    '',
    '| Scenario | Analysis Mode | Evidence Mode | Odds Source | Bet Market | Should Push | Confidence | Prompt Tok. | Resp Tok. | LLM ms | Assertions |',
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
  ];

  for (const output of outputs) {
    const result = output.result;
    const parsed = (result.debug?.parsed ?? {}) as Record<string, unknown>;
    const assertions = output.assertions.length === 0
      ? 'n/a'
      : output.assertions.every((item) => item.pass)
        ? 'pass'
        : 'fail';
    const betMarket = String(parsed.bet_market || '').replace(/\|/g, '\\|') || '(none)';
    lines.push(
      `| ${output.scenarioName} | ${result.debug?.analysisMode ?? ''} | ${result.debug?.evidenceMode ?? ''} | ${result.debug?.oddsSource ?? ''} | ${betMarket} | ${result.shouldPush ? 'yes' : 'no'} | ${result.confidence} | ${result.debug?.promptEstimatedTokens ?? ''} | ${result.debug?.aiTextEstimatedTokens ?? ''} | ${result.debug?.llmLatencyMs ?? ''} | ${assertions} |`,
    );
  }

  lines.push('');
  lines.push('## Details');
  lines.push('');

  for (const output of outputs) {
    const result = output.result;
    lines.push(`### ${output.scenarioName}`);
    lines.push(`- llmMode: ${output.llmMode}`);
    lines.push(`- oddsMode: ${output.oddsMode}`);
    lines.push(`- analysisMode: ${result.debug?.analysisMode ?? ''}`);
    lines.push(`- evidenceMode: ${result.debug?.evidenceMode ?? ''}`);
    lines.push(`- promptVersion: ${result.debug?.promptVersion ?? ''}`);
    lines.push(`- statsSource: ${result.debug?.statsSource ?? ''}`);
    lines.push(`- oddsSource: ${result.debug?.oddsSource ?? ''}`);
    lines.push(`- promptChars: ${result.debug?.promptChars ?? ''}`);
    lines.push(`- promptEstimatedTokens: ${result.debug?.promptEstimatedTokens ?? ''}`);
    lines.push(`- aiTextChars: ${result.debug?.aiTextChars ?? ''}`);
    lines.push(`- aiTextEstimatedTokens: ${result.debug?.aiTextEstimatedTokens ?? ''}`);
    lines.push(`- llmLatencyMs: ${result.debug?.llmLatencyMs ?? ''}`);
    lines.push(`- totalLatencyMs: ${result.debug?.totalLatencyMs ?? ''}`);
    lines.push(`- betMarket: ${String(((result.debug?.parsed ?? {}) as Record<string, unknown>).bet_market || '')}`);
    lines.push(`- shouldPush: ${String(result.shouldPush)}`);
    lines.push(`- saved: ${String(result.saved)}`);
    lines.push(`- notified: ${String(result.notified)}`);
    lines.push(`- selection: ${result.selection || '(none)'}`);
    lines.push(`- confidence: ${result.confidence}`);
    const reasoningEn = String(((result.debug?.parsed ?? {}) as Record<string, unknown>).reasoning_en || '');
    if (reasoningEn) {
      lines.push(`- reasoning_en: ${reasoningEn.length > 300 ? `${reasoningEn.slice(0, 300)}...` : reasoningEn}`);
    }
    if (result.debug?.parsed?.warnings) {
      lines.push(`- warnings: ${JSON.stringify(result.debug.parsed.warnings)}`);
    }
    if (output.assertions.length > 0) {
      lines.push(`- assertions: ${output.assertions.every((item) => item.pass) ? 'pass' : 'fail'}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const files = readdirSync(args.dirPath)
    .filter((name) => extname(name).toLowerCase() === '.json')
    .sort((a, b) => a.localeCompare(b));

  if (files.length === 0) {
    throw new Error(`No JSON scenarios found in ${args.dirPath}`);
  }

  const outputs: ReplayRunOutput[] = [];
  for (let i = 0; i < files.length; i++) {
    const file = files[i]!;
    const scenario = loadReplayScenarioFromFile(join(args.dirPath, file));
    let output = await runReplayScenario(scenario, args.options);
    let attempts = 0;
    while (
      !output.result.success
      && attempts < args.retries
      && String(output.result.error || '').toLowerCase().includes('aborted')
    ) {
      attempts++;
      if (args.delayMs > 0) {
        await sleep(args.delayMs);
      }
      output = await runReplayScenario(scenario, args.options);
    }
    outputs.push(output);
    if (args.delayMs > 0 && i < files.length - 1) {
      await sleep(args.delayMs);
    }
  }

  const summary = {
    dir: args.dirPath,
    total: outputs.length,
    passed: outputs.filter((item) => item.allPassed).length,
    metrics: buildMetricSummary(outputs),
    outputs,
  };

  if (args.reportJsonPath) {
    mkdirSync(dirname(args.reportJsonPath), { recursive: true });
    writeFileSync(args.reportJsonPath, JSON.stringify(summary, null, 2));
  }
  if (args.reportMdPath) {
    mkdirSync(dirname(args.reportMdPath), { recursive: true });
    writeFileSync(args.reportMdPath, buildMarkdownReport(outputs));
  }

  console.log(JSON.stringify(summary, null, 2));
  if (outputs.some((item) => !item.allPassed)) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
