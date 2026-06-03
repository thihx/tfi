import { summarizeNormalizedOdds } from './odds-resolver.js';
import { buildOddsCanonical } from './server-pipeline.js';

export interface OddsCoverageAuditSample {
  id?: number | string;
  matchId?: string;
  normalizedPayload: unknown[];
  coverageFlags: Record<string, unknown>;
}

export interface OddsCoverageAuditResult {
  id?: number | string;
  matchId?: string;
  canonicalKeys: string[];
  rawFlags: Record<string, boolean>;
  canonicalFlags: Record<string, boolean>;
  expectedFlags: Record<string, boolean>;
  recomputedFlags: Record<string, unknown>;
  storedFlags: Record<string, unknown>;
  missingStoredFlags: string[];
  missingRecomputedFlags: string[];
  rawWithoutCanonicalFlags: string[];
  flaggedWithoutCanonical: string[];
  canonicalRejectReasons: Array<{ flag: string; reason: string }>;
  ok: boolean;
}

type MarketKind = '1x2' | 'ou' | 'ah' | 'btts';
type MarketValue = { value?: unknown; odd?: unknown; handicap?: unknown; suspended?: unknown };
type MarketBet = { name?: unknown; values?: MarketValue[] };

function boolFlag(flags: Record<string, unknown>, key: string): boolean {
  return flags[key] === true || String(flags[key]).toLowerCase() === 'true';
}

function canonicalFlag(flags: Record<string, unknown>, key: string): boolean {
  const canonicalKey = `canonical_${key}`;
  if (canonicalKey in flags) return boolFlag(flags, canonicalKey);
  return boolFlag(flags, key);
}

function deriveCanonicalFlags(canonical: Record<string, unknown>): Record<string, boolean> {
  const hasComplete1x2 = (value: unknown): boolean => {
    const row = value as { home?: unknown; draw?: unknown; away?: unknown } | null;
    return row?.home != null && row.draw != null && row.away != null;
  };
  const hasCompletePair = (value: unknown, first: 'over' | 'home' | 'yes', second: 'under' | 'away' | 'no'): boolean => {
    const row = value as Record<string, unknown> | null;
    return row?.[first] != null && row[second] != null;
  };
  return {
    has_1x2: hasComplete1x2(canonical['1x2']),
    has_ou: hasCompletePair(canonical.ou, 'over', 'under') || hasCompletePair(canonical.ht_ou, 'over', 'under'),
    has_ah: hasCompletePair(canonical.ah, 'home', 'away') || hasCompletePair(canonical.ht_ah, 'home', 'away'),
    has_btts: hasCompletePair(canonical.btts, 'yes', 'no') || hasCompletePair(canonical.ht_btts, 'yes', 'no'),
  };
}

function deriveRawFlags(flags: Record<string, unknown>): Record<string, boolean> {
  return {
    has_1x2: boolFlag(flags, 'has_1x2'),
    has_ou: boolFlag(flags, 'has_ou'),
    has_ah: boolFlag(flags, 'has_ah'),
    has_btts: boolFlag(flags, 'has_btts'),
  };
}

function prefixedFlags(prefix: 'raw' | 'canonical', flags: Record<string, boolean>): Record<string, boolean> {
  return {
    [`${prefix}_has_1x2`]: flags.has_1x2 === true,
    [`${prefix}_has_ou`]: flags.has_ou === true,
    [`${prefix}_has_ah`]: flags.has_ah === true,
    [`${prefix}_has_btts`]: flags.has_btts === true,
  };
}

function isPriced(value: MarketValue): boolean {
  if (value.suspended === true || String(value.suspended).toLowerCase() === 'true') return false;
  const odd = Number(value.odd);
  return Number.isFinite(odd) && odd > 1;
}

function impliedInRange(values: number[], min: number, max: number): boolean {
  if (values.length === 0 || values.some((value) => !Number.isFinite(value) || value <= 1)) return false;
  const margin = values.reduce((sum, odd) => sum + 1 / odd, 0);
  return margin >= min && margin <= max;
}

function normalizeBetName(value: unknown): string {
  return String(value ?? '').toLowerCase().trim();
}

function isMarketBet(kind: MarketKind, name: string): boolean {
  if (kind !== 'btts' && name.includes('corner')) return false;
  if (kind === '1x2') {
    return name === '1x2'
      || name === '1 x 2'
      || name.includes('match winner')
      || name.includes('fulltime result')
      || name.includes('full time result');
  }
  if (kind === 'ou') {
    return name.includes('over/under')
      || name.includes('over / under')
      || name.includes('total goals')
      || name.includes('match goals')
      || (name.includes('goals') && (name.includes('over') || name.includes('under')));
  }
  if (kind === 'ah') return name.includes('handicap');
  return name.includes('both teams') || name === 'btts' || name.includes('both teams to score');
}

function flattenMarketBets(normalizedPayload: unknown[], kind: MarketKind): MarketBet[] {
  const bets: MarketBet[] = [];
  for (const entry of normalizedPayload) {
    if (!entry || typeof entry !== 'object') continue;
    const bookmakers = Array.isArray((entry as { bookmakers?: unknown[] }).bookmakers)
      ? (entry as { bookmakers: Array<{ bets?: unknown[] }> }).bookmakers
      : [];
    for (const bookmaker of bookmakers) {
      const bookmakerBets = Array.isArray(bookmaker.bets) ? bookmaker.bets : [];
      for (const bet of bookmakerBets) {
        const row = bet as MarketBet;
        if (isMarketBet(kind, normalizeBetName(row.name))) bets.push(row);
      }
    }
  }
  return bets;
}

function labelOf(value: MarketValue): string {
  return String(value.value ?? '').toLowerCase().trim();
}

function lineKey(value: MarketValue): string {
  const handicap = String(value.handicap ?? '').trim();
  if (handicap) return String(Math.abs(Number(handicap))).replace(/\.0$/, '');
  const match = labelOf(value).match(/([-+]?[0-9]+(?:\.[0-9]+)?)/);
  return match ? String(Math.abs(Number(match[1]))).replace(/\.0$/, '') : 'main';
}

function classifyRawWithoutCanonical(flag: string, normalizedPayload: unknown[]): string {
  const generic = (() => {
    switch (flag) {
      case 'has_1x2':
        return 'raw_1x2_present_but_not_canonical_tradable';
      case 'has_ou':
        return 'raw_goals_ou_present_but_not_canonical_tradable';
      case 'has_ah':
        return 'raw_asian_handicap_present_but_not_canonical_tradable';
      case 'has_btts':
        return 'raw_btts_present_but_not_canonical_tradable';
      default:
        return 'raw_market_present_but_not_canonical_tradable';
    }
  })();

  const kindByFlag: Record<string, MarketKind> = {
    has_1x2: '1x2',
    has_ou: 'ou',
    has_ah: 'ah',
    has_btts: 'btts',
  };
  const kind = kindByFlag[flag];
  if (!kind) return generic;

  const bets = flattenMarketBets(normalizedPayload, kind);
  if (bets.length === 0) return `${generic}:unsupported_market_name`;

  if (kind === '1x2') {
    let home = 0;
    let draw = 0;
    let away = 0;
    for (const bet of bets) {
      for (const value of Array.isArray(bet.values) ? bet.values : []) {
        if (!isPriced(value)) continue;
        const odd = Number(value.odd);
        const label = labelOf(value);
        if (label === 'home' || label === '1') home = Math.max(home, odd);
        if (label === 'draw' || label === 'x') draw = Math.max(draw, odd);
        if (label === 'away' || label === '2') away = Math.max(away, odd);
      }
    }
    if (!home || !draw || !away) return `${generic}:missing_pair_or_selection`;
    return impliedInRange([home, draw, away], 0.90, 1.20) ? generic : `${generic}:invalid_margin`;
  }

  if (kind === 'btts') {
    let yes = 0;
    let no = 0;
    for (const bet of bets) {
      for (const value of Array.isArray(bet.values) ? bet.values : []) {
        if (!isPriced(value)) continue;
        const odd = Number(value.odd);
        const label = labelOf(value);
        if (label === 'yes') yes = Math.max(yes, odd);
        if (label === 'no') no = Math.max(no, odd);
      }
    }
    if (!yes || !no) return `${generic}:missing_pair_or_selection`;
    return impliedInRange([yes, no], 0.85, 1.15) ? generic : `${generic}:invalid_margin`;
  }

  const byLine = new Map<string, { first: number; second: number }>();
  for (const bet of bets) {
    for (const value of Array.isArray(bet.values) ? bet.values : []) {
      if (!isPriced(value)) continue;
      const odd = Number(value.odd);
      const label = labelOf(value);
      const key = lineKey(value);
      const pair = byLine.get(key) ?? { first: 0, second: 0 };
      if (kind === 'ou') {
        if (label.includes('over')) pair.first = Math.max(pair.first, odd);
        if (label.includes('under')) pair.second = Math.max(pair.second, odd);
      } else {
        if (label === 'home' || label === '1' || label.startsWith('home ')) pair.first = Math.max(pair.first, odd);
        if (label === 'away' || label === '2' || label.startsWith('away ')) pair.second = Math.max(pair.second, odd);
      }
      byLine.set(key, pair);
    }
  }

  const pairs = Array.from(byLine.values()).filter((pair) => pair.first > 0 || pair.second > 0);
  if (pairs.length === 0 || pairs.every((pair) => !pair.first || !pair.second)) {
    return `${generic}:missing_pair_or_selection`;
  }
  return pairs.some((pair) => impliedInRange([pair.first, pair.second], 0.85, 1.15))
    ? generic
    : `${generic}:invalid_margin`;
}

export function buildProviderOddsCoverageFlags(normalizedPayload: unknown[]): Record<string, unknown> {
  const payload = Array.isArray(normalizedPayload) ? normalizedPayload : [];
  const raw = summarizeNormalizedOdds(payload);
  const canonical = buildOddsCanonical(payload).canonical as unknown as Record<string, unknown>;
  const rawFlags = deriveRawFlags(raw);
  const canonicalFlags = deriveCanonicalFlags(canonical);
  return {
    ...raw,
    ...prefixedFlags('raw', rawFlags),
    ...prefixedFlags('canonical', canonicalFlags),
  };
}

export function auditOddsCoverageSample(sample: OddsCoverageAuditSample): OddsCoverageAuditResult {
  const normalizedPayload = Array.isArray(sample.normalizedPayload) ? sample.normalizedPayload : [];
  const built = buildOddsCanonical(normalizedPayload);
  const canonical = built.canonical as unknown as Record<string, unknown>;
  const canonicalFlags = deriveCanonicalFlags(canonical);
  const recomputedFlags = buildProviderOddsCoverageFlags(normalizedPayload);
  const rawFlags = deriveRawFlags(recomputedFlags);
  const storedFlags = sample.coverageFlags ?? {};
  const keys = Object.keys(canonicalFlags);

  const missingStoredFlags = keys.filter((key) => canonicalFlags[key] && !canonicalFlag(storedFlags, key));
  const missingRecomputedFlags = keys.filter((key) => canonicalFlags[key] && !canonicalFlag(recomputedFlags, key));
  const rawWithoutCanonicalFlags = keys.filter((key) => !canonicalFlags[key] && rawFlags[key]);
  const flaggedWithoutCanonical = keys.filter((key) => !canonicalFlags[key] && boolFlag(storedFlags, key));
  const canonicalRejectReasons = rawWithoutCanonicalFlags.map((flag) => ({
    flag,
    reason: classifyRawWithoutCanonical(flag, normalizedPayload),
  }));

  return {
    id: sample.id,
    matchId: sample.matchId,
    canonicalKeys: Object.keys(canonical),
    rawFlags,
    canonicalFlags,
    expectedFlags: canonicalFlags,
    recomputedFlags,
    storedFlags,
    missingStoredFlags,
    missingRecomputedFlags,
    rawWithoutCanonicalFlags,
    flaggedWithoutCanonical,
    canonicalRejectReasons,
    ok: missingStoredFlags.length === 0 && missingRecomputedFlags.length === 0,
  };
}

export interface OddsCoverageAuditSummary {
  total: number;
  ok: number;
  mismatchedStored: number;
  mismatchedRecomputed: number;
  flaggedWithoutCanonical: number;
  rawWithoutCanonical: number;
  byMissingStoredFlag: Array<{ key: string; count: number }>;
  byMissingRecomputedFlag: Array<{ key: string; count: number }>;
  byRawWithoutCanonicalFlag: Array<{ key: string; count: number }>;
  byCanonicalRejectReason: Array<{ key: string; count: number }>;
  examples: OddsCoverageAuditResult[];
}

function increment(map: Map<string, number>, key: string): void {
  map.set(key, (map.get(key) ?? 0) + 1);
}

function ranked(map: Map<string, number>): Array<{ key: string; count: number }> {
  return Array.from(map.entries())
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
}

export function summarizeOddsCoverageAudit(results: OddsCoverageAuditResult[]): OddsCoverageAuditSummary {
  const missingStored = new Map<string, number>();
  const missingRecomputed = new Map<string, number>();
  const rawWithoutCanonicalByFlag = new Map<string, number>();
  const canonicalRejectByReason = new Map<string, number>();
  let flaggedWithoutCanonical = 0;
  let rawWithoutCanonical = 0;

  for (const result of results) {
    for (const key of result.missingStoredFlags) increment(missingStored, key);
    for (const key of result.missingRecomputedFlags) increment(missingRecomputed, key);
    for (const key of result.rawWithoutCanonicalFlags) increment(rawWithoutCanonicalByFlag, key);
    for (const row of result.canonicalRejectReasons) increment(canonicalRejectByReason, row.reason);
    if (result.flaggedWithoutCanonical.length > 0) flaggedWithoutCanonical += 1;
    if (result.rawWithoutCanonicalFlags.length > 0) rawWithoutCanonical += 1;
  }

  const examples = results
    .filter((result) => !result.ok || result.flaggedWithoutCanonical.length > 0)
    .slice(0, 20);

  return {
    total: results.length,
    ok: results.filter((result) => result.ok).length,
    mismatchedStored: results.filter((result) => result.missingStoredFlags.length > 0).length,
    mismatchedRecomputed: results.filter((result) => result.missingRecomputedFlags.length > 0).length,
    flaggedWithoutCanonical,
    rawWithoutCanonical,
    byMissingStoredFlag: ranked(missingStored),
    byMissingRecomputedFlag: ranked(missingRecomputed),
    byRawWithoutCanonicalFlag: ranked(rawWithoutCanonicalByFlag),
    byCanonicalRejectReason: ranked(canonicalRejectByReason),
    examples,
  };
}
