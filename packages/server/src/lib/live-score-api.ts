// ============================================================
// Live Score API Client - benchmark-only live stats provider
// https://live-score-api.com/
// ============================================================

import { config } from '../config.js';
import type { ApiFixture, ApiFixtureEvent, ApiFixtureStat } from './football-api.js';

const API_TIMEOUT_MS = 10_000;
const MAX_RETRIES = 1;
const LIVE_MATCHES_CACHE_TTL_MS = 20_000;
const TEAM_SUFFIXES = /\b(fc|sc|cf|afc|ac|as|us|ss|cd|rcd|rc|ca|se|fk|bk|if|sk|gf|bfc)\b/gi;

type CachedValue<T> = {
  expiresAt: number;
  value: T;
};

const liveMatchesCache = new Map<string, CachedValue<LiveScoreMatch[]>>();

interface LiveScoreResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
  code?: number;
}

export interface LiveScoreMatch {
  id: number;
  fixture_id: number;
  status: string;
  time: string;
  scheduled: string;
  competition?: { id: number; name: string };
  country?: { id: number; name: string };
  home?: { id: number; name: string };
  away?: { id: number; name: string };
  scores?: { score?: string };
  urls?: {
    events?: string;
    statistics?: string;
    lineups?: string;
    head2head?: string;
  };
  odds?: {
    live?: Record<string, number | null>;
    pre?: Record<string, number | null>;
  };
}

export interface LiveScoreStatsPayload {
  yellow_cards?: string | null;
  red_cards?: string | null;
  substitutions?: string | null;
  possesion?: string | null;
  free_kicks?: string | null;
  goal_kicks?: string | null;
  throw_ins?: string | null;
  offsides?: string | null;
  corners?: string | null;
  shots_on_target?: string | null;
  shots_off_target?: string | null;
  attempts_on_goal?: string | null;
  saves?: string | null;
  fauls?: string | null;
  treatments?: string | null;
  penalties?: string | null;
  shots_blocked?: string | null;
  dangerous_attacks?: string | null;
  attacks?: string | null;
}

export interface LiveScoreEvent {
  id: string;
  match_id: string;
  player: string;
  time: string;
  event: string;
  sort: string;
  home_away: 'h' | 'a' | string;
  info: string | null;
}

interface LiveScoreEventResponse {
  match?: {
    id?: string;
    fixture_id?: string;
    home_name?: string;
    away_name?: string;
    score?: string;
    time?: string;
    status?: string;
    scheduled?: string;
    competition?: { name?: string };
  };
  event?: LiveScoreEvent[];
}

interface CompactStatPair {
  home: string | null;
  away: string | null;
}

export interface LiveScoreStatsCompact {
  possession: CompactStatPair;
  shots: CompactStatPair;
  shots_on_target: CompactStatPair;
  corners: CompactStatPair;
  fouls: CompactStatPair;
  offsides: CompactStatPair;
  yellow_cards: CompactStatPair;
  red_cards: CompactStatPair;
  goalkeeper_saves: CompactStatPair;
  blocked_shots: CompactStatPair;
  total_passes: CompactStatPair;
  passes_accurate: CompactStatPair;
}

export interface LiveScoreBenchmarkTrace {
  matched: boolean;
  providerMatchId: string | null;
  providerFixtureId: string | null;
  matchedMatch: LiveScoreMatch | null;
  rawLiveMatches: LiveScoreMatch[];
  rawStats: LiveScoreStatsPayload | null;
  rawEvents: LiveScoreEvent[];
  normalizedStats: ApiFixtureStat[];
  normalizedEvents: ApiFixtureEvent[];
  statsCompact: LiveScoreStatsCompact;
  coverageFlags: Record<string, unknown>;
  statusCode: number | null;
  latencyMs: number;
  error: string | null;
}

export interface FetchLiveScoreBenchmarkDeps {
  fetchLiveMatches?: () => Promise<LiveScoreMatch[]>;
  fetchMatchStats?: (matchId: string) => Promise<LiveScoreStatsPayload>;
  fetchMatchEvents?: (matchId: string) => Promise<LiveScoreEvent[]>;
}

function cacheGet<T>(cache: Map<string, CachedValue<T>>, key: string): T | null {
  const entry = cache.get(key);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    cache.delete(key);
    return null;
  }
  return entry.value;
}

function cacheSet<T>(cache: Map<string, CachedValue<T>>, key: string, value: T, ttlMs: number): void {
  cache.set(key, {
    expiresAt: Date.now() + ttlMs,
    value,
  });
}

function normalizeText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\butd\b/g, 'united')
    .replace(/\bst\b/g, 'saint')
    .replace(TEAM_SUFFIXES, ' ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenize(value: string): string[] {
  return normalizeText(value)
    .split(' ')
    .map((token) => token.trim())
    .filter((token) => token.length >= 2);
}

function tokenOverlapRatio(a: string, b: string): number {
  const tokensA = new Set(tokenize(a));
  const tokensB = new Set(tokenize(b));
  if (tokensA.size === 0 || tokensB.size === 0) return 0;

  let overlap = 0;
  for (const token of tokensA) {
    if (tokensB.has(token)) overlap++;
  }
  return overlap / Math.max(tokensA.size, tokensB.size);
}

function levenshteinRatio(a: string, b: string): number {
  if (a === b) return 1;
  const la = a.length;
  const lb = b.length;
  if (!la || !lb) return 0;

  const matrix: number[][] = [];
  for (let i = 0; i <= la; i++) matrix[i] = [i];
  for (let j = 0; j <= lb; j++) matrix[0]![j] = j;

  for (let i = 1; i <= la; i++) {
    for (let j = 1; j <= lb; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      matrix[i]![j] = Math.min(
        matrix[i - 1]![j]! + 1,
        matrix[i]![j - 1]! + 1,
        matrix[i - 1]![j - 1]! + cost,
      );
    }
  }

  return 1 - matrix[la]![lb]! / Math.max(la, lb);
}

function similarity(a: string, b: string): number {
  const normA = normalizeText(a);
  const normB = normalizeText(b);
  if (!normA || !normB) return 0;
  if (normA === normB) return 1;

  const containsScore =
    (normA.length >= 5 && normB.includes(normA)) || (normB.length >= 5 && normA.includes(normB))
      ? 0.92
      : 0;

  return Math.max(
    containsScore,
    tokenOverlapRatio(normA, normB),
    levenshteinRatio(normA, normB),
  );
}

function isActiveLiveTime(value: string | undefined): boolean {
  const normalized = String(value || '').toUpperCase().replace(/[^\w+]/g, '');
  if (!normalized) return false;
  if (normalized === 'HT') return true;
  if (/^\d+\+?\d*$/.test(normalized)) return true;
  return false;
}

function parseScore(raw: string | undefined): { home: number | null; away: number | null } {
  const match = String(raw || '').match(/(\d+)\s*-\s*(\d+)/);
  if (!match) return { home: null, away: null };
  return { home: Number(match[1]), away: Number(match[2]) };
}

function parseMinute(value: string | undefined): { elapsed: number; extra: number | null } {
  const cleaned = String(value || '').replace(/[^\d+]/g, '');
  const match = cleaned.match(/^(\d+)(?:\+(\d+))?$/);
  if (!match) return { elapsed: 0, extra: null };
  return {
    elapsed: Number(match[1]),
    extra: match[2] ? Number(match[2]) : null,
  };
}

function splitPair(value: string | null | undefined): CompactStatPair {
  if (!value) return { home: null, away: null };
  const match = String(value).match(/^\s*([^:]+)\s*:\s*([^:]+)\s*$/);
  if (!match) return { home: null, away: null };
  return {
    home: match[1]?.trim() || null,
    away: match[2]?.trim() || null,
  };
}

function pickStatValue(
  stats: LiveScoreStatsCompact,
  statName: keyof LiveScoreStatsCompact,
  side: 'home' | 'away',
): string | null {
  return stats[statName][side] ?? null;
}

function buildStatsCompact(stats: LiveScoreStatsPayload | null): LiveScoreStatsCompact {
  return {
    possession: splitPair(stats?.possesion),
    shots: splitPair(stats?.attempts_on_goal),
    shots_on_target: splitPair(stats?.shots_on_target),
    corners: splitPair(stats?.corners),
    fouls: splitPair(stats?.fauls),
    offsides: splitPair(stats?.offsides),
    yellow_cards: splitPair(stats?.yellow_cards),
    red_cards: splitPair(stats?.red_cards),
    goalkeeper_saves: splitPair(stats?.saves),
    blocked_shots: splitPair(stats?.shots_blocked),
    total_passes: { home: null, away: null },
    passes_accurate: { home: null, away: null },
  };
}

function buildApiFixtureStats(fixture: ApiFixture, compact: LiveScoreStatsCompact): ApiFixtureStat[] {
  const homeId = fixture.teams?.home?.id ?? 0;
  const awayId = fixture.teams?.away?.id ?? 0;
  const homeName = fixture.teams?.home?.name || '';
  const awayName = fixture.teams?.away?.name || '';
  const homeLogo = fixture.teams?.home?.logo || '';
  const awayLogo = fixture.teams?.away?.logo || '';

  const makeStats = (side: 'home' | 'away') => {
    const values: ApiFixtureStat['statistics'] = [];
    const add = (type: string, value: string | null) => {
      if (value != null) values.push({ type, value });
    };

    add('Ball Possession', pickStatValue(compact, 'possession', side));
    add('Total Shots', pickStatValue(compact, 'shots', side));
    add('Shots on Goal', pickStatValue(compact, 'shots_on_target', side));
    add('Corner Kicks', pickStatValue(compact, 'corners', side));
    add('Fouls', pickStatValue(compact, 'fouls', side));
    add('Offsides', pickStatValue(compact, 'offsides', side));
    add('Yellow Cards', pickStatValue(compact, 'yellow_cards', side));
    add('Red Cards', pickStatValue(compact, 'red_cards', side));
    add('Goalkeeper Saves', pickStatValue(compact, 'goalkeeper_saves', side));
    add('Blocked Shots', pickStatValue(compact, 'blocked_shots', side));
    add('Total passes', pickStatValue(compact, 'total_passes', side));
    add('Passes accurate', pickStatValue(compact, 'passes_accurate', side));
    return values;
  };

  return [
    {
      team: { id: homeId, name: homeName, logo: homeLogo },
      statistics: makeStats('home'),
    },
    {
      team: { id: awayId, name: awayName, logo: awayLogo },
      statistics: makeStats('away'),
    },
  ];
}

function normalizeEventType(rawEvent: string): { type: string; detail: string } | null {
  const normalized = String(rawEvent || '').toUpperCase();
  if (normalized === 'GOAL') return { type: 'Goal', detail: 'Normal Goal' };
  if (normalized === 'YELLOW_CARD') return { type: 'Card', detail: 'Yellow Card' };
  if (normalized === 'RED_CARD' || normalized === 'SECOND_YELLOW_RED_CARD') {
    return { type: 'Card', detail: 'Red Card' };
  }
  if (normalized === 'SUBSTITUTION') return { type: 'subst', detail: 'Substitution' };
  return null;
}

function buildApiFixtureEvents(fixture: ApiFixture, events: LiveScoreEvent[]): ApiFixtureEvent[] {
  const homeTeamId = fixture.teams?.home?.id ?? 0;
  const awayTeamId = fixture.teams?.away?.id ?? 0;
  const homeTeamName = fixture.teams?.home?.name || 'Home';
  const awayTeamName = fixture.teams?.away?.name || 'Away';
  return events
    .map((event) => {
      const mapped = normalizeEventType(event.event);
      if (!mapped) return null;
      const minute = parseMinute(event.time);
      return {
        time: { elapsed: minute.elapsed, extra: minute.extra },
        team: {
          id: event.home_away === 'h' ? homeTeamId : awayTeamId,
          name: event.home_away === 'h' ? homeTeamName : awayTeamName,
          logo: '',
        },
        player: { id: null, name: event.player || null },
        assist: { id: null, name: event.info || null },
        type: mapped.type,
        detail: mapped.detail,
        comments: event.info || null,
      } as ApiFixtureEvent;
    })
    .filter((event): event is ApiFixtureEvent => Boolean(event));
}

function summarizeCoverage(
  compact: LiveScoreStatsCompact,
  rawStats: LiveScoreStatsPayload | null,
  rawEvents: LiveScoreEvent[],
  matchedMatch: LiveScoreMatch | null,
): Record<string, unknown> {
  const fields = Object.entries(compact);
  const populated = fields.filter(([, value]) => value.home != null || value.away != null).length;
  return {
    matched: Boolean(matchedMatch),
    provider_match_id: matchedMatch?.id ?? null,
    provider_fixture_id: matchedMatch?.fixture_id ?? null,
    live_odds_available: Boolean(
      matchedMatch?.odds?.live &&
      Object.values(matchedMatch.odds.live).some((value) => value != null),
    ),
    pre_odds_available: Boolean(
      matchedMatch?.odds?.pre &&
      Object.values(matchedMatch.odds.pre).some((value) => value != null),
    ),
    event_count: rawEvents.length,
    populated_stat_pairs: populated,
    total_stat_pairs: fields.length,
    has_possession: compact.possession.home != null || compact.possession.away != null,
    has_shots: compact.shots.home != null || compact.shots.away != null,
    has_shots_on_target: compact.shots_on_target.home != null || compact.shots_on_target.away != null,
    has_corners: compact.corners.home != null || compact.corners.away != null,
    raw_stat_keys: rawStats ? Object.keys(rawStats).length : 0,
  };
}

async function fetchJson<T>(path: string, params: Record<string, string>): Promise<{ data: T; statusCode: number }> {
  if (!config.liveScoreApiKey || !config.liveScoreApiSecret) {
    throw new Error('LIVE_SCORE_API_KEY/SECRET not configured');
  }

  const url = new URL(`${config.liveScoreApiBaseUrl}${path}`);
  url.searchParams.set('key', config.liveScoreApiKey);
  url.searchParams.set('secret', config.liveScoreApiSecret);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);

  let lastError: Error | null = null;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), API_TIMEOUT_MS);

      const res = await fetch(url.toString(), { signal: controller.signal });
      clearTimeout(timer);

      const json = await res.json() as LiveScoreResponse<T>;
      if (!res.ok) throw new Error(`Live Score API ${res.status}`);
      if (!json.success) throw new Error(json.error || `Live Score API error ${json.code ?? 'unknown'}`);
      if (json.data === undefined) throw new Error('Live Score API returned empty data');
      return { data: json.data, statusCode: res.status };
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (attempt < MAX_RETRIES) {
        await new Promise((resolve) => setTimeout(resolve, 500 * (attempt + 1)));
      }
    }
  }

  throw lastError ?? new Error('Live Score API request failed');
}

async function fetchLiveMatches(): Promise<LiveScoreMatch[]> {
  const cached = cacheGet(liveMatchesCache, 'live');
  if (cached) return cached;

  const { data } = await fetchJson<{ match?: LiveScoreMatch[] }>('/matches/live.json', {});
  const matches = Array.isArray(data.match) ? data.match : [];
  cacheSet(liveMatchesCache, 'live', matches, LIVE_MATCHES_CACHE_TTL_MS);
  return matches;
}

async function fetchMatchStats(matchId: string): Promise<LiveScoreStatsPayload> {
  const { data } = await fetchJson<LiveScoreStatsPayload>('/matches/stats.json', {
    match_id: matchId,
  });
  return data;
}

async function fetchMatchEvents(matchId: string): Promise<LiveScoreEvent[]> {
  const { data } = await fetchJson<LiveScoreEventResponse>('/scores/events.json', {
    id: matchId,
  });
  return Array.isArray(data.event) ? data.event : [];
}

export function clearLiveScoreCaches(): void {
  liveMatchesCache.clear();
}

export function findMatchingLiveScoreMatch(
  fixture: ApiFixture,
  matches: LiveScoreMatch[],
): LiveScoreMatch | null {
  const homeTeam = fixture.teams?.home?.name || '';
  const awayTeam = fixture.teams?.away?.name || '';
  const league = fixture.league?.name || '';
  const currentScore = { home: fixture.goals?.home ?? null, away: fixture.goals?.away ?? null };
  let bestMatch: LiveScoreMatch | null = null;
  let bestScore = 0;

  for (const match of matches) {
    if (!isActiveLiveTime(match.time)) continue;

    const homeScore = similarity(homeTeam, match.home?.name || '');
    const awayScore = similarity(awayTeam, match.away?.name || '');
    if (homeScore < 0.72 || awayScore < 0.72) continue;

    let combined = (homeScore + awayScore) / 2;
    if (normalizeText(homeTeam) === normalizeText(match.home?.name || '')) combined += 0.08;
    if (normalizeText(awayTeam) === normalizeText(match.away?.name || '')) combined += 0.08;

    const leagueScore = similarity(league, match.competition?.name || '');
    if (leagueScore >= 0.8) combined += 0.1;
    else if (leagueScore >= 0.6) combined += 0.05;

    const providerScore = parseScore(match.scores?.score);
    if (
      currentScore.home != null &&
      currentScore.away != null &&
      providerScore.home === currentScore.home &&
      providerScore.away === currentScore.away
    ) {
      combined += 0.04;
    }

    if (combined > bestScore) {
      bestScore = combined;
      bestMatch = match;
    }
  }

  return bestScore >= 0.86 ? bestMatch : null;
}

export async function fetchLiveScoreBenchmarkTrace(
  fixture: ApiFixture,
  deps?: FetchLiveScoreBenchmarkDeps,
): Promise<LiveScoreBenchmarkTrace> {
  const startedAt = Date.now();
  let statusCode: number | null = null;

  if (!config.liveScoreApiKey || !config.liveScoreApiSecret) {
    return {
      matched: false,
      providerMatchId: null,
      providerFixtureId: null,
      matchedMatch: null,
      rawLiveMatches: [],
      rawStats: null,
      rawEvents: [],
      normalizedStats: [],
      normalizedEvents: [],
      statsCompact: buildStatsCompact(null),
      coverageFlags: summarizeCoverage(buildStatsCompact(null), null, [], null),
      statusCode: null,
      latencyMs: Date.now() - startedAt,
      error: 'LIVE_SCORE_API_KEY/SECRET not configured',
    };
  }

  try {
    const liveMatches = await (deps?.fetchLiveMatches ?? fetchLiveMatches)();
    const matchedMatch = findMatchingLiveScoreMatch(fixture, liveMatches);
    if (!matchedMatch) {
      const emptyCompact = buildStatsCompact(null);
      return {
        matched: false,
        providerMatchId: null,
        providerFixtureId: null,
        matchedMatch: null,
        rawLiveMatches: liveMatches,
        rawStats: null,
        rawEvents: [],
        normalizedStats: [],
        normalizedEvents: [],
        statsCompact: emptyCompact,
        coverageFlags: {
          ...summarizeCoverage(emptyCompact, null, [], null),
          candidate_count: liveMatches.length,
        },
        statusCode: null,
        latencyMs: Date.now() - startedAt,
        error: 'NO_LIVE_SCORE_MATCH',
      };
    }

    const [stats, events] = await Promise.all([
      (deps?.fetchMatchStats ?? fetchMatchStats)(String(matchedMatch.id)).catch((err) => {
        throw err;
      }),
      (deps?.fetchMatchEvents ?? fetchMatchEvents)(String(matchedMatch.id)).catch((err) => {
        throw err;
      }),
    ]);

    const compact = buildStatsCompact(stats);
    const normalizedStats = buildApiFixtureStats(fixture, compact);
    const normalizedEvents = buildApiFixtureEvents(fixture, events);

    return {
      matched: true,
      providerMatchId: String(matchedMatch.id),
      providerFixtureId: String(matchedMatch.fixture_id || ''),
      matchedMatch,
      rawLiveMatches: liveMatches,
      rawStats: stats,
      rawEvents: events,
      normalizedStats,
      normalizedEvents,
      statsCompact: compact,
      coverageFlags: {
        ...summarizeCoverage(compact, stats, events, matchedMatch),
        candidate_count: liveMatches.length,
      },
      statusCode,
      latencyMs: Date.now() - startedAt,
      error: null,
    };
  } catch (err) {
    const emptyCompact = buildStatsCompact(null);
    const message = err instanceof Error ? err.message : String(err);
    const codeMatch = message.match(/\b(\d{3})\b/);
    statusCode = codeMatch ? Number(codeMatch[1]) : null;
    return {
      matched: false,
      providerMatchId: null,
      providerFixtureId: null,
      matchedMatch: null,
      rawLiveMatches: [],
      rawStats: null,
      rawEvents: [],
      normalizedStats: [],
      normalizedEvents: [],
      statsCompact: emptyCompact,
      coverageFlags: summarizeCoverage(emptyCompact, null, [], null),
      statusCode,
      latencyMs: Date.now() - startedAt,
      error: message,
    };
  }
}
