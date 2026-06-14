import {
  fetchLiveOdds,
  fetchPreMatchOdds,
} from './football-api.js';
import {
  fetchTheOddsApiOdds,
  type FetchTheOddsApiOddsInput,
} from './the-odds-api.js';
import type { TheOddsApiEventLike } from './canonical/the-odds-api-adapter.js';
import {
  extractStatusCode,
  recordProviderOddsSampleSafe,
} from './provider-sampling.js';
import {
  getProviderOddsCache,
  upsertProviderOddsCache,
  type ProviderOddsCacheRow,
  type UpsertProviderOddsCacheInput,
} from '../repos/provider-odds-cache.repo.js';

export type ResolvedOddsSource = 'live' | 'fallback-live' | 'reference-prematch' | 'none';
/** Includes legacy `the-odds-live` for reading cached rows; new resolutions never write it. */
type ProviderOddsSource = 'api-football-live' | 'the-odds-live' | 'api-football-prematch' | 'none';
export type ResolveMatchOddsFreshness = 'fresh' | 'stale_ok' | 'stale_degraded' | 'missing';
export type ResolveMatchOddsCacheStatus = 'hit' | 'refreshed' | 'stale_fallback' | 'miss';
export type OddsFreshnessMode = 'real_required' | 'stale_safe' | 'prewarm_only';

export interface ResolveMatchOddsInput {
  matchId: string;
  homeTeam?: string;
  awayTeam?: string;
  kickoffTimestamp?: number;
  leagueId?: number | string | null;
  leagueName?: string;
  leagueCountry?: string;
  status?: string;
  matchMinute?: number | null;
  consumer?: string;
  sampleProviderData?: boolean;
  freshnessMode?: OddsFreshnessMode;
}

export interface ResolveMatchOddsResult {
  oddsSource: ResolvedOddsSource;
  response: unknown[];
  oddsFetchedAt: string | null;
  freshness: ResolveMatchOddsFreshness;
  cacheStatus: ResolveMatchOddsCacheStatus;
  referenceResponse?: unknown[];
  referenceOddsSource?: 'reference-prematch' | 'none';
  referenceOddsFetchedAt?: string | null;
}

export interface ResolveMatchOddsDeps {
  fetchLiveOdds?: (fixtureId: string) => Promise<unknown[]>;
  fetchPreMatchOdds?: (fixtureId: string) => Promise<unknown[]>;
  fetchTheOddsApiOdds?: (input: FetchTheOddsApiOddsInput) => ReturnType<typeof fetchTheOddsApiOdds>;
  getCachedOdds?: (matchId: string) => Promise<ProviderOddsCacheRow | null>;
  upsertCachedOdds?: (input: UpsertProviderOddsCacheInput) => Promise<unknown>;
  summarizeCoverageFlags?: (response: unknown[]) => Record<string, unknown>;
  now?: () => Date;
}

type NormalizedBookmaker = {
  id: number;
  name: string;
  bets: Array<{
    id: number;
    name: string;
    values: Array<{ value: string; odd: string; handicap?: string }>;
  }>;
};

type NormalizedOddsEntry = {
  fixture?: unknown;
  bookmakers: NormalizedBookmaker[];
};

const defaultResolveDeps: ResolveMatchOddsDeps = {
  fetchLiveOdds,
  fetchPreMatchOdds,
  fetchTheOddsApiOdds,
  getCachedOdds: getProviderOddsCache,
  upsertCachedOdds: upsertProviderOddsCache,
  summarizeCoverageFlags: summarizeNormalizedOdds,
  now: () => new Date(),
};

const LIVE_STATUSES = new Set(['1H', '2H', 'HT', 'ET', 'BT', 'P', 'LIVE', 'INT']);
const FINISHED_STATUSES = new Set(['FT', 'AET', 'PEN']);

function bypassStartedCache(mode: OddsFreshnessMode, status?: string | null): boolean {
  const normalized = String(status ?? '').toUpperCase();
  return mode === 'real_required' && LIVE_STATUSES.has(normalized);
}

export function normalizeApiSportsOddsResponse(response: unknown[]): unknown[] {
  if (!Array.isArray(response) || response.length === 0) return [];

  return response.flatMap((entry) => {
    if (!entry || typeof entry !== 'object') return [];
    const raw = entry as Record<string, unknown>;
    if (Array.isArray(raw.bookmakers) && raw.bookmakers.length > 0) {
      return [entry];
    }

    if (!Array.isArray(raw.odds) || raw.odds.length === 0) {
      return [entry];
    }

    const bets = raw.odds.map((bet, idx) => {
      const b = (bet ?? {}) as Record<string, unknown>;
      const values = Array.isArray(b.values) ? b.values as Array<{ value: string; odd: string; handicap?: string }> : [];
      return {
        id: Number(b.id ?? idx),
        name: String(b.name ?? ''),
        values,
      };
    });

    const normalized: NormalizedOddsEntry = {
      fixture: raw.fixture,
      bookmakers: [{
        id: 0,
        name: 'Live Odds',
        bets,
      }],
    };
    return [normalized];
  });
}

function hasUsableBookmakers(response: unknown[]): boolean {
  if (!Array.isArray(response) || response.length === 0) return false;
  const first = response[0] as { bookmakers?: Array<{ bets?: unknown[] }> } | undefined;
  return !!(first?.bookmakers && first.bookmakers.some((bk) => Array.isArray(bk.bets) && bk.bets.length > 0));
}

function hasUsableOddValue(values: unknown): boolean {
  if (!Array.isArray(values)) return false;
  return values.some((value) => {
    const row = value as { odd?: unknown; suspended?: unknown } | null;
    if (row?.suspended === true || String(row?.suspended).toLowerCase() === 'true') return false;
    const odd = Number(row?.odd);
    return Number.isFinite(odd) && odd > 1;
  });
}

function isOneX2BetName(name: string): boolean {
  if (name.includes('corner')) return false;
  return name === '1x2'
    || name === '1 x 2'
    || name.includes('match winner')
    || name.includes('fulltime result')
    || name.includes('full time result');
}

function isGoalsOuBetName(name: string): boolean {
  return !name.includes('corner')
    && (
      name.includes('over/under')
      || name.includes('over / under')
      || name.includes('total goals')
      || name.includes('match goals')
      || (name.includes('goals') && (name.includes('over') || name.includes('under')))
    );
}

function isFootballAsianHandicapBetName(name: string): boolean {
  return name.includes('asian handicap')
    && !name.includes('corner')
    && !name.includes('card')
    && !name.includes('yellow')
    && !name.includes('offside')
    && !name.includes('foul')
    && !name.includes('shot');
}

function isAhBetName(name: string): boolean {
  return isFootballAsianHandicapBetName(name);
}

function isBttsBetName(name: string): boolean {
  return name.includes('both teams') || name === 'btts' || name.includes('both teams to score');
}

function oddOf(value: unknown): number | null {
  const row = value as { odd?: unknown; suspended?: unknown } | null;
  if (row?.suspended === true || String(row?.suspended).toLowerCase() === 'true') return null;
  const odd = Number(row?.odd);
  return Number.isFinite(odd) && odd > 1 ? odd : null;
}

function impliedInRange(odds: Array<number | null>, min: number, max: number): boolean {
  if (odds.some((odd) => odd == null)) return false;
  const margin = odds.reduce<number>((sum, odd) => sum + (odd ? 1 / odd : 0), 0);
  return margin >= min && margin <= max;
}

function handicapKey(value: unknown): string {
  const row = value as { handicap?: unknown; value?: unknown } | null;
  const handicap = String(row?.handicap ?? '').trim();
  if (handicap) return String(Math.abs(Number(handicap))).replace(/\.0$/, '');
  const label = String(row?.value ?? '').trim().toLowerCase();
  const match = label.match(/([-+]?[0-9]+(?:\.[0-9]+)?)/);
  return match ? String(Math.abs(Number(match[1]))).replace(/\.0$/, '') : 'main';
}

function ouLineKey(value: unknown): string {
  const row = value as { handicap?: unknown; value?: unknown } | null;
  const handicap = String(row?.handicap ?? '').trim();
  if (handicap) return String(Number(handicap)).replace(/\.0$/, '');
  const label = String(row?.value ?? '').trim().toLowerCase();
  const match = label.match(/([0-9]+(?:\.[0-9]+)?)/);
  return match ? String(Number(match[1])).replace(/\.0$/, '') : 'main';
}

function summarizeCanonicalCompatibleMarketFlags(response: unknown[]): Record<string, boolean> {
  let has1x2 = false;
  let hasOu = false;
  let hasAh = false;
  let hasBtts = false;

  for (const entry of response) {
    if (!entry || typeof entry !== 'object') continue;
    const bookmakers = Array.isArray((entry as { bookmakers?: unknown[] }).bookmakers)
      ? (entry as { bookmakers: Array<{ bets?: Array<{ name?: string; values?: unknown[] }> }> }).bookmakers
      : [];

    for (const bookmaker of bookmakers) {
      const bets = Array.isArray(bookmaker.bets) ? bookmaker.bets : [];
      for (const bet of bets) {
        const name = String(bet.name || '').toLowerCase().trim();
        const values = Array.isArray(bet.values) ? bet.values : [];

        if (!has1x2 && isOneX2BetName(name)) {
          const best = { home: 0, draw: 0, away: 0 };
          for (const value of values) {
            const label = String((value as { value?: unknown }).value ?? '').toLowerCase().trim();
            const odd = oddOf(value) ?? 0;
            if (label === 'home' || label === '1') best.home = Math.max(best.home, odd);
            if (label === 'draw' || label === 'x') best.draw = Math.max(best.draw, odd);
            if (label === 'away' || label === '2') best.away = Math.max(best.away, odd);
          }
          has1x2 = impliedInRange([best.home || null, best.draw || null, best.away || null], 0.90, 1.20);
        }

        if (!hasOu && isGoalsOuBetName(name)) {
          const byLine = new Map<string, { over: number | null; under: number | null }>();
          for (const value of values) {
            const label = String((value as { value?: unknown }).value ?? '').toLowerCase().trim();
            const odd = oddOf(value);
            if (!odd) continue;
            const key = ouLineKey(value);
            const pair = byLine.get(key) ?? { over: null, under: null };
            if (label.includes('over')) pair.over = Math.max(pair.over ?? 0, odd);
            if (label.includes('under')) pair.under = Math.max(pair.under ?? 0, odd);
            byLine.set(key, pair);
          }
          hasOu = Array.from(byLine.values()).some((pair) => impliedInRange([pair.over, pair.under], 0.85, 1.15));
        }

        if (!hasAh && isAhBetName(name)) {
          const byLine = new Map<string, { home: number | null; away: number | null }>();
          for (const value of values) {
            const label = String((value as { value?: unknown }).value ?? '').toLowerCase().trim();
            const odd = oddOf(value);
            if (!odd) continue;
            const key = handicapKey(value);
            const pair = byLine.get(key) ?? { home: null, away: null };
            if (label === 'home' || label === '1' || label.startsWith('home ')) pair.home = Math.max(pair.home ?? 0, odd);
            if (label === 'away' || label === '2' || label.startsWith('away ')) pair.away = Math.max(pair.away ?? 0, odd);
            byLine.set(key, pair);
          }
          hasAh = Array.from(byLine.values()).some((pair) => impliedInRange([pair.home, pair.away], 0.85, 1.15));
        }

        if (!hasBtts && isBttsBetName(name)) {
          let yes = 0;
          let no = 0;
          for (const value of values) {
            const label = String((value as { value?: unknown }).value ?? '').toLowerCase().trim();
            const odd = oddOf(value) ?? 0;
            if (label === 'yes') yes = Math.max(yes, odd);
            if (label === 'no') no = Math.max(no, odd);
          }
          hasBtts = impliedInRange([yes || null, no || null], 0.85, 1.15);
        }
      }
    }
  }

  return {
    canonical_has_1x2: has1x2,
    canonical_has_ou: hasOu,
    canonical_has_ah: hasAh,
    canonical_has_btts: hasBtts,
  };
}

export function summarizeNormalizedOdds(response: unknown[]): Record<string, unknown> {
  const summary = {
    bookmaker_count: 0,
    bet_count: 0,
    priced_bet_count: 0,
    one_x2_bet_count: 0,
    ou_bet_count: 0,
    ah_bet_count: 0,
    btts_bet_count: 0,
    has_1x2: false,
    has_ou: false,
    has_ah: false,
    has_btts: false,
    canonical_has_1x2: false,
    canonical_has_ou: false,
    canonical_has_ah: false,
    canonical_has_btts: false,
  };

  for (const entry of response) {
    if (!entry || typeof entry !== 'object') continue;
    const bookmakers = Array.isArray((entry as { bookmakers?: unknown[] }).bookmakers)
      ? (entry as { bookmakers: Array<{ bets?: Array<{ name?: string }> }> }).bookmakers
      : [];

    summary.bookmaker_count += bookmakers.length;
    for (const bookmaker of bookmakers) {
      const bets = Array.isArray(bookmaker.bets) ? bookmaker.bets : [];
      summary.bet_count += bets.length;
      for (const bet of bets) {
        const name = String(bet.name || '').toLowerCase().trim();
        const priced = hasUsableOddValue((bet as { values?: unknown }).values);
        if (priced) summary.priced_bet_count += 1;
        if (isOneX2BetName(name)) {
          summary.one_x2_bet_count += 1;
          if (priced) summary.has_1x2 = true;
        }
        if (isGoalsOuBetName(name)) {
          summary.ou_bet_count += 1;
          if (priced) summary.has_ou = true;
        }
        if (isAhBetName(name)) {
          summary.ah_bet_count += 1;
          if (priced) summary.has_ah = true;
        }
        if (isBttsBetName(name)) {
          summary.btts_bet_count += 1;
          if (priced) summary.has_btts = true;
        }
      }
    }
  }

  return {
    ...summary,
    ...summarizeCanonicalCompatibleMarketFlags(response),
  };
}

function mapProviderSourceToResolved(providerSource: ProviderOddsSource): ResolvedOddsSource {
  switch (providerSource) {
    case 'api-football-live':
      return 'live';
    case 'the-odds-live':
      return 'fallback-live';
    case 'api-football-prematch':
      return 'reference-prematch';
    default:
      return 'none';
  }
}

function classifyFreshness(ageMs: number | null, ttlMs: number): ResolveMatchOddsFreshness {
  if (ageMs == null) return 'missing';
  if (ageMs <= ttlMs) return 'fresh';
  if (ageMs <= ttlMs * 3) return 'stale_ok';
  return 'stale_degraded';
}

function getOddsCacheTtlMs(input: ResolveMatchOddsInput): number {
  const minute = input.matchMinute ?? 0;
  const status = String(input.status ?? '').toUpperCase();

  if (FINISHED_STATUSES.has(status)) return 12 * 60 * 60 * 1000;
  if (status === 'HT') return 30 * 1000;
  if (LIVE_STATUSES.has(status)) {
    if (minute >= 75) return 15 * 1000;
    return 30 * 1000;
  }
  if (status === 'NS' || !status) return 2 * 60 * 1000;
  return 60 * 1000;
}

function getCacheAgeMs(row: ProviderOddsCacheRow | null, now: Date): number | null {
  if (!row?.cached_at) return null;
  const parsed = Date.parse(row.cached_at);
  if (Number.isNaN(parsed)) return null;
  return now.getTime() - parsed;
}

function isLegacyTheOddsLiveCache(row: ProviderOddsCacheRow): boolean {
  if (String(row.provider_source || '').toLowerCase() !== 'the-odds-live') return false;
  const trace = row.provider_trace && typeof row.provider_trace === 'object' && !Array.isArray(row.provider_trace)
    ? row.provider_trace as Record<string, unknown>
    : {};
  return trace['the_odds_api_resolver_version'] !== 'v1';
}

function responseArrayOf(row: ProviderOddsCacheRow): unknown[] {
  return Array.isArray(row.response) ? row.response : [];
}

function buildCacheResult(
  row: ProviderOddsCacheRow,
  freshness: ResolveMatchOddsFreshness,
  cacheStatus: ResolveMatchOddsCacheStatus,
): ResolveMatchOddsResult {
  return {
    oddsSource: (row.odds_source as ResolvedOddsSource) || mapProviderSourceToResolved((row.provider_source as ProviderOddsSource) || 'none'),
    response: responseArrayOf(row),
    oddsFetchedAt: row.odds_fetched_at,
    freshness,
    cacheStatus,
  };
}

function recordCachedOddsSample(
  input: ResolveMatchOddsInput,
  row: ProviderOddsCacheRow,
  deps: ResolveMatchOddsDeps,
): void {
  if (!isSamplingEnabled(input)) return;
  const normalizedPayload = responseArrayOf(row);
  const coverageFlags = row.coverage_flags && Object.keys(row.coverage_flags).length > 0
    ? row.coverage_flags
    : (deps.summarizeCoverageFlags ?? summarizeNormalizedOdds)(normalizedPayload);
  void recordProviderOddsSampleSafe({
    ...sampleBase(input),
    provider: 'cache',
    source: row.odds_source || mapProviderSourceToResolved((row.provider_source as ProviderOddsSource) || 'none'),
    success: true,
    usable: hasUsableBookmakers(normalizedPayload),
    latency_ms: 0,
    error: '',
    raw_payload: {},
    normalized_payload: normalizedPayload,
    coverage_flags: coverageFlags,
  });
}

async function loadFreshCachedOdds(
  input: ResolveMatchOddsInput,
  deps: ResolveMatchOddsDeps,
): Promise<ResolveMatchOddsResult | { staleRow: ProviderOddsCacheRow | null }> {
  if (!deps.getCachedOdds) return { staleRow: null };

  try {
    const cached = await deps.getCachedOdds(input.matchId);
    const now = deps.now!();
    const freshness = classifyFreshness(getCacheAgeMs(cached, now), getOddsCacheTtlMs(input));
    const mode = input.freshnessMode ?? 'stale_safe';
    if (!cached) return { staleRow: null };
    if (isLegacyTheOddsLiveCache(cached)) return { staleRow: null };
    if (freshness === 'fresh' && !bypassStartedCache(mode, input.status ?? cached.match_status)) {
      recordCachedOddsSample(input, cached, deps);
      return buildCacheResult(cached, 'fresh', 'hit');
    }
    return { staleRow: cached };
  } catch {
    return { staleRow: null };
  }
}

async function persistOddsCache(
  input: ResolveMatchOddsInput,
  deps: ResolveMatchOddsDeps,
  result: ResolveMatchOddsResult,
  providerSource: ProviderOddsSource,
  lastRefreshError = '',
  degraded = false,
): Promise<void> {
  if (!deps.upsertCachedOdds) return;

  const summary = (deps.summarizeCoverageFlags ?? summarizeNormalizedOdds)(result.response);
  try {
    await deps.upsertCachedOdds({
      match_id: input.matchId,
      odds_source: result.oddsSource,
      provider_source: providerSource,
      response: result.response,
      coverage_flags: summary,
      provider_trace: {
        provider_source: providerSource,
        consumer: consumerOf(input),
        ...(providerSource === 'the-odds-live' ? { the_odds_api_resolver_version: 'v1' } : {}),
      },
      odds_fetched_at: result.oddsFetchedAt,
      match_status: input.status ?? '',
      match_minute: input.matchMinute ?? null,
      freshness: result.freshness,
      degraded,
      last_refresh_error: lastRefreshError,
      has_1x2: summary['has_1x2'] === true,
      has_ou: summary['has_ou'] === true,
      has_ah: summary['has_ah'] === true,
      has_btts: summary['has_btts'] === true,
    });
  } catch {
    // Cache write failures must not break runtime odds resolution.
  }
}

interface ProviderResolution {
  result: ResolveMatchOddsResult;
  providerSource: ProviderOddsSource;
  lastError: string;
}

function isSamplingEnabled(input: ResolveMatchOddsInput): boolean {
  return input.sampleProviderData !== false;
}

function consumerOf(input: ResolveMatchOddsInput): string {
  return input.consumer || 'unknown';
}

function sampleBase(input: ResolveMatchOddsInput) {
  return {
    match_id: input.matchId,
    match_minute: input.matchMinute ?? null,
    match_status: input.status ?? '',
    consumer: consumerOf(input),
  };
}

function normalizeText(value: unknown): string {
  return String(value ?? '')
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function cleanText(value: unknown): string {
  return String(value ?? '').trim();
}

function numberValue(value: unknown): number | null {
  if (value == null || value === '') return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function arrayOf(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function recordOf(value: unknown): Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function envFlag(name: string): boolean {
  return String(process.env[name] ?? '').toLowerCase() === 'true';
}

function firstEnv(...names: string[]): string {
  for (const name of names) {
    const value = cleanText(process.env[name]);
    if (value) return value;
  }
  return '';
}

function isTheOddsApiResolverEnabled(): boolean {
  return envFlag('THEODDSAPI_ENABLED')
    && Boolean(firstEnv('THEODDSAPI_API_TOKEN', 'THE_ODDS_API_TOKEN', 'THE_ODDS_API_KEY'));
}

function unique(values: string[]): string[] {
  return values.filter((value, index, all) => value && all.indexOf(value) === index);
}

const THE_ODDS_API_SPORT_KEY_BY_API_FOOTBALL_LEAGUE_ID: Record<string, string> = {
  // API-Football league ids observed in production watchlist. Keep this as a
  // deterministic fallback when the local matches table does not store country.
  '39': 'soccer_epl',
  '61': 'soccer_france_ligue_one',
  '78': 'soccer_germany_bundesliga',
  '88': 'soccer_netherlands_eredivisie',
  '135': 'soccer_italy_serie_a',
  '140': 'soccer_spain_la_liga',
  '141': 'soccer_spain_segunda_division',
  '265': 'soccer_chile_campeonato',
};

function inferTheOddsApiSportKeys(input: ResolveMatchOddsInput): string[] {
  const league = normalizeText(input.leagueName);
  const country = normalizeText(input.leagueCountry);
  const combined = `${country} ${league}`;
  const configured = firstEnv('THEODDSAPI_SOCCER_SPORT_KEY', 'THE_ODDS_API_SOCCER_SPORT_KEY');
  const keys: string[] = [];
  const leagueIdKey = cleanText(input.leagueId);
  const leagueIdSportKey = THE_ODDS_API_SPORT_KEY_BY_API_FOOTBALL_LEAGUE_ID[leagueIdKey];

  if (leagueIdSportKey) keys.push(leagueIdSportKey);

  if (combined.includes('world cup')) keys.push(configured || 'soccer_fifa_world_cup');
  if (combined.includes('chile') && (combined.includes('primera') || combined.includes('campeonato'))) {
    keys.push('soccer_chile_campeonato');
  }
  if (
    (combined.includes('spain') || combined.includes('spanish'))
    && (combined.includes('segunda') || combined.includes('la liga 2') || combined.includes('laliga 2'))
  ) {
    keys.push('soccer_spain_segunda_division');
  }
  if ((combined.includes('spain') || combined.includes('spanish')) && combined.includes('la liga') && !combined.includes('segunda')) {
    keys.push('soccer_spain_la_liga');
  }
  if (combined.includes('england') && combined.includes('premier')) keys.push('soccer_epl');
  if (combined.includes('germany') && combined.includes('bundesliga')) keys.push('soccer_germany_bundesliga');
  if (combined.includes('italy') && combined.includes('serie a')) keys.push('soccer_italy_serie_a');
  if (combined.includes('france') && combined.includes('ligue 1')) keys.push('soccer_france_ligue_one');
  if (combined.includes('netherlands') && combined.includes('eredivisie')) keys.push('soccer_netherlands_eredivisie');
  if (combined.includes('portugal') && (combined.includes('primeira') || combined.includes('liga portugal'))) {
    keys.push('soccer_portugal_primeira_liga');
  }

  if (keys.length === 0 && configured) keys.push(configured);
  return unique(keys);
}

function teamMatchScore(candidate: unknown, expected: unknown): number {
  const left = normalizeText(candidate);
  const right = normalizeText(expected);
  if (!left || !right) return 0;
  if (left === right) return 40;
  if (left.includes(right) || right.includes(left)) return 25;
  return 0;
}

function kickoffScore(event: TheOddsApiEventLike, input: ResolveMatchOddsInput): number {
  if (!input.kickoffTimestamp) return 0;
  const eventMs = Date.parse(cleanText(event.commence_time));
  if (!Number.isFinite(eventMs)) return 0;
  const diffMinutes = Math.abs((eventMs / 1000 - input.kickoffTimestamp) / 60);
  if (diffMinutes <= 20) return 20;
  if (diffMinutes <= 6 * 60) return 8;
  return -30;
}

function scoreTheOddsApiEvent(event: TheOddsApiEventLike, input: ResolveMatchOddsInput): number {
  return teamMatchScore(event.home_team, input.homeTeam)
    + teamMatchScore(event.away_team, input.awayTeam)
    + kickoffScore(event, input);
}

function selectTheOddsApiEvent(events: TheOddsApiEventLike[], input: ResolveMatchOddsInput): TheOddsApiEventLike | null {
  let best: { event: TheOddsApiEventLike; score: number } | null = null;
  for (const event of events) {
    const score = scoreTheOddsApiEvent(event, input);
    if (!best || score > best.score) best = { event, score };
  }
  return best && best.score >= 70 ? best.event : null;
}

function toTheOddsApiDateTime(ms: number): string {
  return new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

function marketDisplayName(key: string): string {
  switch (key) {
    case 'h2h': return 'Match Winner';
    case 'totals': return 'Over/Under';
    case 'spreads': return 'Asian Handicap';
    case 'btts': return 'Both Teams Score';
    default: return key;
  }
}

function theOddsApiSelectionName(args: {
  marketKey: string;
  outcomeName: string;
  homeTeam: string;
  awayTeam: string;
}): string {
  const outcome = normalizeText(args.outcomeName);
  const home = normalizeText(args.homeTeam);
  const away = normalizeText(args.awayTeam);
  if (args.marketKey === 'h2h') {
    if (outcome === 'draw') return 'Draw';
    if (outcome === home) return 'Home';
    if (outcome === away) return 'Away';
  }
  if (args.marketKey === 'spreads') {
    if (outcome === home) return 'Home';
    if (outcome === away) return 'Away';
  }
  if (args.marketKey === 'totals') {
    if (outcome.includes('over')) return 'Over';
    if (outcome.includes('under')) return 'Under';
  }
  if (args.marketKey === 'btts') {
    if (outcome === 'yes') return 'Yes';
    if (outcome === 'no') return 'No';
  }
  return cleanText(args.outcomeName);
}

function theOddsApiEventToApiSportsOddsResponse(event: TheOddsApiEventLike, matchId: string): unknown[] {
  const bookmakers = arrayOf(event.bookmakers)
    .map((bookmakerRaw, bookmakerIndex) => {
      const bookmaker = recordOf(bookmakerRaw);
      const bets = arrayOf(bookmaker.markets)
        .map((marketRaw, marketIndex) => {
          const market = recordOf(marketRaw);
          const marketKey = cleanText(market.key);
          const values = arrayOf(market.outcomes)
            .map((outcomeRaw) => {
              const outcome = recordOf(outcomeRaw);
              const price = numberValue(outcome.price);
              if (price == null || price <= 1) return null;
              const value: { value: string; odd: string; handicap?: string } = {
                value: theOddsApiSelectionName({
                  marketKey,
                  outcomeName: cleanText(outcome.name),
                  homeTeam: cleanText(event.home_team),
                  awayTeam: cleanText(event.away_team),
                }),
                odd: String(price),
              };
              const point = numberValue(outcome.point);
              if (point != null && (marketKey === 'totals' || marketKey === 'spreads')) {
                value.handicap = point > 0 ? `+${point}` : String(point);
              }
              return value;
            })
            .filter((value): value is { value: string; odd: string; handicap?: string } => value != null && value.value !== '');
          if (values.length === 0) return null;
          return {
            id: marketIndex + 1,
            name: marketDisplayName(marketKey),
            values,
          };
        })
        .filter((bet): bet is { id: number; name: string; values: Array<{ value: string; odd: string; handicap?: string }> } => bet != null);
      if (bets.length === 0) return null;
      return {
        id: bookmakerIndex + 1,
        name: cleanText(bookmaker.title) || cleanText(bookmaker.key) || 'The Odds API',
        bets,
      };
    })
    .filter((bookmaker): bookmaker is NormalizedBookmaker => bookmaker != null);

  return bookmakers.length > 0
    ? [{
        fixture: { id: matchId },
        update: new Date().toISOString(),
        bookmakers,
      }]
    : [];
}

function isLiveOddsStatus(status?: string | null): boolean {
  return LIVE_STATUSES.has(String(status ?? '').toUpperCase());
}

function hasExplicitNonLiveStatus(status?: string | null): boolean {
  const normalized = String(status ?? '').toUpperCase();
  return normalized.length > 0 && !LIVE_STATUSES.has(normalized);
}

type ProviderFetchKind = 'live' | 'pre-match';

interface ProviderFetchResult {
  raw: unknown[];
  normalized: unknown[];
  usable: boolean;
  error: unknown;
  latencyMs: number;
}

async function fetchProviderOdds(
  kind: ProviderFetchKind,
  input: ResolveMatchOddsInput,
  deps: ResolveMatchOddsDeps,
): Promise<ProviderFetchResult> {
  const startedAt = Date.now();
  let raw: unknown[] = [];
  let error: unknown = null;
  try {
    raw = kind === 'live'
      ? await deps.fetchLiveOdds!(input.matchId)
      : await deps.fetchPreMatchOdds!(input.matchId);
  } catch (err) {
    error = err;
  }
  const normalized = normalizeApiSportsOddsResponse(raw);
  const usable = hasUsableBookmakers(normalized);
  if (isSamplingEnabled(input)) {
    void recordProviderOddsSampleSafe({
      ...sampleBase(input),
      provider: 'api-football',
      source: kind,
      success: !error,
      usable,
      latency_ms: Date.now() - startedAt,
      status_code: error ? extractStatusCode(error) : null,
      error: error
        ? (error instanceof Error ? error.message : String(error))
        : usable ? '' : 'NO_USABLE_ODDS',
      raw_payload: raw,
      normalized_payload: normalized,
      coverage_flags: (deps.summarizeCoverageFlags ?? summarizeNormalizedOdds)(normalized),
    });
  }
  return {
    raw,
    normalized,
    usable,
    error,
    latencyMs: Date.now() - startedAt,
  };
}

async function fetchTheOddsApiProviderOdds(
  input: ResolveMatchOddsInput,
  deps: ResolveMatchOddsDeps,
): Promise<ProviderFetchResult> {
  const startedAt = Date.now();
  let raw: unknown[] = [];
  let normalized: unknown[] = [];
  let error: unknown = null;

  if (!isTheOddsApiResolverEnabled() || !deps.fetchTheOddsApiOdds) {
    return {
      raw,
      normalized,
      usable: false,
      error: new Error('THEODDSAPI resolver disabled or token missing'),
      latencyMs: 0,
    };
  }

  try {
    const sportKeys = inferTheOddsApiSportKeys(input);
    if (sportKeys.length === 0) {
      throw new Error('THEODDSAPI sport key unavailable for league');
    }
    const from = input.kickoffTimestamp
      ? toTheOddsApiDateTime(input.kickoffTimestamp * 1000 - 6 * 60 * 60_000)
      : undefined;
    const to = input.kickoffTimestamp
      ? toTheOddsApiDateTime(input.kickoffTimestamp * 1000 + 6 * 60 * 60_000)
      : undefined;

    for (const sportKey of sportKeys) {
      const result = await deps.fetchTheOddsApiOdds({
        sportKey,
        regions: firstEnv('THEODDSAPI_REGIONS', 'THE_ODDS_API_REGIONS') || 'eu,uk,us',
        markets: firstEnv('THEODDSAPI_MARKETS', 'THE_ODDS_API_MARKETS') || 'h2h,spreads,totals',
        bookmakers: firstEnv('THEODDSAPI_BOOKMAKERS', 'THE_ODDS_API_BOOKMAKERS'),
        commenceTimeFrom: from,
        commenceTimeTo: to,
        consumer: consumerOf(input),
        jobName: consumerOf(input),
      });
      raw = result.raw;
      const event = selectTheOddsApiEvent(result.data as TheOddsApiEventLike[], input);
      if (event) {
        normalized = theOddsApiEventToApiSportsOddsResponse(event, input.matchId);
        if (hasUsableBookmakers(normalized)) break;
      }
    }
  } catch (err) {
    error = err;
  }

  const usable = hasUsableBookmakers(normalized);
  if (isSamplingEnabled(input)) {
    void recordProviderOddsSampleSafe({
      ...sampleBase(input),
      provider: 'the-odds-api',
      source: 'live',
      success: !error,
      usable,
      latency_ms: Date.now() - startedAt,
      status_code: error ? extractStatusCode(error) : null,
      error: error
        ? (error instanceof Error ? error.message : String(error))
        : usable ? '' : 'NO_USABLE_THE_ODDS_API_LIVE_ODDS',
      raw_payload: raw,
      normalized_payload: normalized,
      coverage_flags: (deps.summarizeCoverageFlags ?? summarizeNormalizedOdds)(normalized),
    });
  }

  return {
    raw,
    normalized,
    usable,
    error,
    latencyMs: Date.now() - startedAt,
  };
}

function providerErrorMessage(error: unknown, fallback: string): string {
  return error
    ? (error instanceof Error ? error.message : String(error))
    : fallback;
}

export async function resolveMatchOdds(
  input: ResolveMatchOddsInput,
  deps?: ResolveMatchOddsDeps,
): Promise<ResolveMatchOddsResult> {
  const resolvedDeps = { ...defaultResolveDeps, ...deps };
  const mode = input.freshnessMode ?? 'stale_safe';
  const nowIso = () => resolvedDeps.now!().toISOString();

  const cached = await loadFreshCachedOdds(input, resolvedDeps);
  if ('oddsSource' in cached) {
    return cached;
  }

  const providerResolved = await resolveMatchOddsFromProviders(input, resolvedDeps, nowIso);
  await persistOddsCache(input, resolvedDeps, providerResolved.result, providerResolved.providerSource, providerResolved.lastError);

  if (providerResolved.result.oddsSource !== 'none') {
    return providerResolved.result;
  }

  if (cached.staleRow && !bypassStartedCache(mode, input.status ?? cached.staleRow.match_status)) {
    const staleResult = buildCacheResult(cached.staleRow, 'stale_degraded', 'stale_fallback');
    await persistOddsCache(
      input,
      resolvedDeps,
      staleResult,
      (cached.staleRow.provider_source as ProviderOddsSource) || 'none',
      providerResolved.lastError || 'FRESH_REFRESH_RETURNED_NO_USABLE_ODDS',
      true,
    );
    return staleResult;
  }

  return providerResolved.result;
}

async function resolveMatchOddsFromProviders(
  input: ResolveMatchOddsInput,
  resolvedDeps: ResolveMatchOddsDeps,
  nowIso: () => string,
): Promise<ProviderResolution> {
  const mode = input.freshnessMode ?? 'stale_safe';
  const liveFirst = isLiveOddsStatus(input.status) || !hasExplicitNonLiveStatus(input.status);

  if (!liveFirst) {
    const preMatch = await fetchProviderOdds('pre-match', input, resolvedDeps);
    if (preMatch.usable) {
      return {
        result: {
          oddsSource: 'reference-prematch',
          response: preMatch.normalized,
          oddsFetchedAt: nowIso(),
          freshness: 'fresh',
          cacheStatus: 'refreshed',
        },
        providerSource: 'api-football-prematch',
        lastError: '',
      };
    }

    const lastError = providerErrorMessage(preMatch.error, 'NO_USABLE_REFERENCE_PREMATCH_ODDS');
    if (isSamplingEnabled(input)) {
      void recordProviderOddsSampleSafe({
        ...sampleBase(input),
        provider: 'resolver',
        source: 'none',
        success: true,
        usable: false,
        latency_ms: 0,
        error: 'NO_USABLE_PREMATCH_ODDS_FOR_NON_LIVE_STATUS',
        raw_payload: {},
        normalized_payload: [],
        coverage_flags: {},
      });
    }

    return {
      result: {
        oddsSource: 'none',
        response: [],
        oddsFetchedAt: null,
        freshness: 'missing',
        cacheStatus: 'miss',
      },
      providerSource: 'none',
      lastError,
    };
  }

  const live = await fetchProviderOdds('live', input, resolvedDeps);
  if (live.usable) {
    return {
      result: {
        oddsSource: 'live',
        response: live.normalized,
        oddsFetchedAt: nowIso(),
        freshness: 'fresh',
        cacheStatus: 'refreshed',
      },
      providerSource: 'api-football-live',
      lastError: '',
    };
  }

  let lastError = providerErrorMessage(live.error, 'NO_USABLE_LIVE_ODDS');

  const theOddsLive = await fetchTheOddsApiProviderOdds(input, resolvedDeps);
  if (theOddsLive.usable) {
    return {
      result: {
        oddsSource: 'fallback-live',
        response: theOddsLive.normalized,
        oddsFetchedAt: nowIso(),
        freshness: 'fresh',
        cacheStatus: 'refreshed',
      },
      providerSource: 'the-odds-live',
      lastError: '',
    };
  }
  if (theOddsLive.error) {
    lastError = `${lastError} | ${providerErrorMessage(theOddsLive.error, 'NO_USABLE_THE_ODDS_API_LIVE_ODDS')}`;
  }

  if (bypassStartedCache(mode, input.status)) {
    const preMatch = await fetchProviderOdds('pre-match', input, resolvedDeps);
    if (preMatch.usable) {
      return {
        result: {
          oddsSource: 'none',
          response: [],
          oddsFetchedAt: null,
          freshness: 'missing',
          cacheStatus: 'miss',
          referenceResponse: preMatch.normalized,
          referenceOddsSource: 'reference-prematch',
          referenceOddsFetchedAt: nowIso(),
        },
        providerSource: 'none',
        lastError,
      };
    }
    lastError = preMatch.error
      ? providerErrorMessage(preMatch.error, 'NO_USABLE_REFERENCE_PREMATCH_ODDS')
      : lastError;

    if (isSamplingEnabled(input)) {
      void recordProviderOddsSampleSafe({
        ...sampleBase(input),
        provider: 'resolver',
        source: 'none',
        success: true,
        usable: false,
        latency_ms: 0,
        error: 'REAL_REQUIRED_LIVE_ODDS_UNAVAILABLE',
        raw_payload: {},
        normalized_payload: [],
        coverage_flags: {},
      });
    }

    return {
      result: {
        oddsSource: 'none',
        response: [],
        oddsFetchedAt: null,
        freshness: 'missing',
        cacheStatus: 'miss',
      },
      providerSource: 'none',
      lastError,
    };
  }

  const preMatch = await fetchProviderOdds('pre-match', input, resolvedDeps);
  if (preMatch.usable) {
    return {
      result: {
        oddsSource: 'reference-prematch',
        response: preMatch.normalized,
        oddsFetchedAt: nowIso(),
        freshness: 'fresh',
        cacheStatus: 'refreshed',
      },
      providerSource: 'api-football-prematch',
      lastError: '',
    };
  }

  lastError = providerErrorMessage(preMatch.error, 'NO_USABLE_REFERENCE_PREMATCH_ODDS');

  if (isSamplingEnabled(input)) {
    void recordProviderOddsSampleSafe({
      ...sampleBase(input),
      provider: 'resolver',
      source: 'none',
      success: true,
      usable: false,
      latency_ms: 0,
      error: 'NO_USABLE_ODDS_ANY_SOURCE',
      raw_payload: {},
      normalized_payload: [],
      coverage_flags: {},
    });
  }

  return {
    result: {
      oddsSource: 'none',
      response: [],
      oddsFetchedAt: null,
      freshness: 'missing',
      cacheStatus: 'miss',
    },
    providerSource: 'none',
    lastError,
  };
}
