import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, extname, resolve } from 'node:path';
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

interface EvaluateArgs {
  dirPath: string;
  promptVersion: string;
  oddsMode: 'recorded' | 'live' | 'mock';
  delayMs: number;
  maxScenarios?: number;
  minuteBand?: string;
  scoreState?: string;
  originalMarketFamily?: string;
  scenarioNameContains?: string;
  reportJsonPath?: string;
  reportMdPath?: string;
}

function parseArgs(argv: string[]): EvaluateArgs {
  let dirPath = '';
  let promptVersion = '';
  let oddsMode: EvaluateArgs['oddsMode'] = 'mock';
  let delayMs = 750;
  let maxScenarios: number | undefined;
  let minuteBand: string | undefined;
  let scoreState: string | undefined;
  let originalMarketFamily: string | undefined;
  let scenarioNameContains: string | undefined;
  let reportJsonPath: string | undefined;
  let reportMdPath: string | undefined;

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
  }

  if (!dirPath || !promptVersion) {
    throw new Error('Usage: tsx src/scripts/evaluate-settled-prompt-self-audit.ts --dir <folder> --prompt-version <version> [--odds recorded|live|mock] [--delay-ms N] [--max-scenarios N] [--minute-band 45-59] [--score-state 0-0] [--original-market-family 1x2|asian_handicap|goals_under|goals_over|corners|btts] [--scenario-name-contains text] [--report-json <file>] [--report-md <file>]');
  }

  return {
    dirPath,
    promptVersion,
    oddsMode,
    delayMs,
    maxScenarios,
    minuteBand,
    scoreState,
    originalMarketFamily,
    scenarioNameContains,
    reportJsonPath,
    reportMdPath,
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

async function callSelfAudit(prompt: string): Promise<string> {
  try {
    return await callGemini(prompt, 'gemini-3-pro-preview');
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
    const replay = await runReplayScenario(scenario, {
      llmMode: 'real',
      oddsMode: args.oddsMode,
      shadowMode: false,
      promptVersionOverride: args.promptVersion as never,
    });
    const auditPrompt = buildReplaySelfAuditPrompt(scenario, replay);
    const auditText = await callSelfAudit(auditPrompt);
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
