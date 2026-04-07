import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import type { SettledReplayScenario } from '../lib/db-replay-scenarios.js';
import { buildOddsCanonical } from '../lib/server-pipeline.js';
import { detectGoalsCornersLineContamination } from '../lib/odds-integrity.js';
import { listReplayScenarioJsonBasenames } from '../lib/replay-scenario-files.js';

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
  const files = listReplayScenarioJsonBasenames(args.dirPath);

  const rows = files.map((file) => {
    const scenario = loadScenario(resolve(args.dirPath, file));
    const currentGoals = parseCurrentGoals(scenario.metadata.score);
    const canonical = buildOddsCanonical(scenario.mockResolvedOdds?.response ?? []).canonical;
    const contamination = detectGoalsCornersLineContamination(canonical, currentGoals);
    const x2 = canonical['1x2'];
    const has1x2Complete = !!(
      x2
      && x2.home != null
      && x2.home > 1
      && x2.draw != null
      && x2.draw > 1
      && x2.away != null
      && x2.away > 1
    );
    const ah = canonical.ah;
    const hasAsianHandicapPlayable = !!(
      ah
      && ah.home != null
      && ah.home > 1
      && ah.away != null
      && ah.away > 1
    );
    return {
      name: scenario.name,
      recommendationId: scenario.metadata.recommendationId,
      originalBetMarket: scenario.metadata.originalBetMarket,
      minute: scenario.metadata.minute,
      score: scenario.metadata.score,
      currentGoals,
      goalsLine: canonical.ou?.line ?? null,
      cornersLine: canonical.corners_ou?.line ?? null,
      ahLine: ah?.line ?? null,
      has1x2Complete,
      hasAsianHandicapPlayable,
      contaminated: contamination.contaminated,
      reason: contamination.reason,
    };
  });

  const summary = {
    generatedAt: new Date().toISOString(),
    totalScenarios: rows.length,
    contaminatedCount: rows.filter((row) => row.contaminated).length,
    oddsCoverage: {
      withComplete1x2: rows.filter((row) => row.has1x2Complete).length,
      withAsianHandicap: rows.filter((row) => row.hasAsianHandicapPlayable).length,
      withGoalsOu: rows.filter((row) => row.goalsLine != null).length,
      withCornersOu: rows.filter((row) => row.cornersLine != null).length,
    },
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
