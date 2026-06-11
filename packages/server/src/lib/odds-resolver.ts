import {
  fetchLiveOdds,
  fetchPreMatchOdds,
} from './football-api.js';
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

function isLegacyProviderSource(providerSource: string | null | undefined): boolean {
  return String(providerSource || '').toLowerCase() === 'the-odds-live';
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
    if (isLegacyProviderSource(cached.provider_source)) return { staleRow: null };
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
