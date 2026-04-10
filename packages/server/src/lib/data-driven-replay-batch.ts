import { mkdirSync, readdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { buildRecommendationSnapshotCoverageReport } from './recommendation-snapshot-coverage.js';
import { buildSettledReplayScenarios, type SettledReplayScenarioFilters } from './db-replay-scenarios.js';
import { config } from '../config.js';

const serverRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

export interface DataDrivenBatchOptions {
  lookbackDays: number;
  limit: number;
  marketFamily: SettledReplayScenarioFilters['marketFamily'];
  exportPromptVersion?: string;
  maxScenarios: number;
  evalPromptVersions: string[];
  llmMode: 'real' | 'mock';
  allowRealLlm: boolean;
  oddsMode: 'recorded' | 'live' | 'mock';
  delayMs: number;
  applyReplayPolicy: boolean;
  skipEval: boolean;
  llmModel: string;
}

export interface DataDrivenBatchResult {
  runId: string;
  runRoot: string;
  scenarioCount: number;
}

function runIdNow(): string {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function writeScenariosDir(
  outDir: string,
  scenarios: Awaited<ReturnType<typeof buildSettledReplayScenarios>>,
): void {
  mkdirSync(outDir, { recursive: true });
  for (const entry of readdirSync(outDir)) {
    if (entry.toLowerCase().endsWith('.json')) unlinkSync(join(outDir, entry));
  }
  for (const scenario of scenarios) {
    writeFileSync(join(outDir, `${scenario.name}.json`), JSON.stringify(scenario, null, 2));
  }
}

export async function runDataDrivenReplayBatch(opts: DataDrivenBatchOptions): Promise<DataDrivenBatchResult> {
  if (opts.llmMode === 'real' && !opts.allowRealLlm) {
    throw new Error('Refusing real LLM without allowRealLlm.');
  }
  if (opts.llmMode === 'real' && !config.geminiApiKey?.trim()) {
    throw new Error('GEMINI_API_KEY is required for real LLM.');
  }
  if (opts.evalPromptVersions.length === 0) {
    throw new Error('evalPromptVersions is empty.');
  }

  const runId = runIdNow();
  const runRoot = join(serverRoot, 'replay-work', 'data-driven-runs', runId);
  const scenariosDir = join(runRoot, 'scenarios');
  const paths = {
    runRoot,
    scenariosDir,
    coverageJson: join(runRoot, 'coverage.json'),
    runSpecJson: join(runRoot, 'run-spec.json'),
    evalSummaryJson: join(runRoot, 'eval-summary.json'),
    evalSummaryMd: join(runRoot, 'eval-summary.md'),
    evalCasesJson: join(runRoot, 'eval-cases.json'),
  };

  mkdirSync(runRoot, { recursive: true });
  writeFileSync(
    paths.runSpecJson,
    JSON.stringify({ runId, generatedAt: new Date().toISOString(), ...opts, paths }, null, 2),
  );

  const coverage = await buildRecommendationSnapshotCoverageReport(opts.lookbackDays);
  writeFileSync(paths.coverageJson, JSON.stringify(coverage, null, 2));

  const scenarios = await buildSettledReplayScenarios({
    limit: opts.limit,
    lookbackDays: opts.lookbackDays,
    promptVersion: opts.exportPromptVersion,
    marketFamily: opts.marketFamily,
  });
  writeScenariosDir(scenariosDir, scenarios);

  const manifest = {
    exportedAt: new Date().toISOString(),
    count: scenarios.length,
    filters: {
      lookbackDays: opts.lookbackDays,
      limit: opts.limit,
      promptVersion: opts.exportPromptVersion ?? null,
      marketFamily: opts.marketFamily ?? 'all',
    },
    scenarios: scenarios.map((s) => ({
      name: s.name,
      recommendationId: s.metadata.recommendationId,
      matchId: s.matchId,
    })),
  };
  writeFileSync(join(scenariosDir, '_manifest.json'), JSON.stringify(manifest, null, 2));

  if (scenarios.length === 0) {
    return { runId, runRoot, scenarioCount: 0 };
  }

  if (!opts.skipEval) {
    const cacheRel = `replay-work/data-driven-runs/${runId}/llm-cache`;
    mkdirSync(join(serverRoot, cacheRel), { recursive: true });
    const relScenarios = `replay-work/data-driven-runs/${runId}/scenarios`;
    const runRel = `replay-work/data-driven-runs/${runId}`;
    const pv = opts.evalPromptVersions.map((v) => `--prompt-version ${v}`).join(' ');
    const policy = opts.applyReplayPolicy ? ' --apply-replay-policy' : '';
    const allow = opts.llmMode === 'real' ? ' --allow-real-llm' : '';
    const cmd =
      `npx tsx src/scripts/evaluate-settled-prompt-variants.ts --dir ${relScenarios} ${pv}` +
      ` --llm ${opts.llmMode} --model ${opts.llmModel}${allow}` +
      ` --odds ${opts.oddsMode} --delay-ms ${opts.delayMs}` +
      ` --max-scenarios ${opts.maxScenarios}${policy}` +
      ` --llm-cache-dir ${cacheRel}` +
      ` --report-json ${runRel}/eval-summary.json` +
      ` --report-md ${runRel}/eval-summary.md` +
      ` --report-cases-json ${runRel}/eval-cases.json`;
    const env = { ...process.env };
    if (opts.llmMode === 'real') env['ALLOW_REAL_LLM_REPLAY'] = 'true';
    const sh = spawnSync(cmd, { cwd: serverRoot, shell: true, stdio: 'inherit', env });
    if (sh.status !== 0) {
      throw new Error(`evaluate-settled-prompt-variants exited with ${sh.status ?? 'unknown'}`);
    }
  }

  return { runId, runRoot, scenarioCount: scenarios.length };
}
