import { mkdirSync, readdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import {
  buildSettledReplayScenarios,
  type SettledReplayScenarioFilters,
} from '../lib/db-replay-scenarios.js';

interface ExportArgs extends SettledReplayScenarioFilters {
  outDir: string;
  manifestPath?: string;
}

function parseArgs(argv: string[]): ExportArgs {
  const args: ExportArgs = {
    outDir: '',
    lookbackDays: 14,
    limit: 100,
    marketFamily: 'all',
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = argv[i + 1];
    if (arg === '--out-dir' && next) {
      args.outDir = resolve(process.cwd(), next);
      i++;
      continue;
    }
    if (arg === '--manifest' && next) {
      args.manifestPath = resolve(process.cwd(), next);
      i++;
      continue;
    }
    if (arg === '--lookback-days' && next) {
      args.lookbackDays = Math.max(1, Number(next) || 14);
      i++;
      continue;
    }
    if (arg === '--limit' && next) {
      args.limit = Math.max(1, Math.min(1000, Number(next) || 100));
      i++;
      continue;
    }
    if (arg === '--prompt-version' && next) {
      args.promptVersion = next;
      i++;
      continue;
    }
    if (arg === '--market-family' && next && ['all', 'goals_totals', 'goals_under', 'goals_over'].includes(next)) {
      args.marketFamily = next as ExportArgs['marketFamily'];
      i++;
      continue;
    }
  }

  if (!args.outDir) {
    throw new Error('Usage: tsx src/scripts/export-settled-replay-scenarios.ts --out-dir <dir> [--manifest <file>] [--lookback-days N] [--limit N] [--prompt-version <version>] [--market-family all|goals_totals|goals_under|goals_over]');
  }

  return args;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const scenarios = await buildSettledReplayScenarios({
    limit: args.limit,
    lookbackDays: args.lookbackDays,
    promptVersion: args.promptVersion,
    marketFamily: args.marketFamily,
  });

  mkdirSync(args.outDir, { recursive: true });
  for (const entry of readdirSync(args.outDir)) {
    if (entry.toLowerCase().endsWith('.json')) {
      unlinkSync(join(args.outDir, entry));
    }
  }

  for (const scenario of scenarios) {
    writeFileSync(
      join(args.outDir, `${scenario.name}.json`),
      JSON.stringify(scenario, null, 2),
    );
  }

  const manifest = {
    exportedAt: new Date().toISOString(),
    count: scenarios.length,
    filters: {
      lookbackDays: args.lookbackDays,
      limit: args.limit,
      promptVersion: args.promptVersion ?? null,
      marketFamily: args.marketFamily ?? 'all',
    },
    scenarios: scenarios.map((scenario) => ({
      name: scenario.name,
      recommendationId: scenario.metadata.recommendationId,
      matchId: scenario.matchId,
      minute: scenario.metadata.minute,
      score: scenario.metadata.score,
      originalBetMarket: scenario.metadata.originalBetMarket,
      originalResult: scenario.metadata.originalResult,
      promptVersion: scenario.metadata.originalPromptVersion,
    })),
  };

  const manifestPath = args.manifestPath || join(args.outDir, '_manifest.json');
  mkdirSync(dirname(manifestPath), { recursive: true });
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  console.log(JSON.stringify(manifest, null, 2));
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
