import {
  fetchAllLeagues,
  fetchFixturesByLeague,
  fetchFixturesForLeagueSeason,
  fetchLeagueById,
  fetchTeamsByLeagueWithSeason,
  type ApiFixture,
  type ApiLeague,
  type LeagueTeamsByLeagueResult,
} from './football-api.js';
import { getRedisClient } from './redis.js';

const LEAGUE_CATALOG_TTL_SEC = 12 * 60 * 60;
const LEAGUE_FIXTURES_TTL_SEC = 2 * 60;
const LEAGUE_SEASON_FIXTURES_TTL_SEC = 12 * 60 * 60;
const LEAGUE_TEAM_DIRECTORY_PROVIDER_TTL_SEC = 6 * 60 * 60;

const inFlight = new Map<string, Promise<unknown>>();

interface CachedEnvelope<T> {
  payload: T;
}

function getRedisSafe() {
  try {
    return getRedisClient();
  } catch {
    return null;
  }
}

function allLeaguesKey(): string {
  return 'cache:reference-data:leagues:all';
}

function leagueByIdKey(leagueId: number): string {
  return `cache:reference-data:league:${leagueId}`;
}

function leagueTeamsKey(leagueId: number): string {
  return `cache:reference-data:league-teams:${leagueId}`;
}

function leagueFixturesKey(leagueId: number, season: number, next: number): string {
  return `cache:reference-data:league-fixtures:${leagueId}:${season}:${next}`;
}

function leagueSeasonFixturesKey(leagueId: number, season: number): string {
  return `cache:reference-data:league-season-fixtures:${leagueId}:${season}`;
}

async function readCache<T>(key: string): Promise<T | null> {
  const redis = getRedisSafe();
  if (!redis) return null;
  try {
    const cached = await redis.get(key);
    if (!cached) return null;
    const parsed = JSON.parse(cached) as CachedEnvelope<T>;
    return parsed.payload ?? null;
  } catch {
    return null;
  }
}

async function writeCache<T>(key: string, value: T, ttlSec: number): Promise<void> {
  const redis = getRedisSafe();
  if (!redis) return;
  try {
    const envelope: CachedEnvelope<T> = { payload: value };
    await redis.set(key, JSON.stringify(envelope), 'EX', ttlSec);
  } catch {
    // Cache write failures must not break provider fetches.
  }
}

async function cachedFetch<T>(
  key: string,
  ttlSec: number,
  fetcher: () => Promise<T>,
  options: { force?: boolean } = {},
): Promise<T> {
  if (!options.force) {
    const cached = await readCache<T>(key);
    if (cached != null) return cached;
  }

  const existing = inFlight.get(key) as Promise<T> | undefined;
  if (existing) return existing;

  const promise = (async () => {
    const result = await fetcher();
    await writeCache(key, result, ttlSec);
    return result;
  })().finally(() => {
    inFlight.delete(key);
  });

  inFlight.set(key, promise);
  return promise;
}

export async function fetchAllLeaguesFromReferenceProvider(
  options: { force?: boolean } = {},
): Promise<ApiLeague[]> {
  return cachedFetch(allLeaguesKey(), LEAGUE_CATALOG_TTL_SEC, () => fetchAllLeagues(), options);
}

export async function fetchLeagueByIdFromReferenceProvider(
  leagueId: number,
  options: { force?: boolean } = {},
): Promise<ApiLeague | null> {
  return cachedFetch(leagueByIdKey(leagueId), LEAGUE_CATALOG_TTL_SEC, () => fetchLeagueById(leagueId), options);
}

export async function fetchLeagueTeamsBySeasonFromReferenceProvider(
  leagueId: number,
  options: { force?: boolean } = {},
): Promise<LeagueTeamsByLeagueResult | null> {
  return cachedFetch(leagueTeamsKey(leagueId), LEAGUE_TEAM_DIRECTORY_PROVIDER_TTL_SEC, () => fetchTeamsByLeagueWithSeason(leagueId), options);
}

export async function fetchLeagueFixturesFromReferenceProvider(
  leagueId: number,
  season: number,
  next: number,
  options: { force?: boolean } = {},
): Promise<ApiFixture[]> {
  return cachedFetch(
    leagueFixturesKey(leagueId, season, next),
    LEAGUE_FIXTURES_TTL_SEC,
    () => fetchFixturesByLeague(leagueId, season, next),
    options,
  );
}

export async function fetchLeagueSeasonFixturesFromReferenceProvider(
  leagueId: number,
  season: number,
  options: { force?: boolean } = {},
): Promise<ApiFixture[]> {
  return cachedFetch(
    leagueSeasonFixturesKey(leagueId, season),
    LEAGUE_SEASON_FIXTURES_TTL_SEC,
    () => fetchFixturesForLeagueSeason(leagueId, season),
    options,
  );
}
