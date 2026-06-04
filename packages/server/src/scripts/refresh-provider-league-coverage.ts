import { closePool } from '../db/pool.js';
import { assertFootballApiAvailable } from '../lib/football-api-circuit.js';
import { refreshLeagueCatalog, type LeagueCatalogRefreshMode } from '../lib/league-catalog.service.js';
import { closeRedis } from '../lib/redis.js';

interface Args {
  mode: LeagueCatalogRefreshMode;
  leagueIds: number[];
  force: boolean;
}

function readArg(name: string): string | null {
  const prefix = `--${name}=`;
  const inline = process.argv.find((arg) => arg.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const idx = process.argv.indexOf(`--${name}`);
  if (idx >= 0) return process.argv[idx + 1] ?? null;
  return null;
}

function parseMode(value: string | null): LeagueCatalogRefreshMode {
  if (value === 'full' || value === 'ids' || value === 'active-top') return value;
  return 'active-top';
}

function parseIds(value: string | null): number[] {
  if (!value) return [];
  return value
    .split(',')
    .map((part) => Number(part.trim()))
    .filter((value) => Number.isInteger(value) && value > 0);
}

function parseArgs(): Args {
  return {
    mode: parseMode(readArg('mode')),
    leagueIds: parseIds(readArg('ids')),
    force: process.argv.includes('--force'),
  };
}

async function main(): Promise<void> {
  const args = parseArgs();
  await assertFootballApiAvailable();
  const result = await refreshLeagueCatalog({
    mode: args.mode,
    leagueIds: args.leagueIds,
    force: args.force,
  });
  console.log(JSON.stringify({
    generatedAt: new Date().toISOString(),
    ...result,
  }, null, 2));
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.stack || err.message : String(err));
    process.exitCode = 1;
  })
  .finally(async () => {
    await Promise.allSettled([
      closePool(),
      closeRedis(),
    ]);
  });
