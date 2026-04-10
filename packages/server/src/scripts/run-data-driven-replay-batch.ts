import { runDataDrivenReplayBatch, type DataDrivenBatchOptions } from '../lib/data-driven-replay-batch.js';
import { config } from '../config.js';

function parseArgs(argv: string[]): DataDrivenBatchOptions {
  let lookbackDays = 14;
  let limit = 80;
  let marketFamily: DataDrivenBatchOptions['marketFamily'] = 'all';
  let exportPromptVersion: string | undefined;
  let maxScenarios = 40;
  const evalPromptVersions: string[] = [];
  let llmMode: DataDrivenBatchOptions['llmMode'] = 'mock';
  let allowRealLlm = process.env['ALLOW_REAL_LLM_REPLAY'] === 'true';
  let oddsMode: DataDrivenBatchOptions['oddsMode'] = 'recorded';
  let delayMs = 750;
  let applyReplayPolicy = false;
  let skipEval = false;
  let llmModel = process.env['GEMINI_REPLAY_MODEL']?.trim() || config.geminiModel;

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const n = argv[i + 1];
    if (a === '--lookback-days' && n) {
      lookbackDays = Math.max(1, Number(n) || 14);
      i++;
    } else if (a === '--limit' && n) {
      limit = Math.max(1, Math.min(1000, Number(n) || 80));
      i++;
    } else if (a === '--market-family' && n && ['all', 'goals_totals', 'goals_under', 'goals_over', 'first_half'].includes(n)) {
      marketFamily = n as DataDrivenBatchOptions['marketFamily'];
      i++;
    } else if (a === '--export-prompt-version' && n) {
      exportPromptVersion = n;
      i++;
    } else if (a === '--max-scenarios' && n) {
      maxScenarios = Math.max(1, Math.min(500, Number(n) || 40));
      i++;
    } else if (a === '--eval-prompt-version' && n) {
      evalPromptVersions.push(n);
      i++;
    } else if (a === '--llm' && n && (n === 'real' || n === 'mock')) {
      llmMode = n;
      i++;
    } else if (a === '--allow-real-llm') {
      allowRealLlm = true;
    } else if (a === '--odds' && n && (n === 'recorded' || n === 'live' || n === 'mock')) {
      oddsMode = n;
      i++;
    } else if (a === '--delay-ms' && n) {
      delayMs = Math.max(0, Math.min(10_000, Number(n) || 0));
      i++;
    } else if (a === '--apply-replay-policy') {
      applyReplayPolicy = true;
    } else if (a === '--skip-eval') {
      skipEval = true;
    } else if (a === '--model' && n) {
      llmModel = n;
      i++;
    }
  }

  if (evalPromptVersions.length === 0) {
    const fb = [config.liveAnalysisActivePromptVersion, config.liveAnalysisShadowPromptVersion].filter(
      (v): v is string => typeof v === 'string' && v.trim().length > 0,
    );
    evalPromptVersions.push(...[...new Set(fb)]);
  }

  return {
    lookbackDays,
    limit,
    marketFamily,
    exportPromptVersion,
    maxScenarios,
    evalPromptVersions,
    llmMode,
    allowRealLlm,
    oddsMode,
    delayMs,
    applyReplayPolicy,
    skipEval,
    llmModel,
  };
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));
  console.log('[data-driven-batch] starting', { lookbackDays: opts.lookbackDays, limit: opts.limit, llmMode: opts.llmMode });
  const out = await runDataDrivenReplayBatch(opts);
  console.log('[data-driven-batch] runRoot=', out.runRoot, 'scenarios=', out.scenarioCount);
  if (out.scenarioCount === 0) {
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
