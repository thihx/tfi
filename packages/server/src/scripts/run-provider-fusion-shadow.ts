import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { closePool } from '../db/pool.js';
import {
  buildApiFootballEventsEnvelope,
  buildApiFootballFetchErrorEnvelope,
  buildApiFootballFixtureIdentityEnvelope,
  buildApiFootballOddsEnvelope,
  buildApiFootballScoreClockEnvelope,
  buildApiFootballStatisticsEnvelope,
} from '../lib/canonical/api-football-adapter.js';
import {
  buildSportmonksAccessErrorEnvelope,
  buildSportmonksEventsEnvelope,
  buildSportmonksFixtureIdentityEnvelope,
  buildSportmonksScoreClockEnvelope,
  buildSportmonksStatisticsEnvelope,
} from '../lib/canonical/sportmonks-adapter.js';
import { config } from '../config.js';
import {
  fetchFixtureEvents,
  fetchFixtureStatistics,
  fetchFixturesByIds,
  fetchLiveOdds,
  type ApiFixture,
} from '../lib/football-api.js';
import { resolveProviderFixtureMapping, type ProviderFixtureMappingCandidate } from '../lib/provider-fixture-mapping-service.js';
import {
  buildLiveProviderFusionSnapshot,
  compactFusionSnapshotForAudit,
  type ProviderFusionSourceEnvelopes,
} from '../lib/provider-fusion-snapshot.js';
import { closeRedis } from '../lib/redis.js';
import {
  fetchSportmonksFixtureById,
  fetchSportmonksFixturesByDate,
  normalizeSportmonksFixtures,
  SPORTMONKS_PROVIDER,
} from '../lib/sportmonks-api.js';
import { getSportmonksFixtureSides, type NormalizedSportmonksFixture } from '../lib/sportmonks-normalize.js';
import { createProviderFixtureSample } from '../repos/provider-fixture-samples.repo.js';

interface Args {
  matchId: string;
  outJson: string;
  persistSample: boolean;
  includeSportmonks: boolean;
}

function readArg(name: string): string | null {
  const prefix = `--${name}=`;
  const inline = process.argv.find((arg) => arg.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const idx = process.argv.indexOf(`--${name}`);
  return idx >= 0 ? process.argv[idx + 1] ?? null : null;
}

function hasFlag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

function parseArgs(): Args {
  const matchId = readArg('match-id') ?? '';
  if (!matchId) throw new Error('Missing required --match-id <api-football-fixture-id>');
  return {
    matchId,
    outJson: readArg('out-json') ?? '',
    persistSample: hasFlag('persist-sample'),
    includeSportmonks: !hasFlag('no-sportmonks') && Boolean(config.sportmonksApiToken) && config.sportmonksEnabled,
  };
}

async function callOrError<T>(fn: () => Promise<T>): Promise<{ ok: true; value: T } | { ok: false; error: unknown }> {
  try {
    return { ok: true, value: await fn() };
  } catch (error) {
    return { ok: false, error };
  }
}

function sportmonksMappingCandidate(fixture: NormalizedSportmonksFixture): ProviderFixtureMappingCandidate {
  const sides = getSportmonksFixtureSides(fixture);
  return {
    providerFixtureId: fixture.providerFixtureId,
    kickoffAtUtc: fixture.startingAt,
    kickoffTimestamp: fixture.startingAtTimestamp,
    leagueId: fixture.leagueId,
    homeName: sides.home?.name ?? '',
    awayName: sides.away?.name ?? '',
  };
}

function apiMappingSource(fixture: ApiFixture) {
  return {
    matchId: fixture.fixture.id,
    kickoffAtUtc: fixture.fixture.date,
    kickoffTimestamp: fixture.fixture.timestamp,
    leagueId: fixture.league.id,
    leagueName: fixture.league.name,
    homeName: fixture.teams.home.name,
    awayName: fixture.teams.away.name,
  };
}

function dateKey(fixture: ApiFixture): string {
  return fixture.fixture.date.slice(0, 10);
}

async function buildApiFootballProvider(matchId: string): Promise<ProviderFusionSourceEnvelopes> {
  const fixture = (await fetchFixturesByIds([matchId]))[0];
  if (!fixture) throw new Error(`API-Football fixture not found: ${matchId}`);
  const fetchedAt = new Date().toISOString();

  const [eventsResult, statsResult, oddsResult] = await Promise.all([
    callOrError(() => fetchFixtureEvents(matchId)),
    callOrError(() => fetchFixtureStatistics(matchId)),
    callOrError(() => fetchLiveOdds(matchId)),
  ]);

  return {
    fixture: buildApiFootballFixtureIdentityEnvelope(fixture, { fetchedAt }),
    scoreClock: buildApiFootballScoreClockEnvelope(fixture, { fetchedAt, now: new Date() }),
    events: eventsResult.ok
      ? buildApiFootballEventsEnvelope(fixture, eventsResult.value, { fetchedAt })
      : buildApiFootballFetchErrorEnvelope({ role: 'event_timeline', matchId, error: eventsResult.error, fetchedAt }),
    statistics: statsResult.ok
      ? buildApiFootballStatisticsEnvelope(fixture, statsResult.value, { fetchedAt })
      : buildApiFootballFetchErrorEnvelope({ role: 'fixture_statistics', matchId, error: statsResult.error, fetchedAt }),
    odds: oddsResult.ok
      ? buildApiFootballOddsEnvelope({ matchId, response: oddsResult.value, sourceKind: 'live', fetchedAt })
      : buildApiFootballFetchErrorEnvelope({ role: 'live_odds', matchId, error: oddsResult.error, fetchedAt }),
  };
}

async function buildSportmonksProvider(apiFixture: ApiFixture): Promise<{
  provider: ProviderFusionSourceEnvelopes | null;
  warnings: string[];
}> {
  if (!config.sportmonksApiToken || !config.sportmonksEnabled) {
    return { provider: null, warnings: ['sportmonks_shadow_disabled_or_token_missing'] };
  }

  const fetchedAt = new Date().toISOString();
  try {
    const resolved = await resolveProviderFixtureMapping({
      provider: SPORTMONKS_PROVIDER,
      source: apiMappingSource(apiFixture),
      candidateToFixture: sportmonksMappingCandidate,
      fetchFixtureByProviderId: async (providerFixtureId) => {
        const response = await fetchSportmonksFixtureById(providerFixtureId, {
          consumer: 'provider-fusion-shadow',
          jobName: 'provider-fusion-shadow',
        });
        return normalizeSportmonksFixtures(response.data)[0] ?? null;
      },
      fetchCandidatesByDate: async (date) => {
        const response = await fetchSportmonksFixturesByDate(date, {
          consumer: 'provider-fusion-shadow',
          jobName: 'provider-fusion-shadow',
        });
        return normalizeSportmonksFixtures(response.data);
      },
    });

    if (!resolved.fixture) {
      return { provider: null, warnings: resolved.warnings };
    }
    return {
      provider: {
        fixture: buildSportmonksFixtureIdentityEnvelope(resolved.fixture, { matchId: apiFixture.fixture.id, fetchedAt }),
        scoreClock: buildSportmonksScoreClockEnvelope(resolved.fixture, { matchId: apiFixture.fixture.id, fetchedAt }),
        events: buildSportmonksEventsEnvelope(resolved.fixture, { matchId: apiFixture.fixture.id, fetchedAt }),
        statistics: buildSportmonksStatisticsEnvelope(resolved.fixture, { matchId: apiFixture.fixture.id, fetchedAt }),
      },
      warnings: resolved.warnings,
    };
  } catch (error) {
    return {
      provider: {
        fixture: buildSportmonksAccessErrorEnvelope({
          role: 'fixture_identity',
          matchId: apiFixture.fixture.id,
          error,
          fetchedAt,
          warnings: [`sportmonks_shadow_mapping_failed:${dateKey(apiFixture)}`],
        }),
      },
      warnings: ['sportmonks_shadow_mapping_failed'],
    };
  }
}

async function main(): Promise<void> {
  const args = parseArgs();
  const apiProvider = await buildApiFootballProvider(args.matchId);
  const providers: ProviderFusionSourceEnvelopes[] = [apiProvider];
  const warnings = ['provider_fusion_shadow_only'];

  if (args.includeSportmonks && apiProvider.fixture?.raw) {
    const apiFixture = apiProvider.fixture.raw as ApiFixture;
    const sportmonks = await buildSportmonksProvider(apiFixture);
    if (sportmonks.provider) providers.push(sportmonks.provider);
    warnings.push(...sportmonks.warnings);
  } else if (!args.includeSportmonks) {
    warnings.push('sportmonks_shadow_disabled_or_token_missing');
  }

  const snapshot = buildLiveProviderFusionSnapshot({
    matchId: args.matchId,
    generatedAt: new Date().toISOString(),
    providers,
    warnings,
  });
  const audit = compactFusionSnapshotForAudit(snapshot);
  const report = {
    generatedAt: new Date().toISOString(),
    mode: 'provider_fusion_shadow',
    productionImpact: 'none',
    matchId: args.matchId,
    apiFootballProviderIncluded: true,
    sportmonksProviderIncluded: providers.some((provider) => provider.fixture?.provider === SPORTMONKS_PROVIDER),
    snapshot,
    audit,
  };

  if (args.persistSample) {
    await createProviderFixtureSample({
      match_id: args.matchId,
      provider_fixture_id: args.matchId,
      provider: 'provider-fusion',
      consumer: 'provider-fusion-shadow',
      success: true,
      normalized_payload: snapshot,
      coverage_flags: audit,
      raw_payload: {},
    });
  }

  const text = JSON.stringify(report, null, 2);
  if (args.outJson) {
    await mkdir(dirname(args.outJson), { recursive: true });
    await writeFile(args.outJson, `${text}\n`, 'utf8');
  }
  console.log(text);
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.stack || error.message : String(error));
    process.exitCode = 1;
  })
  .finally(async () => {
    await closePool().catch(() => undefined);
    await closeRedis().catch(() => undefined);
  });
