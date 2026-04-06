import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, extname, resolve } from 'node:path';
import { config } from '../config.js';
import { callGemini } from '../lib/gemini.js';
import { runReplayScenario } from '../lib/pipeline-replay.js';
import type { SettledReplayScenario } from '../lib/db-replay-scenarios.js';
import {
  buildReplaySelfAuditPrompt,
  parseReplaySelfAuditResponse,
  type ReplaySelfAuditCase,
  summarizeReplaySelfAudit,
} from '../lib/settled-replay-self-audit.js';
import { getReplayMinuteBand, getReplayScoreState } from '../lib/settled-replay-evaluation.js';
import {
  buildReplayLlmCachePath,
  loadReplayLlmCache,
  saveReplayLlmCache,
} from '../lib/replay-llm-cache.js';

interface EvaluateArgs {
  dirPath: string;
  promptVersion: string;
  llmModel: string;
  allowRealLlm: boolean;
  oddsMode: 'recorded' | 'live' | 'mock';
  delayMs: number;
  maxScenarios?: number;
  minuteBand?: string;
  scoreState?: string;
  originalMarketFamily?: string;
  scenarioNameContains?: string;
  reportJsonPath?: string;
  reportMdPath?: string;
  llmCacheDir?: string;
}

function parseArgs(argv: string[]): EvaluateArgs {
  let dirPath = '';
  let promptVersion = '';
  let llmModel = config.geminiModel;
  let allowRealLlm = process.env['ALLOW_REAL_LLM_REPLAY'] === 'true';
  let oddsMode: EvaluateArgs['oddsMode'] = 'mock';
  let delayMs = 750;
  let maxScenarios: number | undefined;
  let minuteBand: string | undefined;
  let scoreState: string | undefined;
  let originalMarketFamily: string | undefined;
  let scenarioNameContains: string | undefined;
  let reportJsonPath: string | undefined;
  let reportMdPath: string | undefined;
  let llmCacheDir: string | undefined;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = argv[i + 1];
    if (arg === '--dir' && next) {
      dirPath = resolve(process.cwd(), next);
      i++;
      continue;
    }
    if (arg === '--prompt-version' && next) {
      promptVersion = next;
      i++;
      continue;
    }
    if (arg === '--model' && next) {
      llmModel = next;
      i++;
      continue;
    }
    if (arg === '--allow-real-llm') {
      allowRealLlm = true;
      continue;
    }
    if (arg === '--odds' && next && (next === 'recorded' || next === 'live' || next === 'mock')) {
      oddsMode = next;
      i++;
      continue;
    }
    if (arg === '--delay-ms' && next) {
      delayMs = Math.max(0, Number(next) || 0);
      i++;
      continue;
    }
    if (arg === '--max-scenarios' && next) {
      maxScenarios = Math.max(1, Number(next) || 1);
      i++;
      continue;
    }
    if (arg === '--minute-band' && next) {
      minuteBand = next;
      i++;
      continue;
    }
    if (arg === '--score-state' && next) {
      scoreState = next;
      i++;
      continue;
    }
    if (arg === '--original-market-family' && next) {
      originalMarketFamily = next;
      i++;
      continue;
    }
    if (arg === '--scenario-name-contains' && next) {
      scenarioNameContains = next.toLowerCase();
      i++;
      continue;
    }
    if (arg === '--report-json' && next) {
      reportJsonPath = resolve(process.cwd(), next);
      i++;
      continue;
    }
    if (arg === '--report-md' && next) {
      reportMdPath = resolve(process.cwd(), next);
      i++;
      continue;
    }
    if (arg === '--llm-cache-dir' && next) {
      llmCacheDir = resolve(process.cwd(), next);
      i++;
      continue;
    }
  }

  if (!dirPath || !promptVersion) {
    throw new Error('Usage: tsx src/scripts/evaluate-settled-prompt-self-audit.ts --dir <folder> --prompt-version <version> [--model <gemini-model>] [--allow-real-llm] [--odds recorded|live|mock] [--delay-ms N] [--max-scenarios N] [--minute-band 45-59] [--score-state 0-0] [--original-market-family 1x2|asian_handicap|goals_under|goals_over|corners|btts] [--scenario-name-contains text] [--llm-cache-dir <dir>] [--report-json <file>] [--report-md <file>]');
  }

  return {
    dirPath,
    promptVersion,
    llmModel,
    allowRealLlm,
    oddsMode,
    delayMs,
    maxScenarios,
    minuteBand,
    scoreState,
    originalMarketFamily,
    scenarioNameContains,
    reportJsonPath,
    reportMdPath,
    llmCacheDir,
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}

function loadScenario(filePath: string): SettledReplayScenario {
  return JSON.parse(readFileSync(filePath, 'utf8')) as SettledReplayScenario;
}

function matchesOriginalMarketFamily(
  market: string,
  family: string | undefined,
): boolean {
  if (!family || family === 'all') return true;
  const normalized = String(market || '').trim().toLowerCase();
  switch (family) {
    case '1x2':
      return normalized.startsWith('1x2_');
    case 'asian_handicap':
      return normalized.startsWith('asian_handicap_');
    case 'goals_under':
      return normalized.startsWith('under_') && !normalized.startsWith('corners_');
    case 'goals_over':
      return normalized.startsWith('over_') && !normalized.startsWith('corners_');
    case 'corners':
      return normalized.startsWith('corners_');
    case 'btts':
      return normalized.startsWith('btts');
    default:
      return true;
  }
}

function scenarioMatchesArgs(
  scenario: SettledReplayScenario,
  args: EvaluateArgs,
): boolean {
  if (args.minuteBand && getReplayMinuteBand(scenario.metadata.minute) !== args.minuteBand) {
    return false;
  }
  if (args.scoreState && getReplayScoreState(scenario.metadata.score) !== args.scoreState) {
    return false;
  }
  if (!matchesOriginalMarketFamily(scenario.metadata.originalBetMarket, args.originalMarketFamily)) {
    return false;
  }
  if (args.scenarioNameContains && !scenario.name.toLowerCase().includes(args.scenarioNameContains)) {
    return false;
  }
  return true;
}

async function callSelfAudit(prompt: string, model: string): Promise<string> {
  try {
    return await callGemini(prompt, model);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`Self-audit LLM call failed: ${reason}`);
  }
}

function buildMarkdownReport(summary: {
  generatedAt: string;
  promptVersion: string;
  oddsMode: string;
  totalScenarios: number;
  filters: Record<string, string | number | null>;
  summary: ReturnType<typeof summarizeReplaySelfAudit>;
  rows: ReplaySelfAuditCase[];
}): string {
  const lines: string[] = [
    '# Settled Replay Self-Audit',
    '',
    `- Generated: ${summary.generatedAt}`,
    `- Prompt version: ${summary.promptVersion}`,
    `- Odds mode: ${summary.oddsMode}`,
    `- Scenarios: ${summary.totalScenarios}`,
    `- Filters: ${JSON.stringify(summary.filters)}`,
    '',
    '## Aggregate',
    '',
    `- Under fallback detected: ${summary.summary.underFallbackDetected}`,
    `- Generic reasoning detected: ${summary.summary.genericReasoningDetected}`,
    `- Odds availability issue: ${summary.summary.oddsAvailabilityIssue}`,
    `- Continuity block: ${summary.summary.continuityBlock}`,
    `- Policy restriction: ${summary.summary.policyRestriction}`,
    `- Priors ignored: ${summary.summary.priorsIgnored}`,
    `- Priors contradicting: ${summary.summary.priorsContradicting}`,
    `- Replay goals-under count: ${summary.summary.replayUnderCount}`,
    `- Replay no-bet count: ${summary.summary.replayNoBetCount}`,
    '',
    '## Primary Drivers',
    '',
    '| Driver | Count |',
    '| --- | --- |',
  ];

  for (const row of summary.summary.primaryDrivers) {
    lines.push(`| ${row.key} | ${row.count} |`);
  }

  lines.push('');
  lines.push('## Cases');
  lines.push('');
  lines.push('| Scenario | Original | Replay | Driver | Under fallback | Generic | Why not 1x2 | Why not AH |');
  lines.push('| --- | --- | --- | --- | --- | --- | --- | --- |');
  for (const row of summary.rows) {
    lines.push(`| ${row.scenarioName} | ${row.originalBetMarket} | ${row.replayBetMarket || '(none)'} | ${row.primaryDecisionDriver || 'unknown'} | ${row.underFallbackDetected} | ${row.genericReasoningDetected} | ${row.whyNot1x2 || '-'} | ${row.whyNotAsianHandicap || '-'} |`);
  }

  return lines.join('\n');
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (!args.allowRealLlm) {
    throw new Error('Refusing to run real-LLM self-audit without explicit opt-in. Re-run with --allow-real-llm or set ALLOW_REAL_LLM_REPLAY=true.');
  }
  const files = readdirSync(args.dirPath)
    .filter((name) => extname(name).toLowerCase() === '.json' && !name.startsWith('_'))
    .sort((a, b) => a.localeCompare(b));

  if (files.length === 0) {
    throw new Error(`No scenario JSON files found in ${args.dirPath}`);
  }

  const filteredFiles = files.filter((file) => {
    const scenario = loadScenario(resolve(args.dirPath, file));
    return scenarioMatchesArgs(scenario, args);
  });
  const selectedFiles = typeof args.maxScenarios === 'number'
    ? filteredFiles.slice(0, args.maxScenarios)
    : filteredFiles;
  const scenarios = selectedFiles.map((file) => loadScenario(resolve(args.dirPath, file)));

  if (scenarios.length === 0) {
    throw new Error('No replay scenarios matched the requested filters.');
  }

  const rows: ReplaySelfAuditCase[] = [];
  for (let index = 0; index < scenarios.length; index++) {
    const scenario = scenarios[index]!;
    const cachePath = args.llmCacheDir
      ? buildReplayLlmCachePath(args.llmCacheDir, scenario, args.promptVersion, args.oddsMode)
      : null;
    const cached = cachePath ? loadReplayLlmCache(cachePath) : null;
    const replay = await runReplayScenario(scenario, {
      llmMode: 'real',
      oddsMode: args.oddsMode,
      shadowMode: true,
      advisoryOnly: true,
      promptVersionOverride: args.promptVersion as never,
      capturedAiText: cached?.aiText,
    });
    if (cachePath && !cached && replay.result.debug?.aiText) {
      saveReplayLlmCache(cachePath, {
        generatedAt: new Date().toISOString(),
        recommendationId: scenario.metadata.recommendationId,
        scenarioName: scenario.name,
        promptVersion: args.promptVersion,
        oddsMode: args.oddsMode,
        aiText: replay.result.debug.aiText,
        prompt: replay.result.debug.prompt ?? null,
        selection: replay.result.selection || null,
      });
    }
    const auditPrompt = buildReplaySelfAuditPrompt(scenario, replay);
    const auditText = await callSelfAudit(auditPrompt, args.llmModel);
    rows.push(parseReplaySelfAuditResponse(auditText, scenario, replay));
    if (args.delayMs > 0 && index < scenarios.length - 1) {
      await sleep(args.delayMs);
    }
  }

  const summary = {
    generatedAt: new Date().toISOString(),
    promptVersion: args.promptVersion,
    oddsMode: args.oddsMode,
    totalScenarios: rows.length,
    filters: {
      minuteBand: args.minuteBand ?? null,
      scoreState: args.scoreState ?? null,
      originalMarketFamily: args.originalMarketFamily ?? null,
      scenarioNameContains: args.scenarioNameContains ?? null,
      maxScenarios: args.maxScenarios ?? null,
    },
    summary: summarizeReplaySelfAudit(rows),
    rows,
  };

  if (args.reportJsonPath) {
    mkdirSync(dirname(args.reportJsonPath), { recursive: true });
    writeFileSync(args.reportJsonPath, JSON.stringify(summary, null, 2));
  }
  if (args.reportMdPath) {
    mkdirSync(dirname(args.reportMdPath), { recursive: true });
    writeFileSync(args.reportMdPath, buildMarkdownReport(summary));
  }

  console.log(JSON.stringify(summary, null, 2));
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
