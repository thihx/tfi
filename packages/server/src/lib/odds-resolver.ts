import {
  fetchLiveOdds,
  fetchPreMatchOdds,
} from './football-api.js';
import {
  fetchTheOddsLiveDetailed,
  type TheOddsLiveTrace,
} from './the-odds-api.js';
import {
  fetchSbobetMatchOdds,
  sbobetOddsToBookmakerEntry,
  type SbobetOddsLine,
} from './sbobet-extractor.js';
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

export type ResolvedOddsSource = 'live' | 'sbobet-live' | 'fallback-live' | 'reference-prematch' | 'none';
type ProviderOddsSource = 'sbobet-live' | 'api-football-live' | 'the-odds-live' | 'api-football-prematch' | 'none';
export type ResolveMatchOddsFreshness = 'fresh' | 'stale_ok' | 'stale_degraded' | 'missing';
export type ResolveMatchOddsCacheStatus = 'hit' | 'refreshed' | 'stale_fallback' | 'miss';

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
}

export interface ResolveMatchOddsResult {
  oddsSource: ResolvedOddsSource;
  response: unknown[];
  oddsFetchedAt: string | null;
  freshness: ResolveMatchOddsFreshness;
  cacheStatus: ResolveMatchOddsCacheStatus;
}

export interface ResolveMatchOddsDeps {
  fetchLiveOdds?: (fixtureId: string) => Promise<unknown[]>;
  fetchPreMatchOdds?: (fixtureId: string) => Promise<unknown[]>;
  fetchSbobetOdds?: (homeTeam: string, awayTeam: string) => Promise<SbobetOddsLine | null>;
  fetchTheOddsLiveDetailed?: (
    homeTeam: string,
    awayTeam: string,
    fixtureId: number,
    kickoffTimestamp?: number,
    options?: {
      leagueName?: string;
      leagueCountry?: string;
      status?: string;
    },
  ) => Promise<TheOddsLiveTrace>;
  getCachedOdds?: (matchId: string) => Promise<ProviderOddsCacheRow | null>;
  upsertCachedOdds?: (input: UpsertProviderOddsCacheInput) => Promise<unknown>;
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
  fetchSbobetOdds: fetchSbobetMatchOdds,
  fetchLiveOdds,
  fetchPreMatchOdds,
  fetchTheOddsLiveDetailed,
  getCachedOdds: getProviderOddsCache,
  upsertCachedOdds: upsertProviderOddsCache,
  now: () => new Date(),
};

const LIVE_STATUSES = new Set(['1H', '2H', 'HT', 'ET', 'BT', 'P', 'LIVE', 'INT']);
const FINISHED_STATUSES = new Set(['FT', 'AET', 'PEN']);

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

function summarizeNormalizedOdds(response: unknown[]): Record<string, unknown> {
  const summary = {
    bookmaker_count: 0,
    bet_count: 0,
    has_1x2: false,
    has_ou: false,
    has_ah: false,
    has_btts: false,
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
        const name = String(bet.name || '').toLowerCase();
        if (name.includes('match winner')) summary.has_1x2 = true;
        if (name.includes('over/under')) summary.has_ou = true;
        if (name.includes('asian handicap')) summary.has_ah = true;
        if (name.includes('both teams')) summary.has_btts = true;
      }
    }
  }

  return summary;
}

function mapProviderSourceToResolved(providerSource: ProviderOddsSource): ResolvedOddsSource {
  switch (providerSource) {
    case 'sbobet-live':
      return 'sbobet-live';
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

async function loadFreshCachedOdds(
  input: ResolveMatchOddsInput,
  deps: ResolveMatchOddsDeps,
): Promise<ResolveMatchOddsResult | { staleRow: ProviderOddsCacheRow | null }> {
  if (!deps.getCachedOdds) return { staleRow: null };

  try {
    const cached = await deps.getCachedOdds(input.matchId);
    const now = deps.now!();
    const freshness = classifyFreshness(getCacheAgeMs(cached, now), getOddsCacheTtlMs(input));
    if (!cached) return { staleRow: null };
    if (freshness === 'fresh') {
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

  const summary = summarizeNormalizedOdds(result.response);
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

export async function resolveMatchOdds(
  input: ResolveMatchOddsInput,
  deps?: ResolveMatchOddsDeps,
): Promise<ResolveMatchOddsResult> {
  const resolvedDeps = { ...defaultResolveDeps, ...deps };
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

  if (cached.staleRow) {
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

  // ── Step 0: SBOBET live odds (Asian live lines, most accurate for in-play) ──
  if (resolvedDeps.fetchSbobetOdds && input.homeTeam && input.awayTeam) {
    const sboStartedAt = Date.now();
    let sboLine: Awaited<ReturnType<typeof fetchSbobetMatchOdds>> = null;
    let sboError: unknown = null;
    try {
      sboLine = await resolvedDeps.fetchSbobetOdds(input.homeTeam, input.awayTeam);
    } catch (err) {
      sboError = err;
    }
    const sboResponse = sboLine ? [sbobetOddsToBookmakerEntry(sboLine)] : [];
    const sboUsable = hasUsableBookmakers(sboResponse);
    if (isSamplingEnabled(input)) {
      void recordProviderOddsSampleSafe({
        ...sampleBase(input),
        provider: 'sbobet',
        source: 'sbobet-live',
        success: !sboError && sboLine != null,
        usable: sboUsable,
        latency_ms: Date.now() - sboStartedAt,
        status_code: sboError ? extractStatusCode(sboError) : null,
        error: sboError
          ? (sboError instanceof Error ? sboError.message : String(sboError))
          : sboUsable ? '' : 'SBO_MATCH_NOT_FOUND',
        raw_payload: sboLine ?? {},
        normalized_payload: sboResponse,
        coverage_flags: summarizeNormalizedOdds(sboResponse),
      });
    }
    if (sboUsable) {
      return {
        result: {
          oddsSource: 'sbobet-live',
          response: sboResponse,
          oddsFetchedAt: sboLine!.fetchedAt,
          freshness: 'fresh',
          cacheStatus: 'refreshed',
        },
        providerSource: 'sbobet-live',
        lastError: '',
      };
    }
  }

  // ── Step 1: API-Football live odds ────────────────────────────────────────
  const liveStartedAt = Date.now();
  let liveRaw: unknown[] = [];
  let liveError: unknown = null;
  try {
    liveRaw = await resolvedDeps.fetchLiveOdds!(input.matchId);
  } catch (err) {
    liveError = err;
  }
  const liveOdds = normalizeApiSportsOddsResponse(liveRaw);
  const liveUsable = hasUsableBookmakers(liveOdds);
  if (isSamplingEnabled(input)) {
    void recordProviderOddsSampleSafe({
      ...sampleBase(input),
      provider: 'api-football',
      source: 'live',
      success: !liveError,
      usable: liveUsable,
      latency_ms: Date.now() - liveStartedAt,
      status_code: liveError ? extractStatusCode(liveError) : null,
      error: liveError
        ? (liveError instanceof Error ? liveError.message : String(liveError))
        : liveUsable ? '' : 'NO_USABLE_ODDS',
      raw_payload: liveRaw,
      normalized_payload: liveOdds,
      coverage_flags: summarizeNormalizedOdds(liveOdds),
    });
  }
  if (liveUsable) {
    return {
      result: {
        oddsSource: 'live',
        response: liveOdds,
        oddsFetchedAt: nowIso(),
        freshness: 'fresh',
        cacheStatus: 'refreshed',
      },
      providerSource: 'api-football-live',
      lastError: '',
    };
  }

  let lastError = liveError
    ? (liveError instanceof Error ? liveError.message : String(liveError))
    : liveUsable ? '' : 'NO_USABLE_LIVE_ODDS';

  if (input.homeTeam && input.awayTeam) {
    const theOddsStartedAt = Date.now();
    let theOddsTrace: TheOddsLiveTrace | null = null;
    let theOddsError: unknown = null;
    try {
      theOddsTrace = await resolvedDeps.fetchTheOddsLiveDetailed!(
        input.homeTeam,
        input.awayTeam,
        Number(input.matchId),
        input.kickoffTimestamp,
        {
          leagueName: input.leagueName,
          leagueCountry: input.leagueCountry,
          status: input.status,
        },
      );
    } catch (err) {
      theOddsError = err;
    }

    const theOddsResult = theOddsTrace?.result ?? null;
    const theOddsResponse = theOddsResult ? [theOddsResult] : [];
    const theOddsUsable = hasUsableBookmakers(theOddsResponse);

    if (isSamplingEnabled(input)) {
      void recordProviderOddsSampleSafe({
        ...sampleBase(input),
        provider: 'the-odds-api',
        source: 'the-odds-api',
        success: !theOddsError,
        usable: theOddsUsable,
        latency_ms: Date.now() - theOddsStartedAt,
        status_code: theOddsError ? extractStatusCode(theOddsError) : null,
        error: theOddsError
          ? (theOddsError instanceof Error ? theOddsError.message : String(theOddsError))
          : theOddsTrace?.error ?? (theOddsUsable ? '' : 'NO_USABLE_ODDS'),
        raw_payload: {
          matched_event: theOddsTrace?.matchedEvent ?? null,
          event_odds: theOddsTrace?.rawEventOdds ?? null,
          sport_key: theOddsTrace?.sportKey ?? null,
          scanned_sport_keys: theOddsTrace?.scannedSportKeys ?? [],
        },
        normalized_payload: theOddsResponse,
        coverage_flags: summarizeNormalizedOdds(theOddsResponse),
      });
    }

    if (theOddsUsable) {
      return {
        result: {
          oddsSource: 'fallback-live',
          response: theOddsResponse,
          oddsFetchedAt: nowIso(),
          freshness: 'fresh',
          cacheStatus: 'refreshed',
        },
        providerSource: 'the-odds-live',
        lastError: '',
      };
    }

    lastError = theOddsError
      ? (theOddsError instanceof Error ? theOddsError.message : String(theOddsError))
      : theOddsTrace?.error || 'NO_USABLE_FALLBACK_LIVE_ODDS';
  }

  const preMatchStartedAt = Date.now();
  let preMatchRaw: unknown[] = [];
  let preMatchError: unknown = null;
  try {
    preMatchRaw = await resolvedDeps.fetchPreMatchOdds!(input.matchId);
  } catch (err) {
    preMatchError = err;
  }
  const preMatchOdds = normalizeApiSportsOddsResponse(preMatchRaw);
  const preMatchUsable = hasUsableBookmakers(preMatchOdds);
  if (isSamplingEnabled(input)) {
    void recordProviderOddsSampleSafe({
      ...sampleBase(input),
      provider: 'api-football',
      source: 'pre-match',
      success: !preMatchError,
      usable: preMatchUsable,
      latency_ms: Date.now() - preMatchStartedAt,
      status_code: preMatchError ? extractStatusCode(preMatchError) : null,
      error: preMatchError
        ? (preMatchError instanceof Error ? preMatchError.message : String(preMatchError))
        : preMatchUsable ? '' : 'NO_USABLE_ODDS',
      raw_payload: preMatchRaw,
      normalized_payload: preMatchOdds,
      coverage_flags: summarizeNormalizedOdds(preMatchOdds),
    });
  }
  if (preMatchUsable) {
    return {
      result: {
        oddsSource: 'reference-prematch',
        response: preMatchOdds,
        oddsFetchedAt: nowIso(),
        freshness: 'fresh',
        cacheStatus: 'refreshed',
      },
      providerSource: 'api-football-prematch',
      lastError: '',
    };
  }

  lastError = preMatchError
    ? (preMatchError instanceof Error ? preMatchError.message : String(preMatchError))
    : preMatchUsable ? '' : 'NO_USABLE_REFERENCE_PREMATCH_ODDS';

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
