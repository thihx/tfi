import { closePool, query } from '../db/pool.js';
import { buildProviderOddsCoverageFlags } from '../lib/provider-coverage-audit.js';

interface Args {
  lookbackDays: number;
  limit: number;
  apply: boolean;
}

function readArg(name: string): string | null {
  const prefix = `--${name}=`;
  const inline = process.argv.find((arg) => arg.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const idx = process.argv.indexOf(`--${name}`);
  if (idx >= 0) return process.argv[idx + 1] ?? null;
  return null;
}

function parseArgs(): Args {
  const lookbackDays = Number(readArg('lookback-days') ?? 180);
  const limit = Number(readArg('limit') ?? 1000);
  return {
    lookbackDays: Number.isFinite(lookbackDays) && lookbackDays > 0 ? lookbackDays : 180,
    limit: Number.isFinite(limit) && limit > 0 ? limit : 1000,
    apply: process.argv.includes('--apply'),
  };
}

function changed(before: Record<string, unknown>, after: Record<string, unknown>): boolean {
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  for (const key of keys) {
    if (JSON.stringify(before[key] ?? null) !== JSON.stringify(after[key] ?? null)) return true;
  }
  return false;
}

async function main(): Promise<void> {
  const args = parseArgs();
  const rows = await query<{
    id: number;
    match_id: string;
    coverage_flags: Record<string, unknown>;
    normalized_payload: unknown;
  }>(
    `SELECT id, match_id, coverage_flags, normalized_payload
     FROM provider_odds_samples
     WHERE captured_at >= NOW() - ($1::text || ' days')::interval
       AND usable = TRUE
     ORDER BY captured_at DESC
     LIMIT $2`,
    [String(args.lookbackDays), args.limit],
  );

  let changedCount = 0;
  const examples: Array<{
    id: number;
    matchId: string;
    before: Record<string, unknown>;
    after: Record<string, unknown>;
  }> = [];

  for (const row of rows.rows) {
    const payload = Array.isArray(row.normalized_payload) ? row.normalized_payload : [];
    const recomputed = buildProviderOddsCoverageFlags(payload);
    const nextFlags = { ...(row.coverage_flags ?? {}), ...recomputed };
    if (!changed(row.coverage_flags ?? {}, nextFlags)) continue;

    changedCount += 1;
    if (examples.length < 20) {
      examples.push({
        id: row.id,
        matchId: row.match_id,
        before: row.coverage_flags ?? {},
        after: nextFlags,
      });
    }

    if (args.apply) {
      await query(
        `UPDATE provider_odds_samples
         SET coverage_flags = $2::jsonb
         WHERE id = $1`,
        [row.id, JSON.stringify(nextFlags)],
      );
    }
  }

  console.log(JSON.stringify({
    generatedAt: new Date().toISOString(),
    lookbackDays: args.lookbackDays,
    limit: args.limit,
    apply: args.apply,
    scanned: rows.rowCount,
    changed: changedCount,
    examples,
  }, null, 2));
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.stack || err.message : String(err));
    process.exitCode = 1;
  })
  .finally(async () => {
    await closePool().catch(() => undefined);
  });
