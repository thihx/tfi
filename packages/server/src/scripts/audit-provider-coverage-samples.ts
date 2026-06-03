import { closePool, query } from '../db/pool.js';
import {
  auditOddsCoverageSample,
  summarizeOddsCoverageAudit,
} from '../lib/provider-coverage-audit.js';

interface Args {
  lookbackDays: number;
  limit: number;
  usableOnly: boolean;
  outJson: string;
  failOnMismatch: boolean;
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
  const limit = Number(readArg('limit') ?? 500);
  const outJson = readArg('out-json') ?? '';
  return {
    lookbackDays: Number.isFinite(lookbackDays) && lookbackDays > 0 ? lookbackDays : 180,
    limit: Number.isFinite(limit) && limit > 0 ? limit : 500,
    usableOnly: !process.argv.includes('--all'),
    outJson,
    failOnMismatch: process.argv.includes('--fail-on-mismatch'),
  };
}

async function main(): Promise<void> {
  const args = parseArgs();
  const rows = await query<{
    id: number;
    match_id: string;
    captured_at: string;
    provider: string;
    source: string;
    consumer: string;
    usable: boolean;
    normalized_payload: unknown;
    coverage_flags: Record<string, unknown>;
  }>(
    `SELECT id, match_id, captured_at, provider, source, consumer, usable, normalized_payload, coverage_flags
     FROM provider_odds_samples
     WHERE captured_at >= NOW() - ($1::text || ' days')::interval
       AND ($2::boolean = FALSE OR usable = TRUE)
     ORDER BY captured_at DESC
     LIMIT $3`,
    [String(args.lookbackDays), args.usableOnly, args.limit],
  );

  const results = rows.rows.map((row) => auditOddsCoverageSample({
    id: row.id,
    matchId: row.match_id,
    normalizedPayload: Array.isArray(row.normalized_payload) ? row.normalized_payload : [],
    coverageFlags: row.coverage_flags ?? {},
  }));
  const summary = summarizeOddsCoverageAudit(results);
  const report = {
    generatedAt: new Date().toISOString(),
    lookbackDays: args.lookbackDays,
    limit: args.limit,
    usableOnly: args.usableOnly,
    summary,
  };

  const text = JSON.stringify(report, null, 2);
  if (args.outJson) {
    const fs = await import('node:fs/promises');
    await fs.writeFile(args.outJson, `${text}\n`, 'utf8');
  }

  console.log(text);

  if (args.failOnMismatch && (summary.mismatchedStored > 0 || summary.mismatchedRecomputed > 0)) {
    process.exitCode = 1;
  }
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.stack || err.message : String(err));
    process.exitCode = 1;
  })
  .finally(async () => {
    await closePool().catch(() => undefined);
  });
