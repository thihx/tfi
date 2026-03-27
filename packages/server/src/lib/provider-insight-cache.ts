import {
  fetchFixtureEvents,
  fetchFixtureLineups,
  fetchPrediction,
  fetchFixtureStatistics,
  fetchFixturesByIds,
  fetchStandings,
  type ApiFixture,
  type ApiFixtureEvent,
  type ApiFixtureLineup,
  type ApiPrediction,
  type ApiStanding,
  type ApiFixtureStat,
} from './football-api.js';
import { resolveMatchOdds } from './odds-resolver.js';
import {
  getProviderFixtureCache,
  getProviderFixtureCaches,
  getProviderFixtureEventsCache,
  getProviderFixtureLineupsCache,
  getProviderFixturePredictionCache,
  getProviderFixtureStatsCache,
  getProviderLeagueStandingsCache,
  upsertProviderFixtureCache,
  upsertProviderFixtureEventsCache,
  upsertProviderFixtureLineupsCache,
  upsertProviderFixturePredictionCache,
  upsertProviderFixtureStatsCache,
  upsertProviderLeagueStandingsCache,
  type ProviderFixtureCacheRow,
  type ProviderFixtureEventsCacheRow,
  type ProviderFixtureLineupsCacheRow,
  type ProviderFixturePredictionCacheRow,
  type ProviderFixtureStatsCacheRow,
  type ProviderLeagueStandingsCacheRow,
} from '../repos/provider-fixture-insight.repo.js';

export type InsightFreshness = 'fresh' | 'stale_ok' | 'stale_degraded' | 'missing';
export type InsightCacheStatus = 'hit' | 'refreshed' | 'stale_fallback' | 'miss';

export interface InsightDomainState<T> {
  payload: T;
  freshness: InsightFreshness;
  cacheStatus: InsightCacheStatus;
  cachedAt: string | null;
  fetchedAt: string | null;
  degraded: boolean;
}

export interface MatchInsightResult {
  fixture: InsightDomainState<ApiFixture | null>;
  statistics: InsightDomainState<ApiFixtureStat[]>;
  events: InsightDomainState<ApiFixtureEvent[]>;
}

export interface ScoutInsightResult extends MatchInsightResult {
  lineups: InsightDomainState<ApiFixtureLineup[]>;
  prediction: InsightDomainState<ApiPrediction | null>;
  standings: InsightDomainState<ApiStanding[]>;
}

export interface EnsureMatchInsightOptions {
  fixture?: ApiFixture | null;
  status?: string;
  matchMinute?: number | null;
  includeStartedDetails?: boolean;
  refreshOdds?: boolean;
  consumer?: string;
  sampleProviderData?: boolean;
}

interface ProviderInsightDeps {
  fetchFixturesByIds: typeof fetchFixturesByIds;
  fetchFixtureStatistics: typeof fetchFixtureStatistics;
  fetchFixtureEvents: typeof fetchFixtureEvents;
  fetchFixtureLineups: typeof fetchFixtureLineups;
  fetchPrediction: typeof fetchPrediction;
  fetchStandings: typeof fetchStandings;
  resolveMatchOdds: typeof resolveMatchOdds;
  getProviderFixtureCache: typeof getProviderFixtureCache;
  getProviderFixtureCaches: typeof getProviderFixtureCaches;
  getProviderFixtureStatsCache: typeof getProviderFixtureStatsCache;
  getProviderFixtureEventsCache: typeof getProviderFixtureEventsCache;
  getProviderFixtureLineupsCache: typeof getProviderFixtureLineupsCache;
  getProviderFixturePredictionCache: typeof getProviderFixturePredictionCache;
  getProviderLeagueStandingsCache: typeof getProviderLeagueStandingsCache;
  upsertProviderFixtureCache: typeof upsertProviderFixtureCache;
  upsertProviderFixtureStatsCache: typeof upsertProviderFixtureStatsCache;
  upsertProviderFixtureEventsCache: typeof upsertProviderFixtureEventsCache;
  upsertProviderFixtureLineupsCache: typeof upsertProviderFixtureLineupsCache;
  upsertProviderFixturePredictionCache: typeof upsertProviderFixturePredictionCache;
  upsertProviderLeagueStandingsCache: typeof upsertProviderLeagueStandingsCache;
  now: () => Date;
}

const defaultDeps: ProviderInsightDeps = {
  fetchFixturesByIds,
  fetchFixtureStatistics,
  fetchFixtureEvents,
  fetchFixtureLineups,
  fetchPrediction,
  fetchStandings,
  resolveMatchOdds,
  getProviderFixtureCache,
  getProviderFixtureCaches,
  getProviderFixtureStatsCache,
  getProviderFixtureEventsCache,
  getProviderFixtureLineupsCache,
  getProviderFixturePredictionCache,
  getProviderLeagueStandingsCache,
  upsertProviderFixtureCache,
  upsertProviderFixtureStatsCache,
  upsertProviderFixtureEventsCache,
  upsertProviderFixtureLineupsCache,
  upsertProviderFixturePredictionCache,
  upsertProviderLeagueStandingsCache,
  now: () => new Date(),
};

const LIVE_STATUSES = new Set(['1H', '2H', 'HT', 'ET', 'BT', 'P', 'LIVE', 'INT']);
const FINISHED_STATUSES = new Set(['FT', 'AET', 'PEN']);

function classifyFreshness(ageMs: number | null, ttlMs: number): InsightFreshness {
  if (ageMs == null) return 'missing';
  if (ageMs <= ttlMs) return 'fresh';
  if (ageMs <= ttlMs * 3) return 'stale_ok';
  return 'stale_degraded';
}

function ageMs(cachedAt: string | null | undefined, now: Date): number | null {
  if (!cachedAt) return null;
  const parsed = Date.parse(cachedAt);
  if (Number.isNaN(parsed)) return null;
  return now.getTime() - parsed;
}

function fixtureTtlMs(status: string, minute: number | null): number {
  const normalized = status.toUpperCase();
  if (FINISHED_STATUSES.has(normalized)) return 12 * 60 * 60 * 1000;
  if (normalized === 'HT') return 30 * 1000;
  if (LIVE_STATUSES.has(normalized)) return minute != null && minute >= 75 ? 15 * 1000 : 30 * 1000;
  if (normalized === 'NS' || normalized === '') return 5 * 60 * 1000;
  return 2 * 60 * 1000;
}

function detailTtlMs(status: string, minute: number | null): number {
  const normalized = status.toUpperCase();
  if (FINISHED_STATUSES.has(normalized)) return 12 * 60 * 60 * 1000;
  if (normalized === 'HT') return 30 * 1000;
  if (LIVE_STATUSES.has(normalized)) return minute != null && minute >= 75 ? 20 * 1000 : 45 * 1000;
  return 5 * 60 * 1000;
}

function predictionTtlMs(status: string): number {
  const normalized = status.toUpperCase();
  if (normalized === 'NS' || normalized === '') return 6 * 60 * 60 * 1000;
  if (hasStarted(normalized)) return 12 * 60 * 60 * 1000;
  return 6 * 60 * 60 * 1000;
}

function standingsTtlMs(): number {
  return 6 * 60 * 60 * 1000;
}

function hasStarted(status: string): boolean {
  const normalized = status.toUpperCase();
  return LIVE_STATUSES.has(normalized) || FINISHED_STATUSES.has(normalized);
}

function fixturePayloadOf(row: ProviderFixtureCacheRow | null): ApiFixture | null {
  if (!row || !row.fixture_payload || typeof row.fixture_payload !== 'object') return null;
  return row.fixture_payload as ApiFixture;
}

function statsPayloadOf(row: ProviderFixtureStatsCacheRow | null): ApiFixtureStat[] {
  return row && Array.isArray(row.statistics_payload) ? row.statistics_payload as ApiFixtureStat[] : [];
}

function eventsPayloadOf(row: ProviderFixtureEventsCacheRow | null): ApiFixtureEvent[] {
  return row && Array.isArray(row.events_payload) ? row.events_payload as ApiFixtureEvent[] : [];
}

function lineupsPayloadOf(row: ProviderFixtureLineupsCacheRow | null): ApiFixtureLineup[] {
  return row && Array.isArray(row.lineups_payload) ? row.lineups_payload as ApiFixtureLineup[] : [];
}

function predictionPayloadOf(row: ProviderFixturePredictionCacheRow | null): ApiPrediction | null {
  if (!row || !row.prediction_payload || typeof row.prediction_payload !== 'object' || Array.isArray(row.prediction_payload)) return null;
  return row.prediction_payload as ApiPrediction;
}

function standingsPayloadOf(row: ProviderLeagueStandingsCacheRow | null): ApiStanding[] {
  return row && Array.isArray(row.standings_payload) ? row.standings_payload as ApiStanding[] : [];
}

function buildFixtureDomain(
  row: ProviderFixtureCacheRow | null,
  freshness: InsightFreshness,
  cacheStatus: InsightCacheStatus,
): InsightDomainState<ApiFixture | null> {
  return {
    payload: fixturePayloadOf(row),
    freshness,
    cacheStatus,
    cachedAt: row?.cached_at ?? null,
    fetchedAt: row?.fixture_fetched_at ?? null,
    degraded: row?.degraded ?? false,
  };
}

function buildStatsDomain(
  row: ProviderFixtureStatsCacheRow | null,
  freshness: InsightFreshness,
  cacheStatus: InsightCacheStatus,
): InsightDomainState<ApiFixtureStat[]> {
  return {
    payload: statsPayloadOf(row),
    freshness,
    cacheStatus,
    cachedAt: row?.cached_at ?? null,
    fetchedAt: row?.stats_fetched_at ?? null,
    degraded: row?.degraded ?? false,
  };
}

function buildEventsDomain(
  row: ProviderFixtureEventsCacheRow | null,
  freshness: InsightFreshness,
  cacheStatus: InsightCacheStatus,
): InsightDomainState<ApiFixtureEvent[]> {
  return {
    payload: eventsPayloadOf(row),
    freshness,
    cacheStatus,
    cachedAt: row?.cached_at ?? null,
    fetchedAt: row?.events_fetched_at ?? null,
    degraded: row?.degraded ?? false,
  };
}

function buildLineupsDomain(
  row: ProviderFixtureLineupsCacheRow | null,
  freshness: InsightFreshness,
  cacheStatus: InsightCacheStatus,
): InsightDomainState<ApiFixtureLineup[]> {
  return {
    payload: lineupsPayloadOf(row),
    freshness,
    cacheStatus,
    cachedAt: row?.cached_at ?? null,
    fetchedAt: row?.lineups_fetched_at ?? null,
    degraded: row?.degraded ?? false,
  };
}

function buildPredictionDomain(
  row: ProviderFixturePredictionCacheRow | null,
  freshness: InsightFreshness,
  cacheStatus: InsightCacheStatus,
): InsightDomainState<ApiPrediction | null> {
  return {
    payload: predictionPayloadOf(row),
    freshness,
    cacheStatus,
    cachedAt: row?.cached_at ?? null,
    fetchedAt: row?.prediction_fetched_at ?? null,
    degraded: row?.degraded ?? false,
  };
}

function buildStandingsDomain(
  row: ProviderLeagueStandingsCacheRow | null,
  freshness: InsightFreshness,
  cacheStatus: InsightCacheStatus,
): InsightDomainState<ApiStanding[]> {
  return {
    payload: standingsPayloadOf(row),
    freshness,
    cacheStatus,
    cachedAt: row?.cached_at ?? null,
    fetchedAt: row?.standings_fetched_at ?? null,
    degraded: row?.degraded ?? false,
  };
}

function buildStatsCoverage(stats: ApiFixtureStat[]): Record<string, unknown> {
  const statPairs = stats.reduce((count, team) => count + (Array.isArray(team.statistics) ? team.statistics.length : 0), 0);
  return {
    team_count: stats.length,
    stat_pairs: statPairs,
    has_payload: stats.length > 0,
  };
}

function buildEventsCoverage(events: ApiFixtureEvent[]): Record<string, unknown> {
  return {
    event_count: events.length,
    has_payload: events.length > 0,
  };
}

function buildLineupsCoverage(lineups: ApiFixtureLineup[]): Record<string, unknown> {
  return {
    team_count: lineups.length,
    has_payload: lineups.length > 0,
  };
}

async function batchRun<T>(tasks: Array<() => Promise<T>>, concurrency = 4): Promise<T[]> {
  const results: T[] = [];
  for (let i = 0; i < tasks.length; i += concurrency) {
    const chunk = tasks.slice(i, i + concurrency);
    results.push(...await Promise.all(chunk.map((task) => task())));
  }
  return results;
}

async function fetchFixturesInChunks(matchIds: string[], deps: ProviderInsightDeps): Promise<ApiFixture[]> {
  if (matchIds.length === 0) return [];
  const tasks: Array<() => Promise<ApiFixture[]>> = [];
  for (let i = 0; i < matchIds.length; i += 20) {
    const chunk = matchIds.slice(i, i + 20);
    tasks.push(() => deps.fetchFixturesByIds(chunk));
  }
  const chunks = await batchRun(tasks, 2);
  return chunks.flat();
}

async function persistFixture(fixture: ApiFixture, deps: ProviderInsightDeps): Promise<void> {
  await deps.upsertProviderFixtureCache({
    match_id: String(fixture.fixture.id),
    fixture_payload: fixture,
    fixture_fetched_at: deps.now().toISOString(),
    match_status: fixture.fixture.status.short,
    match_minute: fixture.fixture.status.elapsed,
    freshness: 'fresh',
    degraded: false,
    last_refresh_error: '',
  });
}

function fixtureContext(
  matchId: string,
  options: EnsureMatchInsightOptions,
  cachedFixture: ProviderFixtureCacheRow | null,
) {
  const payload = options.fixture ?? fixturePayloadOf(cachedFixture);
  const status = payload?.fixture?.status?.short ?? options.status ?? cachedFixture?.match_status ?? '';
  const matchMinute = payload?.fixture?.status?.elapsed ?? options.matchMinute ?? cachedFixture?.match_minute ?? null;
  return {
    matchId,
    fixture: payload,
    status,
    matchMinute,
    includeStartedDetails: options.includeStartedDetails ?? hasStarted(status),
  };
}

async function loadInsightRows(matchId: string, deps: ProviderInsightDeps) {
  const [fixtureRow, statsRow, eventsRow] = await Promise.all([
    deps.getProviderFixtureCache(matchId),
    deps.getProviderFixtureStatsCache(matchId),
    deps.getProviderFixtureEventsCache(matchId),
  ]);
  return { fixtureRow, statsRow, eventsRow };
}

export async function ensureMatchInsight(
  matchId: string,
  options: EnsureMatchInsightOptions = {},
  depsOverride?: Partial<ProviderInsightDeps>,
): Promise<MatchInsightResult> {
  const deps = { ...defaultDeps, ...depsOverride };
  const initial = await loadInsightRows(matchId, deps);
  const initialContext = fixtureContext(matchId, options, initial.fixtureRow);
  const now = deps.now();

  const initialFixtureFreshness = classifyFreshness(ageMs(initial.fixtureRow?.cached_at, now), fixtureTtlMs(initialContext.status, initialContext.matchMinute));
  const initialStatsFreshness = classifyFreshness(ageMs(initial.statsRow?.cached_at, now), detailTtlMs(initialContext.status, initialContext.matchMinute));
  const initialEventsFreshness = classifyFreshness(ageMs(initial.eventsRow?.cached_at, now), detailTtlMs(initialContext.status, initialContext.matchMinute));
  const detailsReady = !initialContext.includeStartedDetails || (initialStatsFreshness === 'fresh' && initialEventsFreshness === 'fresh');

  if (initialFixtureFreshness === 'fresh' && detailsReady) {
    return {
      fixture: buildFixtureDomain(initial.fixtureRow, 'fresh', 'hit'),
      statistics: buildStatsDomain(initial.statsRow, initialContext.includeStartedDetails ? initialStatsFreshness : 'missing', initialContext.includeStartedDetails ? 'hit' : 'miss'),
      events: buildEventsDomain(initial.eventsRow, initialContext.includeStartedDetails ? initialEventsFreshness : 'missing', initialContext.includeStartedDetails ? 'hit' : 'miss'),
    };
  }

  const refreshedFixture = initialContext.fixture
    ? [initialContext.fixture]
    : await fetchFixturesInChunks([matchId], deps);
  const fixture = refreshedFixture[0] ?? fixturePayloadOf(initial.fixtureRow);

  if (fixture) {
    await persistFixture(fixture, deps);
  }

  const refreshedStatus = fixture?.fixture?.status?.short ?? initialContext.status;
  const refreshedMinute = fixture?.fixture?.status?.elapsed ?? initialContext.matchMinute;
  const shouldLoadDetails = options.includeStartedDetails ?? hasStarted(refreshedStatus);

  if (shouldLoadDetails) {
    const [statsResult, eventsResult] = await Promise.allSettled([
      deps.fetchFixtureStatistics(matchId),
      deps.fetchFixtureEvents(matchId),
    ]);

    if (statsResult.status === 'fulfilled') {
      await deps.upsertProviderFixtureStatsCache({
        match_id: matchId,
        statistics_payload: statsResult.value,
        coverage_flags: buildStatsCoverage(statsResult.value),
        stats_fetched_at: deps.now().toISOString(),
        match_status: refreshedStatus,
        match_minute: refreshedMinute,
        freshness: 'fresh',
        degraded: false,
        last_refresh_error: '',
      });
    }

    if (eventsResult.status === 'fulfilled') {
      await deps.upsertProviderFixtureEventsCache({
        match_id: matchId,
        events_payload: eventsResult.value,
        coverage_flags: buildEventsCoverage(eventsResult.value),
        events_fetched_at: deps.now().toISOString(),
        match_status: refreshedStatus,
        match_minute: refreshedMinute,
        freshness: 'fresh',
        degraded: false,
        last_refresh_error: '',
      });
    }
  }

  if (options.refreshOdds !== false && fixture) {
    await deps.resolveMatchOdds({
      matchId,
      homeTeam: fixture.teams.home.name,
      awayTeam: fixture.teams.away.name,
      kickoffTimestamp: fixture.fixture.timestamp,
      leagueName: fixture.league.name,
      leagueCountry: fixture.league.country,
      status: fixture.fixture.status.short,
      matchMinute: fixture.fixture.status.elapsed,
      consumer: options.consumer ?? 'provider-insight-cache',
      sampleProviderData: options.sampleProviderData,
    }).catch(() => null);
  }

  const finalRows = await loadInsightRows(matchId, deps);
  const finalNow = deps.now();
  const finalContext = fixtureContext(matchId, options, finalRows.fixtureRow);
  const finalFixtureFreshness = classifyFreshness(ageMs(finalRows.fixtureRow?.cached_at, finalNow), fixtureTtlMs(finalContext.status, finalContext.matchMinute));
  const finalStatsFreshness = classifyFreshness(ageMs(finalRows.statsRow?.cached_at, finalNow), detailTtlMs(finalContext.status, finalContext.matchMinute));
  const finalEventsFreshness = classifyFreshness(ageMs(finalRows.eventsRow?.cached_at, finalNow), detailTtlMs(finalContext.status, finalContext.matchMinute));

  return {
    fixture: buildFixtureDomain(
      finalRows.fixtureRow,
      finalFixtureFreshness,
      finalFixtureFreshness === 'fresh' ? 'refreshed' : finalRows.fixtureRow ? 'stale_fallback' : 'miss',
    ),
    statistics: buildStatsDomain(
      finalRows.statsRow,
      finalContext.includeStartedDetails ? finalStatsFreshness : 'missing',
      !finalContext.includeStartedDetails
        ? 'miss'
        : finalStatsFreshness === 'fresh'
          ? 'refreshed'
          : finalRows.statsRow
            ? 'stale_fallback'
            : 'miss',
    ),
    events: buildEventsDomain(
      finalRows.eventsRow,
      finalContext.includeStartedDetails ? finalEventsFreshness : 'missing',
      !finalContext.includeStartedDetails
        ? 'miss'
        : finalEventsFreshness === 'fresh'
          ? 'refreshed'
          : finalRows.eventsRow
            ? 'stale_fallback'
            : 'miss',
    ),
  };
}

export async function ensureFixturesForMatchIds(
  matchIds: string[],
  depsOverride?: Partial<ProviderInsightDeps>,
): Promise<ApiFixture[]> {
  const deps = { ...defaultDeps, ...depsOverride };
  if (matchIds.length === 0) return [];

  const cachedRows = await deps.getProviderFixtureCaches(matchIds);
  const cachedMap = new Map(cachedRows.map((row) => [row.match_id, row]));
  const now = deps.now();
  const staleOrMissingIds = matchIds.filter((matchId) => {
    const row = cachedMap.get(matchId) ?? null;
    const fixture = fixturePayloadOf(row);
    const status = fixture?.fixture?.status?.short ?? row?.match_status ?? '';
    const minute = fixture?.fixture?.status?.elapsed ?? row?.match_minute ?? null;
    return classifyFreshness(ageMs(row?.cached_at, now), fixtureTtlMs(status, minute)) !== 'fresh';
  });

  if (staleOrMissingIds.length > 0) {
    const fetchedFixtures = await fetchFixturesInChunks(staleOrMissingIds, deps);
    await Promise.all(fetchedFixtures.map((fixture) => persistFixture(fixture, deps)));
    for (const fixture of fetchedFixtures) {
      cachedMap.set(String(fixture.fixture.id), {
        match_id: String(fixture.fixture.id),
        fixture_payload: fixture,
        fixture_fetched_at: deps.now().toISOString(),
        cached_at: deps.now().toISOString(),
        match_status: fixture.fixture.status.short,
        match_minute: fixture.fixture.status.elapsed,
        freshness: 'fresh',
        degraded: false,
        last_refresh_error: '',
      });
    }
  }

  return matchIds
    .map((matchId) => fixturePayloadOf(cachedMap.get(matchId) ?? null))
    .filter((fixture): fixture is ApiFixture => fixture != null);
}

export async function refreshProviderInsightsForMatches(
  matchIds: string[],
  depsOverride?: Partial<ProviderInsightDeps>,
): Promise<{
  candidates: number;
  fixtureCached: number;
  detailRefreshed: number;
  lineupsRefreshed: number;
  predictionsRefreshed: number;
  standingsRefreshed: number;
  oddsRefreshed: number;
}> {
  const deps = { ...defaultDeps, ...depsOverride };
  const uniqueIds = Array.from(new Set(matchIds.filter(Boolean)));
  if (uniqueIds.length === 0) {
    return {
      candidates: 0,
      fixtureCached: 0,
      detailRefreshed: 0,
      lineupsRefreshed: 0,
      predictionsRefreshed: 0,
      standingsRefreshed: 0,
      oddsRefreshed: 0,
    };
  }

  const fixtures = await fetchFixturesInChunks(uniqueIds, deps);
  await Promise.all(fixtures.map((fixture) => persistFixture(fixture, deps)));

  const detailFixtures = fixtures.filter((fixture) => hasStarted(fixture.fixture.status.short));
  const prematchFixtures = fixtures.filter((fixture) => !hasStarted(fixture.fixture.status.short));
  const standingsKeys = new Set<string>();
  await batchRun(detailFixtures.map((fixture) => async () => {
    const matchId = String(fixture.fixture.id);
    const [stats, events, lineups] = await Promise.all([
      deps.fetchFixtureStatistics(matchId).catch(() => null),
      deps.fetchFixtureEvents(matchId).catch(() => null),
      deps.fetchFixtureLineups(matchId).catch(() => null),
    ]);

    if (stats) {
      await deps.upsertProviderFixtureStatsCache({
        match_id: matchId,
        statistics_payload: stats,
        coverage_flags: buildStatsCoverage(stats),
        stats_fetched_at: deps.now().toISOString(),
        match_status: fixture.fixture.status.short,
        match_minute: fixture.fixture.status.elapsed,
        freshness: 'fresh',
        degraded: false,
        last_refresh_error: '',
      });
    }

    if (events) {
      await deps.upsertProviderFixtureEventsCache({
        match_id: matchId,
        events_payload: events,
        coverage_flags: buildEventsCoverage(events),
        events_fetched_at: deps.now().toISOString(),
        match_status: fixture.fixture.status.short,
        match_minute: fixture.fixture.status.elapsed,
        freshness: 'fresh',
        degraded: false,
        last_refresh_error: '',
      });
    }

    if (lineups) {
      await deps.upsertProviderFixtureLineupsCache({
        match_id: matchId,
        lineups_payload: lineups,
        coverage_flags: buildLineupsCoverage(lineups),
        lineups_fetched_at: deps.now().toISOString(),
        match_status: fixture.fixture.status.short,
        match_minute: fixture.fixture.status.elapsed,
        freshness: 'fresh',
        degraded: false,
        last_refresh_error: '',
      });
    }

    await deps.resolveMatchOdds({
      matchId,
      homeTeam: fixture.teams.home.name,
      awayTeam: fixture.teams.away.name,
      kickoffTimestamp: fixture.fixture.timestamp,
      leagueName: fixture.league.name,
      leagueCountry: fixture.league.country,
      status: fixture.fixture.status.short,
      matchMinute: fixture.fixture.status.elapsed,
      consumer: 'provider-insight-refresh-job',
      sampleProviderData: false,
    }).catch(() => null);

    return null;
  }), 4);

  await batchRun(prematchFixtures.map((fixture) => async () => {
    const matchId = String(fixture.fixture.id);
    const prediction = await deps.fetchPrediction(matchId).catch(() => null);
    if (prediction) {
      await deps.upsertProviderFixturePredictionCache({
        match_id: matchId,
        prediction_payload: prediction,
        prediction_fetched_at: deps.now().toISOString(),
        match_status: fixture.fixture.status.short,
        freshness: 'fresh',
        degraded: false,
        last_refresh_error: '',
      });
    }

    standingsKeys.add(`${fixture.league.id}:${fixture.league.season}`);
    return null;
  }), 4);

  await batchRun(Array.from(standingsKeys).map((key) => async () => {
    const [leagueIdRaw, seasonRaw] = key.split(':');
    const leagueId = Number(leagueIdRaw);
    const season = Number(seasonRaw);
    if (!leagueId || !season) return null;
    const standings = await deps.fetchStandings(String(leagueId), String(season)).catch(() => null);
    if (!standings) return null;
    await deps.upsertProviderLeagueStandingsCache({
      league_id: leagueId,
      season,
      standings_payload: standings,
      standings_fetched_at: deps.now().toISOString(),
      freshness: 'fresh',
      degraded: false,
      last_refresh_error: '',
    });
    return null;
  }), 2);

  return {
    candidates: uniqueIds.length,
    fixtureCached: fixtures.length,
    detailRefreshed: detailFixtures.length,
    lineupsRefreshed: detailFixtures.length,
    predictionsRefreshed: prematchFixtures.length,
    standingsRefreshed: standingsKeys.size,
    oddsRefreshed: detailFixtures.length,
  };
}

function currentSeasonDefault(): number {
  const now = new Date();
  return now.getMonth() < 6 ? now.getFullYear() - 1 : now.getFullYear();
}

export async function ensureScoutInsight(
  matchId: string,
  options: {
    fixture?: ApiFixture | null;
    leagueId?: number;
    season?: number;
    status?: string;
    consumer?: string;
    sampleProviderData?: boolean;
  } = {},
  depsOverride?: Partial<ProviderInsightDeps>,
): Promise<ScoutInsightResult> {
  const deps = { ...defaultDeps, ...depsOverride };
  const matchInsight = await ensureMatchInsight(matchId, {
    fixture: options.fixture,
    status: options.status,
    consumer: options.consumer,
    sampleProviderData: options.sampleProviderData,
  }, deps);

  const fixture = matchInsight.fixture.payload;
  const effectiveStatus = fixture?.fixture?.status?.short ?? options.status ?? '';
  const effectiveMinute = fixture?.fixture?.status?.elapsed ?? null;
  const started = hasStarted(effectiveStatus);
  const leagueId = options.leagueId ?? fixture?.league?.id ?? null;
  const season = options.season ?? fixture?.league?.season ?? currentSeasonDefault();
  const now = deps.now();

  const [lineupsRow, predictionRow, standingsRow] = await Promise.all([
    deps.getProviderFixtureLineupsCache(matchId),
    deps.getProviderFixturePredictionCache(matchId),
    leagueId ? deps.getProviderLeagueStandingsCache(leagueId, season) : Promise.resolve(null),
  ]);

  const lineupsFreshness = classifyFreshness(ageMs(lineupsRow?.cached_at, now), detailTtlMs(effectiveStatus, effectiveMinute));
  const predictionFreshness = classifyFreshness(ageMs(predictionRow?.cached_at, now), predictionTtlMs(effectiveStatus));
  const standingsFreshness = classifyFreshness(ageMs(standingsRow?.cached_at, now), standingsTtlMs());

  if (started && lineupsFreshness !== 'fresh') {
    const lineups = await deps.fetchFixtureLineups(matchId).catch(() => null);
    if (lineups) {
      await deps.upsertProviderFixtureLineupsCache({
        match_id: matchId,
        lineups_payload: lineups,
        coverage_flags: buildLineupsCoverage(lineups),
        lineups_fetched_at: deps.now().toISOString(),
        match_status: effectiveStatus,
        match_minute: effectiveMinute,
        freshness: 'fresh',
        degraded: false,
        last_refresh_error: '',
      });
    }
  }

  if (!started && predictionFreshness !== 'fresh') {
    const prediction = await deps.fetchPrediction(matchId).catch(() => null);
    if (prediction) {
      await deps.upsertProviderFixturePredictionCache({
        match_id: matchId,
        prediction_payload: prediction,
        prediction_fetched_at: deps.now().toISOString(),
        match_status: effectiveStatus,
        freshness: 'fresh',
        degraded: false,
        last_refresh_error: '',
      });
    }
  }

  if (!started && leagueId && standingsFreshness !== 'fresh') {
    const standings = await deps.fetchStandings(String(leagueId), String(season)).catch(() => null);
    if (standings) {
      await deps.upsertProviderLeagueStandingsCache({
        league_id: leagueId,
        season,
        standings_payload: standings,
        standings_fetched_at: deps.now().toISOString(),
        freshness: 'fresh',
        degraded: false,
        last_refresh_error: '',
      });
    }
  }

  const [finalLineupsRow, finalPredictionRow, finalStandingsRow] = await Promise.all([
    deps.getProviderFixtureLineupsCache(matchId),
    deps.getProviderFixturePredictionCache(matchId),
    leagueId ? deps.getProviderLeagueStandingsCache(leagueId, season) : Promise.resolve(null),
  ]);
  const finalNow = deps.now();
  const finalLineupsFreshness = classifyFreshness(ageMs(finalLineupsRow?.cached_at, finalNow), detailTtlMs(effectiveStatus, effectiveMinute));
  const finalPredictionFreshness = classifyFreshness(ageMs(finalPredictionRow?.cached_at, finalNow), predictionTtlMs(effectiveStatus));
  const finalStandingsFreshness = classifyFreshness(ageMs(finalStandingsRow?.cached_at, finalNow), standingsTtlMs());

  return {
    ...matchInsight,
    lineups: buildLineupsDomain(
      finalLineupsRow,
      started ? finalLineupsFreshness : 'missing',
      !started
        ? 'miss'
        : finalLineupsFreshness === 'fresh'
          ? 'refreshed'
          : finalLineupsRow
            ? 'stale_fallback'
            : 'miss',
    ),
    prediction: buildPredictionDomain(
      finalPredictionRow,
      !started ? finalPredictionFreshness : 'missing',
      started
        ? 'miss'
        : finalPredictionFreshness === 'fresh'
          ? 'refreshed'
          : finalPredictionRow
            ? 'stale_fallback'
            : 'miss',
    ),
    standings: buildStandingsDomain(
      finalStandingsRow,
      !started ? finalStandingsFreshness : 'missing',
      started || !leagueId
        ? 'miss'
        : finalStandingsFreshness === 'fresh'
          ? 'refreshed'
          : finalStandingsRow
            ? 'stale_fallback'
            : 'miss',
    ),
  };
}