import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import {
  buildReplayPolicyExperimentReport,
  DEFAULT_REPLAY_POLICY_EXPERIMENTS,
  type ReplayPolicyExperimentConfig,
} from '../lib/replay-policy-experiment.js';
import { loadEvalCasesPayload } from '../lib/replay-vs-original-analysis.js';

interface Args {
  casesJson: string;
  outJson?: string;
  variantIndex: number;
  stakeCaps: Partial<Record<ReplayPolicyExperimentConfig['id'], number>>;
}

function parseArgs(argv: string[]): Args {
  let casesJson = '';
  let outJson: string | undefined;
  let variantIndex = 0;
  const stakeCaps: Args['stakeCaps'] = {};

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = argv[i + 1];
    if (arg === '--cases-json' && next) {
      casesJson = resolve(process.cwd(), next);
      i++;
    } else if (arg === '--out-json' && next) {
      outJson = resolve(process.cwd(), next);
      i++;
    } else if (arg === '--variant-index' && next) {
      variantIndex = Math.max(0, Number(next) || 0);
      i++;
    } else if (arg === '--stake-cap' && next) {
      const [id, rawValue] = next.split('=');
      const value = Number(rawValue);
      if (id && Number.isFinite(value) && value >= 0) {
        stakeCaps[id as ReplayPolicyExperimentConfig['id']] = value;
      }
      i++;
    }
  }

  if (!casesJson) {
    throw new Error(
      'Usage: tsx src/scripts/run-replay-policy-experiment.ts --cases-json <eval-cases.json> [--out-json <file>] [--variant-index 0] [--stake-cap experiment_id=1]',
    );
  }

  return { casesJson, outJson, variantIndex, stakeCaps };
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const payload = loadEvalCasesPayload(readFileSync(args.casesJson, 'utf8'));
  const variant = payload.variants[args.variantIndex];
  if (!variant) throw new Error(`No variant at index ${args.variantIndex}`);

  const experiments = DEFAULT_REPLAY_POLICY_EXPERIMENTS.map((experiment) => ({
    ...experiment,
    stakeCapPercent: args.stakeCaps[experiment.id] ?? experiment.stakeCapPercent,
  }));
  const report = buildReplayPolicyExperimentReport(variant.cases, experiments);
  const text = `${JSON.stringify(report, null, 2)}\n`;

  if (args.outJson) {
    mkdirSync(dirname(args.outJson), { recursive: true });
    writeFileSync(args.outJson, text, 'utf8');
  }
  process.stdout.write(text);
}

main();
