import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import { aggregateEvalCasesPayloads, type EvalCasesAggregateInput } from '../lib/eval-cases-aggregate.js';
import { loadEvalCasesPayload } from '../lib/replay-vs-original-analysis.js';

interface Args {
  casesJsonPaths: string[];
  outJson?: string;
}

function parseArgs(argv: string[]): Args {
  const casesJsonPaths: string[] = [];
  let outJson: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = argv[i + 1];
    if ((arg === '--cases-json' || arg === '--input') && next) {
      casesJsonPaths.push(resolve(process.cwd(), next));
      i++;
    } else if (arg === '--out-json' && next) {
      outJson = resolve(process.cwd(), next);
      i++;
    }
  }
  if (casesJsonPaths.length === 0) {
    throw new Error(
      'Usage: tsx src/scripts/aggregate-eval-cases.ts --cases-json <run/eval-cases.json> [--cases-json <...>] [--out-json <file>]',
    );
  }
  return { casesJsonPaths, outJson };
}

function inferRunId(casesJsonPath: string): string {
  const parent = basename(dirname(casesJsonPath));
  return parent || basename(casesJsonPath);
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const inputs: EvalCasesAggregateInput[] = args.casesJsonPaths.map((path) => ({
    runId: inferRunId(path),
    payload: loadEvalCasesPayload(readFileSync(path, 'utf8')),
  }));
  const report = aggregateEvalCasesPayloads(inputs);
  const text = `${JSON.stringify(report, null, 2)}\n`;
  if (args.outJson) {
    mkdirSync(dirname(args.outJson), { recursive: true });
    writeFileSync(args.outJson, text, 'utf8');
  }
  process.stdout.write(text);
}

main();
