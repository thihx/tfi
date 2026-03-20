// ============================================================
// The Odds API Client - exact-event fallback odds provider
// https://the-odds-api.com/liveapi/guides/v4/
// ============================================================

import { config } from '../config.js';

const API_TIMEOUT_MS = 10_000;
const EVENTS_CACHE_TTL_MS = 5 * 60 * 1000;
const EVENT_ODDS_CACHE_TTL_MS = 60 * 1000;

const TEAM_SUFFIXES = /\b(fc|sc|cf|afc|ac|as|us|ss|cd|rcd|rc|ca|se|fk|bk|if|sk|gf|bfc)\b/gi;

const SOCCER_SPORT_KEYS = [
  'soccer_uefa_champs_league',
  'soccer_uefa_europa_league',
  'soccer_uefa_europa_conference_league',
  'soccer_epl',
  'soccer_spain_la_liga',
  'soccer_italy_serie_a',
  'soccer_germany_bundesliga',
  'soccer_france_ligue_one',
  'soccer_portugal_primeira_liga',
  'soccer_netherlands_eredivisie',
  'soccer_belgium_first_div',
  'soccer_turkey_super_league',
  'soccer_austria_bundesliga',
  'soccer_denmark_superliga',
  'soccer_greece_super_league',
  'soccer_norway_eliteserien',
  'soccer_poland_ekstraklasa',
  'soccer_sweden_allsvenskan',
  'soccer_switzerland_superleague',
  'soccer_spl',
  'soccer_efl_champ',
  'soccer_england_league1',
  'soccer_england_league2',
  'soccer_fa_cup',
  'soccer_england_efl_cup',
  'soccer_germany_bundesliga2',
  'soccer_germany_liga3',
  'soccer_germany_dfb_pokal',
  'soccer_france_ligue_two',
  'soccer_france_coupe_de_france',
  'soccer_spain_segunda_division',
  'soccer_spain_copa_del_rey',
  'soccer_italy_serie_b',
  'soccer_brazil_campeonato',
  'soccer_brazil_serie_b',
  'soccer_argentina_primera_division',
  'soccer_mexico_ligamx',
  'soccer_usa_mls',
  'soccer_korea_kleague1',
  'soccer_japan_j_league',
  'soccer_australia_aleague',
  'soccer_china_superleague',
  'soccer_league_of_ireland',
  'soccer_russia_premier_league',
  'soccer_fifa_world_cup',
  'soccer_fifa_world_cup_qualifiers_europe',
] as const;

type CachedValue<T> = {
  expiresAt: number;
  value: T;
};

const sportEventsCache = new Map<string, CachedValue<TheOddsEvent[]>>();
const eventOddsCache = new Map<string, CachedValue<TheOddsEvent>>();

// ==================== Types ====================

export interface TheOddsEvent {
  id: string;
  sport_key: string;
  sport_title: string;
  commence_time: string;
  home_team: string;
  away_team: string;
  bookmakers?: TheOddsBookmaker[];
}

interface TheOddsBookmaker {
  key: string;
  title: string;
  last_update: string;
  markets: TheOddsMarket[];
}

interface TheOddsMarket {
  key: string;
  last_update: string;
  outcomes: TheOddsOutcome[];
}

interface TheOddsOutcome {
  name: string;
  price: number;
  point?: number;
}

export interface TheOddsLookupOptions {
  leagueName?: string;
  leagueCountry?: string;
  status?: string;
}

export interface TheOddsLiveConverted {
  fixture: { id: number };
  bookmakers: Array<{
    id: number;
    name: string;
    bets: Array<{
      id: number;
      name: string;
      values: Array<{ value: string; odd: string; handicap?: string }>;
    }>;
  }>;
}

export interface FetchTheOddsLiveDeps {
  fetchEventsForSport?: (
    sportKey: string,
    kickoffTimestamp?: number,
    status?: string,
  ) => Promise<TheOddsEvent[]>;
  fetchEventOddsForMatch?: (sportKey: string, eventId: string) => Promise<TheOddsEvent | null>;
}

export interface TheOddsLiveTrace {
  result: TheOddsLiveConverted | null;
  matchedEvent: TheOddsEvent | null;
  rawEventOdds: TheOddsEvent | null;
  sportKey: string | null;
  scannedSportKeys: string[];
  error: string | null;
}

// ==================== Helpers ====================

function normalizeText(value: string): string {
  return value
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

function teamSimilarity(a: string, b: string): number {
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

function isLiveStatus(status?: string): boolean {
  const live = new Set(['1H', '2H', 'HT', 'ET', 'LIVE', 'INT', 'P', 'BT']);
  return live.has(String(status || '').toUpperCase());
}

function buildCommenceWindow(kickoffTimestamp?: number, status?: string): { from?: string; to?: string } {
  if (kickoffTimestamp && Number.isFinite(kickoffTimestamp)) {
    return {
      from: new Date((kickoffTimestamp - 4 * 3600) * 1000).toISOString(),
      to: new Date((kickoffTimestamp + 4 * 3600) * 1000).toISOString(),
    };
  }

  if (isLiveStatus(status)) {
    return {
      from: new Date(Date.now() - 8 * 3600 * 1000).toISOString(),
      to: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
    };
  }

  return {};
}

function buildSportKeyCandidates(options?: TheOddsLookupOptions): string[] {
  const hinted: string[] = [];
  const league = normalizeText(options?.leagueName || '');
  const country = normalizeText(options?.leagueCountry || '');

  const add = (key: string) => {
    if (!hinted.includes(key)) hinted.push(key);
  };

  if (league.includes('champions league')) add('soccer_uefa_champs_league');
  if (league.includes('europa conference')) add('soccer_uefa_europa_conference_league');
  if (league.includes('europa league')) add('soccer_uefa_europa_league');
  if (league.includes('premier league') && country.includes('england')) add('soccer_epl');
  if (league.includes('championship') && country.includes('england')) add('soccer_efl_champ');
  if (league.includes('league 1') && country.includes('england')) add('soccer_england_league1');
  if (league.includes('league 2') && country.includes('england')) add('soccer_england_league2');
  if (league.includes('fa cup')) add('soccer_fa_cup');
  if (league.includes('efl cup') || league.includes('league cup')) add('soccer_england_efl_cup');
  if (league.includes('la liga')) add('soccer_spain_la_liga');
  if (league.includes('segunda')) add('soccer_spain_segunda_division');
  if (league.includes('copa del rey')) add('soccer_spain_copa_del_rey');
  if (league === 'serie a' || (league.includes('serie a') && country.includes('italy'))) add('soccer_italy_serie_a');
  if (league.includes('serie b') && country.includes('italy')) add('soccer_italy_serie_b');
  if (league.includes('bundesliga 2')) add('soccer_germany_bundesliga2');
  if (league.includes('bundesliga')) add('soccer_germany_bundesliga');
  if (league.includes('dfb pokal')) add('soccer_germany_dfb_pokal');
  if (league.includes('ligue 1')) add('soccer_france_ligue_one');
  if (league.includes('ligue 2')) add('soccer_france_ligue_two');
  if (league.includes('coupe de france')) add('soccer_france_coupe_de_france');
  if (league.includes('eredivisie')) add('soccer_netherlands_eredivisie');
  if (league.includes('primeira') || league.includes('liga portugal')) add('soccer_portugal_primeira_liga');
  if (league.includes('super lig') || league.includes('super league') && country.includes('turkey')) add('soccer_turkey_super_league');
  if (league.includes('premiership') && country.includes('scotland')) add('soccer_spl');
  if (league.includes('mls')) add('soccer_usa_mls');
  if (league.includes('liga mx')) add('soccer_mexico_ligamx');
  if (league.includes('kleague') || league.includes('k league')) add('soccer_korea_kleague1');
  if (league.includes('j league')) add('soccer_japan_j_league');
  if (league.includes('a league')) add('soccer_australia_aleague');
  if (league.includes('china super')) add('soccer_china_superleague');
  if (league.includes('argentina')) add('soccer_argentina_primera_division');
  if (league.includes('brazil') || league.includes('brasileirao')) add('soccer_brazil_campeonato');

  return [...hinted, ...SOCCER_SPORT_KEYS.filter((key) => !hinted.includes(key))];
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

export function clearTheOddsCaches(): void {
  sportEventsCache.clear();
  eventOddsCache.clear();
}

// ==================== Matching ====================

/**
 * Match an API-Sports fixture to a The Odds API event using team names + kickoff time.
 * Matching is intentionally conservative because a wrong event is worse than no fallback.
 */
export function findMatchingEvent(
  events: TheOddsEvent[],
  homeTeam: string,
  awayTeam: string,
  kickoffTimestamp?: number,
  options?: TheOddsLookupOptions,
): TheOddsEvent | null {
  let bestMatch: TheOddsEvent | null = null;
  let bestScore = 0;
  const nowMs = Date.now();

  for (const ev of events) {
    const evTimeMs = Date.parse(ev.commence_time);
    if (Number.isFinite(evTimeMs)) {
      if (kickoffTimestamp) {
        const timeDiffHours = Math.abs(evTimeMs / 1000 - kickoffTimestamp) / 3600;
        if (timeDiffHours > 4) continue;
      } else if (isLiveStatus(options?.status) && evTimeMs > nowMs + 30 * 60 * 1000) {
        continue;
      }
    }

    const homeScore = teamSimilarity(homeTeam, ev.home_team);
    const awayScore = teamSimilarity(awayTeam, ev.away_team);
    if (homeScore < 0.72 || awayScore < 0.72) continue;

    let combinedScore = (homeScore + awayScore) / 2;

    if (normalizeText(homeTeam) === normalizeText(ev.home_team)) combinedScore += 0.08;
    if (normalizeText(awayTeam) === normalizeText(ev.away_team)) combinedScore += 0.08;

    if (kickoffTimestamp && Number.isFinite(evTimeMs)) {
      const timeDiffMinutes = Math.abs(evTimeMs / 1000 - kickoffTimestamp) / 60;
      if (timeDiffMinutes <= 15) combinedScore += 0.08;
      else if (timeDiffMinutes <= 60) combinedScore += 0.04;
    }

    if (combinedScore > bestScore) {
      bestScore = combinedScore;
      bestMatch = ev;
    }
  }

  return bestScore >= 0.84 ? bestMatch : null;
}

// ==================== Convert to API-Sports Format ====================

/**
 * Convert The Odds event odds to a subset of API-Sports bookmaker format.
 * We intentionally keep only markets whose semantics safely fit the current canonical model.
 */
export function convertToApiSportsFormat(
  event: TheOddsEvent,
  fixtureId: number,
): TheOddsLiveConverted {
  const bookmakers = (event.bookmakers || []).map((bk, idx) => {
    const bets: Array<{
      id: number;
      name: string;
      values: Array<{ value: string; odd: string; handicap?: string }>;
    }> = [];

    for (const market of bk.markets || []) {
      if (market.key === 'h2h') {
        const values = market.outcomes.map((o) => {
          let value = o.name;
          if (o.name === event.home_team) value = 'Home';
          else if (o.name === event.away_team) value = 'Away';
          else if (/^draw$/i.test(o.name)) value = 'Draw';
          return { value, odd: String(o.price) };
        });
        bets.push({ id: 1, name: 'Match Winner', values });
      }

      if (market.key === 'totals') {
        const values = market.outcomes.map((o) => ({
          value: o.name,
          odd: String(o.price),
          handicap: o.point != null ? String(o.point) : undefined,
        }));
        bets.push({ id: 2, name: 'Over/Under', values });
      }
    }

    return { id: idx + 100, name: bk.title, bets };
  }).filter((bk) => bk.bets.length > 0);

  return { fixture: { id: fixtureId }, bookmakers };
}

// ==================== API Calls ====================

async function fetchJson<T>(url: URL): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), API_TIMEOUT_MS);

  try {
    const res = await fetch(url.toString(), { signal: controller.signal });
    clearTimeout(timer);

    if (!res.ok) {
      if (res.status === 401) throw new Error('THE_ODDS_API_KEY invalid');
      if (res.status === 429) throw new Error('The Odds API rate limited');
      throw new Error(`The Odds API ${res.status}`);
    }

    return await res.json() as T;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchEventsForSport(
  sportKey: string,
  kickoffTimestamp?: number,
  status?: string,
): Promise<TheOddsEvent[]> {
  const url = new URL(`${config.theOddsApiBaseUrl}/sports/${sportKey}/events`);
  url.searchParams.set('apiKey', config.theOddsApiKey);
  url.searchParams.set('dateFormat', 'iso');

  const { from, to } = buildCommenceWindow(kickoffTimestamp, status);
  if (from) url.searchParams.set('commenceTimeFrom', from);
  if (to) url.searchParams.set('commenceTimeTo', to);

  return fetchJson<TheOddsEvent[]>(url);
}

async function fetchEventOddsForMatch(sportKey: string, eventId: string): Promise<TheOddsEvent | null> {
  const cacheKey = `${sportKey}:${eventId}`;
  const cached = cacheGet(eventOddsCache, cacheKey);
  if (cached) return cached;

  const url = new URL(`${config.theOddsApiBaseUrl}/sports/${sportKey}/events/${eventId}/odds`);
  url.searchParams.set('apiKey', config.theOddsApiKey);
  url.searchParams.set('regions', 'eu,uk');
  url.searchParams.set('markets', 'h2h,totals');
  url.searchParams.set('oddsFormat', 'decimal');
  url.searchParams.set('dateFormat', 'iso');

  const event = await fetchJson<TheOddsEvent>(url).catch(() => null);
  if (event) cacheSet(eventOddsCache, cacheKey, event, EVENT_ODDS_CACHE_TTL_MS);
  return event;
}

/**
 * Fetch exact-event live odds from The Odds API.
 * Uses free /events lookup first, then requests odds for only the matched event.
 */
export async function fetchTheOddsLive(
  homeTeam: string,
  awayTeam: string,
  fixtureId: number,
  kickoffTimestamp?: number,
  options?: TheOddsLookupOptions,
): Promise<TheOddsLiveConverted | null> {
  const trace = await fetchTheOddsLiveDetailed(homeTeam, awayTeam, fixtureId, kickoffTimestamp, options);
  return trace.result;
}

export async function fetchTheOddsLiveDetailed(
  homeTeam: string,
  awayTeam: string,
  fixtureId: number,
  kickoffTimestamp?: number,
  options?: TheOddsLookupOptions,
  deps?: FetchTheOddsLiveDeps,
): Promise<TheOddsLiveTrace> {
  if (!config.theOddsApiKey) {
    return {
      result: null,
      matchedEvent: null,
      rawEventOdds: null,
      sportKey: null,
      scannedSportKeys: [],
      error: 'THE_ODDS_API_KEY not configured',
    };
  }

  const candidateSportKeys = buildSportKeyCandidates(options);
  const fetchEvents = deps?.fetchEventsForSport ?? fetchEventsForSport;
  const fetchEventOdds = deps?.fetchEventOddsForMatch ?? fetchEventOddsForMatch;
  let lastError: string | null = null;

  for (const sportKey of candidateSportKeys) {
    let events = cacheGet(sportEventsCache, sportKey);

    if (!events) {
      try {
        events = await fetchEvents(sportKey, kickoffTimestamp, options?.status);
        cacheSet(sportEventsCache, sportKey, events, EVENTS_CACHE_TTL_MS);
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err);
        continue;
      }
    }

    const matched = findMatchingEvent(events, homeTeam, awayTeam, kickoffTimestamp, options);
    if (!matched) continue;

    const eventWithOdds = await fetchEventOdds(matched.sport_key, matched.id).catch((err) => {
      lastError = err instanceof Error ? err.message : String(err);
      return null;
    });
    if (!eventWithOdds || !Array.isArray(eventWithOdds.bookmakers) || eventWithOdds.bookmakers.length === 0) {
      return {
        result: null,
        matchedEvent: matched,
        rawEventOdds: eventWithOdds,
        sportKey: matched.sport_key,
        scannedSportKeys: candidateSportKeys,
        error: lastError ?? 'NO_USABLE_EVENT_ODDS',
      };
    }

    console.log(`[the-odds-api] Matched "${homeTeam} vs ${awayTeam}" -> "${matched.home_team} vs ${matched.away_team}" (${matched.sport_key})`);
    return {
      result: convertToApiSportsFormat(eventWithOdds, fixtureId),
      matchedEvent: matched,
      rawEventOdds: eventWithOdds,
      sportKey: matched.sport_key,
      scannedSportKeys: candidateSportKeys,
      error: null,
    };
  }

  console.log(`[the-odds-api] No exact-event odds match for "${homeTeam} vs ${awayTeam}" across ${candidateSportKeys.length} sports`);
  return {
    result: null,
    matchedEvent: null,
    rawEventOdds: null,
    sportKey: null,
    scannedSportKeys: candidateSportKeys,
    error: lastError ?? 'NO_EXACT_EVENT_MATCH',
  };
}
