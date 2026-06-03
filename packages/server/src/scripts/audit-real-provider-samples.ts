import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { config } from '../config.js';
import {
  fetchFixtureEvents,
  fetchFixturesForDate,
  fetchFixtureStatistics,
  fetchLiveOdds,
  fetchPreMatchOdds,
  type ApiFixture,
} from '../lib/football-api.js';
import { closeRedis } from '../lib/redis.js';
import {
  normalizeApiSportsOddsResponse,
  summarizeNormalizedOdds,
} from '../lib/odds-resolver.js';

interface Args {
  date: string;
  maxFixtures: number;
  maxApiCalls: number;
  nearHours: number;
  outJson: string;
  includeLive: boolean;
  includeNear: boolean;
  includeFinished: boolean;
  includeStats: boolean;
  includeEvents: boolean;
  includeLiveOdds: boolean;
  includePreMatchOdds: boolean;
  fullPayloads: boolean;
  iterations: number;
  intervalMs: number;
}

type FixtureBucket = 'live' | 'near_kickoff' | 'finished';
type CallStatus = 'ok' | 'error' | 'skipped_budget' | 'skipped_disabled';
type ProviderCallResult<T> = { status: CallStatus; value?: T; latencyMs: number; error?: string };
type ProviderCallFn = <T>(enabled: boolean, fn: () => Promise<T>) => Promise<ProviderCallResult<T>>;

interface ProviderCallSummary {
  status: CallStatus;
  latencyMs: number;
  error?: string;
  count?: number;
  rawCount?: number;
  normalizedCount?: number;
  coverage?: Record<string, unknown>;
  response?: unknown;
}

const LIVE_STATUSES = new Set(['1H', '2H', 'HT', 'ET', 'BT', 'P', 'LIVE', 'INT']);
const FINISHED_STATUSES = new Set(['FT', 'AET', 'PEN']);

function readArg(name: string): string | null {
  const prefix = `--${name}=`;
  const inline = process.argv.find((arg) => arg.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const idx = process.argv.indexOf(`--${name}`);
  if (idx >= 0) return process.argv[idx + 1] ?? null;
  return null;
}

function hasFlag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

function parsePositiveInt(name: string, fallback: number): number {
  const value = Number(readArg(name) ?? fallback);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

function parseNonNegativeInt(name: string, fallback: number): number {
  const value = Number(readArg(name) ?? fallback);
  return Number.isFinite(value) && value >= 0 ? Math.floor(value) : fallback;
}

function parseArgs(): Args {
  const defaultDate = new Intl.DateTimeFormat('en-CA', {
    timeZone: config.timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());

  return {
    date: readArg('date') ?? defaultDate,
    maxFixtures: parsePositiveInt('max-fixtures', 5),
    maxApiCalls: parsePositiveInt('max-api-calls', 20),
    nearHours: parsePositiveInt('near-hours', 3),
    outJson: readArg('out-json') ?? '',
    includeLive: !hasFlag('no-live'),
    includeNear: !hasFlag('no-near'),
    includeFinished: !hasFlag('no-finished'),
    includeStats: !hasFlag('no-stats'),
    includeEvents: !hasFlag('no-events'),
    includeLiveOdds: !hasFlag('no-live-odds'),
    includePreMatchOdds: !hasFlag('no-prematch-odds'),
    fullPayloads: hasFlag('full-payloads'),
    iterations: parsePositiveInt('iterations', 1),
    intervalMs: parseNonNegativeInt('interval-ms', 0),
  };
}

function compactFixture(fixture: ApiFixture) {
  return {
    fixtureId: String(fixture.fixture.id),
    home: fixture.teams.home.name,
    away: fixture.teams.away.name,
    league: fixture.league.name,
    country: fixture.league.country,
    kickoff: fixture.fixture.date,
    timestamp: fixture.fixture.timestamp,
    status: fixture.fixture.status,
    score: fixture.goals,
  };
}

function bucketOf(fixture: ApiFixture, nowSec: number, nearHours: number): FixtureBucket | null {
  const status = String(fixture.fixture.status.short).toUpperCase();
  if (LIVE_STATUSES.has(status)) return 'live';
  if (FINISHED_STATUSES.has(status)) return 'finished';
  if (status === 'NS' && fixture.fixture.timestamp >= nowSec - 600 && fixture.fixture.timestamp <= nowSec + nearHours * 3600) {
    return 'near_kickoff';
  }
  return null;
}

function selectFixtures(args: Args, fixtures: ApiFixture[]): Array<{ bucket: FixtureBucket; fixture: ApiFixture }> {
  const nowSec = Math.floor(Date.now() / 1000);
  const candidates = fixtures
    .map((fixture) => ({ fixture, bucket: bucketOf(fixture, nowSec, args.nearHours) }))
    .filter((entry): entry is { bucket: FixtureBucket; fixture: ApiFixture } => {
      if (!entry.bucket) return false;
      if (entry.bucket === 'live') return args.includeLive;
      if (entry.bucket === 'near_kickoff') return args.includeNear;
      return args.includeFinished;
    });

  const byId = new Map<number, { bucket: FixtureBucket; fixture: ApiFixture }>();
  for (const bucket of ['live', 'near_kickoff', 'finished'] as const) {
    for (const entry of candidates.filter((candidate) => candidate.bucket === bucket)) {
      byId.set(entry.fixture.fixture.id, entry);
      if (byId.size >= args.maxFixtures) return Array.from(byId.values());
    }
  }
  return Array.from(byId.values());
}

async function timedCall<T>(fn: () => Promise<T>): Promise<{ value?: T; latencyMs: number; error?: string }> {
  const started = Date.now();
  try {
    return {
      value: await fn(),
      latencyMs: Date.now() - started,
    };
  } catch (err) {
    return {
      latencyMs: Date.now() - started,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

function skipped(status: Extract<CallStatus, 'skipped_budget' | 'skipped_disabled'>): ProviderCallSummary {
  return { status, latencyMs: 0 };
}

async function main(): Promise<void> {
  const args = parseArgs();
  let apiCallsUsed = 0;

  const call: ProviderCallFn = async <T>(enabled: boolean, fn: () => Promise<T>): Promise<ProviderCallResult<T>> => {
    if (!enabled) return { status: 'skipped_disabled', latencyMs: 0 };
    if (apiCallsUsed >= args.maxApiCalls) return { status: 'skipped_budget', latencyMs: 0 };
    apiCallsUsed += 1;
    const result = await timedCall(fn);
    if (result.error) return { status: 'error', latencyMs: result.latencyMs, error: result.error };
    return { status: 'ok', latencyMs: result.latencyMs, value: result.value };
  };

  const iterations = [];
  for (let i = 0; i < args.iterations; i++) {
    iterations.push(await collectIteration(args, i + 1, call));
    if (i < args.iterations - 1 && args.intervalMs > 0 && apiCallsUsed < args.maxApiCalls) {
      await new Promise((resolve) => setTimeout(resolve, args.intervalMs));
    }
  }

  const firstIteration = iterations[0] ?? null;
  const samples = iterations.flatMap((iteration) => iteration.samples);

  const report = {
    generatedAt: new Date().toISOString(),
    date: args.date,
    timezone: config.timezone,
    args,
    apiCallsUsed,
    iterationCount: iterations.length,
    fixtureCall: firstIteration?.fixtureCall ?? { status: 'skipped_budget', latencyMs: 0, error: 'No iterations executed' },
    fixtureCountForDate: firstIteration?.fixtureCountForDate ?? 0,
    selectedCount: samples.length,
    candidateCounts: firstIteration?.candidateCounts ?? { live: 0, near_kickoff: 0, finished: 0 },
    summary: samples.map((sample) => summarizeSample(sample)),
    samples,
    iterations,
  };

  const text = JSON.stringify(report, null, 2);
  if (args.outJson) {
    await mkdir(dirname(args.outJson), { recursive: true });
    await writeFile(args.outJson, `${text}\n`, 'utf8');
  }
  console.log(text);
}

async function collectIteration(args: Args, iteration: number, call: ProviderCallFn) {
  const fixtureCall = await call(true, () => fetchFixturesForDate(args.date));
  const fixtures = Array.isArray(fixtureCall.value) ? fixtureCall.value : [];
  const selected = selectFixtures(args, fixtures);
  const samples = [];

  for (const entry of selected) {
    const fixtureId = String(entry.fixture.fixture.id);
    const sample: Record<string, unknown> = {
      iteration,
      bucket: entry.bucket,
      ...compactFixture(entry.fixture),
      calls: {},
    };
    const calls = sample['calls'] as Record<string, ProviderCallSummary>;

    const stats = await call(args.includeStats, () => fetchFixtureStatistics(fixtureId));
    calls['statistics'] = stats.status !== 'ok'
      ? skipped(stats.status === 'skipped_budget' ? 'skipped_budget' : 'skipped_disabled')
      : {
        status: 'ok',
        latencyMs: stats.latencyMs,
        count: Array.isArray(stats.value) ? stats.value.length : 0,
        ...(args.fullPayloads ? { response: stats.value } : {}),
      };
    if (stats.status === 'error') calls['statistics'] = { status: 'error', latencyMs: stats.latencyMs, error: stats.error };

    const events = await call(args.includeEvents, () => fetchFixtureEvents(fixtureId));
    calls['events'] = events.status !== 'ok'
      ? skipped(events.status === 'skipped_budget' ? 'skipped_budget' : 'skipped_disabled')
      : {
        status: 'ok',
        latencyMs: events.latencyMs,
        count: Array.isArray(events.value) ? events.value.length : 0,
        ...(args.fullPayloads ? { response: events.value } : {}),
      };
    if (events.status === 'error') calls['events'] = { status: 'error', latencyMs: events.latencyMs, error: events.error };

    const liveOdds = await call(args.includeLiveOdds, () => fetchLiveOdds(fixtureId));
    calls['liveOdds'] = summarizeOddsCall(liveOdds, args.fullPayloads);

    const preMatchOdds = await call(args.includePreMatchOdds, () => fetchPreMatchOdds(fixtureId));
    calls['preMatchOdds'] = summarizeOddsCall(preMatchOdds, args.fullPayloads);

    samples.push(sample);
  }

  return {
    iteration,
    generatedAt: new Date().toISOString(),
    fixtureCall: fixtureCall.status === 'ok'
      ? { status: 'ok', latencyMs: fixtureCall.latencyMs, count: fixtures.length }
      : { status: fixtureCall.status, latencyMs: fixtureCall.latencyMs, error: fixtureCall.error },
    fixtureCountForDate: fixtures.length,
    selectedCount: selected.length,
    candidateCounts: countCandidates(args, fixtures),
    summary: samples.map((sample) => summarizeSample(sample)),
    samples,
  };
}

function summarizeOddsCall(
  result: { status: CallStatus; value?: unknown[]; latencyMs: number; error?: string },
  fullPayloads: boolean,
): ProviderCallSummary {
  if (result.status === 'skipped_budget') return skipped('skipped_budget');
  if (result.status === 'skipped_disabled') return skipped('skipped_disabled');
  if (result.status === 'error') return { status: 'error', latencyMs: result.latencyMs, error: result.error };

  const raw = Array.isArray(result.value) ? result.value : [];
  const normalized = normalizeApiSportsOddsResponse(raw);
  return {
    status: 'ok',
    latencyMs: result.latencyMs,
    rawCount: raw.length,
    normalizedCount: normalized.length,
    coverage: summarizeNormalizedOdds(normalized),
    ...(fullPayloads ? { response: { raw, normalized } } : {}),
  };
}

function countCandidates(args: Args, fixtures: ApiFixture[]): Record<FixtureBucket, number> {
  const nowSec = Math.floor(Date.now() / 1000);
  const counts: Record<FixtureBucket, number> = {
    live: 0,
    near_kickoff: 0,
    finished: 0,
  };
  for (const fixture of fixtures) {
    const bucket = bucketOf(fixture, nowSec, args.nearHours);
    if (bucket) counts[bucket] += 1;
  }
  return counts;
}

function summarizeSample(sample: Record<string, unknown>) {
  const calls = sample['calls'] as Record<string, ProviderCallSummary>;
  return {
    bucket: sample['bucket'],
    iteration: sample['iteration'],
    fixtureId: sample['fixtureId'],
    match: `${sample['home']} vs ${sample['away']}`,
    status: (sample['status'] as { short?: string } | undefined)?.short ?? '',
    score: sample['score'],
    statistics: summarizeBasicCall(calls['statistics']),
    events: summarizeBasicCall(calls['events']),
    liveOdds: summarizeOddsSummary(calls['liveOdds']),
    preMatchOdds: summarizeOddsSummary(calls['preMatchOdds']),
  };
}

function summarizeBasicCall(call?: ProviderCallSummary) {
  return {
    status: call?.status ?? 'skipped_disabled',
    count: call?.count ?? 0,
    error: call?.error ?? '',
  };
}

function summarizeOddsSummary(call?: ProviderCallSummary) {
  return {
    status: call?.status ?? 'skipped_disabled',
    rawCount: call?.rawCount ?? 0,
    normalizedCount: call?.normalizedCount ?? 0,
    canonical: {
      has1x2: call?.coverage?.['canonical_has_1x2'] === true,
      hasOu: call?.coverage?.['canonical_has_ou'] === true,
      hasAh: call?.coverage?.['canonical_has_ah'] === true,
      hasBtts: call?.coverage?.['canonical_has_btts'] === true,
    },
    error: call?.error ?? '',
  };
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.stack || err.message : String(err));
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeRedis().catch(() => undefined);
  });
