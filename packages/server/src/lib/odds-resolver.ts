import {
  fetchLiveOdds,
  fetchPreMatchOdds,
} from './football-api.js';
import {
  fetchTheOddsLiveDetailed,
  type TheOddsLiveTrace,
} from './the-odds-api.js';
import {
  extractStatusCode,
  recordProviderOddsSampleSafe,
} from './provider-sampling.js';

export type ResolvedOddsSource = 'live' | 'the-odds-api' | 'pre-match' | 'none';

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
}

export interface ResolveMatchOddsDeps {
  fetchLiveOdds?: (fixtureId: string) => Promise<unknown[]>;
  fetchPreMatchOdds?: (fixtureId: string) => Promise<unknown[]>;
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
  fetchTheOddsLiveDetailed,
};

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
  const nowIso = () => new Date().toISOString();
  const resolvedDeps = { ...defaultResolveDeps, ...deps };

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
      oddsSource: 'live',
      response: liveOdds,
      oddsFetchedAt: nowIso(),
    };
  }

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
        oddsSource: 'the-odds-api',
        response: theOddsResponse,
        oddsFetchedAt: nowIso(),
      };
    }
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
      oddsSource: 'pre-match',
      response: preMatchOdds,
      oddsFetchedAt: nowIso(),
    };
  }

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
    oddsSource: 'none',
    response: [],
    oddsFetchedAt: null,
  };
}
