import type {
  CanonicalOddsSelection,
  CanonicalOddsSnapshot,
  ProviderId,
} from './canonical/provider-domain.js';
import type { ResolvedOddsSource } from './odds-resolver.js';
import {
  buildProviderFusionOddsShadow,
  canonicalOddsMarketFamily,
} from './provider-fusion-odds-shadow.js';
import type { ProviderFusionPipelineReadResult } from './provider-fusion-pipeline-read.js';

export type ProviderFusionOddsPromotionStatus = 'disabled' | 'blocked' | 'promoted';

export interface ProviderFusionOddsPromotionFlags {
  providerFusionEnabled?: boolean;
  providerFusionOddsPromotion?: boolean;
}

export interface ProviderFusionOddsPromotionRuntime {
  shadowMode?: boolean;
}

export interface ProviderFusionOddsPromotionConfig {
  killSwitch: boolean;
  providerAllowlist: readonly string[];
  rolloutPercent: number;
}

export interface ProviderFusionOddsPromotionInput {
  read: ProviderFusionPipelineReadResult | null;
  matchId: string;
  oddsSource: ResolvedOddsSource;
  oddsFetchedAt: string | null;
  status: string;
  minute: number;
  score: string;
  homeName?: string;
  awayName?: string;
  currentTotalGoals?: number | null;
  generatedAt?: string;
  maxLiveOddsAgeMs?: number;
  config: ProviderFusionOddsPromotionConfig;
}

export type ProviderFusionOddsSide = { line: number; over: number | null; under: number | null };
export type ProviderFusionAsianSide = { line: number; home: number | null; away: number | null };

export interface ProviderFusionPromotedOddsCanonical {
  '1x2'?: { home: number | null; draw: number | null; away: number | null };
  ou?: ProviderFusionOddsSide;
  ou_adjacent?: ProviderFusionOddsSide;
  ou_extra?: ProviderFusionOddsSide[];
  ah?: ProviderFusionAsianSide;
  ah_adjacent?: ProviderFusionAsianSide;
  ah_extra?: ProviderFusionAsianSide[];
  btts?: { yes: number | null; no: number | null };
  corners_ou?: ProviderFusionOddsSide;
  ht_1x2?: { home: number | null; draw: number | null; away: number | null };
  ht_ou?: ProviderFusionOddsSide;
  ht_ou_adjacent?: ProviderFusionOddsSide;
  ht_ou_extra?: ProviderFusionOddsSide[];
  ht_ah?: ProviderFusionAsianSide;
  ht_ah_adjacent?: ProviderFusionAsianSide;
  ht_ah_extra?: ProviderFusionAsianSide[];
  ht_btts?: { yes: number | null; no: number | null };
}

export interface ProviderFusionOddsPromotionDecision {
  status: ProviderFusionOddsPromotionStatus;
  promoted: boolean;
  productionBehaviorChanged: boolean;
  canUseFusionOddsForMoneyDecision: boolean;
  canSaveRecommendation: boolean;
  blocksRecommendationSave: boolean;
  oddsCanonical: ProviderFusionPromotedOddsCanonical;
  oddsAvailable: boolean;
  oddsFetchedAt: string | null;
  provider: ProviderId | null;
  providerFixtureId: string | null;
  rolloutPercent: number;
  rolloutRatio: number | null;
  hardBlockReasons: string[];
  softWarnings: string[];
  reason: string;
  audit: Record<string, unknown>;
}

const CONTRACT = 'provider-fusion-phase-9-odds-promotion';
const MAX_LADDER_EXTRAS = 2;
const MONEY_SAFETY_BLOCK_REASONS = new Set([
  'provider_fusion_read_missing',
  'no_tradable_live_odds',
  'reference_odds_context_only',
  'live_odds_stale',
  'live_odds_freshness_unknown',
  'score_conflict_blocks_odds',
  'minute_conflict_blocks_odds',
  'odds_source_conflict',
  'legacy_fusion_odds_availability_mismatch',
  'canonical_odds_no_supported_markets',
]);

type Side = 'home' | 'away' | 'draw' | 'yes' | 'no' | 'over' | 'under' | null;
type OuPair = { over: number | null; under: number | null };
type AhPair = { home: number | null; away: number | null };

function cleanString(value: unknown): string {
  return value == null ? '' : String(value).trim();
}

function normalizeText(value: unknown): string {
  return cleanString(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function uniqueSorted(values: Array<string | null | undefined>): string[] {
  return [...new Set(values.map((value) => cleanString(value)).filter(Boolean))].sort();
}

function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(value, 100));
}

function stableRatio(seed: string): number {
  let hash = 2166136261;
  for (let idx = 0; idx < seed.length; idx += 1) {
    hash ^= seed.charCodeAt(idx);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) / 4294967295;
}

function best(current: number | null | undefined, candidate: number): number {
  return current && current > candidate ? current : candidate;
}

function hasPrice(value: number | null | undefined): boolean {
  return typeof value === 'number' && Number.isFinite(value) && value > 1;
}

function impliedInRange(odds: Array<number | null | undefined>, min: number, max: number): boolean {
  if (odds.some((odd) => !hasPrice(odd))) return false;
  const total = odds.reduce<number>((sum, odd) => sum + 1 / Number(odd), 0);
  return total >= min && total <= max;
}

function parseLineFromText(value: string): number | null {
  const match = value.match(/[-+]?\d+(?:\.\d+)?/);
  if (!match) return null;
  return Number(match[0]);
}

function selectionLine(selection: CanonicalOddsSelection): number | null {
  if (selection.line != null && Number.isFinite(selection.line)) return selection.line;
  return parseLineFromText(`${selection.selection} ${selection.market}`);
}

function isFirstHalf(selection: CanonicalOddsSelection): boolean {
  const text = normalizeText(`${selection.market} ${selection.selection}`);
  return /\b(first half|1st half|half time|half-time|h1|1h)\b/.test(text);
}

function selectionSide(
  selection: CanonicalOddsSelection,
  homeName = '',
  awayName = '',
): Side {
  const text = normalizeText(selection.selection);
  const market = normalizeText(selection.market);
  const home = normalizeText(homeName);
  const away = normalizeText(awayName);
  if (/\bover\b/.test(text)) return 'over';
  if (/\bunder\b/.test(text)) return 'under';
  if (text === 'yes' || /\byes\b/.test(text)) return 'yes';
  if (text === 'no' || /\bno\b/.test(text)) return 'no';
  if (text === 'x' || text === 'draw' || /\bdraw\b/.test(text)) return 'draw';
  if (text === '1' || text === 'home' || /\bhome\b/.test(text) || (home && text.includes(home))) return 'home';
  if (text === '2' || text === 'away' || /\baway\b/.test(text) || (away && text.includes(away))) return 'away';
  if (market.includes('home') && !market.includes('away')) return 'home';
  if (market.includes('away') && !market.includes('home')) return 'away';
  return null;
}

function ensureOu(map: Map<number, OuPair>, line: number): OuPair {
  const existing = map.get(line);
  if (existing) return existing;
  const next = { over: null, under: null };
  map.set(line, next);
  return next;
}

function ensureAh(map: Map<number, AhPair>, line: number): AhPair {
  const existing = map.get(line);
  if (existing) return existing;
  const next = { home: null, away: null };
  map.set(line, next);
  return next;
}

function completeOu(pair: OuPair): boolean {
  return hasPrice(pair.over) && hasPrice(pair.under);
}

function completeAh(pair: AhPair): boolean {
  return hasPrice(pair.home) && hasPrice(pair.away);
}

function pickOuLadder(
  map: Map<number, OuPair>,
  goalHint?: number | null,
): { main?: ProviderFusionOddsSide; adjacent?: ProviderFusionOddsSide; extras: ProviderFusionOddsSide[] } {
  const rows = [...map.entries()].filter(([line]) => Number.isFinite(line));
  if (rows.length === 0) return { extras: [] };
  const complete = rows.filter(([, pair]) => completeOu(pair));
  if (complete.length > 0 && goalHint != null && Number.isFinite(goalHint) && goalHint >= 0) {
    const above = complete.filter(([line]) => line > goalHint);
    const pool = above.length > 0 ? above : complete;
    const mainLine = pool.sort((left, right) => {
      const leftDist = Math.abs(left[0] - goalHint);
      const rightDist = Math.abs(right[0] - goalHint);
      return leftDist - rightDist;
    })[0]![0];
    return buildOuLadder(map, complete, mainLine);
  }
  if (complete.length > 0) {
    const mainLine = complete.sort((left, right) => (
      Math.abs(left[1].over! - left[1].under!)
      - Math.abs(right[1].over! - right[1].under!)
    ))[0]![0];
    return buildOuLadder(map, complete, mainLine);
  }
  return buildOuLadder(map, complete, rows.sort((left, right) => Math.abs(left[0]) - Math.abs(right[0]))[0]![0]);
}

function buildOuLadder(
  map: Map<number, OuPair>,
  complete: Array<[number, OuPair]>,
  mainLine: number,
): { main?: ProviderFusionOddsSide; adjacent?: ProviderFusionOddsSide; extras: ProviderFusionOddsSide[] } {
  const toRung = ([line, pair]: [number, OuPair]): ProviderFusionOddsSide => ({
    line,
    over: pair.over,
    under: pair.under,
  });
  const main = toRung([mainLine, map.get(mainLine)!]);
  const completeOther = complete
    .filter(([line]) => line !== mainLine)
    .sort((left, right) => Math.abs(left[0] - mainLine!) - Math.abs(right[0] - mainLine!));
  const adjacent = completeOther[0] ? toRung(completeOther[0]) : undefined;
  const extras = completeOther.slice(adjacent ? 1 : 0, adjacent ? 1 + MAX_LADDER_EXTRAS : MAX_LADDER_EXTRAS)
    .map(toRung);
  return { main, adjacent, extras };
}

function pickAhLadder(
  map: Map<number, AhPair>,
): { main?: ProviderFusionAsianSide; adjacent?: ProviderFusionAsianSide; extras: ProviderFusionAsianSide[] } {
  const rows = [...map.entries()].filter(([line]) => Number.isFinite(line));
  if (rows.length === 0) return { extras: [] };
  const complete = rows.filter(([, pair]) => completeAh(pair));
  if (complete.length > 0) {
    const mainLine = complete.sort((left, right) => {
      const leftAbs = Math.abs(left[0]);
      const rightAbs = Math.abs(right[0]);
      if (leftAbs !== rightAbs) return leftAbs - rightAbs;
      return Math.abs(left[1].home! - left[1].away!)
        - Math.abs(right[1].home! - right[1].away!);
    })[0]![0];
    return buildAhLadder(map, complete, mainLine);
  }
  return buildAhLadder(map, complete, rows.sort((left, right) => Math.abs(left[0]) - Math.abs(right[0]))[0]![0]);
}

function buildAhLadder(
  map: Map<number, AhPair>,
  complete: Array<[number, AhPair]>,
  mainLine: number,
): { main?: ProviderFusionAsianSide; adjacent?: ProviderFusionAsianSide; extras: ProviderFusionAsianSide[] } {
  const toRung = ([line, pair]: [number, AhPair]): ProviderFusionAsianSide => ({
    line,
    home: pair.home,
    away: pair.away,
  });
  const main = toRung([mainLine, map.get(mainLine)!]);
  const completeOther = complete
    .filter(([line]) => line !== mainLine)
    .sort((left, right) => Math.abs(left[0] - mainLine!) - Math.abs(right[0] - mainLine!));
  const adjacent = completeOther[0] ? toRung(completeOther[0]) : undefined;
  const extras = completeOther.slice(adjacent ? 1 : 0, adjacent ? 1 + MAX_LADDER_EXTRAS : MAX_LADDER_EXTRAS)
    .map(toRung);
  return { main, adjacent, extras };
}

function pruneBadMargins(canonical: ProviderFusionPromotedOddsCanonical): void {
  if (canonical['1x2'] && !impliedInRange([canonical['1x2'].home, canonical['1x2'].draw, canonical['1x2'].away], 0.90, 1.20)) {
    delete canonical['1x2'];
  }
  if (canonical.ht_1x2 && !impliedInRange([canonical.ht_1x2.home, canonical.ht_1x2.draw, canonical.ht_1x2.away], 0.90, 1.20)) {
    delete canonical.ht_1x2;
  }
  for (const key of ['ou', 'ou_adjacent', 'corners_ou', 'ht_ou', 'ht_ou_adjacent'] as const) {
    if (canonical[key] && !impliedInRange([canonical[key]?.over, canonical[key]?.under], 0.85, 1.15)) delete canonical[key];
  }
  for (const key of ['ah', 'ah_adjacent', 'ht_ah', 'ht_ah_adjacent'] as const) {
    if (canonical[key] && !impliedInRange([canonical[key]?.home, canonical[key]?.away], 0.85, 1.15)) delete canonical[key];
  }
  for (const key of ['btts', 'ht_btts'] as const) {
    if (canonical[key] && !impliedInRange([canonical[key]?.yes, canonical[key]?.no], 0.85, 1.15)) delete canonical[key];
  }
  if (canonical.ou_extra) canonical.ou_extra = canonical.ou_extra.filter((row) => impliedInRange([row.over, row.under], 0.85, 1.15));
  if (canonical.ou_extra?.length === 0) delete canonical.ou_extra;
  if (canonical.ht_ou_extra) canonical.ht_ou_extra = canonical.ht_ou_extra.filter((row) => impliedInRange([row.over, row.under], 0.85, 1.15));
  if (canonical.ht_ou_extra?.length === 0) delete canonical.ht_ou_extra;
  if (canonical.ah_extra) canonical.ah_extra = canonical.ah_extra.filter((row) => impliedInRange([row.home, row.away], 0.85, 1.15));
  if (canonical.ah_extra?.length === 0) delete canonical.ah_extra;
  if (canonical.ht_ah_extra) canonical.ht_ah_extra = canonical.ht_ah_extra.filter((row) => impliedInRange([row.home, row.away], 0.85, 1.15));
  if (canonical.ht_ah_extra?.length === 0) delete canonical.ht_ah_extra;
}

export function canonicalFusionOddsToPipelineOddsCanonical(
  snapshot: CanonicalOddsSnapshot | null,
  input: { homeName?: string; awayName?: string; currentTotalGoals?: number | null } = {},
): { canonical: ProviderFusionPromotedOddsCanonical; available: boolean; marketKeys: string[]; lineKeys: string[] } {
  const canonical: ProviderFusionPromotedOddsCanonical = {};
  const ftOu = new Map<number, OuPair>();
  const htOu = new Map<number, OuPair>();
  const cornersOu = new Map<number, OuPair>();
  const ftAh = new Map<number, AhPair>();
  const htAh = new Map<number, AhPair>();
  const oneX2 = { home: null as number | null, draw: null as number | null, away: null as number | null };
  const htOneX2 = { home: null as number | null, draw: null as number | null, away: null as number | null };
  const btts = { yes: null as number | null, no: null as number | null };
  const htBtts = { yes: null as number | null, no: null as number | null };

  for (const selection of snapshot?.selections ?? []) {
    if (selection.kind !== 'live' || selection.suspended || !hasPrice(selection.price)) continue;
    const family = canonicalOddsMarketFamily(selection.market, selection.selection);
    const half = isFirstHalf(selection);
    const side = selectionSide(selection, input.homeName, input.awayName);
    const line = selectionLine(selection);

    if (family === '1x2') {
      const target = half ? htOneX2 : oneX2;
      if (side === 'home') target.home = best(target.home, selection.price);
      if (side === 'draw') target.draw = best(target.draw, selection.price);
      if (side === 'away') target.away = best(target.away, selection.price);
    } else if (family === 'btts') {
      const target = half ? htBtts : btts;
      if (side === 'yes') target.yes = best(target.yes, selection.price);
      if (side === 'no') target.no = best(target.no, selection.price);
    } else if ((family === 'goals_ou' || family === 'corners_ou') && line != null && (side === 'over' || side === 'under')) {
      const targetMap = family === 'corners_ou' ? cornersOu : half ? htOu : ftOu;
      const target = ensureOu(targetMap, line);
      target[side] = best(target[side], selection.price);
    } else if (family === 'asian_handicap' && line != null && (side === 'home' || side === 'away')) {
      const homeCentricLine = side === 'away' ? -line : line;
      const target = ensureAh(half ? htAh : ftAh, homeCentricLine);
      target[side] = best(target[side], selection.price);
    }
  }

  if (hasPrice(oneX2.home) || hasPrice(oneX2.draw) || hasPrice(oneX2.away)) canonical['1x2'] = oneX2;
  if (hasPrice(htOneX2.home) || hasPrice(htOneX2.draw) || hasPrice(htOneX2.away)) canonical.ht_1x2 = htOneX2;
  if (hasPrice(btts.yes) || hasPrice(btts.no)) canonical.btts = btts;
  if (hasPrice(htBtts.yes) || hasPrice(htBtts.no)) canonical.ht_btts = htBtts;

  const ftOuLadder = pickOuLadder(ftOu, input.currentTotalGoals);
  if (ftOuLadder.main) canonical.ou = ftOuLadder.main;
  if (ftOuLadder.adjacent) canonical.ou_adjacent = ftOuLadder.adjacent;
  if (ftOuLadder.extras.length > 0) canonical.ou_extra = ftOuLadder.extras;
  const htOuLadder = pickOuLadder(htOu);
  if (htOuLadder.main) canonical.ht_ou = htOuLadder.main;
  if (htOuLadder.adjacent) canonical.ht_ou_adjacent = htOuLadder.adjacent;
  if (htOuLadder.extras.length > 0) canonical.ht_ou_extra = htOuLadder.extras;
  const cornersLadder = pickOuLadder(cornersOu);
  if (cornersLadder.main) canonical.corners_ou = cornersLadder.main;

  const ftAhLadder = pickAhLadder(ftAh);
  if (ftAhLadder.main) canonical.ah = ftAhLadder.main;
  if (ftAhLadder.adjacent) canonical.ah_adjacent = ftAhLadder.adjacent;
  if (ftAhLadder.extras.length > 0) canonical.ah_extra = ftAhLadder.extras;
  const htAhLadder = pickAhLadder(htAh);
  if (htAhLadder.main) canonical.ht_ah = htAhLadder.main;
  if (htAhLadder.adjacent) canonical.ht_ah_adjacent = htAhLadder.adjacent;
  if (htAhLadder.extras.length > 0) canonical.ht_ah_extra = htAhLadder.extras;

  pruneBadMargins(canonical);
  const marketKeys = Object.keys(canonical).sort();
  const lineKeys = [
    canonical.ou ? `goals_ou:${canonical.ou.line}` : null,
    canonical.ou_adjacent ? `goals_ou:${canonical.ou_adjacent.line}` : null,
    ...(canonical.ou_extra ?? []).map((row) => `goals_ou:${row.line}`),
    canonical.ah ? `asian_handicap:${canonical.ah.line}` : null,
    canonical.ah_adjacent ? `asian_handicap:${canonical.ah_adjacent.line}` : null,
    ...(canonical.ah_extra ?? []).map((row) => `asian_handicap:${row.line}`),
    canonical.corners_ou ? `corners_ou:${canonical.corners_ou.line}` : null,
    canonical.ht_ou ? `ht_goals_ou:${canonical.ht_ou.line}` : null,
    canonical.ht_ah ? `ht_asian_handicap:${canonical.ht_ah.line}` : null,
  ];
  return {
    canonical,
    available: marketKeys.length > 0,
    marketKeys,
    lineKeys: uniqueSorted(lineKeys),
  };
}

export function shouldEvaluateProviderFusionOddsPromotion(
  flags: ProviderFusionOddsPromotionFlags,
  runtime: ProviderFusionOddsPromotionRuntime = {},
): boolean {
  return flags.providerFusionEnabled === true
    && flags.providerFusionOddsPromotion === true
    && runtime.shadowMode !== true;
}

function sourceProvider(read: ProviderFusionPipelineReadResult): ProviderId | null {
  return read.snapshot.canonical.odds?.sourceProvider ?? read.snapshot.fieldSources.odds.provider;
}

function providerAllowed(provider: ProviderId | null, allowlist: readonly string[]): boolean {
  if (!provider) return false;
  const allowed = new Set(allowlist.map((item) => normalizeText(item)).filter(Boolean));
  return allowed.has(normalizeText(provider));
}

function hasMoneySafetyBlock(reasons: string[]): boolean {
  return reasons.some((reason) => MONEY_SAFETY_BLOCK_REASONS.has(reason));
}

function compactProviderOdds(snapshot: CanonicalOddsSnapshot | null): Record<string, unknown> {
  const selections = snapshot?.selections ?? [];
  const liveSelections = selections.filter((selection) => (
    selection.kind === 'live'
    && !selection.suspended
    && selection.price > 1
  ));
  return {
    selectionCount: selections.length,
    liveSelectionCount: liveSelections.length,
    provider: snapshot?.sourceProvider ?? null,
    sourceKind: snapshot?.sourceKind ?? 'unknown',
    bookmakers: uniqueSorted(selections.map((selection) => selection.bookmaker)),
    marketFamilies: uniqueSorted(liveSelections.map((selection) => canonicalOddsMarketFamily(selection.market, selection.selection))),
  };
}

function decision(input: {
  status: ProviderFusionOddsPromotionStatus;
  promoted: boolean;
  reason: string;
  blocksRecommendationSave: boolean;
  oddsCanonical?: ProviderFusionPromotedOddsCanonical;
  oddsAvailable?: boolean;
  oddsFetchedAt: string | null;
  provider: ProviderId | null;
  providerFixtureId: string | null;
  rolloutPercent: number;
  rolloutRatio: number | null;
  hardBlockReasons: string[];
  softWarnings: string[];
  auditBase: Record<string, unknown>;
}): ProviderFusionOddsPromotionDecision {
  const oddsCanonical = input.oddsCanonical ?? {};
  const oddsAvailable = input.oddsAvailable ?? false;
  const audit = {
    ...input.auditBase,
    contract: CONTRACT,
    status: input.status,
    promoted: input.promoted,
    productionBehaviorChanged: input.promoted,
    canUseFusionOddsForMoneyDecision: input.promoted,
    canSaveRecommendation: input.promoted,
    blocksRecommendationSave: input.blocksRecommendationSave,
    reason: input.reason,
    provider: input.provider,
    providerFixtureId: input.providerFixtureId,
    rolloutPercent: input.rolloutPercent,
    rolloutRatio: input.rolloutRatio,
    hardBlockReasons: input.hardBlockReasons,
    softWarnings: input.softWarnings,
    promotedOdds: {
      available: oddsAvailable,
      marketKeys: Object.keys(oddsCanonical).sort(),
    },
  };
  return {
    status: input.status,
    promoted: input.promoted,
    productionBehaviorChanged: input.promoted,
    canUseFusionOddsForMoneyDecision: input.promoted,
    canSaveRecommendation: input.promoted,
    blocksRecommendationSave: input.blocksRecommendationSave,
    oddsCanonical,
    oddsAvailable,
    oddsFetchedAt: input.oddsFetchedAt,
    provider: input.provider,
    providerFixtureId: input.providerFixtureId,
    rolloutPercent: input.rolloutPercent,
    rolloutRatio: input.rolloutRatio,
    hardBlockReasons: input.hardBlockReasons,
    softWarnings: input.softWarnings,
    reason: input.reason,
    audit,
  };
}

export function decideProviderFusionOddsPromotion(
  input: ProviderFusionOddsPromotionInput,
): ProviderFusionOddsPromotionDecision {
  const rolloutPercent = clampPercent(input.config.rolloutPercent);
  const generatedAt = input.generatedAt ?? new Date().toISOString();
  const hardBlockReasons = new Set<string>();
  const softWarnings = new Set<string>();
  const auditBase: Record<string, unknown> = {
    matchId: input.matchId,
    score: input.score,
    minute: input.minute,
    fixtureStatus: input.status,
    resolvedOddsSource: input.oddsSource,
    promotionConfig: {
      killSwitch: input.config.killSwitch,
      providerAllowlist: [...input.config.providerAllowlist],
      rolloutPercent,
    },
  };

  if (input.config.killSwitch) {
    return decision({
      status: 'disabled',
      promoted: false,
      reason: 'promotion_kill_switch',
      blocksRecommendationSave: false,
      oddsFetchedAt: input.oddsFetchedAt,
      provider: null,
      providerFixtureId: null,
      rolloutPercent,
      rolloutRatio: null,
      hardBlockReasons: ['promotion_kill_switch'],
      softWarnings: [],
      auditBase,
    });
  }

  if (!input.read) {
    hardBlockReasons.add('provider_fusion_read_missing');
    return decision({
      status: 'blocked',
      promoted: false,
      reason: 'provider_fusion_read_missing',
      blocksRecommendationSave: true,
      oddsFetchedAt: input.oddsFetchedAt,
      provider: null,
      providerFixtureId: null,
      rolloutPercent,
      rolloutRatio: null,
      hardBlockReasons: [...hardBlockReasons],
      softWarnings: [],
      auditBase,
    });
  }

  const provider = sourceProvider(input.read);
  const providerFixtureId = input.read.snapshot.fieldSources.odds.providerFixtureId;
  auditBase['providerOdds'] = compactProviderOdds(input.read.snapshot.canonical.odds);
  auditBase['consensus'] = input.read.snapshot.consensus;
  auditBase['snapshotMoneyGuard'] = input.read.snapshot.moneyGuard;

  if (!provider && (input.oddsSource === 'reference-prematch' || input.oddsSource === 'none')) {
    const guard = buildProviderFusionOddsShadow({
      read: input.read,
      matchId: input.matchId,
      oddsSource: input.oddsSource,
      oddsFetchedAt: input.oddsFetchedAt,
      status: input.status,
      minute: input.minute,
      score: input.score,
      generatedAt,
      maxLiveOddsAgeMs: input.maxLiveOddsAgeMs,
    });
    guard.hardBlockReasons.forEach((reason) => hardBlockReasons.add(reason));
    guard.softWarnings.forEach((warning) => softWarnings.add(warning));
    auditBase['oddsShadowGuard'] = guard.audit;
    if (hardBlockReasons.size === 0) hardBlockReasons.add('no_tradable_live_odds');
    const hardBlocks = [...hardBlockReasons].sort();
    const warnings = [...softWarnings].sort();
    return decision({
      status: 'blocked',
      promoted: false,
      reason: hardBlocks[0]!,
      blocksRecommendationSave: hasMoneySafetyBlock(hardBlocks),
      oddsFetchedAt: input.oddsFetchedAt ?? input.read.snapshot.fieldSources.odds.fetchedAt,
      provider,
      providerFixtureId,
      rolloutPercent,
      rolloutRatio: null,
      hardBlockReasons: hardBlocks,
      softWarnings: warnings,
      auditBase,
    });
  }

  if (input.config.providerAllowlist.length === 0) {
    return decision({
      status: 'disabled',
      promoted: false,
      reason: 'provider_allowlist_empty',
      blocksRecommendationSave: false,
      oddsFetchedAt: input.oddsFetchedAt,
      provider,
      providerFixtureId,
      rolloutPercent,
      rolloutRatio: null,
      hardBlockReasons: ['provider_allowlist_empty'],
      softWarnings: [],
      auditBase,
    });
  }
  if (!providerAllowed(provider, input.config.providerAllowlist)) {
    return decision({
      status: 'disabled',
      promoted: false,
      reason: 'provider_not_allowlisted',
      blocksRecommendationSave: false,
      oddsFetchedAt: input.oddsFetchedAt,
      provider,
      providerFixtureId,
      rolloutPercent,
      rolloutRatio: null,
      hardBlockReasons: ['provider_not_allowlisted'],
      softWarnings: [],
      auditBase,
    });
  }
  if (rolloutPercent <= 0) {
    return decision({
      status: 'disabled',
      promoted: false,
      reason: 'rollout_zero',
      blocksRecommendationSave: false,
      oddsFetchedAt: input.oddsFetchedAt,
      provider,
      providerFixtureId,
      rolloutPercent,
      rolloutRatio: null,
      hardBlockReasons: ['rollout_zero'],
      softWarnings: [],
      auditBase,
    });
  }

  const rolloutRatio = stableRatio(`${input.matchId}:${provider}:odds`);
  if (rolloutPercent < 100 && rolloutRatio >= rolloutPercent / 100) {
    return decision({
      status: 'disabled',
      promoted: false,
      reason: 'outside_rollout_sample',
      blocksRecommendationSave: false,
      oddsFetchedAt: input.oddsFetchedAt,
      provider,
      providerFixtureId,
      rolloutPercent,
      rolloutRatio,
      hardBlockReasons: ['outside_rollout_sample'],
      softWarnings: [],
      auditBase,
    });
  }

  const guard = buildProviderFusionOddsShadow({
    read: input.read,
    matchId: input.matchId,
    oddsSource: input.oddsSource,
    oddsFetchedAt: input.oddsFetchedAt,
    status: input.status,
    minute: input.minute,
    score: input.score,
    generatedAt,
    maxLiveOddsAgeMs: input.maxLiveOddsAgeMs,
  });
  guard.hardBlockReasons.forEach((reason) => hardBlockReasons.add(reason));
  guard.softWarnings.forEach((warning) => softWarnings.add(warning));
  auditBase['oddsShadowGuard'] = guard.audit;

  const converted = canonicalFusionOddsToPipelineOddsCanonical(input.read.snapshot.canonical.odds, {
    homeName: input.homeName,
    awayName: input.awayName,
    currentTotalGoals: input.currentTotalGoals,
  });
  if (!converted.available) hardBlockReasons.add('canonical_odds_no_supported_markets');
  auditBase['convertedOdds'] = {
    available: converted.available,
    marketKeys: converted.marketKeys,
    lineKeys: converted.lineKeys,
  };

  const hardBlocks = [...hardBlockReasons].sort();
  const warnings = [...softWarnings].sort();
  if (hardBlocks.length > 0) {
    return decision({
      status: 'blocked',
      promoted: false,
      reason: hardBlocks[0]!,
      blocksRecommendationSave: hasMoneySafetyBlock(hardBlocks),
      oddsFetchedAt: input.oddsFetchedAt ?? input.read.snapshot.fieldSources.odds.fetchedAt,
      provider,
      providerFixtureId,
      rolloutPercent,
      rolloutRatio,
      hardBlockReasons: hardBlocks,
      softWarnings: warnings,
      auditBase,
    });
  }

  return decision({
    status: 'promoted',
    promoted: true,
    reason: 'promoted_controlled_live_odds',
    blocksRecommendationSave: false,
    oddsCanonical: converted.canonical,
    oddsAvailable: converted.available,
    oddsFetchedAt: input.oddsFetchedAt ?? input.read.snapshot.fieldSources.odds.fetchedAt,
    provider,
    providerFixtureId,
    rolloutPercent,
    rolloutRatio,
    hardBlockReasons: [],
    softWarnings: warnings,
    auditBase,
  });
}
