import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
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
import {
  buildReplayLlmCachePath,
  loadReplayLlmCache,
  saveReplayLlmCache,
} from '../lib/replay-llm-cache.js';
import { listReplayScenarioJsonBasenames } from '../lib/replay-scenario-files.js';

interface EvaluateArgs {
  dirPath: string;
  promptVersions: string[];
  llmMode: 'real' | 'mock';
  llmModel: string;
  allowRealLlm: boolean;
  oddsMode: 'recorded' | 'live' | 'mock';
  delayMs: number;
  /** Cap cohort size after manifest order (first N scenarios). */
  maxScenarios?: number;
  reportJsonPath?: string;
  reportMdPath?: string;
  reportCasesJsonPath?: string;
  llmCacheDir?: string;
  /** Run recommendation-policy after LLM parse (production parity with settled-replay trace). */
  applySettledReplayPolicy?: boolean;
}

function parseArgs(argv: string[]): EvaluateArgs {
  const promptVersions: string[] = [];
  let dirPath = '';
  let llmMode: EvaluateArgs['llmMode'] = 'real';
  let llmModel = config.geminiModel;
  let allowRealLlm = process.env['ALLOW_REAL_LLM_REPLAY'] === 'true';
  let oddsMode: EvaluateArgs['oddsMode'] = 'mock';
  let delayMs = 750;
  let reportJsonPath: string | undefined;
  let reportMdPath: string | undefined;
  let reportCasesJsonPath: string | undefined;
  let llmCacheDir: string | undefined;
  let maxScenarios: number | undefined;
  let applySettledReplayPolicy = false;

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
    if (arg === '--report-cases-json' && next) {
      reportCasesJsonPath = resolve(process.cwd(), next);
      i++;
      continue;
    }
    if (arg === '--llm-cache-dir' && next) {
      llmCacheDir = resolve(process.cwd(), next);
      i++;
      continue;
    }
    if (arg === '--max-scenarios' && next) {
      maxScenarios = Math.max(1, Math.min(2000, Number(next) || 0));
      i++;
      continue;
    }
    if (arg === '--apply-replay-policy') {
      applySettledReplayPolicy = true;
      continue;
    }
  }

  if (!dirPath) {
    throw new Error('Usage: tsx src/scripts/evaluate-settled-prompt-variants.ts --dir <folder> [--prompt-version <version>]... [--llm real|mock] [--model <gemini-model>] [--allow-real-llm] [--odds recorded|live|mock] [--delay-ms N] [--max-scenarios N] [--apply-replay-policy] [--llm-cache-dir <dir>] [--report-json <file>] [--report-md <file>] [--report-cases-json <file>]');
  }

  const fallbackPromptVersions = [
    config.liveAnalysisActivePromptVersion,
    config.liveAnalysisShadowPromptVersion,
  ].filter((value): value is string => typeof value === 'string' && value.trim().length > 0);

  return {
    dirPath,
    promptVersions: promptVersions.length > 0 ? promptVersions : [...new Set(fallbackPromptVersions)],
    llmMode,
    llmModel,
    allowRealLlm,
    oddsMode,
    delayMs,
    reportJsonPath,
    reportMdPath,
    reportCasesJsonPath,
    llmCacheDir,
    maxScenarios,
    applySettledReplayPolicy,
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
  llmModel: string,
  oddsMode: EvaluateArgs['oddsMode'],
  llmCacheDir?: string,
  applySettledReplayPolicy?: boolean,
): Promise<EvaluatedReplayCase> {
  const cachePath = llmMode === 'real' && llmCacheDir
    ? buildReplayLlmCachePath(llmCacheDir, scenario, promptVersion, oddsMode, 'settled-trace')
    : null;
  const cached = cachePath ? loadReplayLlmCache(cachePath) : null;
  const output = await runReplayScenario({
    ...scenario,
    pipelineOptions: {
      ...(scenario.pipelineOptions ?? {}),
      modelOverride: llmMode === 'real' ? llmModel : scenario.pipelineOptions?.modelOverride,
    },
  }, {
    llmMode,
    oddsMode,
    shadowMode: true,
    advisoryOnly: true,
    promptVersionOverride: promptVersion as never,
    capturedAiText: cached?.aiText,
    settledReplayApprovedTrace: true,
    applySettledReplayPolicy: applySettledReplayPolicy === true,
  });

  if (cachePath && !cached && output.result.debug?.aiText) {
    saveReplayLlmCache(cachePath, {
      generatedAt: new Date().toISOString(),
      recommendationId: scenario.metadata.recommendationId,
      scenarioName: scenario.name,
      promptVersion,
      oddsMode,
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

function formatSideMarketKpis(variant: ReturnType<typeof summarizeSettledReplayVariant>): string[] {
  const x2 = variant.byMarketFamily.find((f) => f.family === '1x2');
  const ah = variant.byMarketFamily.find((f) => f.family === 'asian_handicap');
  const pushTotal = variant.pushCount;
  const x2n = x2?.pushCount ?? 0;
  const ahn = ah?.pushCount ?? 0;
  const share = (count: number) => (pushTotal > 0 ? (count / pushTotal) * 100 : 0);
  return [
    '### Side markets KPI (1X2 / Asian Handicap)',
    '',
    `- 1X2 pushes: ${x2n} (${share(x2n).toFixed(2)}% of actionable pushes, ${((x2?.pushRateOfCohort ?? 0) * 100).toFixed(2)}% of cohort)`,
    `- Asian Handicap pushes: ${ahn} (${share(ahn).toFixed(2)}% of actionable pushes, ${((ah?.pushRateOfCohort ?? 0) * 100).toFixed(2)}% of cohort)`,
    '',
  ];
}

function buildMarkdownReport(summary: {
  generatedAt: string;
  totalScenarios: number;
  applySettledReplayPolicy?: boolean;
  promptVersions: string[];
  variants: ReturnType<typeof summarizeSettledReplayVariant>[];
}): string {
  const lines: string[] = [
    '# Settled Replay Prompt Evaluation',
    '',
    `- Generated: ${summary.generatedAt}`,
    `- Scenarios: ${summary.totalScenarios}`,
    `- Post-parse recommendation policy: ${summary.applySettledReplayPolicy ? 'applied (production parity)' : 'skipped (settled-replay default)'}`,
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
    lines.push(...formatSideMarketKpis(variant));
    lines.push('| Cohort | Total | Push | No Bet | Under | Over | Under Share | Accuracy | Avg Odds | Break-even | P/L | ROI |');
    lines.push('| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |');
    for (const row of variant.byMinuteBand) {
      lines.push(`| Minute ${row.bucket} | ${row.total} | ${row.pushCount} | ${row.noBetCount} | ${row.goalsUnderCount} | ${row.goalsOverCount} | ${(row.underShare * 100).toFixed(2)}% | ${(row.accuracy * 100).toFixed(2)}% | ${row.avgOdds.toFixed(2)} | ${(row.avgBreakEvenRate * 100).toFixed(2)}% | ${row.totalPnl.toFixed(2)} | ${(row.roi * 100).toFixed(2)}% |`);
    }
    lines.push('');
    lines.push('### Fine time windows (hotspot diagnosis)');
    lines.push('');
    lines.push('| Window | Total | Push | No Bet | Under | Over | Under Share | Accuracy | Avg Odds | Break-even | P/L | ROI |');
    lines.push('| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |');
    for (const row of variant.byFineTimeWindow) {
      lines.push(`| ${row.bucket} | ${row.total} | ${row.pushCount} | ${row.noBetCount} | ${row.goalsUnderCount} | ${row.goalsOverCount} | ${(row.underShare * 100).toFixed(2)}% | ${(row.accuracy * 100).toFixed(2)}% | ${row.avgOdds.toFixed(2)} | ${(row.avgBreakEvenRate * 100).toFixed(2)}% | ${row.totalPnl.toFixed(2)} | ${(row.roi * 100).toFixed(2)}% |`);
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
    lines.push('### By market family (actionable pushes only)');
    lines.push('');
    lines.push('| Family | Pushes | Share of pushes | Push % of cohort | Wins | Losses | Win rate | Avg odds | Staked | P/L | ROI |');
    lines.push('| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |');
    for (const mf of variant.byMarketFamily) {
      lines.push(
        `| ${mf.family} | ${mf.pushCount} | ${(mf.shareOfActionable * 100).toFixed(2)}% | ${(mf.pushRateOfCohort * 100).toFixed(2)}% | ${mf.winCount} | ${mf.lossCount} | ${(mf.accuracy * 100).toFixed(2)}% | ${mf.avgOdds.toFixed(2)} | ${mf.totalStaked.toFixed(2)} | ${mf.totalPnl.toFixed(2)} | ${(mf.roi * 100).toFixed(2)}% |`,
      );
    }
    lines.push('');
    lines.push('### Top canonical markets (actionable pushes)');
    lines.push('');
    lines.push('| Market | Family | Pushes | Push % of cohort | Wins | Losses | Win rate | Avg odds | Staked | P/L | ROI |');
    lines.push('| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |');
    for (const cm of variant.byCanonicalMarketTop) {
      lines.push(
        `| ${cm.canonicalMarket} | ${cm.family} | ${cm.pushCount} | ${(cm.pushRateOfCohort * 100).toFixed(2)}% | ${cm.winCount} | ${cm.lossCount} | ${(cm.accuracy * 100).toFixed(2)}% | ${cm.avgOdds.toFixed(2)} | ${cm.totalStaked.toFixed(2)} | ${cm.totalPnl.toFixed(2)} | ${(cm.roi * 100).toFixed(2)}% |`,
      );
    }
    lines.push('');
    lines.push('### Minute band × market family (push rate in band, win rate, ROI)');
    lines.push('');
    lines.push('| Minute | Family | Pushes | Band total | Push % in band | Wins | Losses | Win rate | Staked | P/L | ROI |');
    lines.push('| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |');
    for (const cell of variant.byMinuteBandMarketFamily) {
      lines.push(
        `| ${cell.slice} | ${cell.family} | ${cell.pushCount} | ${cell.sliceTotal} | ${(cell.pushRateInSlice * 100).toFixed(2)}% | ${cell.winCount} | ${cell.lossCount} | ${(cell.accuracy * 100).toFixed(2)}% | ${cell.totalStaked.toFixed(2)} | ${cell.totalPnl.toFixed(2)} | ${(cell.roi * 100).toFixed(2)}% |`,
      );
    }
    lines.push('');
    lines.push('### Score state × market family');
    lines.push('');
    lines.push('| Score state | Family | Pushes | Slice total | Push % in slice | Wins | Losses | Win rate | Staked | P/L | ROI |');
    lines.push('| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |');
    for (const cell of variant.byScoreStateMarketFamily) {
      lines.push(
        `| ${cell.slice} | ${cell.family} | ${cell.pushCount} | ${cell.sliceTotal} | ${(cell.pushRateInSlice * 100).toFixed(2)}% | ${cell.winCount} | ${cell.lossCount} | ${(cell.accuracy * 100).toFixed(2)}% | ${cell.totalStaked.toFixed(2)} | ${cell.totalPnl.toFixed(2)} | ${(cell.roi * 100).toFixed(2)}% |`,
      );
    }
    lines.push('');
  }

  return lines.join('\n');
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.llmMode === 'real' && !args.allowRealLlm) {
    throw new Error('Refusing to run real-LLM replay without explicit opt-in. Re-run with --allow-real-llm or set ALLOW_REAL_LLM_REPLAY=true.');
  }
  let files = listReplayScenarioJsonBasenames(args.dirPath);
  if (typeof args.maxScenarios === 'number' && files.length > args.maxScenarios) {
    files = files.slice(0, args.maxScenarios);
  }

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
        args.llmModel,
        args.oddsMode,
        args.llmCacheDir,
        args.applySettledReplayPolicy,
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
    applySettledReplayPolicy: args.applySettledReplayPolicy === true,
    promptVersions: args.promptVersions,
    variants: args.promptVersions.map((promptVersion) => summarizeSettledReplayVariant(
      promptVersion,
      variantEvaluations.get(promptVersion) ?? [],
    )),
  };
  const casesPayload = {
    generatedAt: summary.generatedAt,
    totalScenarios: scenarios.length,
    applySettledReplayPolicy: summary.applySettledReplayPolicy,
    promptVersions: args.promptVersions,
    variants: args.promptVersions.map((promptVersion) => ({
      promptVersion,
      summary: summarizeSettledReplayVariant(promptVersion, variantEvaluations.get(promptVersion) ?? []),
      cases: variantEvaluations.get(promptVersion) ?? [],
    })),
  };

  if (args.reportJsonPath) {
    mkdirSync(dirname(args.reportJsonPath), { recursive: true });
    writeFileSync(args.reportJsonPath, JSON.stringify(summary, null, 2));
  }
  if (args.reportMdPath) {
    mkdirSync(dirname(args.reportMdPath), { recursive: true });
    writeFileSync(args.reportMdPath, buildMarkdownReport(summary));
  }
  if (args.reportCasesJsonPath) {
    mkdirSync(dirname(args.reportCasesJsonPath), { recursive: true });
    writeFileSync(args.reportCasesJsonPath, JSON.stringify(casesPayload, null, 2));
  }

  console.log(JSON.stringify(summary, null, 2));
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
