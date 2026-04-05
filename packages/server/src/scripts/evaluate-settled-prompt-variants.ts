import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, extname, resolve } from 'node:path';
import { config } from '../config.js';
import { runReplayScenario } from '../lib/pipeline-replay.js';
import type { SettledReplayScenario } from '../lib/db-replay-scenarios.js';
import {
  buildReplayMarketOpportunity,
  classifyReplayMarketAvailability,
} from '../lib/replay-market-opportunities.js';
import {
  buildEvaluatedReplayCase,
  summarizeSettledReplayVariant,
  type EvaluatedReplayCase,
} from '../lib/settled-replay-evaluation.js';
import { settleMatch } from '../jobs/auto-settle.job.js';

interface EvaluateArgs {
  dirPath: string;
  promptVersions: string[];
  llmMode: 'real' | 'mock';
  oddsMode: 'recorded' | 'live' | 'mock';
  delayMs: number;
  reportJsonPath?: string;
  reportMdPath?: string;
}

function parseArgs(argv: string[]): EvaluateArgs {
  const promptVersions: string[] = [];
  let dirPath = '';
  let llmMode: EvaluateArgs['llmMode'] = 'real';
  let oddsMode: EvaluateArgs['oddsMode'] = 'mock';
  let delayMs = 750;
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
      promptVersions.push(next);
      i++;
      continue;
    }
    if (arg === '--llm' && next && (next === 'real' || next === 'mock')) {
      llmMode = next;
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

  if (!dirPath) {
    throw new Error('Usage: tsx src/scripts/evaluate-settled-prompt-variants.ts --dir <folder> [--prompt-version <version>]... [--llm real|mock] [--odds recorded|live|mock] [--delay-ms N] [--report-json <file>] [--report-md <file>]');
  }

  const fallbackPromptVersions = [
    config.liveAnalysisActivePromptVersion,
    config.liveAnalysisShadowPromptVersion,
  ].filter((value): value is string => typeof value === 'string' && value.trim().length > 0);

  return {
    dirPath,
    promptVersions: promptVersions.length > 0 ? promptVersions : [...new Set(fallbackPromptVersions)],
    llmMode,
    oddsMode,
    delayMs,
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

async function evaluateScenarioAgainstSettlement(
  scenario: SettledReplayScenario,
  promptVersion: string,
  llmMode: EvaluateArgs['llmMode'],
  oddsMode: EvaluateArgs['oddsMode'],
): Promise<EvaluatedReplayCase> {
  const output = await runReplayScenario(scenario, {
    llmMode,
    oddsMode,
    shadowMode: false,
    promptVersionOverride: promptVersion as never,
  });

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

  const replayPnl = settlementResult && settlementResult !== 'unresolved'
    ? (() => {
        switch (settlementResult) {
          case 'win':
            return (replayOdds - 1) * replayStake;
          case 'loss':
            return -replayStake;
          case 'half_win':
            return ((replayOdds - 1) * replayStake) / 2;
          case 'half_loss':
            return -replayStake / 2;
          case 'push':
          case 'void':
            return 0;
          default:
            return null;
        }
      })()
    : null;

  return buildEvaluatedReplayCase(
    promptVersion,
    scenario,
    output,
    settlementResult,
    replayOdds,
    replayStake,
    replayPnl,
    classifyReplayMarketAvailability(buildReplayMarketOpportunity(scenario)),
  );
}

function buildMarkdownReport(summary: {
  generatedAt: string;
  totalScenarios: number;
  promptVersions: string[];
  variants: ReturnType<typeof summarizeSettledReplayVariant>[];
}): string {
  const lines: string[] = [
    '# Settled Replay Prompt Evaluation',
    '',
    `- Generated: ${summary.generatedAt}`,
    `- Scenarios: ${summary.totalScenarios}`,
    `- Prompt versions: ${summary.promptVersions.join(', ') || '(none)'}`,
    '',
  ];

  for (const variant of summary.variants) {
    lines.push(`## ${variant.promptVersion}`);
    lines.push('');
    lines.push(`- Push rate: ${(variant.pushRate * 100).toFixed(2)}%`);
    lines.push(`- No-bet rate: ${(variant.noBetRate * 100).toFixed(2)}%`);
    lines.push(`- Goals Under share: ${(variant.goalsUnderShare * 100).toFixed(2)}%`);
    lines.push(`- Directional accuracy: ${(variant.accuracy * 100).toFixed(2)}% (${variant.winCount}/${variant.winCount + variant.lossCount})`);
    lines.push(`- Avg odds: ${variant.avgOdds.toFixed(2)}`);
    lines.push(`- Avg break-even required: ${(variant.avgBreakEvenRate * 100).toFixed(2)}%`);
    lines.push(`- Total staked: ${variant.totalStaked.toFixed(2)} units`);
    lines.push(`- Replay P/L: ${variant.totalPnl.toFixed(2)} units`);
    lines.push(`- Replay ROI: ${(variant.roi * 100).toFixed(2)}%`);
    lines.push('');
    lines.push('| Cohort | Total | Push | No Bet | Under | Over | Under Share | Accuracy | Avg Odds | Break-even | P/L | ROI |');
    lines.push('| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |');
    for (const row of variant.byMinuteBand) {
      lines.push(`| Minute ${row.bucket} | ${row.total} | ${row.pushCount} | ${row.noBetCount} | ${row.goalsUnderCount} | ${row.goalsOverCount} | ${(row.underShare * 100).toFixed(2)}% | ${(row.accuracy * 100).toFixed(2)}% | ${row.avgOdds.toFixed(2)} | ${(row.avgBreakEvenRate * 100).toFixed(2)}% | ${row.totalPnl.toFixed(2)} | ${(row.roi * 100).toFixed(2)}% |`);
    }
    lines.push('');
    lines.push('### By Evidence Mode');
    lines.push('');
    lines.push('| Evidence Mode | Total | Push | No Bet | Under | Over | Under Share | Accuracy | Avg Odds | Break-even | P/L | ROI |');
    lines.push('| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |');
    for (const row of variant.byEvidenceMode) {
      lines.push(`| ${row.bucket} | ${row.total} | ${row.pushCount} | ${row.noBetCount} | ${row.goalsUnderCount} | ${row.goalsOverCount} | ${(row.underShare * 100).toFixed(2)}% | ${(row.accuracy * 100).toFixed(2)}% | ${row.avgOdds.toFixed(2)} | ${(row.avgBreakEvenRate * 100).toFixed(2)}% | ${row.totalPnl.toFixed(2)} | ${(row.roi * 100).toFixed(2)}% |`);
    }
    lines.push('');
    lines.push('### By Market Availability');
    lines.push('');
    lines.push('| Availability | Total | Push | No Bet | Under | Over | Under Share | Accuracy | Avg Odds | Break-even | P/L | ROI |');
    lines.push('| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |');
    for (const row of variant.byMarketAvailability) {
      lines.push(`| ${row.bucket} | ${row.total} | ${row.pushCount} | ${row.noBetCount} | ${row.goalsUnderCount} | ${row.goalsOverCount} | ${(row.underShare * 100).toFixed(2)}% | ${(row.accuracy * 100).toFixed(2)}% | ${row.avgOdds.toFixed(2)} | ${(row.avgBreakEvenRate * 100).toFixed(2)}% | ${row.totalPnl.toFixed(2)} | ${(row.roi * 100).toFixed(2)}% |`);
    }
    lines.push('');
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
  if (args.promptVersions.length === 0) {
    throw new Error('No prompt versions provided and no configured active/shadow versions were available.');
  }

  const scenarios = files.map((file) => loadScenario(resolve(args.dirPath, file)));
  const variantEvaluations = new Map<string, EvaluatedReplayCase[]>();

  for (const promptVersion of args.promptVersions) {
    const rows: EvaluatedReplayCase[] = [];
    for (let index = 0; index < scenarios.length; index++) {
      const scenario = scenarios[index]!;
      rows.push(await evaluateScenarioAgainstSettlement(
        scenario,
        promptVersion,
        args.llmMode,
        args.oddsMode,
      ));
      if (args.delayMs > 0 && index < scenarios.length - 1) {
        await sleep(args.delayMs);
      }
    }
    variantEvaluations.set(promptVersion, rows);
  }

  const summary = {
    generatedAt: new Date().toISOString(),
    totalScenarios: scenarios.length,
    promptVersions: args.promptVersions,
    variants: args.promptVersions.map((promptVersion) => summarizeSettledReplayVariant(
      promptVersion,
      variantEvaluations.get(promptVersion) ?? [],
    )),
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
