import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { config } from '../config.js';
import { closePool } from '../db/pool.js';
import {
  fetchSportmonksFixtureById,
  fetchSportmonksFixturesByDate,
  fetchSportmonksLatestLivescores,
  fetchSportmonksLivescores,
  normalizeSportmonksFixtures,
  SPORTMONKS_PROVIDER,
  type SportmonksCallResult,
  type SportmonksRateLimit,
} from '../lib/sportmonks-api.js';
import {
  summarizeSportmonksCoverage,
  type NormalizedSportmonksFixture,
  type SportmonksCoverageFlags,
  type SportmonksFixtureLike,
} from '../lib/sportmonks-normalize.js';
import {
  createProviderEventSample,
  createProviderFixtureSample,
} from '../repos/provider-fixture-samples.repo.js';
import { closeRedis } from '../lib/redis.js';

interface Args {
  fixtureIds: string[];
  date: string;
  include: string;
  includeLivescores: boolean;
  includeLatest: boolean;
  includeInplayOdds: boolean;
  maxCalls: number;
  outJson: string;
  persistSamples: boolean;
  fullPayloads: boolean;
}

interface CapturedFixture {
  source: 'fixture_by_id' | 'fixtures_by_date' | 'livescores' | 'latest_livescores';
  fixture: NormalizedSportmonksFixture;
  coverage: SportmonksCoverageFlags;
  latencyMs: number;
  statusCode: number;
  rateLimit: SportmonksRateLimit | null;
  raw?: unknown;
}

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

function parseArgs(): Args {
  const fixtureIds = (readArg('fixture-ids') ?? readArg('fixture-id') ?? '')
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean);
  return {
    fixtureIds,
    date: readArg('date') ?? '',
    include: readArg('include') ?? [
      'participants',
      'league',
      'state',
      'scores',
      'events',
      'statistics',
      'periods',
      ...(hasFlag('include-inplay-odds') ? ['inplayOdds'] : []),
    ].join(';'),
    includeLivescores: !hasFlag('no-livescores'),
    includeLatest: hasFlag('latest'),
    includeInplayOdds: hasFlag('include-inplay-odds'),
    maxCalls: parsePositiveInt('max-calls', config.sportmonksShadowMaxCallsPerRun),
    outJson: readArg('out-json') ?? '',
    persistSamples: hasFlag('persist-samples'),
    fullPayloads: hasFlag('full-payloads'),
  };
}

function coverageSummary(samples: CapturedFixture[]) {
  const total = samples.length;
  const count = (key: keyof SportmonksCoverageFlags) => samples.filter((sample) => sample.coverage[key] === true).length;
  return {
    total,
    withParticipants: count('has_participants'),
    withScores: count('has_scores'),
    withEvents: count('has_events'),
    withStatistics: count('has_statistics'),
    withPeriods: count('has_periods'),
    withInplayOdds: count('has_inplay_odds'),
    providerHasOddsFlag: count('provider_has_odds_flag'),
    providerHasPremiumOddsFlag: count('provider_has_premium_odds_flag'),
  };
}

function compactFixture(fixture: NormalizedSportmonksFixture) {
  const home = fixture.participants.find((participant) => {
    const meta = participant && typeof participant === 'object' ? (participant as { meta?: { location?: unknown } }).meta : null;
    return meta?.location === 'home';
  }) as { name?: unknown; id?: unknown } | undefined;
  const away = fixture.participants.find((participant) => {
    const meta = participant && typeof participant === 'object' ? (participant as { meta?: { location?: unknown } }).meta : null;
    return meta?.location === 'away';
  }) as { name?: unknown; id?: unknown } | undefined;
  return {
    provider: fixture.provider,
    providerFixtureId: fixture.providerFixtureId,
    name: fixture.name,
    home: home?.name ?? null,
    away: away?.name ?? null,
    leagueId: fixture.leagueId,
    seasonId: fixture.seasonId,
    stateId: fixture.stateId,
    startingAt: fixture.startingAt,
    startingAtTimestamp: fixture.startingAtTimestamp,
    resultInfo: fixture.resultInfo,
    hasOdds: fixture.hasOdds,
    hasPremiumOdds: fixture.hasPremiumOdds,
  };
}

async function captureCall(
  enabled: boolean,
  budget: { used: number; max: number },
  source: CapturedFixture['source'],
  fn: () => Promise<SportmonksCallResult<SportmonksFixtureLike>>,
  fullPayloads: boolean,
): Promise<{
  status: 'ok' | 'skipped_disabled' | 'skipped_budget' | 'error';
  samples: CapturedFixture[];
  rateLimit?: SportmonksRateLimit | null;
  latencyMs?: number;
  statusCode?: number;
  error?: string;
}> {
  if (!enabled) return { status: 'skipped_disabled', samples: [] };
  if (budget.used >= budget.max) return { status: 'skipped_budget', samples: [] };
  budget.used += 1;
  try {
    const result = await fn();
    const fixtures = normalizeSportmonksFixtures(result.data);
    return {
      status: 'ok',
      samples: fixtures.map((fixture) => ({
        source,
        fixture,
        coverage: summarizeSportmonksCoverage(fixture),
        latencyMs: result.latencyMs,
        statusCode: result.statusCode,
        rateLimit: result.rateLimit,
        ...(fullPayloads ? { raw: result.raw } : {}),
      })),
      rateLimit: result.rateLimit,
      latencyMs: result.latencyMs,
      statusCode: result.statusCode,
    };
  } catch (err) {
    return {
      status: 'error',
      samples: [],
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

async function persistCapturedSamples(samples: CapturedFixture[]): Promise<{ fixtureSamples: number; eventSamples: number }> {
  let fixtureSamples = 0;
  let eventSamples = 0;
  for (const sample of samples) {
    await createProviderFixtureSample({
      provider_fixture_id: sample.fixture.providerFixtureId,
      provider: SPORTMONKS_PROVIDER,
      consumer: 'sportmonks-shadow-poc',
      success: true,
      latency_ms: sample.latencyMs,
      status_code: sample.statusCode,
      raw_payload: sample.raw ?? {},
      normalized_payload: sample.fixture,
      coverage_flags: { ...sample.coverage, source: sample.source, rateLimit: sample.rateLimit },
    });
    fixtureSamples += 1;

    await createProviderEventSample({
      provider_fixture_id: sample.fixture.providerFixtureId,
      match_status: sample.fixture.stateId ?? '',
      provider: SPORTMONKS_PROVIDER,
      consumer: 'sportmonks-shadow-poc',
      success: true,
      latency_ms: sample.latencyMs,
      status_code: sample.statusCode,
      raw_payload: sample.raw ?? {},
      normalized_payload: sample.fixture.events,
      coverage_flags: {
        source: sample.source,
        has_events: sample.coverage.has_events,
        event_count: sample.coverage.event_count,
      },
    });
    eventSamples += 1;
  }
  return { fixtureSamples, eventSamples };
}

async function main(): Promise<void> {
  const args = parseArgs();
  const budget = { used: 0, max: args.maxCalls };
  const calls: Record<string, unknown> = {};
  const callRateLimits: SportmonksRateLimit[] = [];
  const samples: CapturedFixture[] = [];

  const livescores = await captureCall(
    args.includeLivescores,
    budget,
    'livescores',
    () => fetchSportmonksLivescores({ include: args.include, consumer: 'sportmonks-shadow-poc', jobName: 'sportmonks-shadow-poc' }),
    args.fullPayloads,
  );
  calls['livescores'] = {
    status: livescores.status,
    count: livescores.samples.length,
    latencyMs: livescores.latencyMs,
    statusCode: livescores.statusCode,
    rateLimit: livescores.rateLimit,
    error: livescores.error,
  };
  if (livescores.rateLimit) callRateLimits.push(livescores.rateLimit);
  samples.push(...livescores.samples);

  const latest = await captureCall(
    args.includeLatest,
    budget,
    'latest_livescores',
    () => fetchSportmonksLatestLivescores({ include: args.include, consumer: 'sportmonks-shadow-poc', jobName: 'sportmonks-shadow-poc' }),
    args.fullPayloads,
  );
  calls['latestLivescores'] = {
    status: latest.status,
    count: latest.samples.length,
    latencyMs: latest.latencyMs,
    statusCode: latest.statusCode,
    rateLimit: latest.rateLimit,
    error: latest.error,
  };
  if (latest.rateLimit) callRateLimits.push(latest.rateLimit);
  samples.push(...latest.samples);

  if (args.date) {
    const dateCall = await captureCall(
      true,
      budget,
      'fixtures_by_date',
      () => fetchSportmonksFixturesByDate(args.date, { include: args.include, consumer: 'sportmonks-shadow-poc', jobName: 'sportmonks-shadow-poc' }),
      args.fullPayloads,
    );
    calls[`fixturesByDate:${args.date}`] = {
      status: dateCall.status,
      count: dateCall.samples.length,
      latencyMs: dateCall.latencyMs,
      statusCode: dateCall.statusCode,
      rateLimit: dateCall.rateLimit,
      error: dateCall.error,
    };
    if (dateCall.rateLimit) callRateLimits.push(dateCall.rateLimit);
    samples.push(...dateCall.samples);
  }

  for (const fixtureId of args.fixtureIds) {
    const call = await captureCall(
      true,
      budget,
      'fixture_by_id',
      () => fetchSportmonksFixtureById(fixtureId, { include: args.include, consumer: 'sportmonks-shadow-poc', jobName: 'sportmonks-shadow-poc' }),
      args.fullPayloads,
    );
    calls[`fixture:${fixtureId}`] = {
      status: call.status,
      count: call.samples.length,
      latencyMs: call.latencyMs,
      statusCode: call.statusCode,
      rateLimit: call.rateLimit,
      error: call.error,
    };
    if (call.rateLimit) callRateLimits.push(call.rateLimit);
    samples.push(...call.samples);
  }

  const persisted = args.persistSamples ? await persistCapturedSamples(samples) : { fixtureSamples: 0, eventSamples: 0 };
  const report = {
    generatedAt: new Date().toISOString(),
    provider: SPORTMONKS_PROVIDER,
    mode: 'shadow_poc',
    productionImpact: 'none',
    tokenConfigured: Boolean(config.sportmonksApiToken),
    args: { ...args, include: args.include },
    apiCallsUsed: budget.used,
    calls,
    rateLimits: callRateLimits,
    summary: coverageSummary(samples),
    persisted,
    samples: samples.map((sample) => ({
      source: sample.source,
      fixture: args.fullPayloads ? sample.fixture : compactFixture(sample.fixture),
      coverage: sample.coverage,
      latencyMs: sample.latencyMs,
      statusCode: sample.statusCode,
      rateLimit: sample.rateLimit,
      ...(args.fullPayloads ? { raw: sample.raw } : {}),
    })),
  };

  const text = JSON.stringify(report, null, 2);
  if (args.outJson) {
    await mkdir(dirname(args.outJson), { recursive: true });
    await writeFile(args.outJson, `${text}\n`, 'utf8');
  }
  console.log(text);
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.stack || err.message : String(err));
    process.exitCode = 1;
  })
  .finally(async () => {
    await closePool().catch(() => undefined);
    await closeRedis().catch(() => undefined);
  });
