import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { closePool } from '../db/pool.js';
import { config } from '../config.js';
import {
  buildApiFootballEventsEnvelope,
  buildApiFootballFetchErrorEnvelope,
  buildApiFootballFixtureIdentityEnvelope,
  buildApiFootballOddsEnvelope,
  buildApiFootballScoreClockEnvelope,
  buildApiFootballStatisticsEnvelope,
} from '../lib/canonical/api-football-adapter.js';
import {
  buildCanonicalFixtureIdentity,
  buildProviderEnvelope,
} from '../lib/canonical/provider-domain.js';
import {
  buildTheOddsApiErrorEnvelope,
  buildTheOddsApiOddsEnvelope,
  THE_ODDS_API_PROVIDER,
  type TheOddsApiEventLike,
} from '../lib/canonical/the-odds-api-adapter.js';
import {
  fetchFixtureEvents,
  fetchFixtureStatistics,
  fetchFixturesByIds,
  fetchLiveOdds,
  type ApiFixture,
} from '../lib/football-api.js';
import {
  resolveProviderFixtureMapping,
  type ProviderFixtureMappingCandidate,
} from '../lib/provider-fixture-mapping-service.js';
import {
  buildLiveProviderFusionSnapshot,
  compactFusionSnapshotForAudit,
  type ProviderFusionSourceEnvelopes,
} from '../lib/provider-fusion-snapshot.js';
import { closeRedis } from '../lib/redis.js';
import {
  fetchTheOddsApiOdds,
  inferTheOddsApiQuotaState,
} from '../lib/the-odds-api.js';

interface Args {
  matchId: string;
  sportKey: string;
  outJson: string;
}

function readArg(name: string): string | null {
  const prefix = `--${name}=`;
  const inline = process.argv.find((arg) => arg.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const idx = process.argv.indexOf(`--${name}`);
  return idx >= 0 ? process.argv[idx + 1] ?? null : null;
}

function parseArgs(): Args {
  const matchId = readArg('match-id') ?? '';
  if (!matchId) throw new Error('Missing required --match-id <api-football-fixture-id>');
  return {
    matchId,
    sportKey: readArg('sport-key') ?? config.theOddsApiDefaultSoccerSportKey,
    outJson: readArg('out-json') ?? '',
  };
}

async function callOrError<T>(fn: () => Promise<T>): Promise<{ ok: true; value: T } | { ok: false; error: unknown }> {
  try {
    return { ok: true, value: await fn() };
  } catch (error) {
    return { ok: false, error };
  }
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

function theOddsEventCandidate(event: TheOddsApiEventLike): ProviderFixtureMappingCandidate {
  const kickoffMs = Date.parse(String(event.commence_time ?? ''));
  return {
    providerFixtureId: String(event.id ?? ''),
    kickoffAtUtc: String(event.commence_time ?? ''),
    kickoffTimestamp: Number.isFinite(kickoffMs) ? Math.floor(kickoffMs / 1000) : null,
    leagueId: String(event.sport_key ?? ''),
    leagueName: String(event.sport_title ?? ''),
    homeName: String(event.home_team ?? ''),
    awayName: String(event.away_team ?? ''),
  };
}

function windowForFixture(fixture: ApiFixture): { from: string; to: string } {
  const kickoffMs = fixture.fixture.timestamp * 1000;
  return {
    from: new Date(kickoffMs - 6 * 60 * 60_000).toISOString(),
    to: new Date(kickoffMs + 6 * 60 * 60_000).toISOString(),
  };
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

function buildTheOddsFixtureEnvelope(apiFixture: ApiFixture, event: TheOddsApiEventLike, fetchedAt: string, confidence: 'verified' | 'high' | 'medium' | 'low' | 'unknown') {
  return buildProviderEnvelope({
    provider: THE_ODDS_API_PROVIDER,
    role: 'fixture_identity',
    providerFixtureId: event.id,
    matchId: apiFixture.fixture.id,
    fetchedAt,
    raw: null,
    normalized: buildCanonicalFixtureIdentity({
      matchId: apiFixture.fixture.id,
      providerFixtureIds: {
        [THE_ODDS_API_PROVIDER]: String(event.id ?? ''),
      },
      kickoffAtUtc: String(event.commence_time ?? ''),
      league: {
        id: String(event.sport_key ?? ''),
        name: String(event.sport_title ?? ''),
        country: null,
        season: null,
        logo: null,
      },
      home: { id: null, name: String(event.home_team ?? ''), logo: null },
      away: { id: null, name: String(event.away_team ?? ''), logo: null },
      mappingConfidence: confidence,
    }),
    coverage: { fetched: true, itemCount: 1 },
    freshness: 'fresh',
    quota: 'unknown',
  });
}

async function buildTheOddsProvider(apiFixture: ApiFixture, sportKey: string): Promise<{
  provider: ProviderFusionSourceEnvelopes | null;
  warnings: string[];
}> {
  const fetchedAt = new Date().toISOString();
  if (!config.theOddsApiEnabled || !config.theOddsApiToken) {
    return { provider: null, warnings: ['the_odds_api_disabled_or_token_missing'] };
  }

  try {
    const win = windowForFixture(apiFixture);
    const resolved = await resolveProviderFixtureMapping({
      provider: THE_ODDS_API_PROVIDER,
      source: apiMappingSource(apiFixture),
      candidateToFixture: theOddsEventCandidate,
      fetchFixtureByProviderId: async (providerFixtureId) => {
        const response = await fetchTheOddsApiOdds({
          sportKey,
          regions: config.theOddsApiRegions,
          markets: config.theOddsApiMarkets,
          bookmakers: config.theOddsApiBookmakers,
          eventIds: [providerFixtureId],
          consumer: 'the-odds-api-shadow',
          jobName: 'the-odds-api-shadow',
        });
        return response.data[0] ?? null;
      },
      fetchCandidatesByDate: async () => {
        const response = await fetchTheOddsApiOdds({
          sportKey,
          regions: config.theOddsApiRegions,
          markets: config.theOddsApiMarkets,
          bookmakers: config.theOddsApiBookmakers,
          commenceTimeFrom: win.from,
          commenceTimeTo: win.to,
          consumer: 'the-odds-api-shadow',
          jobName: 'the-odds-api-shadow',
        });
        return response.data;
      },
    });

    if (!resolved.fixture) {
      return { provider: null, warnings: resolved.warnings };
    }

    const oddsResult = await fetchTheOddsApiOdds({
      sportKey,
      regions: config.theOddsApiRegions,
      markets: config.theOddsApiMarkets,
      bookmakers: config.theOddsApiBookmakers,
      eventIds: [resolved.providerFixtureId],
      consumer: 'the-odds-api-shadow',
      jobName: 'the-odds-api-shadow',
    });
    const event = oddsResult.data[0] ?? resolved.fixture;
    const quota = inferTheOddsApiQuotaState(oddsResult.quota, oddsResult.statusCode);
    return {
      provider: {
        fixture: buildTheOddsFixtureEnvelope(apiFixture, event, fetchedAt, resolved.confidence),
        odds: buildTheOddsApiOddsEnvelope({
          matchId: String(apiFixture.fixture.id),
          event,
          fetchedAt,
          statusCode: oddsResult.statusCode,
          latencyMs: oddsResult.latencyMs,
          quota,
          raw: null,
          warnings: resolved.warnings,
        }),
      },
      warnings: resolved.warnings,
    };
  } catch (error) {
    return {
      provider: {
        odds: buildTheOddsApiErrorEnvelope({
          matchId: apiFixture.fixture.id,
          fetchedAt,
          error,
          warnings: ['the_odds_api_shadow_fetch_failed'],
        }),
      },
      warnings: ['the_odds_api_shadow_fetch_failed'],
    };
  }
}

async function main(): Promise<void> {
  const args = parseArgs();
  const apiProvider = await buildApiFootballProvider(args.matchId);
  const apiFixture = apiProvider.fixture?.raw as ApiFixture | undefined;
  if (!apiFixture) throw new Error('API-Football fixture payload unavailable for mapping');

  const providers: ProviderFusionSourceEnvelopes[] = [apiProvider];
  const warnings = ['the_odds_api_shadow_only'];
  const theOdds = await buildTheOddsProvider(apiFixture, args.sportKey);
  if (theOdds.provider) providers.push(theOdds.provider);
  warnings.push(...theOdds.warnings);

  const snapshot = buildLiveProviderFusionSnapshot({
    matchId: args.matchId,
    generatedAt: new Date().toISOString(),
    providers,
    warnings,
  });
  const audit = compactFusionSnapshotForAudit(snapshot);
  const report = {
    generatedAt: new Date().toISOString(),
    mode: 'the_odds_api_shadow',
    productionImpact: 'none',
    matchId: args.matchId,
    sportKey: args.sportKey,
    apiFootballProviderIncluded: true,
    theOddsApiProviderIncluded: providers.some((provider) => provider.odds?.provider === THE_ODDS_API_PROVIDER),
    snapshot,
    audit,
  };

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
