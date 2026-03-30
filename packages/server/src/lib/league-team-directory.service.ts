import type { LeagueTeamWithRank } from './football-api.js';
import { getRedisClient } from './redis.js';
import { fetchLeagueTeamsBySeasonFromReferenceProvider } from './reference-data-provider.js';
import {
  getLeagueTeamDirectory as getLeagueTeamDirectoryRows,
  replaceLeagueTeamsSnapshot,
  type LeagueTeamDirectoryRow,
} from '../repos/team-directory.repo.js';

const DIRECTORY_TTL_MS = 24 * 60 * 60 * 1000;
const REDIS_CACHE_TTL_SEC = 15 * 60;
const REFRESH_LOCK_TTL_SEC = 30;
const REMOTE_REFRESH_WAIT_MS = 2_000;
const REMOTE_REFRESH_POLL_MS = 200;

const inFlightRefreshes = new Map<number, Promise<LeagueTeamDirectoryRefreshResult>>();

export interface LeagueTeamResponse {
  team: {
    id: number;
    name: string;
    logo: string;
    country: string | null;
  };
  rank: number | null;
}

export interface LeagueTeamDirectoryRefreshResult {
  rows: LeagueTeamResponse[];
  source: 'fresh_cache' | 'provider_refreshed' | 'remote_refreshed' | 'stale_fallback' | 'empty_provider';
}

function cacheKey(leagueId: number): string {
  return `cache:league-team-directory:${leagueId}`;
}

function refreshLockKey(leagueId: number): string {
  return `lock:league-team-directory:${leagueId}`;
}

function toResponse(rows: LeagueTeamDirectoryRow[]): LeagueTeamResponse[] {
  return rows.map((row) => ({
    team: {
      id: row.team_id,
      name: row.team_name,
      logo: row.team_logo,
      country: row.country || null,
    },
    rank: row.rank,
  }));
}

function isFresh(rows: LeagueTeamDirectoryRow[], now = Date.now()): boolean {
  if (rows.length === 0) return false;
  return rows.every((row) => Date.parse(row.expires_at) > now);
}

function getRedisSafe() {
  try {
    return getRedisClient();
  } catch {
    return null;
  }
}

async function readRedisCache(leagueId: number): Promise<LeagueTeamResponse[] | null> {
  const redis = getRedisSafe();
  if (!redis) return null;
  try {
    const cached = await redis.get(cacheKey(leagueId));
    return cached ? JSON.parse(cached) as LeagueTeamResponse[] : null;
  } catch {
    return null;
  }
}

async function writeRedisCache(leagueId: number, rows: LeagueTeamResponse[]): Promise<void> {
  const redis = getRedisSafe();
  if (!redis) return;
  try {
    await redis.set(cacheKey(leagueId), JSON.stringify(rows), 'EX', REDIS_CACHE_TTL_SEC);
  } catch {
    // ignore cache write failures
  }
}

async function invalidateRedisCache(leagueId: number): Promise<void> {
  const redis = getRedisSafe();
  if (!redis) return;
  try {
    await redis.del(cacheKey(leagueId));
  } catch {
    // ignore cache invalidation failures
  }
}

async function acquireRefreshLock(leagueId: number): Promise<boolean> {
  const redis = getRedisSafe();
  if (!redis) return true;
  try {
    const result = await redis.set(refreshLockKey(leagueId), '1', 'EX', REFRESH_LOCK_TTL_SEC, 'NX');
    return result === 'OK';
  } catch {
    return true;
  }
}

async function releaseRefreshLock(leagueId: number): Promise<void> {
  const redis = getRedisSafe();
  if (!redis) return;
  try {
    await redis.del(refreshLockKey(leagueId));
  } catch {
    // ignore lock release failures
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForRemoteRefresh(leagueId: number): Promise<LeagueTeamDirectoryRefreshResult | null> {
  const deadline = Date.now() + REMOTE_REFRESH_WAIT_MS;
  while (Date.now() < deadline) {
    await sleep(REMOTE_REFRESH_POLL_MS);
    const rows = await getLeagueTeamDirectoryRows(leagueId);
    if (isFresh(rows)) {
      const response = toResponse(rows);
      await writeRedisCache(leagueId, response);
      return { rows: response, source: 'remote_refreshed' };
    }
  }
  return null;
}

async function refreshFromProvider(leagueId: number): Promise<LeagueTeamDirectoryRefreshResult> {
  const providerResult = await fetchLeagueTeamsBySeasonFromReferenceProvider(leagueId, { force: true });
  if (!providerResult || providerResult.teams.length === 0) {
    await invalidateRedisCache(leagueId);
    return { rows: [], source: 'empty_provider' };
  }

  const fetchedAt = new Date();
  const expiresAt = new Date(fetchedAt.getTime() + DIRECTORY_TTL_MS);
  await replaceLeagueTeamsSnapshot({
    leagueId,
    season: providerResult.season,
    fetchedAt,
    expiresAt,
    teams: providerResult.teams.map((row: LeagueTeamWithRank) => ({
      team: row.team,
      venue: row.venue,
      rank: row.rank,
    })),
  });

  const response = providerResult.teams.map((row) => ({
    team: {
      id: row.team.id,
      name: row.team.name,
      logo: row.team.logo,
      country: row.team.country,
    },
    rank: row.rank,
  }));
  await writeRedisCache(leagueId, response);
  return { rows: response, source: 'provider_refreshed' };
}

async function refreshLeagueTeamDirectory(
  leagueId: number,
  fallbackRows: LeagueTeamDirectoryRow[],
): Promise<LeagueTeamDirectoryRefreshResult> {
  const hasLock = await acquireRefreshLock(leagueId);
  if (!hasLock) {
    const remoteResult = await waitForRemoteRefresh(leagueId);
    if (remoteResult) return remoteResult;
    if (fallbackRows.length > 0) return { rows: toResponse(fallbackRows), source: 'stale_fallback' };
  }

  try {
    return await refreshFromProvider(leagueId);
  } catch (error) {
    if (fallbackRows.length > 0) {
      return { rows: toResponse(fallbackRows), source: 'stale_fallback' };
    }
    throw error;
  } finally {
    if (hasLock) {
      await releaseRefreshLock(leagueId);
    }
  }
}

export async function refreshLeagueTeamsDirectoryNow(leagueId: number): Promise<LeagueTeamDirectoryRefreshResult> {
  const existing = inFlightRefreshes.get(leagueId);
  if (existing) return existing;

  const rows = await getLeagueTeamDirectoryRows(leagueId);
  if (isFresh(rows)) {
    const response = toResponse(rows);
    await writeRedisCache(leagueId, response);
    return { rows: response, source: 'fresh_cache' };
  }
  const refreshPromise = refreshLeagueTeamDirectory(leagueId, rows)
    .finally(() => {
      inFlightRefreshes.delete(leagueId);
    });
  inFlightRefreshes.set(leagueId, refreshPromise);
  return refreshPromise;
}

export async function getLeagueTeamsDirectory(leagueId: number): Promise<LeagueTeamResponse[]> {
  const cached = await readRedisCache(leagueId);
  if (cached) return cached;

  const rows = await getLeagueTeamDirectoryRows(leagueId);
  if (isFresh(rows)) {
    const response = toResponse(rows);
    await writeRedisCache(leagueId, response);
    return response;
  }

  const existing = inFlightRefreshes.get(leagueId);
  if (existing) {
    const result = await existing;
    return result.rows;
  }

  const refreshPromise = refreshLeagueTeamDirectory(leagueId, rows)
    .finally(() => {
      inFlightRefreshes.delete(leagueId);
    });
  inFlightRefreshes.set(leagueId, refreshPromise);
  const result = await refreshPromise;
  return result.rows;
}
