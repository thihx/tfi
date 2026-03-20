import { resolve } from 'node:path';
import {
  loadReplayScenarioFromFile,
  runReplayScenario,
  type ReplayRunOptions,
} from '../lib/pipeline-replay.js';

function parseArgs(argv: string[]): { scenarioPath: string; options: ReplayRunOptions } {
  let scenarioPath = '';
  const options: ReplayRunOptions = {};

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
    throw new Error('Usage: tsx src/scripts/replay-pipeline.ts --scenario <file> [--llm real|mock] [--odds recorded|live|mock] [--no-shadow] [--sample-provider-data]');
  }

  return { scenarioPath: resolve(process.cwd(), scenarioPath), options };
}

async function main(): Promise<void> {
  const { scenarioPath, options } = parseArgs(process.argv.slice(2));
  const scenario = loadReplayScenarioFromFile(scenarioPath);
  const output = await runReplayScenario(scenario, options);

  console.log(JSON.stringify(output, null, 2));
  if (!output.allPassed) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
