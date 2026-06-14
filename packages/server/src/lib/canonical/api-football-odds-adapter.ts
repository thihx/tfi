import {
  buildCanonicalOddsSelection,
  buildCanonicalOddsSnapshot,
  type CanonicalOddsKind,
  type CanonicalOddsSelection,
  type CanonicalOddsSnapshot,
} from './provider-domain.js';

export type ApiFootballOddsSourceKind = 'live' | 'prematch' | 'reference';

interface ApiFootballOddsValueLike {
  value?: unknown;
  odd?: unknown;
  handicap?: unknown;
  suspended?: unknown;
}

interface ApiFootballOddsBetLike {
  id?: unknown;
  name?: unknown;
  values?: unknown;
}

interface ApiFootballBookmakerLike {
  id?: unknown;
  name?: unknown;
  bets?: unknown;
}

interface ApiFootballOddsEntryLike {
  fixture?: unknown;
  bookmakers?: unknown;
  odds?: unknown;
}

export interface BuildApiFootballOddsSnapshotInput {
  matchId: string;
  response: unknown[];
  sourceKind: ApiFootballOddsSourceKind;
  fetchedAt: string;
  generatedAt?: string;
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

function toArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (isRecord(value) && Array.isArray(value['data'])) return value['data'];
  return [];
}

function numberOrNull(value: unknown): number | null {
  if (value == null || value === '') return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function boolValue(value: unknown): boolean {
  return value === true || String(value).toLowerCase().trim() === 'true';
}

function canonicalKind(sourceKind: ApiFootballOddsSourceKind): CanonicalOddsKind {
  return sourceKind === 'live' ? 'live' : 'reference';
}

function valueLine(value: ApiFootballOddsValueLike): number | null {
  const handicap = numberOrNull(value.handicap);
  if (handicap != null) return handicap;
  const label = cleanString(value.value);
  const match = label.match(/[-+]?\d+(?:\.\d+)?/);
  return match ? numberOrNull(match[0]) : null;
}

function normalizeBookmakers(entry: ApiFootballOddsEntryLike): ApiFootballBookmakerLike[] {
  const bookmakers = toArray(entry.bookmakers);
  if (bookmakers.length > 0) return bookmakers.filter(isRecord) as ApiFootballBookmakerLike[];

  const inlineOdds = toArray(entry.odds);
  if (inlineOdds.length === 0) return [];
  return [{
    id: 0,
    name: 'Live Odds',
    bets: inlineOdds,
  }];
}

function valueRows(bet: ApiFootballOddsBetLike): ApiFootballOddsValueLike[] {
  return toArray(bet.values).filter(isRecord) as ApiFootballOddsValueLike[];
}

function warningStrings(value: unknown[] | undefined): string[] {
  return (value ?? []).map((item) => cleanString(item)).filter(Boolean);
}

export function redactApiFootballLedgerParams(params: Record<string, unknown>): Record<string, string> {
  const redacted: Record<string, string> = {};
  for (const [key, value] of Object.entries(params)) {
    const normalizedKey = key.toLowerCase();
    const secret = normalizedKey.includes('token')
      || normalizedKey.includes('api_key')
      || normalizedKey.includes('apikey')
      || normalizedKey.includes('apisports-key')
      || normalizedKey === 'authorization'
      || normalizedKey === 'key';
    redacted[key] = secret ? '[redacted]' : cleanString(value);
  }
  return redacted;
}

export function apiFootballOddsToSelections(input: {
  response: unknown[];
  sourceKind: ApiFootballOddsSourceKind;
  fetchedAt: string;
}): CanonicalOddsSelection[] {
  const kind = canonicalKind(input.sourceKind);
  const selections: CanonicalOddsSelection[] = [];

  for (const rawEntry of input.response) {
    if (!isRecord(rawEntry)) continue;
    const entry = rawEntry as ApiFootballOddsEntryLike;
    for (const bookmaker of normalizeBookmakers(entry)) {
      const bookmakerName = stringOrNull(bookmaker.name);
      for (const rawBet of toArray(bookmaker.bets)) {
        if (!isRecord(rawBet)) continue;
        const bet = rawBet as ApiFootballOddsBetLike;
        const market = cleanString(bet.name);
        if (!market) continue;
        for (const value of valueRows(bet)) {
          const price = numberOrNull(value.odd);
          if (price == null || price <= 1) continue;
          const selection = cleanString(value.value);
          if (!selection) continue;
          selections.push(buildCanonicalOddsSelection({
            market,
            selection,
            line: valueLine(value),
            price,
            bookmaker: bookmakerName,
            provider: 'api-football',
            kind,
            fetchedAt: input.fetchedAt,
            suspended: boolValue(value.suspended),
          }));
        }
      }
    }
  }

  return selections;
}

export function buildApiFootballOddsSnapshot(input: BuildApiFootballOddsSnapshotInput): CanonicalOddsSnapshot {
  const selections = apiFootballOddsToSelections({
    response: input.response,
    sourceKind: input.sourceKind,
    fetchedAt: input.fetchedAt,
  });
  const warnings = warningStrings(input.warnings);
  if (input.sourceKind === 'prematch') warnings.push('prematch_reference_only');

  return buildCanonicalOddsSnapshot({
    matchId: input.matchId,
    generatedAt: input.generatedAt ?? input.fetchedAt,
    selections,
    sourceProvider: selections.length > 0 ? 'api-football' : null,
    sourceKind: canonicalKind(input.sourceKind),
    warnings,
  });
}
