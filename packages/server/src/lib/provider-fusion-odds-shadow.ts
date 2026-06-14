import type {
  CanonicalOddsSelection,
  CanonicalOddsSnapshot,
  ProviderFieldSource,
} from './canonical/provider-domain.js';
import type { ResolvedOddsSource } from './odds-resolver.js';
import type { ProviderFusionPipelineReadResult } from './provider-fusion-pipeline-read.js';

export interface ProviderFusionOddsShadowFlags {
  providerFusionEnabled?: boolean;
  providerFusionShadowEnabled?: boolean;
  providerFusionOddsShadowEnabled?: boolean;
  providerFusionOddsPromotion?: boolean;
}

export interface ProviderFusionOddsShadowInput {
  read: ProviderFusionPipelineReadResult | null;
  matchId: string;
  oddsSource: ResolvedOddsSource;
  oddsFetchedAt: string | null;
  status: string;
  minute: number;
  score: string;
  generatedAt?: string;
  maxLiveOddsAgeMs?: number;
}

export interface ProviderFusionOddsShadowResult {
  status: 'blocked' | 'shadowed';
  shadowOnly: true;
  productionBehaviorChanged: false;
  canUseFusionOddsForMoneyDecision: boolean;
  canSaveRecommendation: false;
  hardBlockReasons: string[];
  softWarnings: string[];
  audit: Record<string, unknown>;
}

type OddsSourceKind = 'live' | 'reference' | 'prematch' | 'none' | 'unknown';
type OddsFreshness = 'fresh' | 'stale' | 'missing' | 'reference' | 'unknown';

const CONTRACT = 'provider-fusion-phase-8-odds-shadow';
const DEFAULT_MAX_LIVE_ODDS_AGE_MS = 90_000;

function cleanString(value: unknown): string {
  return value == null ? '' : String(value).trim();
}

function uniqueSorted(values: Array<string | null | undefined>): string[] {
  return [...new Set(values.map((value) => cleanString(value)).filter(Boolean))].sort();
}

function dateMs(value: unknown): number | null {
  const text = cleanString(value);
  if (!text) return null;
  const ms = Date.parse(text);
  return Number.isFinite(ms) ? ms : null;
}

function ageMs(fetchedAt: string | null, generatedAt: string): number | null {
  const fetched = dateMs(fetchedAt);
  const generated = dateMs(generatedAt);
  if (fetched == null || generated == null) return null;
  return Math.max(0, generated - fetched);
}

function sourceKindFromResolved(source: ResolvedOddsSource): OddsSourceKind {
  switch (source) {
    case 'live':
    case 'fallback-live':
      return 'live';
    case 'reference-prematch':
      return 'reference';
    case 'none':
      return 'none';
  }
}

function canonicalSourceKind(snapshot: CanonicalOddsSnapshot | null, source: ResolvedOddsSource): OddsSourceKind {
  if (snapshot?.sourceKind === 'live') return 'live';
  if (snapshot?.sourceKind === 'prematch') return 'prematch';
  if (snapshot?.sourceKind === 'reference') return 'reference';
  if (snapshot?.sourceKind === 'unknown' && (snapshot.selections.length ?? 0) > 0) return 'unknown';
  return sourceKindFromResolved(source);
}

export function canonicalOddsMarketFamily(market: string, selection = ''): string {
  const text = `${market} ${selection}`.toLowerCase();
  if (text.includes('corner')) return 'corners_ou';
  if (text.includes('asian handicap')) return 'asian_handicap';
  if (text.includes('both teams') || text.includes('btts')) return 'btts';
  if (text.includes('match winner')
    || text.includes('fulltime result')
    || text.includes('full time result')
    || text.includes('1x2')) return '1x2';
  if (text.includes('over/under')
    || text.includes('over / under')
    || text.includes('total goals')
    || /\b(over|under)\b/.test(text)) return 'goals_ou';
  return cleanString(market).toLowerCase().replace(/[^a-z0-9]+/g, '_') || 'unknown';
}

function selectionLineKey(selection: CanonicalOddsSelection): string {
  return `${canonicalOddsMarketFamily(selection.market, selection.selection)}:${selection.line ?? 'none'}`;
}

function selectionMarketSignature(selection: CanonicalOddsSelection): string {
  const family = canonicalOddsMarketFamily(selection.market, selection.selection);
  const side = cleanString(selection.selection).toLowerCase().replace(/[^a-z0-9.+-]+/g, '_') || 'unknown';
  return `${family}:${selection.line ?? 'none'}:${side}`;
}

function liveTradableSelections(snapshot: CanonicalOddsSnapshot | null): CanonicalOddsSelection[] {
  return (snapshot?.selections ?? []).filter((selection) => (
    selection.kind === 'live'
    && selection.suspended !== true
    && selection.price > 1
  ));
}

function classifyFreshness(input: {
  sourceKind: OddsSourceKind;
  liveSelectionCount: number;
  fetchedAt: string | null;
  generatedAt: string;
  maxAgeMs: number;
}): { freshness: OddsFreshness; ageMs: number | null; stale: boolean } {
  if (input.sourceKind === 'reference' || input.sourceKind === 'prematch') {
    return { freshness: 'reference', ageMs: ageMs(input.fetchedAt, input.generatedAt), stale: false };
  }
  if (input.liveSelectionCount === 0) {
    return { freshness: 'missing', ageMs: ageMs(input.fetchedAt, input.generatedAt), stale: false };
  }
  const age = ageMs(input.fetchedAt, input.generatedAt);
  if (age == null) return { freshness: 'unknown', ageMs: null, stale: true };
  if (age > input.maxAgeMs) return { freshness: 'stale', ageMs: age, stale: true };
  return { freshness: 'fresh', ageMs: age, stale: false };
}

function containsEntitlementWarning(warnings: string[]): boolean {
  return warnings.some((warning) => {
    const text = warning.toLowerCase();
    return text.includes('entitlement')
      || text.includes('subscription')
      || text.includes('all-in')
      || text.includes('no_access')
      || text.includes('no access')
      || text.includes('forbidden')
      || text.includes('unauthorized');
  });
}

function sourceAudit(source: ProviderFieldSource): Record<string, unknown> {
  return {
    provider: source.provider,
    providerFixtureId: source.providerFixtureId,
    fetchedAt: source.fetchedAt,
    freshness: source.freshness,
    coverage: source.coverage,
    confidence: source.confidence,
    notes: source.notes,
  };
}

function diffSet(left: string[], right: string[]): string[] {
  const rightSet = new Set(right);
  return left.filter((item) => !rightSet.has(item));
}

function compactSelections(snapshot: CanonicalOddsSnapshot | null): Record<string, unknown> {
  const selections = snapshot?.selections ?? [];
  const liveSelections = liveTradableSelections(snapshot);
  const bookmakers = uniqueSorted(selections.map((selection) => selection.bookmaker));
  const liveFamilies = uniqueSorted(liveSelections.map((selection) => canonicalOddsMarketFamily(selection.market, selection.selection)));
  const allFamilies = uniqueSorted(selections.map((selection) => canonicalOddsMarketFamily(selection.market, selection.selection)));
  const lineKeys = uniqueSorted(liveSelections.map(selectionLineKey));
  return {
    selectionCount: selections.length,
    liveSelectionCount: liveSelections.length,
    bookmakerCount: bookmakers.length,
    bookmakers,
    sourceProvider: snapshot?.sourceProvider ?? null,
    sourceKind: snapshot?.sourceKind ?? 'unknown',
    liveFamilies,
    allFamilies,
    lineKeys,
    marketSignatures: uniqueSorted(liveSelections.map(selectionMarketSignature)),
  };
}

export function shouldBuildProviderFusionOddsShadow(
  flags: ProviderFusionOddsShadowFlags,
  runtime: { shadowMode?: boolean } = {},
): boolean {
  return flags.providerFusionEnabled === true
    && (flags.providerFusionOddsShadowEnabled === true || flags.providerFusionShadowEnabled === true)
    && flags.providerFusionOddsPromotion !== true
    && runtime.shadowMode !== true;
}

export function buildProviderFusionOddsShadow(input: ProviderFusionOddsShadowInput): ProviderFusionOddsShadowResult {
  const generatedAt = input.generatedAt ?? new Date().toISOString();
  const maxAgeMs = input.maxLiveOddsAgeMs ?? DEFAULT_MAX_LIVE_ODDS_AGE_MS;
  if (!input.read) {
    const hardBlockReasons = ['provider_fusion_read_missing'];
    return {
      status: 'blocked',
      shadowOnly: true,
      productionBehaviorChanged: false,
      canUseFusionOddsForMoneyDecision: false,
      canSaveRecommendation: false,
      hardBlockReasons,
      softWarnings: [],
      audit: {
        contract: CONTRACT,
        matchId: input.matchId,
        status: 'blocked',
        shadowOnly: true,
        productionBehaviorChanged: false,
        canUseFusionOddsForMoneyDecision: false,
        canSaveRecommendation: false,
        hardBlockReasons,
        softWarnings: [],
      },
    };
  }

  const oddsSnapshot = input.read.snapshot.canonical.odds;
  const source = input.read.snapshot.fieldSources.odds;
  const sourceKind = canonicalSourceKind(oddsSnapshot, input.oddsSource);
  const liveSelections = liveTradableSelections(oddsSnapshot);
  const selectedFetchedAt = input.oddsFetchedAt ?? source.fetchedAt ?? oddsSnapshot?.generatedAt ?? null;
  const freshness = classifyFreshness({
    sourceKind,
    liveSelectionCount: liveSelections.length,
    fetchedAt: selectedFetchedAt,
    generatedAt,
    maxAgeMs,
  });
  const warnings = uniqueSorted([
    ...(oddsSnapshot?.warnings ?? []),
    ...source.notes,
    ...input.read.snapshot.warnings,
    ...input.read.snapshot.moneyGuard.softWarnings,
  ]);
  const hardBlocks = new Set<string>();

  if (liveSelections.length === 0) hardBlocks.add('no_tradable_live_odds');
  if (sourceKind === 'reference' || sourceKind === 'prematch') hardBlocks.add('reference_odds_context_only');
  if (freshness.stale) hardBlocks.add(freshness.freshness === 'stale' ? 'live_odds_stale' : 'live_odds_freshness_unknown');
  if (input.read.snapshot.consensus.scoreAgreement === 'conflict'
    || input.read.snapshot.moneyGuard.hardBlockReasons.includes('score_conflict')) {
    hardBlocks.add('score_conflict_blocks_odds');
  }
  if (input.read.snapshot.consensus.minuteAgreement === 'conflict'
    || input.read.snapshot.moneyGuard.hardBlockReasons.includes('minute_conflict')) {
    hardBlocks.add('minute_conflict_blocks_odds');
  }
  if (input.read.snapshot.consensus.oddsAgreement === 'conflict') hardBlocks.add('odds_source_conflict');
  if (input.read.diff.fields.odds.changed
    && input.read.legacyRead.odds.available !== input.read.fusionRead.odds.available) {
    hardBlocks.add('legacy_fusion_odds_availability_mismatch');
  }
  if (input.oddsSource === 'none' && (oddsSnapshot?.selections.length ?? 0) > 0) {
    hardBlocks.add('odds_source_conflict');
  }
  const softWarnings = containsEntitlementWarning(warnings)
    ? uniqueSorted([...warnings, 'odds_entitlement_or_no_access'])
    : warnings;
  const hardBlockReasons = [...hardBlocks].sort();
  const canUseFusionOddsForMoneyDecision = hardBlockReasons.length === 0
    && sourceKind === 'live'
    && freshness.freshness === 'fresh'
    && liveSelections.length > 0;
  const legacyLineKeys = input.read.legacyRead.odds.lineKeys;
  const fusionLineKeys = input.read.fusionRead.odds.lineKeys;
  const legacyFamilies = input.read.legacyRead.odds.marketFamilies;
  const fusionFamilies = input.read.fusionRead.odds.marketFamilies;
  const audit = {
    contract: CONTRACT,
    matchId: input.matchId,
    status: 'shadowed',
    shadowOnly: true,
    productionBehaviorChanged: false,
    oddsPromotionEnabled: false,
    canUseFusionOddsForMoneyDecision,
    canSaveRecommendation: false,
    score: input.score,
    minute: input.minute,
    fixtureStatus: input.status,
    resolvedOddsSource: input.oddsSource,
    sourceKind,
    source: sourceAudit(source),
    freshness,
    providerOdds: compactSelections(oddsSnapshot),
    legacyOdds: {
      available: input.read.legacyRead.odds.available,
      source: input.read.legacyRead.odds.source,
      marketFamilies: legacyFamilies,
      lineKeys: legacyLineKeys,
      selectionCount: input.read.legacyRead.odds.selectionCount,
    },
    fusionOdds: {
      available: input.read.fusionRead.odds.available,
      source: input.read.fusionRead.odds.source,
      marketFamilies: fusionFamilies,
      lineKeys: fusionLineKeys,
      selectionCount: input.read.fusionRead.odds.selectionCount,
    },
    marketDiff: {
      changed: input.read.diff.fields.odds.changed,
      familiesMissingInFusion: diffSet(legacyFamilies, fusionFamilies),
      familiesExtraInFusion: diffSet(fusionFamilies, legacyFamilies),
      linesMissingInFusion: diffSet(legacyLineKeys, fusionLineKeys),
      linesExtraInFusion: diffSet(fusionLineKeys, legacyLineKeys),
    },
    consensus: {
      scoreAgreement: input.read.snapshot.consensus.scoreAgreement,
      minuteAgreement: input.read.snapshot.consensus.minuteAgreement,
      oddsAgreement: input.read.snapshot.consensus.oddsAgreement,
    },
    moneyGuard: {
      canUseFusionOddsForMoneyDecision,
      canSaveRecommendation: false,
      hardBlockReasons,
      softWarnings,
      snapshotMoneyGuard: input.read.snapshot.moneyGuard,
    },
    hardBlockReasons,
    softWarnings,
  };

  return {
    status: 'shadowed',
    shadowOnly: true,
    productionBehaviorChanged: false,
    canUseFusionOddsForMoneyDecision,
    canSaveRecommendation: false,
    hardBlockReasons,
    softWarnings,
    audit,
  };
}
