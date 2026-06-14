import {
  type CanonicalMatchEvent,
  type CanonicalOddsSnapshot,
  type CanonicalTeamStatistics,
  type ProviderFusionEvidenceMode,
  type ProviderId,
} from './canonical/provider-domain.js';
import { classifyLiveEvidence } from './live-output-router.js';
import type { LiveAnalysisEvidenceMode } from './evidence-mode-market-allowlist.js';
import type { ResolvedOddsSource } from './odds-resolver.js';
import type { PipelineFixtureInput } from './pipeline-live-input.js';
import {
  buildLiveProviderFusionSnapshot,
  compactFusionSnapshotForAudit,
  type ProviderFusionSourceEnvelopes,
} from './provider-fusion-snapshot.js';

type SideValue = { home: number | null; away: number | null };

export interface ProviderFusionPipelineFlags {
  providerFusionEnabled?: boolean;
  providerFusionShadowEnabled?: boolean;
  providerFusionPromotionEnabled?: boolean;
}

export interface ProviderFusionPipelineReadInput {
  matchId: string;
  fixture: PipelineFixtureInput;
  providerSources: ProviderFusionSourceEnvelopes[];
  statsCompact: Record<string, unknown>;
  eventsCompact: Array<Record<string, unknown>>;
  oddsCanonical: Record<string, unknown>;
  oddsResponse: unknown[];
  oddsSource: ResolvedOddsSource;
  oddsFetchedAt: string | null;
  statisticsProvider?: string | null;
  eventsProvider?: string | null;
  generatedAt?: string;
  promotionEnabled?: boolean;
}

export interface ProviderFusionReadView {
  score: {
    status: string;
    minute: number | null;
    text: string;
  };
  statistics: {
    available: boolean;
    populatedPairs: number;
    keys: string[];
    values: Record<string, SideValue>;
    provider: string | null;
  };
  events: {
    count: number;
    goalCount: number;
    cardCount: number;
    substitutionCount: number;
    lastMinute: number | null;
    provider: string | null;
  };
  odds: {
    available: boolean;
    source: string;
    marketFamilies: string[];
    marketKeys: string[];
    lineKeys: string[];
    selectionCount: number;
  };
  evidenceMode: LiveAnalysisEvidenceMode;
}

export interface ProviderFusionFieldDiff<T> {
  changed: boolean;
  legacy: T;
  fusion: T;
}

export interface ProviderFusionMoneyGuardDiff {
  promotionEnabled: boolean;
  legacyCanSaveRecommendation: boolean;
  fusionCanSaveRecommendation: boolean;
  canPromoteWithoutBehaviorChange: boolean;
  hardBlockReasons: string[];
  softWarnings: string[];
}

export interface ProviderFusionPipelineDiff {
  changed: boolean;
  promptEquivalent: boolean;
  changedFields: string[];
  fields: {
    score: ProviderFusionFieldDiff<string>;
    minute: ProviderFusionFieldDiff<number | null>;
    status: ProviderFusionFieldDiff<string>;
    statistics: ProviderFusionFieldDiff<Record<string, SideValue>>;
    events: ProviderFusionFieldDiff<Omit<ProviderFusionReadView['events'], 'provider'>>;
    odds: ProviderFusionFieldDiff<Pick<ProviderFusionReadView['odds'], 'available' | 'marketFamilies'>>;
    evidenceMode: ProviderFusionFieldDiff<LiveAnalysisEvidenceMode>;
  };
  moneyGuard: ProviderFusionMoneyGuardDiff;
}

export interface ProviderFusionPipelineReadResult {
  snapshot: ReturnType<typeof buildLiveProviderFusionSnapshot>;
  legacyRead: ProviderFusionReadView;
  fusionRead: ProviderFusionReadView;
  diff: ProviderFusionPipelineDiff;
  audit: Record<string, unknown>;
}

const API_FOOTBALL_PROVIDER: ProviderId = 'api-football';

const STAT_KEY_MAP: Record<string, keyof Omit<CanonicalTeamStatistics, 'rawTypeMap'>> = {
  possession: 'possessionPct',
  shots: 'shotsTotal',
  shots_on_target: 'shotsOnTarget',
  corners: 'corners',
  fouls: 'fouls',
  yellow_cards: 'yellowCards',
  red_cards: 'redCards',
  expected_goals: 'expectedGoals',
  total_passes: 'passes',
};

function cleanString(value: unknown): string {
  return value == null ? '' : String(value).trim();
}

function numberOrNull(value: unknown): number | null {
  if (value == null || value === '') return null;
  const text = typeof value === 'string' ? value.trim().replace(/%$/, '') : value;
  const num = Number(text);
  return Number.isFinite(num) ? num : null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function uniqueSorted(values: Array<string | null | undefined>): string[] {
  return [...new Set(values.map((value) => cleanString(value)).filter(Boolean))].sort();
}

function normalizeProvider(value: string | null | undefined): ProviderId {
  const text = cleanString(value).toLowerCase();
  if (text.includes('sportmonks')) return 'sportmonks';
  return API_FOOTBALL_PROVIDER;
}

function sideValueFromRecord(value: unknown): SideValue | null {
  const record = asRecord(value);
  if (!record) return null;
  return {
    home: numberOrNull(record['home']),
    away: numberOrNull(record['away']),
  };
}

function keepPopulatedStats(values: Record<string, SideValue>): Record<string, SideValue> {
  return Object.fromEntries(
    Object.entries(values)
      .filter(([, value]) => value.home != null || value.away != null)
      .sort(([left], [right]) => left.localeCompare(right)),
  );
}

function legacyStatisticsView(statsCompact: Record<string, unknown>): ProviderFusionReadView['statistics'] {
  const values: Record<string, SideValue> = {};
  for (const [legacyKey, canonicalKey] of Object.entries(STAT_KEY_MAP)) {
    const side = sideValueFromRecord(statsCompact[legacyKey]);
    if (side) values[canonicalKey] = side;
  }
  const populated = keepPopulatedStats(values);
  return {
    available: Object.keys(populated).length > 0,
    populatedPairs: Object.values(populated)
      .reduce((count, value) => count + (value.home != null ? 1 : 0) + (value.away != null ? 1 : 0), 0),
    keys: Object.keys(populated).sort(),
    values: populated,
    provider: null,
  };
}

function fusionStatisticsView(stats: CanonicalTeamStatistics | null, provider: string | null): ProviderFusionReadView['statistics'] {
  const values: Record<string, SideValue> = {};
  for (const key of Object.values(STAT_KEY_MAP)) {
    const side = sideValueFromRecord(stats?.[key]);
    if (side) values[key] = side;
  }
  const populated = keepPopulatedStats(values);
  return {
    available: Object.keys(populated).length > 0,
    populatedPairs: Object.values(populated)
      .reduce((count, value) => count + (value.home != null ? 1 : 0) + (value.away != null ? 1 : 0), 0),
    keys: Object.keys(populated).sort(),
    values: populated,
    provider,
  };
}

function eventMinute(value: unknown): number | null {
  const minute = numberOrNull(value);
  return minute == null ? null : Math.max(0, Math.floor(minute));
}

function legacyEventType(value: unknown): string {
  const text = cleanString(value).toLowerCase();
  if (text === 'subst' || text.includes('substitution')) return 'substitution';
  if (text.includes('goal')) return 'goal';
  if (text.includes('card')) return 'card';
  return text || 'other';
}

function eventSummary(events: Array<Record<string, unknown>>, provider: string | null): ProviderFusionReadView['events'] {
  const minutes = events.map((event) => eventMinute(event['minute'])).filter((value): value is number => value != null);
  const types = events.map((event) => legacyEventType(event['type']));
  return {
    count: events.length,
    goalCount: types.filter((type) => type === 'goal').length,
    cardCount: types.filter((type) => type === 'card').length,
    substitutionCount: types.filter((type) => type === 'substitution').length,
    lastMinute: minutes.length > 0 ? Math.max(...minutes) : null,
    provider,
  };
}

function fusionEventSummary(events: CanonicalMatchEvent[], provider: string | null): ProviderFusionReadView['events'] {
  return eventSummary(events.map((event) => ({
    minute: event.minute,
    type: event.type,
  })), provider);
}

function countPriceSlots(value: unknown, keyHint = ''): number {
  if (typeof value === 'number') {
    return keyHint === 'line' || !Number.isFinite(value) || value <= 1 ? 0 : 1;
  }
  if (Array.isArray(value)) {
    return value.reduce((count, item) => count + countPriceSlots(item), 0);
  }
  const record = asRecord(value);
  if (!record) return 0;
  return Object.entries(record)
    .reduce((count, [key, item]) => count + countPriceSlots(item, key), 0);
}

function collectLegacyLineKeys(value: unknown, marketKey: string): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((row) => collectLegacyLineKeys(row, marketKey));
  }
  const record = asRecord(value);
  if (!record) return [];
  const result: string[] = [];
  const line = numberOrNull(record['line']);
  if (line != null) result.push(`${marketFamilyFromPipelineKey(marketKey)}:${line}`);
  for (const item of Object.values(record)) {
    if (Array.isArray(item)) {
      for (const row of item) result.push(...collectLegacyLineKeys(row, marketKey));
    }
  }
  return result;
}

function marketFamilyFromPipelineKey(key: string): string {
  const text = key.toLowerCase();
  if (text.includes('corner')) return 'corners_ou';
  if (text.includes('1x2')) return '1x2';
  if (text.includes('btts')) return 'btts';
  if (text.includes('ah')) return 'asian_handicap';
  if (text.includes('ou')) return 'goals_ou';
  return text;
}

function marketFamilyFromSelection(market: string, selection: string): string {
  const text = `${market} ${selection}`.toLowerCase();
  if (text.includes('corner')) return 'corners_ou';
  if (text.includes('asian handicap')) return 'asian_handicap';
  if (text.includes('both teams') || text.includes('btts')) return 'btts';
  if (text.includes('match winner') || text.includes('fulltime result') || text.includes('full time result') || text.includes('1x2')) return '1x2';
  if (text.includes('over/under') || text.includes('over / under') || text.includes('total goals') || /\b(over|under)\b/.test(text)) return 'goals_ou';
  return cleanString(market).toLowerCase().replace(/[^a-z0-9]+/g, '_') || 'unknown';
}

function legacyOddsView(oddsCanonical: Record<string, unknown>, source: string): ProviderFusionReadView['odds'] {
  const marketKeys = Object.keys(oddsCanonical).sort();
  const marketFamilies = uniqueSorted(marketKeys.map(marketFamilyFromPipelineKey));
  return {
    available: countPriceSlots(oddsCanonical) > 0 && marketKeys.length > 0,
    source,
    marketFamilies,
    marketKeys,
    lineKeys: uniqueSorted(marketKeys.flatMap((key) => collectLegacyLineKeys(oddsCanonical[key], key))),
    selectionCount: countPriceSlots(oddsCanonical),
  };
}

function fusionOddsView(odds: CanonicalOddsSnapshot | null, source: string): ProviderFusionReadView['odds'] {
  const selections = odds?.selections ?? [];
  const liveSelections = selections.filter((selection) => selection.kind === 'live' && !selection.suspended && selection.price > 1);
  const families = liveSelections.map((selection) => marketFamilyFromSelection(selection.market, selection.selection));
  return {
    available: liveSelections.length > 0,
    source,
    marketFamilies: uniqueSorted(families),
    marketKeys: uniqueSorted(selections.map((selection) => selection.market)),
    lineKeys: uniqueSorted(liveSelections.map((selection) => `${marketFamilyFromSelection(selection.market, selection.selection)}:${selection.line ?? 'none'}`)),
    selectionCount: liveSelections.length,
  };
}

function scoreText(home: number | null | undefined, away: number | null | undefined): string {
  return `${home ?? 0}-${away ?? 0}`;
}

function mapFusionEvidenceMode(mode: ProviderFusionEvidenceMode): LiveAnalysisEvidenceMode {
  switch (mode) {
    case 'full_live_data':
    case 'stats_only':
    case 'odds_events_only_degraded':
    case 'events_only_degraded':
    case 'low_evidence':
      return mode;
    case 'odds_events_only':
      return 'odds_events_only_degraded';
    case 'none':
      return 'low_evidence';
    /* v8 ignore next 4 -- exhaustive guard for future enum additions */
    default: {
      const exhaustive: never = mode;
      return exhaustive;
    }
  }
}

function buildLegacyRead(input: ProviderFusionPipelineReadInput): ProviderFusionReadView {
  const stats = legacyStatisticsView(input.statsCompact);
  const events = eventSummary(input.eventsCompact, normalizeProvider(input.eventsProvider));
  const odds = legacyOddsView(input.oddsCanonical, input.oddsSource);
  return {
    score: {
      status: cleanString(input.fixture.status.short || input.fixture.status.long),
      minute: numberOrNull(input.fixture.status.minute),
      text: input.fixture.score.text,
    },
    statistics: {
      ...stats,
      provider: normalizeProvider(input.statisticsProvider),
    },
    events,
    odds,
    evidenceMode: classifyLiveEvidence({
      statsAvailable: stats.available,
      oddsAvailable: odds.available,
      eventCount: events.count,
    }).evidenceMode,
  };
}

function buildFusionRead(
  snapshot: ReturnType<typeof buildLiveProviderFusionSnapshot>,
): ProviderFusionReadView {
  const score = snapshot.canonical.scoreClock;
  const statsProvider = snapshot.fieldSources.statistics.provider;
  const eventsProvider = snapshot.fieldSources.events.provider;
  const oddsProvider = snapshot.fieldSources.odds.provider;
  return {
    score: {
      status: cleanString(score?.status),
      minute: score?.minute ?? null,
      text: scoreText(score?.score.home, score?.score.away),
    },
    statistics: fusionStatisticsView(snapshot.canonical.statistics, statsProvider),
    events: fusionEventSummary(snapshot.canonical.events, eventsProvider),
    odds: fusionOddsView(snapshot.canonical.odds, oddsProvider ?? 'none'),
    evidenceMode: mapFusionEvidenceMode(snapshot.evidenceMode),
  };
}

function sameJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function fieldDiff<T>(legacy: T, fusion: T): ProviderFusionFieldDiff<T> {
  return {
    changed: !sameJson(legacy, fusion),
    legacy,
    fusion,
  };
}

function compareMoneyGuard(input: {
  legacyRead: ProviderFusionReadView;
  fusionRead: ProviderFusionReadView;
  snapshot: ReturnType<typeof buildLiveProviderFusionSnapshot>;
  promptEquivalent: boolean;
  promotionEnabled: boolean;
}): ProviderFusionMoneyGuardDiff {
  const legacyCanSaveRecommendation = input.legacyRead.evidenceMode === 'full_live_data' && input.legacyRead.odds.available;
  const fusionCanSaveRecommendation = input.snapshot.moneyGuard.canSaveRecommendation;
  const hardBlockReasons = new Set<string>(input.snapshot.moneyGuard.hardBlockReasons);
  if (!input.promotionEnabled) hardBlockReasons.add('promotion_disabled');
  if (!legacyCanSaveRecommendation) hardBlockReasons.add('legacy_money_guard_blocked');
  if (!fusionCanSaveRecommendation) hardBlockReasons.add('fusion_money_guard_blocked');
  if (legacyCanSaveRecommendation !== fusionCanSaveRecommendation) hardBlockReasons.add('money_guard_mismatch');
  if (!input.promptEquivalent) hardBlockReasons.add('prompt_relevant_diff');

  return {
    promotionEnabled: input.promotionEnabled,
    legacyCanSaveRecommendation,
    fusionCanSaveRecommendation,
    canPromoteWithoutBehaviorChange: input.promotionEnabled
      && legacyCanSaveRecommendation
      && fusionCanSaveRecommendation
      && input.promptEquivalent,
    hardBlockReasons: [...hardBlockReasons].sort(),
    softWarnings: uniqueSorted([
      ...input.snapshot.moneyGuard.softWarnings,
      ...input.snapshot.warnings,
    ]),
  };
}

function buildDiff(input: {
  legacyRead: ProviderFusionReadView;
  fusionRead: ProviderFusionReadView;
  snapshot: ReturnType<typeof buildLiveProviderFusionSnapshot>;
  promotionEnabled: boolean;
}): ProviderFusionPipelineDiff {
  const fields = {
    score: fieldDiff(input.legacyRead.score.text, input.fusionRead.score.text),
    minute: fieldDiff(input.legacyRead.score.minute, input.fusionRead.score.minute),
    status: fieldDiff(input.legacyRead.score.status, input.fusionRead.score.status),
    statistics: fieldDiff(input.legacyRead.statistics.values, input.fusionRead.statistics.values),
    events: fieldDiff(
      {
        count: input.legacyRead.events.count,
        goalCount: input.legacyRead.events.goalCount,
        cardCount: input.legacyRead.events.cardCount,
        substitutionCount: input.legacyRead.events.substitutionCount,
        lastMinute: input.legacyRead.events.lastMinute,
      },
      {
        count: input.fusionRead.events.count,
        goalCount: input.fusionRead.events.goalCount,
        cardCount: input.fusionRead.events.cardCount,
        substitutionCount: input.fusionRead.events.substitutionCount,
        lastMinute: input.fusionRead.events.lastMinute,
      },
    ),
    odds: fieldDiff(
      {
        available: input.legacyRead.odds.available,
        marketFamilies: input.legacyRead.odds.marketFamilies,
      },
      {
        available: input.fusionRead.odds.available,
        marketFamilies: input.fusionRead.odds.marketFamilies,
      },
    ),
    evidenceMode: fieldDiff(input.legacyRead.evidenceMode, input.fusionRead.evidenceMode),
  };
  const changedFields = Object.entries(fields)
    .filter(([, diff]) => diff.changed)
    .map(([key]) => key)
    .sort();
  const promptEquivalent = changedFields.length === 0;
  const moneyGuard = compareMoneyGuard({
    legacyRead: input.legacyRead,
    fusionRead: input.fusionRead,
    snapshot: input.snapshot,
    promptEquivalent,
    promotionEnabled: input.promotionEnabled,
  });
  return {
    changed: changedFields.length > 0 || moneyGuard.hardBlockReasons.length > 0,
    promptEquivalent,
    changedFields,
    fields,
    moneyGuard,
  };
}

function compactReadView(read: ProviderFusionReadView): Record<string, unknown> {
  return {
    score: read.score,
    statistics: {
      available: read.statistics.available,
      populatedPairs: read.statistics.populatedPairs,
      keys: read.statistics.keys,
      provider: read.statistics.provider,
    },
    events: read.events,
    odds: read.odds,
    evidenceMode: read.evidenceMode,
  };
}

export function shouldBuildProviderFusionShadow(
  flags: ProviderFusionPipelineFlags,
  runtime: { shadowMode?: boolean } = {},
): boolean {
  return flags.providerFusionEnabled === true
    && flags.providerFusionShadowEnabled === true
    && runtime.shadowMode !== true;
}

export function buildProviderFusionPipelineRead(
  input: ProviderFusionPipelineReadInput,
): ProviderFusionPipelineReadResult {
  const generatedAt = input.generatedAt ?? new Date().toISOString();
  const snapshot = buildLiveProviderFusionSnapshot({
    matchId: input.matchId,
    generatedAt,
    providers: input.providerSources,
    primaryProvider: API_FOOTBALL_PROVIDER,
  });
  const legacyRead = buildLegacyRead(input);
  const fusionRead = buildFusionRead(snapshot);
  const diff = buildDiff({
    legacyRead,
    fusionRead,
    snapshot,
    promotionEnabled: input.promotionEnabled === true,
  });
  const audit = {
    contract: 'provider-fusion-phase-6-shadow-parity',
    promotionEnabled: input.promotionEnabled === true,
    promptEquivalent: diff.promptEquivalent,
    changedFields: diff.changedFields,
    legacy: compactReadView(legacyRead),
    fusion: compactReadView(fusionRead),
    diff,
    snapshot: compactFusionSnapshotForAudit(snapshot),
  };
  return {
    snapshot,
    legacyRead,
    fusionRead,
    diff,
    audit,
  };
}
