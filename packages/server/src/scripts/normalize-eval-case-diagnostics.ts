import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { normalizeEvaluatedReplayCaseDiagnostics } from '../lib/settled-replay-evaluation.js';
import { loadEvalCasesPayload } from '../lib/replay-vs-original-analysis.js';

interface Args {
  casesJson: string;
  outJson?: string;
}

function parseArgs(argv: string[]): Args {
  let casesJson = '';
  let outJson: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = argv[i + 1];
    if (arg === '--cases-json' && next) {
      casesJson = resolve(process.cwd(), next);
      i++;
    } else if (arg === '--out-json' && next) {
      outJson = resolve(process.cwd(), next);
      i++;
    }
  }
  if (!casesJson) {
    throw new Error(
      'Usage: tsx src/scripts/normalize-eval-case-diagnostics.ts --cases-json <eval-cases.json> [--out-json <file>]',
    );
  }
  return { casesJson, outJson };
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const payload = loadEvalCasesPayload(readFileSync(args.casesJson, 'utf8'));
  const normalized = {
    ...payload,
    generatedAt: new Date().toISOString(),
    variants: payload.variants.map((variant) => ({
      ...variant,
      cases: variant.cases.map(normalizeEvaluatedReplayCaseDiagnostics),
    })),
  };
  const text = `${JSON.stringify(normalized, null, 2)}\n`;
  if (args.outJson) {
    mkdirSync(dirname(args.outJson), { recursive: true });
    writeFileSync(args.outJson, text, 'utf8');
  }
  process.stdout.write(text);
}

main();
