import {
  buildCanonicalOddsSelection,
  buildCanonicalOddsSnapshot,
  buildProviderEnvelope,
  type CanonicalOddsKind,
  type CanonicalOddsSelection,
  type CanonicalOddsSnapshot,
  type ProviderEnvelope,
  type ProviderQuotaState,
} from './provider-domain.js';

export const THE_ODDS_API_PROVIDER = 'the-odds-api';

export interface TheOddsApiOutcomeLike {
  name?: unknown;
  price?: unknown;
  point?: unknown;
}

export interface TheOddsApiMarketLike {
  key?: unknown;
  last_update?: unknown;
  outcomes?: unknown;
}

export interface TheOddsApiBookmakerLike {
  key?: unknown;
  title?: unknown;
  last_update?: unknown;
  markets?: unknown;
}

export interface TheOddsApiEventLike {
  id?: unknown;
  sport_key?: unknown;
  sport_title?: unknown;
  commence_time?: unknown;
  home_team?: unknown;
  away_team?: unknown;
  bookmakers?: unknown;
}

export interface BuildTheOddsApiOddsEnvelopeInput {
  matchId: string;
  event: unknown;
  fetchedAt: string;
  generatedAt?: string;
  statusCode?: number | null;
  latencyMs?: number | null;
  quota?: ProviderQuotaState;
  raw?: unknown;
  warnings?: unknown[];
  now?: Date;
  forceKind?: CanonicalOddsKind;
}

export interface BuildTheOddsApiErrorEnvelopeInput {
  matchId?: string | number | null;
  providerFixtureId?: string | number | null;
  fetchedAt: string;
  error: unknown;
  statusCode?: number | null;
  latencyMs?: number | null;
  quota?: ProviderQuotaState;
  warnings?: unknown[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value);
}

function cleanString(value: unknown): string {
  return value == null ? '' : String(value).trim();
}

function stringOrNull(value: unknown): string | null {
  const text = cleanString(value);
  return text ? text : null;
}

function numberOrNull(value: unknown): number | null {
  if (value == null || value === '') return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function toArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function warningStrings(value: unknown[] | undefined): string[] {
  return (value ?? []).map((item) => cleanString(item)).filter(Boolean);
}

function normalizeText(value: unknown): string {
  return cleanString(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function eventKind(event: TheOddsApiEventLike, now: Date, forceKind?: CanonicalOddsKind): CanonicalOddsKind {
  if (forceKind) return forceKind;
  const commence = Date.parse(cleanString(event.commence_time));
  if (!Number.isFinite(commence)) return 'unknown';
  const ageMs = now.getTime() - commence;
  if (ageMs >= -15 * 60_000 && ageMs <= 4 * 60 * 60_000) return 'live';
  return 'prematch';
}

function marketName(key: string): string {
  switch (key) {
    case 'h2h':
      return 'Match Winner';
    case 'totals':
      return 'Over/Under';
    case 'spreads':
      return 'Asian Handicap';
    case 'btts':
      return 'Both Teams To Score';
    default:
      return key;
  }
}

function selectionName(input: {
  marketKey: string;
  outcomeName: string;
  homeName: string;
  awayName: string;
  point: number | null;
}): string {
  const text = normalizeText(input.outcomeName);
  const home = normalizeText(input.homeName);
  const away = normalizeText(input.awayName);
  if (input.marketKey === 'h2h') {
    if (text === 'draw') return 'Draw';
    if (home && text === home) return 'Home';
    if (away && text === away) return 'Away';
  }
  if (input.marketKey === 'spreads') {
    const side = home && text === home ? 'Home' : away && text === away ? 'Away' : cleanString(input.outcomeName);
    return input.point == null ? side : `${side} ${input.point > 0 ? '+' : ''}${input.point}`;
  }
  if (input.marketKey === 'totals') {
    const side = text.includes('under') ? 'Under' : text.includes('over') ? 'Over' : cleanString(input.outcomeName);
    return input.point == null ? side : `${side} ${input.point}`;
  }
  if (input.marketKey === 'btts') {
    if (text === 'yes') return 'Yes';
    if (text === 'no') return 'No';
  }
  return cleanString(input.outcomeName);
}

function outcomeFetchedAt(
  market: TheOddsApiMarketLike,
  bookmaker: TheOddsApiBookmakerLike,
  fallback: string,
): string {
  return stringOrNull(market.last_update) ?? stringOrNull(bookmaker.last_update) ?? fallback;
}

export function theOddsApiEventToSelections(input: {
  event: unknown;
  fetchedAt: string;
  now?: Date;
  forceKind?: CanonicalOddsKind;
}): CanonicalOddsSelection[] {
  if (!isRecord(input.event)) return [];
  const event = input.event as TheOddsApiEventLike;
  const kind = eventKind(event, input.now ?? new Date(), input.forceKind);
  const selections: CanonicalOddsSelection[] = [];
  const homeName = cleanString(event.home_team);
  const awayName = cleanString(event.away_team);

  for (const rawBookmaker of toArray(event.bookmakers)) {
    if (!isRecord(rawBookmaker)) continue;
    const bookmaker = rawBookmaker as TheOddsApiBookmakerLike;
    const bookmakerName = stringOrNull(bookmaker.title) ?? stringOrNull(bookmaker.key);
    for (const rawMarket of toArray(bookmaker.markets)) {
      if (!isRecord(rawMarket)) continue;
      const market = rawMarket as TheOddsApiMarketLike;
      const marketKey = cleanString(market.key);
      if (!marketKey) continue;
      const canonicalMarket = marketName(marketKey);
      for (const rawOutcome of toArray(market.outcomes)) {
        if (!isRecord(rawOutcome)) continue;
        const outcome = rawOutcome as TheOddsApiOutcomeLike;
        const price = numberOrNull(outcome.price);
        if (price == null || price <= 1) continue;
        const outcomeName = cleanString(outcome.name);
        if (!outcomeName) continue;
        const point = numberOrNull(outcome.point);
        selections.push(buildCanonicalOddsSelection({
          market: canonicalMarket,
          selection: selectionName({
            marketKey,
            outcomeName,
            homeName,
            awayName,
            point,
          }),
          line: point,
          price,
          bookmaker: bookmakerName,
          provider: THE_ODDS_API_PROVIDER,
          kind,
          fetchedAt: outcomeFetchedAt(market, bookmaker, input.fetchedAt),
          suspended: false,
        }));
      }
    }
  }

  return selections;
}

export function buildTheOddsApiOddsSnapshot(input: {
  matchId: string;
  event: unknown;
  fetchedAt: string;
  generatedAt?: string;
  warnings?: unknown[];
  now?: Date;
  forceKind?: CanonicalOddsKind;
}): CanonicalOddsSnapshot {
  const selections = theOddsApiEventToSelections(input);
  const warnings = warningStrings(input.warnings);
  const sourceKind = selections[0]?.kind ?? eventKind(
    isRecord(input.event) ? input.event as TheOddsApiEventLike : {},
    input.now ?? new Date(),
    input.forceKind,
  );
  if (sourceKind === 'prematch') warnings.push('prematch_reference_only');
  return buildCanonicalOddsSnapshot({
    matchId: input.matchId,
    generatedAt: input.generatedAt ?? input.fetchedAt,
    selections,
    sourceProvider: selections.length > 0 ? THE_ODDS_API_PROVIDER : null,
    sourceKind,
    warnings,
  });
}

export function buildTheOddsApiOddsEnvelope(
  input: BuildTheOddsApiOddsEnvelopeInput,
): ProviderEnvelope<CanonicalOddsSnapshot> {
  const event = isRecord(input.event) ? input.event as TheOddsApiEventLike : {};
  const snapshot = buildTheOddsApiOddsSnapshot({
    matchId: input.matchId,
    event,
    fetchedAt: input.fetchedAt,
    generatedAt: input.generatedAt,
    warnings: input.warnings,
    now: input.now,
    forceKind: input.forceKind,
  });
  const providerFixtureId = stringOrNull(event.id);
  return buildProviderEnvelope({
    provider: THE_ODDS_API_PROVIDER,
    role: snapshot.sourceKind === 'live' ? 'live_odds' : 'reference_odds',
    providerFixtureId,
    matchId: input.matchId,
    fetchedAt: input.fetchedAt,
    latencyMs: input.latencyMs,
    success: true,
    statusCode: input.statusCode ?? 200,
    raw: input.raw ?? null,
    normalized: snapshot,
    coverage: {
      fetched: true,
      itemCount: snapshot.selections.length,
      warnings: snapshot.warnings,
    },
    freshness: snapshot.sourceKind === 'live' ? 'fresh' : 'stale',
    quota: input.quota ?? 'unknown',
    warnings: snapshot.warnings,
  });
}

export function buildTheOddsApiErrorEnvelope(
  input: BuildTheOddsApiErrorEnvelopeInput,
): ProviderEnvelope<CanonicalOddsSnapshot> {
  const error = input.error instanceof Error ? input.error.message : cleanString(input.error);
  return buildProviderEnvelope<CanonicalOddsSnapshot>({
    provider: THE_ODDS_API_PROVIDER,
    role: 'live_odds',
    providerFixtureId: input.providerFixtureId,
    matchId: input.matchId,
    fetchedAt: input.fetchedAt,
    latencyMs: input.latencyMs,
    success: false,
    statusCode: input.statusCode ?? null,
    raw: null,
    normalized: null,
    coverage: {
      fetched: false,
      itemCount: 0,
      warnings: warningStrings(input.warnings),
    },
    freshness: 'missing',
    quota: input.quota ?? 'unknown',
    error,
    warnings: warningStrings(input.warnings),
  });
}

