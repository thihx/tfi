import { readdirSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, extname, resolve } from 'node:path';
import type { SettledReplayScenario } from '../lib/db-replay-scenarios.js';
import { buildOddsCanonical } from '../lib/server-pipeline.js';
import { detectGoalsCornersLineContamination } from '../lib/odds-integrity.js';

interface Args {
  dirPath: string;
  reportJsonPath?: string;
}

function parseArgs(argv: string[]): Args {
  let dirPath = '';
  let reportJsonPath: string | undefined;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = argv[i + 1];
    if (arg === '--dir' && next) {
      dirPath = resolve(process.cwd(), next);
      i++;
      continue;
    }
    if (arg === '--report-json' && next) {
      reportJsonPath = resolve(process.cwd(), next);
      i++;
      continue;
    }
  }

  if (!dirPath) {
    throw new Error('Usage: tsx src/scripts/audit-replay-odds-integrity.ts --dir <folder> [--report-json <file>]');
  }

  return { dirPath, reportJsonPath };
}

function loadScenario(filePath: string): SettledReplayScenario {
  return JSON.parse(readFileSync(filePath, 'utf8')) as SettledReplayScenario;
}

function parseCurrentGoals(score: string): number {
  const match = String(score || '').trim().match(/^(\d+)\s*[-:]\s*(\d+)$/);
  if (!match) return 0;
  return Number(match[1] ?? 0) + Number(match[2] ?? 0);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const files = readdirSync(args.dirPath)
    .filter((name) => extname(name).toLowerCase() === '.json' && !name.startsWith('_'))
    .sort((a, b) => a.localeCompare(b));

  const rows = files.map((file) => {
    const scenario = loadScenario(resolve(args.dirPath, file));
    const currentGoals = parseCurrentGoals(scenario.metadata.score);
    const canonical = buildOddsCanonical(scenario.mockResolvedOdds?.response ?? []).canonical;
    const contamination = detectGoalsCornersLineContamination(canonical, currentGoals);
    return {
      name: scenario.name,
      recommendationId: scenario.metadata.recommendationId,
      originalBetMarket: scenario.metadata.originalBetMarket,
      minute: scenario.metadata.minute,
      score: scenario.metadata.score,
      currentGoals,
      goalsLine: canonical.ou?.line ?? null,
      cornersLine: canonical.corners_ou?.line ?? null,
      contaminated: contamination.contaminated,
      reason: contamination.reason,
    };
  });

  const summary = {
    generatedAt: new Date().toISOString(),
    totalScenarios: rows.length,
    contaminatedCount: rows.filter((row) => row.contaminated).length,
    rows: rows.filter((row) => row.contaminated),
  };

  if (args.reportJsonPath) {
    mkdirSync(dirname(args.reportJsonPath), { recursive: true });
    writeFileSync(args.reportJsonPath, JSON.stringify(summary, null, 2));
  }

  console.log(JSON.stringify(summary, null, 2));
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
