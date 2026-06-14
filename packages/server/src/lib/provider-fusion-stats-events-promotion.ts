import type {
  CanonicalMatchEvent,
  CanonicalTeamStatistics,
  LiveProviderFusionSnapshot,
  ProviderFieldSource,
} from './canonical/provider-domain.js';
import type { ProviderFusionPipelineReadResult } from './provider-fusion-pipeline-read.js';

type StatsSource = 'api-football' | 'sportmonks' | 'api-football+sportmonks';

type PromptSideValue = { home: string | null; away: string | null };

export interface ProviderFusionStatsCompact {
  possession: PromptSideValue;
  shots: PromptSideValue;
  shots_on_target: PromptSideValue;
  corners: PromptSideValue;
  fouls: PromptSideValue;
  offsides: PromptSideValue;
  yellow_cards: PromptSideValue;
  red_cards: PromptSideValue;
  goalkeeper_saves: PromptSideValue;
  blocked_shots: PromptSideValue;
  total_passes: PromptSideValue;
  passes_accurate: PromptSideValue;
  shots_off_target?: PromptSideValue;
  shots_inside_box?: PromptSideValue;
  shots_outside_box?: PromptSideValue;
  expected_goals?: PromptSideValue;
  goals_prevented?: PromptSideValue;
  passes_percent?: PromptSideValue;
}

export interface ProviderFusionEventCompact {
  minute: number;
  extra: number | null;
  team: string;
  type: string;
  detail: string;
  player: string;
}

export interface ProviderFusionStatsEventsPromotionFlags {
  providerFusionEnabled?: boolean;
  providerFusionStatsEventsPromotion?: boolean;
  providerFusionOddsPromotion?: boolean;
}

export interface ProviderFusionStatsEventsPromotionDecision {
  status: 'disabled' | 'blocked' | 'promoted';
  promoted: boolean;
  statsPromoted: boolean;
  eventsPromoted: boolean;
  statsCompact?: ProviderFusionStatsCompact;
  eventsCompact?: ProviderFusionEventCompact[];
  statsSource: StatsSource | null;
  statsFallbackReason: string;
  reasons: string[];
  blockedReasons: string[];
  audit: Record<string, unknown>;
}

interface RoleDecision {
  promoted: boolean;
  blockedReasons: string[];
  reason: string;
  source: Record<string, unknown>;
}

interface PromotionInput {
  enabled: boolean;
  read: ProviderFusionPipelineReadResult | null;
  homeName: string;
  awayName: string;
  apiFootballStatsPresent: boolean;
  apiFootballEventsPresent: boolean;
  oddsPromotionEnabled?: boolean;
}

const CONTRACT = 'provider-fusion-phase-7-stats-events-promotion';
const SPORTMONKS_PROVIDER = 'sportmonks';

function emptySide(): PromptSideValue {
  return { home: null, away: null };
}

function cleanString(value: unknown): string {
  return value == null ? '' : String(value).trim();
}

function formatStatValue(value: unknown, percent = false): string | null {
  const text = cleanString(value);
  if (!text) return null;
  return percent && !text.endsWith('%') ? `${text}%` : text;
}

function statSide(
  stats: CanonicalTeamStatistics | null,
  key: keyof Omit<CanonicalTeamStatistics, 'rawTypeMap'>,
  percent = false,
): PromptSideValue {
  const side = stats?.[key];
  return {
    home: formatStatValue(side?.home, percent),
    away: formatStatValue(side?.away, percent),
  };
}

export function canonicalStatisticsToStatsCompact(
  stats: CanonicalTeamStatistics | null,
): ProviderFusionStatsCompact {
  return {
    possession: statSide(stats, 'possessionPct', true),
    shots: statSide(stats, 'shotsTotal'),
    shots_on_target: statSide(stats, 'shotsOnTarget'),
    corners: statSide(stats, 'corners'),
    fouls: statSide(stats, 'fouls'),
    offsides: emptySide(),
    yellow_cards: statSide(stats, 'yellowCards'),
    red_cards: statSide(stats, 'redCards'),
    goalkeeper_saves: emptySide(),
    blocked_shots: emptySide(),
    total_passes: statSide(stats, 'passes'),
    passes_accurate: emptySide(),
    shots_off_target: emptySide(),
    shots_inside_box: emptySide(),
    shots_outside_box: emptySide(),
    expected_goals: statSide(stats, 'expectedGoals'),
    goals_prevented: emptySide(),
    passes_percent: emptySide(),
  };
}

function eventTypeToPrompt(event: CanonicalMatchEvent): string {
  if (event.type === 'substitution') return 'subst';
  if (event.type === 'goal' || event.type === 'penalty') return 'goal';
  if (event.type === 'card') return 'card';
  return event.type || 'other';
}

function eventTeamName(event: CanonicalMatchEvent, homeName: string, awayName: string): string {
  const named = cleanString(event.team?.name);
  if (named) return named;
  if (event.teamSide === 'home') return homeName;
  if (event.teamSide === 'away') return awayName;
  return '';
}

export function canonicalEventsToEventsCompact(
  events: CanonicalMatchEvent[],
  homeName: string,
  awayName: string,
): ProviderFusionEventCompact[] {
  return [...events]
    .sort((left, right) => (left.minute ?? 0) - (right.minute ?? 0))
    .map((event) => ({
      minute: event.minute ?? 0,
      extra: event.extra ?? null,
      team: eventTeamName(event, homeName, awayName),
      type: eventTypeToPrompt(event),
      detail: cleanString(event.detail),
      player: cleanString(event.playerName),
    }));
}

export function shouldEvaluateProviderFusionStatsEventsPromotion(
  flags: ProviderFusionStatsEventsPromotionFlags,
  runtime: { shadowMode?: boolean } = {},
): boolean {
  return flags.providerFusionEnabled === true
    && flags.providerFusionStatsEventsPromotion === true
    && runtime.shadowMode !== true;
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

function isTrustedSource(source: ProviderFieldSource): boolean {
  return source.confidence === 'high';
}

function isUsableCoverage(source: ProviderFieldSource): boolean {
  return source.coverage === 'complete' || source.coverage === 'partial';
}

function selectedSportmonksSource(source: ProviderFieldSource): boolean {
  return source.provider === SPORTMONKS_PROVIDER;
}

function evaluateRole(input: {
  role: 'statistics' | 'events';
  source: ProviderFieldSource;
  apiFootballPresent: boolean;
  hasFusionData: boolean;
}): RoleDecision {
  const blockedReasons: string[] = [];
  if (input.apiFootballPresent) blockedReasons.push(`api_football_${input.role}_present`);
  if (!selectedSportmonksSource(input.source)) blockedReasons.push(`no_sportmonks_${input.role}_selected`);
  if (selectedSportmonksSource(input.source) && !isTrustedSource(input.source)) {
    blockedReasons.push(`sportmonks_${input.role}_mapping_not_trusted`);
  }
  if (selectedSportmonksSource(input.source) && !isUsableCoverage(input.source)) {
    blockedReasons.push(`sportmonks_${input.role}_coverage_not_usable`);
  }
  if (!input.hasFusionData) blockedReasons.push(`no_fusion_${input.role}_data`);

  return {
    promoted: blockedReasons.length === 0,
    blockedReasons,
    reason: blockedReasons.length === 0
      ? `promote_sportmonks_${input.role}`
      : `blocked_${input.role}`,
    source: sourceAudit(input.source),
  };
}

function hasConflictBlock(snapshot: LiveProviderFusionSnapshot): string[] {
  const reasons: string[] = [];
  if (snapshot.consensus.scoreAgreement === 'conflict'
    || snapshot.moneyGuard.hardBlockReasons.includes('score_conflict')) {
    reasons.push('score_conflict');
  }
  if (snapshot.consensus.minuteAgreement === 'conflict'
    || snapshot.moneyGuard.hardBlockReasons.includes('minute_conflict')) {
    reasons.push('minute_conflict');
  }
  return [...new Set(reasons)];
}

function roleStatsSource(statsPromoted: boolean, eventsPromoted: boolean): StatsSource {
  return statsPromoted && eventsPromoted ? SPORTMONKS_PROVIDER : 'api-football+sportmonks';
}

function compactAuditPayload(input: {
  status: ProviderFusionStatsEventsPromotionDecision['status'];
  statsPromoted: boolean;
  eventsPromoted: boolean;
  statsSource: StatsSource | null;
  statsFallbackReason: string;
  reasons: string[];
  blockedReasons: string[];
  read: ProviderFusionPipelineReadResult | null;
  statsRole?: RoleDecision;
  eventsRole?: RoleDecision;
  oddsPromotionEnabled: boolean;
}): Record<string, unknown> {
  return {
    contract: CONTRACT,
    status: input.status,
    promoted: input.status === 'promoted',
    statsPromoted: input.statsPromoted,
    eventsPromoted: input.eventsPromoted,
    statsSource: input.statsSource,
    statsFallbackReason: input.statsFallbackReason,
    reasons: input.reasons,
    blockedReasons: input.blockedReasons,
    oddsPromotionEnabled: input.oddsPromotionEnabled,
    oddsPolicy: 'unchanged',
    savePolicyChanged: false,
    sourceRoles: {
      statistics: input.statsRole?.source ?? null,
      events: input.eventsRole?.source ?? null,
    },
    legacyRead: input.read ? {
      statisticsProvider: input.read.legacyRead.statistics.provider,
      statisticsAvailable: input.read.legacyRead.statistics.available,
      statisticsPopulatedPairs: input.read.legacyRead.statistics.populatedPairs,
      eventProvider: input.read.legacyRead.events.provider,
      eventCount: input.read.legacyRead.events.count,
    } : null,
    fusionRead: input.read ? {
      statisticsProvider: input.read.fusionRead.statistics.provider,
      statisticsAvailable: input.read.fusionRead.statistics.available,
      statisticsPopulatedPairs: input.read.fusionRead.statistics.populatedPairs,
      eventProvider: input.read.fusionRead.events.provider,
      eventCount: input.read.fusionRead.events.count,
      evidenceMode: input.read.fusionRead.evidenceMode,
    } : null,
    consensus: input.read?.snapshot.consensus ?? null,
    moneyGuard: input.read?.snapshot.moneyGuard ?? null,
  };
}

export function decideProviderFusionStatsEventsPromotion(
  input: PromotionInput,
): ProviderFusionStatsEventsPromotionDecision {
  if (!input.enabled) {
    const blockedReasons = ['stats_events_promotion_disabled'];
    return {
      status: 'disabled',
      promoted: false,
      statsPromoted: false,
      eventsPromoted: false,
      statsSource: null,
      statsFallbackReason: '',
      reasons: [],
      blockedReasons,
      audit: compactAuditPayload({
        status: 'disabled',
        statsPromoted: false,
        eventsPromoted: false,
        statsSource: null,
        statsFallbackReason: '',
        reasons: [],
        blockedReasons,
        read: input.read,
        oddsPromotionEnabled: input.oddsPromotionEnabled === true,
      }),
    };
  }

  if (!input.read) {
    const blockedReasons = ['provider_fusion_read_missing'];
    return {
      status: 'blocked',
      promoted: false,
      statsPromoted: false,
      eventsPromoted: false,
      statsSource: null,
      statsFallbackReason: '',
      reasons: [],
      blockedReasons,
      audit: compactAuditPayload({
        status: 'blocked',
        statsPromoted: false,
        eventsPromoted: false,
        statsSource: null,
        statsFallbackReason: '',
        reasons: [],
        blockedReasons,
        read: null,
        oddsPromotionEnabled: input.oddsPromotionEnabled === true,
      }),
    };
  }

  const conflictBlocks = hasConflictBlock(input.read.snapshot);
  if (conflictBlocks.length > 0) {
    return {
      status: 'blocked',
      promoted: false,
      statsPromoted: false,
      eventsPromoted: false,
      statsSource: null,
      statsFallbackReason: '',
      reasons: [],
      blockedReasons: conflictBlocks,
      audit: compactAuditPayload({
        status: 'blocked',
        statsPromoted: false,
        eventsPromoted: false,
        statsSource: null,
        statsFallbackReason: '',
        reasons: [],
        blockedReasons: conflictBlocks,
        read: input.read,
        oddsPromotionEnabled: input.oddsPromotionEnabled === true,
      }),
    };
  }

  const statsRole = evaluateRole({
    role: 'statistics',
    source: input.read.snapshot.fieldSources.statistics,
    apiFootballPresent: input.apiFootballStatsPresent,
    hasFusionData: input.read.fusionRead.statistics.available
      && input.read.snapshot.canonical.statistics != null,
  });
  const eventsRole = evaluateRole({
    role: 'events',
    source: input.read.snapshot.fieldSources.events,
    apiFootballPresent: input.apiFootballEventsPresent,
    hasFusionData: input.read.fusionRead.events.count > 0
      && input.read.snapshot.canonical.events.length > 0,
  });

  const statsPromoted = statsRole.promoted;
  const eventsPromoted = eventsRole.promoted;
  const promoted = statsPromoted || eventsPromoted;
  const blockedReasons = [...new Set([
    ...statsRole.blockedReasons,
    ...eventsRole.blockedReasons,
  ])].sort();
  const reasons = [
    statsPromoted ? statsRole.reason : null,
    eventsPromoted ? eventsRole.reason : null,
  ].filter((reason): reason is string => Boolean(reason));
  const statsSource = promoted ? roleStatsSource(statsPromoted, eventsPromoted) : null;
  const statsFallbackReason = promoted
    ? `provider_fusion_phase_7_${statsSource}`
    : '';
  const status: ProviderFusionStatsEventsPromotionDecision['status'] = promoted ? 'promoted' : 'blocked';
  const audit = compactAuditPayload({
    status,
    statsPromoted,
    eventsPromoted,
    statsSource,
    statsFallbackReason,
    reasons,
    blockedReasons: promoted ? blockedReasons : blockedReasons.length > 0 ? blockedReasons : ['no_promotable_stats_or_events'],
    read: input.read,
    statsRole,
    eventsRole,
    oddsPromotionEnabled: input.oddsPromotionEnabled === true,
  });

  return {
    status,
    promoted,
    statsPromoted,
    eventsPromoted,
    statsCompact: statsPromoted
      ? canonicalStatisticsToStatsCompact(input.read.snapshot.canonical.statistics)
      : undefined,
    eventsCompact: eventsPromoted
      ? canonicalEventsToEventsCompact(input.read.snapshot.canonical.events, input.homeName, input.awayName)
      : undefined,
    statsSource,
    statsFallbackReason,
    reasons,
    blockedReasons: promoted ? blockedReasons : (blockedReasons.length > 0 ? blockedReasons : ['no_promotable_stats_or_events']),
    audit,
  };
}
