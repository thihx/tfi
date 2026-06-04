import { closePool, query } from '../db/pool.js';
import { auditOddsCoverageSample } from '../lib/provider-coverage-audit.js';

interface Args {
  lookbackDays: number;
  limit: number;
  outJson: string;
  outMd: string;
}

interface SampleRow {
  id: number;
  match_id: string;
  captured_at: string;
  match_minute: number | null;
  match_status: string;
  provider: string;
  source: string;
  consumer: string;
  success: boolean;
  usable: boolean;
  error: string;
  normalized_payload: unknown;
  coverage_flags: Record<string, unknown>;
  league_id: number | null;
  league_name: string | null;
  league_country: string | null;
  coverage_odds: boolean | null;
  coverage_fixtures_statistics: boolean | null;
  coverage_fixtures_players: boolean | null;
  coverage_fixtures_lineups: boolean | null;
  coverage_synced_at: string | null;
}

interface Bucket {
  key: string;
  leagueId: number | null;
  leagueName: string;
  country: string;
  source: string;
  status: string;
  minuteBand: string;
  coverageOdds: boolean | null;
  coverageFixtureStats: boolean | null;
  coverageFixturePlayers: boolean | null;
  coverageLineups: boolean | null;
  coverageSyncedAt: string | null;
  total: number;
  success: number;
  usable: number;
  raw: Record<string, number>;
  canonical: Record<string, number>;
  rawWithoutCanonical: Record<string, number>;
  rejectReasons: Record<string, number>;
  errors: Record<string, number>;
}

const MARKET_FLAGS = ['has_1x2', 'has_ou', 'has_ah', 'has_btts'] as const;

function readArg(name: string): string | null {
  const prefix = `--${name}=`;
  const inline = process.argv.find((arg) => arg.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const idx = process.argv.indexOf(`--${name}`);
  if (idx >= 0) return process.argv[idx + 1] ?? null;
  return null;
}

function parseArgs(): Args {
  const lookbackDays = Number(readArg('lookback-days') ?? 30);
  const limit = Number(readArg('limit') ?? 5000);
  return {
    lookbackDays: Number.isFinite(lookbackDays) && lookbackDays > 0 ? lookbackDays : 30,
    limit: Number.isFinite(limit) && limit > 0 ? limit : 5000,
    outJson: readArg('out-json') ?? '',
    outMd: readArg('out-md') ?? '',
  };
}

function minuteBand(minute: number | null): string {
  if (minute == null || !Number.isFinite(minute)) return 'unknown';
  if (minute <= 15) return '00-15';
  if (minute <= 30) return '16-30';
  if (minute <= 45) return '31-45';
  if (minute <= 60) return '46-60';
  if (minute <= 75) return '61-75';
  if (minute <= 90) return '76-90';
  return '90+';
}

function increment(map: Record<string, number>, key: string, by = 1): void {
  map[key] = (map[key] ?? 0) + by;
}

function bucketKey(row: SampleRow): string {
  return [
    row.league_id ?? 'unknown',
    row.source || 'unknown',
    row.match_status || 'unknown',
    minuteBand(row.match_minute),
  ].join('|');
}

function makeBucket(row: SampleRow): Bucket {
  return {
    key: bucketKey(row),
    leagueId: row.league_id ?? null,
    leagueName: row.league_name ?? 'Unknown League',
    country: row.league_country ?? '',
    source: row.source || 'unknown',
    status: row.match_status || 'unknown',
    minuteBand: minuteBand(row.match_minute),
    coverageOdds: row.coverage_odds,
    coverageFixtureStats: row.coverage_fixtures_statistics,
    coverageFixturePlayers: row.coverage_fixtures_players,
    coverageLineups: row.coverage_fixtures_lineups,
    coverageSyncedAt: row.coverage_synced_at,
    total: 0,
    success: 0,
    usable: 0,
    raw: {},
    canonical: {},
    rawWithoutCanonical: {},
    rejectReasons: {},
    errors: {},
  };
}

function topEntries(map: Record<string, number>, limit = 8): Array<{ key: string; count: number }> {
  return Object.entries(map)
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key))
    .slice(0, limit);
}

function normalizeBucket(bucket: Bucket) {
  return {
    ...bucket,
    successRate: bucket.total > 0 ? bucket.success / bucket.total : 0,
    usableRate: bucket.total > 0 ? bucket.usable / bucket.total : 0,
    raw: Object.fromEntries(MARKET_FLAGS.map((flag) => [flag, bucket.raw[flag] ?? 0])),
    canonical: Object.fromEntries(MARKET_FLAGS.map((flag) => [flag, bucket.canonical[flag] ?? 0])),
    rawWithoutCanonical: topEntries(bucket.rawWithoutCanonical),
    rejectReasons: topEntries(bucket.rejectReasons),
    errors: topEntries(bucket.errors),
  };
}

function renderMarkdown(report: ReturnType<typeof buildReport>): string {
  const lines: string[] = [];
  lines.push('# Provider Odds Quality Report');
  lines.push('');
  lines.push(`Generated: ${report.generatedAt}`);
  lines.push(`Lookback days: ${report.lookbackDays}`);
  lines.push(`Samples: ${report.summary.total}`);
  lines.push('');
  lines.push('## Summary');
  lines.push('');
  lines.push(`- Success rate: ${(report.summary.successRate * 100).toFixed(1)}%`);
  lines.push(`- Usable rate: ${(report.summary.usableRate * 100).toFixed(1)}%`);
  lines.push(`- Raw without canonical cases: ${report.summary.rawWithoutCanonicalTotal}`);
  lines.push('');
  lines.push('## Worst Buckets');
  lines.push('');
  lines.push('| League | Source | Status | Minute | Coverage Odds | Coverage As-Of | Total | Usable | Canonical O/U | Canonical AH | Rejects |');
  lines.push('|---|---|---:|---:|---:|---|---:|---:|---:|---:|---|');
  for (const bucket of report.worstBuckets.slice(0, 20)) {
    lines.push([
      bucket.leagueName,
      bucket.source,
      bucket.status,
      bucket.minuteBand,
      String(bucket.coverageOdds),
      bucket.coverageSyncedAt ?? 'current/null',
      String(bucket.total),
      `${(bucket.usableRate * 100).toFixed(1)}%`,
      String(bucket.canonical.has_ou ?? 0),
      String(bucket.canonical.has_ah ?? 0),
      bucket.rejectReasons.map((item) => `${item.key} (${item.count})`).join('; '),
    ].join(' | ').replace(/^/, '| ').replace(/$/, ' |'));
  }
  lines.push('');
  return `${lines.join('\n')}\n`;
}

function buildReport(rows: SampleRow[], args: Args) {
  const buckets = new Map<string, Bucket>();
  const totals = {
    total: 0,
    success: 0,
    usable: 0,
    rawWithoutCanonicalTotal: 0,
    bySource: {} as Record<string, number>,
    byRejectReason: {} as Record<string, number>,
    byError: {} as Record<string, number>,
  };

  for (const row of rows) {
    const key = bucketKey(row);
    const bucket = buckets.get(key) ?? makeBucket(row);
    buckets.set(key, bucket);

    const audit = auditOddsCoverageSample({
      id: row.id,
      matchId: row.match_id,
      normalizedPayload: Array.isArray(row.normalized_payload) ? row.normalized_payload : [],
      coverageFlags: row.coverage_flags ?? {},
    });

    totals.total += 1;
    bucket.total += 1;
    increment(totals.bySource, row.source || 'unknown');

    if (row.success) {
      totals.success += 1;
      bucket.success += 1;
    }
    if (row.usable) {
      totals.usable += 1;
      bucket.usable += 1;
    }
    if (!row.success || row.error) {
      const err = row.error || 'provider_success_false';
      increment(totals.byError, err);
      increment(bucket.errors, err);
    }

    for (const flag of MARKET_FLAGS) {
      if (audit.rawFlags[flag]) increment(bucket.raw, flag);
      if (audit.canonicalFlags[flag]) increment(bucket.canonical, flag);
    }
    for (const flag of audit.rawWithoutCanonicalFlags) {
      totals.rawWithoutCanonicalTotal += 1;
      increment(bucket.rawWithoutCanonical, flag);
    }
    for (const reason of audit.canonicalRejectReasons) {
      increment(totals.byRejectReason, reason.reason);
      increment(bucket.rejectReasons, reason.reason);
    }
  }

  const bucketRows = Array.from(buckets.values()).map(normalizeBucket);
  const worstBuckets = bucketRows
    .filter((bucket) => bucket.total >= 2)
    .sort((a, b) => a.usableRate - b.usableRate || b.total - a.total)
    .slice(0, 50);

  return {
    generatedAt: new Date().toISOString(),
    lookbackDays: args.lookbackDays,
    limit: args.limit,
    summary: {
      ...totals,
      successRate: totals.total > 0 ? totals.success / totals.total : 0,
      usableRate: totals.total > 0 ? totals.usable / totals.total : 0,
      bySource: topEntries(totals.bySource),
      byRejectReason: topEntries(totals.byRejectReason, 20),
      byError: topEntries(totals.byError, 20),
    },
    buckets: bucketRows,
    worstBuckets,
  };
}

async function main(): Promise<void> {
  const args = parseArgs();
  const rows = await query<SampleRow>(
    `WITH sample_scope AS (
       SELECT *
       FROM provider_odds_samples
       WHERE captured_at >= NOW() - ($1::text || ' days')::interval
       ORDER BY captured_at DESC
       LIMIT $2
     ),
     match_dim AS (
       SELECT match_id, league_id, league_name FROM matches
       UNION ALL
       SELECT match_id, league_id, league_name FROM matches_history
     ),
     dedup_match_dim AS (
       SELECT DISTINCT ON (match_id) match_id, league_id, league_name
       FROM match_dim
       ORDER BY match_id, league_id NULLS LAST
     )
     SELECT
       s.id, s.match_id, s.captured_at, s.match_minute, s.match_status, s.provider, s.source, s.consumer,
       s.success, s.usable, s.error, s.normalized_payload, s.coverage_flags,
       m.league_id, COALESCE(m.league_name, l.league_name) AS league_name, l.country AS league_country,
       COALESCE(ch.coverage_odds, l.coverage_odds) AS coverage_odds,
       COALESCE(ch.coverage_fixtures_statistics, l.coverage_fixtures_statistics) AS coverage_fixtures_statistics,
       COALESCE(ch.coverage_fixtures_players, l.coverage_fixtures_players) AS coverage_fixtures_players,
       COALESCE(ch.coverage_fixtures_lineups, l.coverage_fixtures_lineups) AS coverage_fixtures_lineups,
       ch.synced_at AS coverage_synced_at
     FROM sample_scope s
     LEFT JOIN dedup_match_dim m ON m.match_id = s.match_id
     LEFT JOIN leagues l ON l.league_id = m.league_id
     LEFT JOIN LATERAL (
       SELECT *
       FROM league_provider_coverage_history h
       WHERE h.league_id = m.league_id
         AND h.synced_at <= s.captured_at
       ORDER BY h.synced_at DESC
       LIMIT 1
     ) ch ON TRUE
     ORDER BY s.captured_at DESC`,
    [String(args.lookbackDays), args.limit],
  );

  const report = buildReport(rows.rows, args);
  const json = JSON.stringify(report, null, 2);

  if (args.outJson) {
    const fs = await import('node:fs/promises');
    const path = await import('node:path');
    await fs.mkdir(path.dirname(args.outJson), { recursive: true });
    await fs.writeFile(args.outJson, `${json}\n`, 'utf8');
  }

  if (args.outMd) {
    const fs = await import('node:fs/promises');
    const path = await import('node:path');
    await fs.mkdir(path.dirname(args.outMd), { recursive: true });
    await fs.writeFile(args.outMd, renderMarkdown(report), 'utf8');
  }

  console.log(json);
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.stack || err.message : String(err));
    process.exitCode = 1;
  })
  .finally(async () => {
    await closePool().catch(() => undefined);
  });
