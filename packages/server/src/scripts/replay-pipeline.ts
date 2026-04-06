import { resolve } from 'node:path';
import { config } from '../config.js';
import {
  loadReplayScenarioFromFile,
  runReplayScenario,
  type ReplayRunOptions,
} from '../lib/pipeline-replay.js';

function parseArgs(argv: string[]): {
  scenarioPath: string;
  options: ReplayRunOptions;
  llmModel?: string;
  allowRealLlm: boolean;
} {
  let scenarioPath = '';
  const options: ReplayRunOptions = {};
  let llmModel: string | undefined;
  let allowRealLlm = process.env['ALLOW_REAL_LLM_REPLAY'] === 'true';

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = argv[i + 1];
    if (arg === '--scenario' && next) {
      scenarioPath = next;
      i++;
      continue;
    }
    if (arg === '--llm' && next && (next === 'real' || next === 'mock')) {
      options.llmMode = next;
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
      options.oddsMode = next;
      i++;
      continue;
    }
    if (arg === '--no-shadow') {
      options.shadowMode = false;
      continue;
    }
    if (arg === '--sample-provider-data') {
      options.sampleProviderData = true;
    }
  }

  if (!scenarioPath) {
    throw new Error('Usage: tsx src/scripts/replay-pipeline.ts --scenario <file> [--llm real|mock] [--model <gemini-model>] [--allow-real-llm] [--odds recorded|live|mock] [--no-shadow] [--sample-provider-data]');
  }

  return {
    scenarioPath: resolve(process.cwd(), scenarioPath),
    options,
    llmModel,
    allowRealLlm,
  };
}

async function main(): Promise<void> {
  const { scenarioPath, options, llmModel, allowRealLlm } = parseArgs(process.argv.slice(2));
  if (options.llmMode === 'real' && !allowRealLlm) {
    throw new Error('Refusing to run real-LLM replay without explicit opt-in. Re-run with --allow-real-llm or set ALLOW_REAL_LLM_REPLAY=true.');
  }
  const scenario = loadReplayScenarioFromFile(scenarioPath);
  const output = await runReplayScenario({
    ...scenario,
    pipelineOptions: {
      ...(scenario.pipelineOptions ?? {}),
      modelOverride: options.llmMode === 'real'
        ? (llmModel ?? scenario.pipelineOptions?.modelOverride ?? config.geminiModel)
        : scenario.pipelineOptions?.modelOverride,
    },
  }, options);

  console.log(JSON.stringify(output, null, 2));
  if (!output.allPassed) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
