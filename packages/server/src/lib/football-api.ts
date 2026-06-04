// ============================================================
// Football API Client — api-sports.io v3
//
// Canonical entry point for all outbound HTTP to the sports data provider.
// Call sites (jobs, pipelines, caches, proxy routes) must use this module —
// do not add ad-hoc fetch() to the provider base URL elsewhere.
// ============================================================

import { config } from '../config.js';
import {
  assertFootballApiAvailable,
  extractFootballApiDailyLimitError,
  FootballApiDailyLimitError,
  isFootballApiDailyLimitMessage,
  openFootballApiCircuitUntilNextUtcMidnight,
  recordFootballApiDailyLimitFromError,
} from './football-api-circuit.js';
import { incrementFootballApiDailyCount, checkAndTripCircuitAtCritical } from './football-api-quota.js';
import { getFootballApiRequestContext } from './football-api-request-context.js';
import { recordApiFootballRequestSafe } from '../repos/api-football-request-ledger.repo.js';

interface ApiFootballResponse<T> {
  get: string;
  parameters: Record<string, string>;
  errors: Record<string, string>;
  results: number;
  response: T[];
}

export interface ApiFootballStatusResponse {
  errors?: Record<string, string>;
  response?: {
    account?: {
      requests?: {
        current?: number;
        limit_day?: number;
      };
    };
  };
}

export interface ApiFootballStatusResult {
  ok: boolean;
  status: number;
  data: ApiFootballStatusResponse | null;
  text: string;
}

// ==================== Fixtures ====================

export interface ApiFixture {
  fixture: {
    id: number;
    referee: string | null;
    timezone: string;
    date: string;
    timestamp: number;
    periods: { first: number | null; second: number | null };
    venue: { id: number | null; name: string | null; city: string | null };
    status: { long: string; short: string; elapsed: number | null };
  };
  league: { id: number; name: string; country: string; logo: string; flag: string | null; season: number; round: string };
  teams: {
    home: { id: number; name: string; logo: string; winner: boolean | null };
    away: { id: number; name: string; logo: string; winner: boolean | null };
  };
  goals: { home: number | null; away: number | null };
  score: Record<string, { home: number | null; away: number | null }>;
}

// ==================== API Calls ====================

const API_TIMEOUT_MS = 15_000;
const MAX_RETRIES = 2;

async function countOutboundAttempt(): Promise<void> {
  await incrementFootballApiDailyCount();
  await checkAndTripCircuitAtCritical();
}

async function recordProviderAttempt(input: {
  endpoint: string;
  params?: Record<string, string>;
  attempt: number;
  startedAt: number;
  success: boolean;
  dailyLimit?: boolean;
  statusCode?: number | null;
  resultCount?: number | null;
  quotaCurrent?: number | null;
  quotaLimit?: number | null;
  error?: string | null;
}): Promise<void> {
  const context = getFootballApiRequestContext();
  await recordApiFootballRequestSafe({
    jobName: context.jobName ?? null,
    consumer: context.consumer ?? null,
    endpoint: input.endpoint,
    params: input.params ?? {},
    attempt: input.attempt,
    success: input.success,
    dailyLimit: input.dailyLimit,
    statusCode: input.statusCode ?? null,
    latencyMs: Math.max(0, Date.now() - input.startedAt),
    resultCount: input.resultCount ?? null,
    quotaCurrent: input.quotaCurrent ?? null,
    quotaLimit: input.quotaLimit ?? null,
    error: input.error ?? '',
  });
}

async function apiGet<T>(endpoint: string, params: Record<string, string> = {}): Promise<T[]> {
  if (!config.footballApiKey) throw new Error('FOOTBALL_API_KEY not configured');

  await assertFootballApiAvailable();

  const url = new URL(config.footballApiBaseUrl + endpoint);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

  let lastError: Error | null = null;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const attemptNumber = attempt + 1;
    let startedAt = Date.now();
    let recorded = false;
    try {
      await countOutboundAttempt();
      startedAt = Date.now();
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), API_TIMEOUT_MS);

      const res = await fetch(url.toString(), {
        headers: {
          'x-apisports-key': config.footballApiKey,
          Accept: 'application/json',
        },
        signal: controller.signal,
      });

      clearTimeout(timer);

      if (res.status === 429) {
        const text = await res.text();
        const dailyLimit = isFootballApiDailyLimitMessage(text);
        await recordProviderAttempt({
          endpoint,
          params,
          attempt: attemptNumber,
          startedAt,
          success: false,
          dailyLimit,
          statusCode: res.status,
          error: text.substring(0, 500),
        });
        recorded = true;
        if (dailyLimit) {
          const openUntil = await openFootballApiCircuitUntilNextUtcMidnight();
          throw new FootballApiDailyLimitError(openUntil, `Football API ${res.status}: ${text.substring(0, 300)}`);
        }
        const waitMs = 2000 * (attempt + 1);
        console.warn(`[football-api] Rate limited (429), retrying in ${waitMs}ms...`);
        await new Promise((r) => setTimeout(r, waitMs));
        continue;
      }

      if (!res.ok) {
        const text = await res.text();
        const dailyLimit = isFootballApiDailyLimitMessage(text);
        await recordProviderAttempt({
          endpoint,
          params,
          attempt: attemptNumber,
          startedAt,
          success: false,
          dailyLimit,
          statusCode: res.status,
          error: text.substring(0, 500),
        });
        recorded = true;
        if (dailyLimit) {
          const openUntil = await openFootballApiCircuitUntilNextUtcMidnight();
          throw new FootballApiDailyLimitError(openUntil, `Football API ${res.status}: ${text.substring(0, 300)}`);
        }
        throw new Error(`Football API ${res.status}: ${text.substring(0, 300)}`);
      }

      const data: ApiFootballResponse<T> = await res.json();
      if (data.errors && Object.keys(data.errors).length > 0) {
        const serializedErrors = JSON.stringify(data.errors);
        const dailyLimit = isFootballApiDailyLimitMessage(serializedErrors);
        await recordProviderAttempt({
          endpoint,
          params,
          attempt: attemptNumber,
          startedAt,
          success: false,
          dailyLimit,
          statusCode: res.status,
          resultCount: data.results,
          error: serializedErrors.substring(0, 500),
        });
        recorded = true;
        if (dailyLimit) {
          const openUntil = await openFootballApiCircuitUntilNextUtcMidnight();
          throw new FootballApiDailyLimitError(openUntil, `Football API errors: ${serializedErrors}`);
        }
        throw new Error(`Football API errors: ${serializedErrors}`);
      }
      await recordProviderAttempt({
        endpoint,
        params,
        attempt: attemptNumber,
        startedAt,
        success: true,
        statusCode: res.status,
        resultCount: data.results,
      });
      recorded = true;
      return data.response;
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (!recorded && !(lastError instanceof FootballApiDailyLimitError)) {
        await recordProviderAttempt({
          endpoint,
          params,
          attempt: attemptNumber,
          startedAt,
          success: false,
          error: lastError.message,
        });
      }
      if (lastError instanceof FootballApiDailyLimitError) {
        throw lastError;
      }
      if (await recordFootballApiDailyLimitFromError(lastError)) {
        throw extractFootballApiDailyLimitError(lastError) ?? lastError;
      }
      if (attempt < MAX_RETRIES) {
        const waitMs = 1000 * (attempt + 1);
        console.warn(`[football-api] Attempt ${attempt + 1} failed, retrying in ${waitMs}ms...`, lastError.message);
        await new Promise((r) => setTimeout(r, waitMs));
      }
    }
  }

  throw lastError ?? new Error('Football API request failed');
}

export async function fetchFootballApiStatus(): Promise<ApiFootballStatusResult> {
  if (!config.footballApiKey) throw new Error('FOOTBALL_API_KEY not configured');

  await assertFootballApiAvailable();

  const url = new URL(config.footballApiBaseUrl + '/status');

  let lastError: Error | null = null;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const attemptNumber = attempt + 1;
    let startedAt = Date.now();
    let recorded = false;
    try {
      await countOutboundAttempt();
      startedAt = Date.now();
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), API_TIMEOUT_MS);

      const res = await fetch(url.toString(), {
        headers: {
          'x-apisports-key': config.footballApiKey,
          Accept: 'application/json',
        },
        signal: controller.signal,
      });

      clearTimeout(timer);

      const text = await res.text();
      const dailyLimit = isFootballApiDailyLimitMessage(text);
      if (dailyLimit) {
        await openFootballApiCircuitUntilNextUtcMidnight();
      }

      let data: ApiFootballStatusResponse | null = null;
      try {
        data = text ? JSON.parse(text) as ApiFootballStatusResponse : null;
      } catch {
        data = null;
      }

      const quota = data?.response?.account?.requests;
      await recordProviderAttempt({
        endpoint: '/status',
        attempt: attemptNumber,
        startedAt,
        success: res.ok && !dailyLimit,
        dailyLimit,
        statusCode: res.status,
        quotaCurrent: quota?.current ?? null,
        quotaLimit: quota?.limit_day ?? null,
        error: res.ok ? '' : text.substring(0, 500),
      });
      recorded = true;

      return {
        ok: res.ok,
        status: res.status,
        data,
        text,
      };
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (!recorded && !(lastError instanceof FootballApiDailyLimitError)) {
        await recordProviderAttempt({
          endpoint: '/status',
          attempt: attemptNumber,
          startedAt,
          success: false,
          error: lastError.message,
        });
      }
      if (lastError instanceof FootballApiDailyLimitError) {
        throw lastError;
      }
      if (await recordFootballApiDailyLimitFromError(lastError)) {
        throw extractFootballApiDailyLimitError(lastError) ?? lastError;
      }
      if (attempt < MAX_RETRIES) {
        const waitMs = 1000 * (attempt + 1);
        console.warn(`[football-api] Status attempt ${attempt + 1} failed, retrying in ${waitMs}ms...`, lastError.message);
        await new Promise((r) => setTimeout(r, waitMs));
      }
    }
  }

  throw lastError ?? new Error('Football API status request failed');
}

export async function fetchFixturesForDate(date: string): Promise<ApiFixture[]> {
  return apiGet<ApiFixture>('/fixtures', { date, timezone: config.timezone });
}

export async function fetchFixturesByIds(ids: string[]): Promise<ApiFixture[]> {
  if (ids.length === 0) return [];
  return apiGet<ApiFixture>('/fixtures', { ids: ids.join('-') });
}

export async function fetchFixturesByLeague(leagueId: number, season: number, next: number): Promise<ApiFixture[]> {
  return apiGet<ApiFixture>('/fixtures', { league: String(leagueId), season: String(season), next: String(next) });
}

export async function fetchFixturesForLeagueSeason(leagueId: number, season: number): Promise<ApiFixture[]> {
  return apiGet<ApiFixture>('/fixtures', {
    league: String(leagueId),
    season: String(season),
    timezone: config.timezone,
  });
}

export async function fetchLiveOdds(fixtureId: string): Promise<unknown[]> {
  return apiGet<unknown>('/odds/live', { fixture: fixtureId });
}

export async function fetchPreMatchOdds(fixtureId: string): Promise<unknown[]> {
  return apiGet<unknown>('/odds', { fixture: fixtureId });
}

// ==================== Fixture Detail ====================

export interface ApiFixtureEvent {
  time: { elapsed: number; extra: number | null };
  team: { id: number; name: string; logo: string };
  player: { id: number | null; name: string | null };
  assist: { id: number | null; name: string | null };
  type: string;
  detail: string;
  comments: string | null;
}

export interface ApiFixtureStat {
  team: { id: number; name: string; logo: string };
  statistics: Array<{ type: string; value: string | number | null }>;
}

export interface ApiFixtureLineupPlayer {
  player: { id: number; name: string; number: number; pos: string; grid: string | null };
}

export interface ApiFixtureLineup {
  team: { id: number; name: string; logo: string };
  coach: { id: number | null; name: string | null; photo: string | null };
  formation: string;
  startXI: ApiFixtureLineupPlayer[];
  substitutes: ApiFixtureLineupPlayer[];
}

export interface ApiStanding {
  rank: number;
  team: { id: number; name: string; logo: string };
  points: number;
  goalsDiff: number;
  form: string;
  description: string | null;
  all: { played: number; win: number; draw: number; lose: number; goals: { for: number; against: number } };
}

export async function fetchFixtureEvents(fixtureId: string): Promise<ApiFixtureEvent[]> {
  return apiGet<ApiFixtureEvent>('/fixtures/events', { fixture: fixtureId });
}

export async function fetchFixtureStatistics(fixtureId: string): Promise<ApiFixtureStat[]> {
  return apiGet<ApiFixtureStat>('/fixtures/statistics', { fixture: fixtureId });
}

export async function fetchFixtureLineups(fixtureId: string): Promise<ApiFixtureLineup[]> {
  return apiGet<ApiFixtureLineup>('/fixtures/lineups', { fixture: fixtureId });
}

export async function fetchStandings(leagueId: string, season: string): Promise<ApiStanding[]> {
  interface StandingsWrapper { league: { standings: ApiStanding[][] } }
  const results = await apiGet<StandingsWrapper>('/standings', { league: leagueId, season });
  // standings[0] is the main group/table
  return results[0]?.league?.standings?.[0] ?? [];
}

// ==================== Leagues ====================

export interface ApiLeague {
  league: { id: number; name: string; type: string; logo: string };
  country: { name: string; code: string | null; flag: string | null };
  seasons: Array<{
    year: number;
    current: boolean;
    coverage?: {
      fixtures?: {
        events?: boolean;
        lineups?: boolean;
        statistics_fixtures?: boolean;
        statistics_players?: boolean;
      };
      standings?: boolean;
      players?: boolean;
      top_scorers?: boolean;
      top_assists?: boolean;
      top_cards?: boolean;
      injuries?: boolean;
      predictions?: boolean;
      odds?: boolean;
    };
  }>;
}

export async function fetchAllLeagues(): Promise<ApiLeague[]> {
  return apiGet<ApiLeague>('/leagues');
}

export async function fetchLeagueById(leagueId: number): Promise<ApiLeague | null> {
  const results = await apiGet<ApiLeague>('/leagues', { id: String(leagueId) });
  return results[0] ?? null;
}

// ==================== Teams ====================

export interface ApiTeam {
  team: { id: number; name: string; logo: string; country: string | null; founded: number | null };
  venue: { id: number | null; name: string | null; city: string | null } | null;
}

export interface LeagueTeamWithRank {
  team: ApiTeam['team'];
  venue: ApiTeam['venue'];
  rank: number | null;
}

export interface LeagueTeamsByLeagueResult {
  season: number;
  teams: LeagueTeamWithRank[];
}

/** Fetch teams for a league/season. Returns empty array if no data. */
async function fetchTeamsForSeason(leagueId: number, season: number): Promise<ApiTeam[]> {
  return apiGet<ApiTeam>('/teams', { league: String(leagueId), season: String(season) });
}

function buildFallbackLeagueSeasons(league: ApiLeague | null, attempted: number[]): number[] {
  if (!league?.seasons?.length) return [];

  const attemptedSet = new Set(attempted);
  const currentSeasons = league.seasons
    .filter((season) => season.current)
    .map((season) => season.year);
  const remainingYears = league.seasons
    .map((season) => season.year)
    .filter((year) => !attemptedSet.has(year))
    .sort((left, right) => right - left);

  return Array.from(new Set([
    ...currentSeasons,
    ...remainingYears,
  ])).filter((season) => Number.isFinite(season) && !attemptedSet.has(season));
}

/**
 * Fetch teams by league with automatic season fallback:
 * tries current year first, then current year - 1.
 * Also fetches standings to attach rank to each team.
 */
export async function fetchTeamsByLeagueWithSeason(leagueId: number): Promise<LeagueTeamsByLeagueResult | null> {
  const currentYear = new Date().getFullYear();
  const attemptedSeasons: number[] = [];
  let teams: ApiTeam[] = [];
  let season = currentYear;

  for (const candidateSeason of [currentYear, currentYear - 1]) {
    attemptedSeasons.push(candidateSeason);
    teams = await fetchTeamsForSeason(leagueId, candidateSeason);
    season = candidateSeason;
    if (teams.length > 0) break;
  }

  if (teams.length === 0) {
    const league = await fetchLeagueById(leagueId);
    const fallbackSeasons = buildFallbackLeagueSeasons(league, attemptedSeasons);
    for (const candidateSeason of fallbackSeasons) {
      attemptedSeasons.push(candidateSeason);
      teams = await fetchTeamsForSeason(leagueId, candidateSeason);
      season = candidateSeason;
      if (teams.length > 0) break;
    }
  }

  if (teams.length === 0) return null;

  // Fetch standings to get rank (best-effort, ignore errors)
  let rankMap = new Map<number, number>();
  try {
    const standings = await fetchStandings(String(leagueId), String(season));
    for (const s of standings) rankMap.set(s.team.id, s.rank);
  } catch { /* no standings for cups/internationals */ }

  return {
    season,
    teams: teams
      .map((t) => ({ team: t.team, venue: t.venue, rank: rankMap.get(t.team.id) ?? null }))
      .sort((a, b) => {
        if (a.rank !== null && b.rank !== null) return a.rank - b.rank;
        if (a.rank !== null) return -1;
        if (b.rank !== null) return 1;
        return a.team.name.localeCompare(b.team.name);
      }),
  };
}

export async function fetchTeamsByLeague(leagueId: number): Promise<{ team: ApiTeam['team']; rank: number | null }[]> {
  const result = await fetchTeamsByLeagueWithSeason(leagueId);
  if (!result) return [];
  return result.teams
    .map(({ team, rank }) => ({ team, rank }))
    .sort((a, b) => {
      if (a.rank !== null && b.rank !== null) return a.rank - b.rank;
      if (a.rank !== null) return -1;
      if (b.rank !== null) return 1;
      return a.team.name.localeCompare(b.team.name);
    });
}
