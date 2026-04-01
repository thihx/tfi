// ============================================================
// Football API Client — api-sports.io v3
// ============================================================

import { config } from '../config.js';

interface ApiFootballResponse<T> {
  get: string;
  parameters: Record<string, string>;
  errors: Record<string, string>;
  results: number;
  response: T[];
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

// ==================== Predictions ====================

export interface ApiH2HFixture {
  fixture: { id: number; date: string };
  teams: {
    home: { id: number; name: string; winner: boolean | null };
    away: { id: number; name: string; winner: boolean | null };
  };
  goals: { home: number | null; away: number | null };
}

export interface ApiPrediction {
  predictions: {
    winner: { id: number; name: string; comment: string } | null;
    win_or_draw: boolean;
    under_over: string | null;
    goals: { home: string; away: string } | null;
    advice: string;
    percent: { home: string; draw: string; away: string } | null;
  };
  comparison: {
    form: { home: string; away: string } | null;
    att: { home: string; away: string } | null;
    def: { home: string; away: string } | null;
    goals: { home: string; away: string } | null;
    total: { home: string; away: string } | null;
    poisson_distribution?: { home: string; away: string } | null;
  };
  h2h?: ApiH2HFixture[];
  teams?: {
    home: { id: number; name: string; league?: { form?: string } };
    away: { id: number; name: string; league?: { form?: string } };
  };
}

// ==================== API Calls ====================

const API_TIMEOUT_MS = 15_000;
const MAX_RETRIES = 2;

async function apiGet<T>(endpoint: string, params: Record<string, string> = {}): Promise<T[]> {
  if (!config.footballApiKey) throw new Error('FOOTBALL_API_KEY not configured');

  const url = new URL(config.footballApiBaseUrl + endpoint);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

  let lastError: Error | null = null;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
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
        // Rate limited — wait and retry
        const waitMs = 2000 * (attempt + 1);
        console.warn(`[football-api] Rate limited (429), retrying in ${waitMs}ms...`);
        await new Promise((r) => setTimeout(r, waitMs));
        continue;
      }

      if (!res.ok) {
        const text = await res.text();
        throw new Error(`Football API ${res.status}: ${text.substring(0, 300)}`);
      }

      const data: ApiFootballResponse<T> = await res.json();
      if (data.errors && Object.keys(data.errors).length > 0) {
        throw new Error(`Football API errors: ${JSON.stringify(data.errors)}`);
      }
      return data.response;
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (attempt < MAX_RETRIES) {
        const waitMs = 1000 * (attempt + 1);
        console.warn(`[football-api] Attempt ${attempt + 1} failed, retrying in ${waitMs}ms...`, lastError.message);
        await new Promise((r) => setTimeout(r, waitMs));
      }
    }
  }

  throw lastError ?? new Error('Football API request failed');
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
  seasons: { year: number; current: boolean }[];
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

// ==================== Predictions ====================

export async function fetchPrediction(fixtureId: string): Promise<ApiPrediction | null> {
  const results = await apiGet<ApiPrediction>('/predictions', { fixture: fixtureId });
  return results[0] ?? null;
}

// ==================== Helpers ====================

/** Build a slim prediction object — includes H2H summary and full comparison */
export function buildSlimPrediction(item: ApiPrediction) {
  const pred = item.predictions;
  const comp = item.comparison;

  // Build H2H summary (last 5 meetings max)
  let h2hSummary: { total: number; home_wins: number; away_wins: number; draws: number } | null = null;
  if (Array.isArray(item.h2h) && item.h2h.length > 0) {
    const recent = item.h2h.slice(0, 5);
    const homeName = item.teams?.home?.name;
    let homeWins = 0, awayWins = 0, draws = 0;
    for (const m of recent) {
      const hGoals = m.goals?.home ?? 0;
      const aGoals = m.goals?.away ?? 0;
      if (hGoals === aGoals) { draws++; continue; }
      const winnerName = hGoals > aGoals ? m.teams?.home?.name : m.teams?.away?.name;
      if (winnerName === homeName) homeWins++;
      else awayWins++;
    }
    h2hSummary = { total: recent.length, home_wins: homeWins, away_wins: awayWins, draws };
  }

  // Extract team form sequence (e.g., "WDLWW")
  const homeForm = item.teams?.home?.league?.form || null;
  const awayForm = item.teams?.away?.league?.form || null;

  return {
    predictions: {
      winner: pred.winner ?? null,
      win_or_draw: pred.win_or_draw,
      under_over: pred.under_over,
      goals: pred.goals ?? null,
      advice: pred.advice,
      percent: pred.percent ?? null,
    },
    comparison: {
      form: comp.form ?? null,
      att: comp.att ?? null,
      def: comp.def ?? null,
      goals: comp.goals ?? null,
      total: comp.total ?? null,
      poisson_distribution: comp.poisson_distribution ?? null,
    },
    h2h_summary: h2hSummary,
    team_form: (homeForm || awayForm) ? { home: homeForm, away: awayForm } : null,
  };
}
