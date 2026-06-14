import {
  buildProviderFieldSource,
  type CanonicalFixtureIdentity,
  type CanonicalMatchEvent,
  type CanonicalOddsSnapshot,
  type CanonicalScoreClock,
  type CanonicalTeamStatistics,
  type LiveProviderFusionSnapshot,
  type ProviderConsensus,
  type ProviderEnvelope,
  type ProviderFieldSource,
  type ProviderFusionEvidenceMode,
  type ProviderHealth,
  type ProviderId,
  type ProviderMappingConfidence,
  type ProviderMoneyGuard,
  type ProviderQuotaState,
  type ProviderReliability,
} from './canonical/provider-domain.js';

export interface ProviderFusionSourceEnvelopes {
  fixture?: ProviderEnvelope<CanonicalFixtureIdentity> | null;
  scoreClock?: ProviderEnvelope<CanonicalScoreClock> | null;
  events?: ProviderEnvelope<CanonicalMatchEvent[]> | null;
  statistics?: ProviderEnvelope<CanonicalTeamStatistics> | null;
  odds?: ProviderEnvelope<CanonicalOddsSnapshot> | null;
}

export interface BuildLiveProviderFusionSnapshotInput {
  matchId: string | number;
  generatedAt?: string;
  providers: ProviderFusionSourceEnvelopes[];
  primaryProvider?: ProviderId;
  warnings?: unknown[];
}

type RoleKey = keyof ProviderFusionSourceEnvelopes;

interface Candidate<T> {
  envelope: ProviderEnvelope<T>;
  confidence: ProviderMappingConfidence;
  usable: boolean;
  itemCount: number;
}

const ROLE_KEYS: RoleKey[] = ['fixture', 'scoreClock', 'events', 'statistics', 'odds'];
const QUOTA_SEVERITY: Record<ProviderQuotaState, number> = {
  ok: 0,
  elevated: 1,
  unknown: 1,
  high: 2,
  critical: 3,
  hourly_limit: 4,
  daily_limit: 5,
};
const PRIMARY_PROVIDER = 'api-football';

function cleanString(value: unknown): string {
  return value == null ? '' : String(value).trim();
}

function stringArray(value: unknown[] | undefined): string[] {
  return (value ?? []).map((item) => cleanString(item)).filter(Boolean);
}

function isoOrNow(value: unknown): string {
  const text = cleanString(value);
  return text || new Date().toISOString();
}

function asProviderId(value: string): ProviderId {
  return value as ProviderId;
}

function isMoneyEligibleConfidence(confidence: ProviderMappingConfidence): boolean {
  return confidence === 'verified' || confidence === 'high';
}

function fixtureConfidence(envelope: ProviderEnvelope<CanonicalFixtureIdentity> | null | undefined): ProviderMappingConfidence {
  return envelope?.normalized?.mappingConfidence ?? 'unknown';
}

function confidenceByProvider(providers: ProviderFusionSourceEnvelopes[]): Map<string, ProviderMappingConfidence> {
  const result = new Map<string, ProviderMappingConfidence>();
  for (const source of providers) {
    if (source.fixture?.provider) {
      result.set(source.fixture.provider, fixtureConfidence(source.fixture));
    }
  }
  return result;
}

function envelopeConfidence<T>(
  envelope: ProviderEnvelope<T>,
  confidences: Map<string, ProviderMappingConfidence>,
): ProviderMappingConfidence {
  if (envelope.provider === PRIMARY_PROVIDER) return 'verified';
  return confidences.get(envelope.provider) ?? 'unknown';
}

function allEnvelopes(providers: ProviderFusionSourceEnvelopes[]): ProviderEnvelope<unknown>[] {
  const result: ProviderEnvelope<unknown>[] = [];
  for (const source of providers) {
    for (const key of ROLE_KEYS) {
      const envelope = source[key];
      if (envelope) result.push(envelope as ProviderEnvelope<unknown>);
    }
  }
  return result;
}

function candidatesFor<T>(
  providers: ProviderFusionSourceEnvelopes[],
  key: RoleKey,
  confidences: Map<string, ProviderMappingConfidence>,
  usable: (normalized: NonNullable<T>) => boolean = () => true,
): Candidate<T>[] {
  const result: Candidate<T>[] = [];
  for (const source of providers) {
    const envelope = source[key] as ProviderEnvelope<T> | null | undefined;
    const confidence = envelope ? envelopeConfidence(envelope, confidences) : 'unknown';
    const normalized = envelope?.normalized;
    result.push({
      envelope: envelope as ProviderEnvelope<T>,
      confidence,
      usable: Boolean(
        envelope
        && envelope.success
        && envelope.freshness !== 'missing'
        && normalized != null
        && (envelope.provider === PRIMARY_PROVIDER || isMoneyEligibleConfidence(confidence))
        && usable(normalized as NonNullable<T>),
      ),
      itemCount: envelope?.coverage.itemCount ?? 0,
    });
  }
  return result.filter((candidate) => candidate.envelope);
}

function selectPrimaryFirst<T>(
  candidates: Candidate<T>[],
  primaryProvider: ProviderId,
): Candidate<T> | null {
  return candidates.find((candidate) => candidate.usable && candidate.envelope.provider === primaryProvider)
    ?? candidates.find((candidate) => candidate.usable)
    ?? null;
}

function selectHighestCoverage<T>(
  candidates: Candidate<T>[],
  primaryProvider: ProviderId,
): Candidate<T> | null {
  const usable = candidates.filter((candidate) => candidate.usable);
  if (usable.length === 0) return null;
  return usable.sort((left, right) => {
    if (left.itemCount !== right.itemCount) return right.itemCount - left.itemCount;
    if (left.envelope.provider === primaryProvider) return -1;
    if (right.envelope.provider === primaryProvider) return 1;
    return left.envelope.provider.localeCompare(right.envelope.provider);
  })[0] ?? null;
}

function hasStatsData(stats: CanonicalTeamStatistics): boolean {
  return Object.entries(stats)
    .filter(([key]) => key !== 'rawTypeMap')
    .some(([, value]) => {
      const side = value as { home?: unknown; away?: unknown } | undefined;
      return side?.home != null || side?.away != null;
    });
}

function hasLiveOdds(odds: CanonicalOddsSnapshot): boolean {
  return odds.sourceKind === 'live'
    && odds.selections.some((selection) => selection.kind === 'live' && !selection.suspended && selection.price > 1);
}

function sourceForCandidate<T>(candidate: Candidate<T> | null, notes: string[] = []): ProviderFieldSource {
  if (!candidate) {
    return buildProviderFieldSource({
      fetched: false,
      itemCount: 0,
      confidence: 'unknown',
      notes,
    });
  }
  return buildProviderFieldSource({
    provider: candidate.envelope.provider,
    providerFixtureId: candidate.envelope.providerFixtureId,
    fetchedAt: candidate.envelope.fetchedAt,
    fetched: candidate.envelope.success,
    itemCount: candidate.envelope.coverage.itemCount,
    confidence: candidate.confidence,
    notes: [...candidate.envelope.warnings, ...notes],
  });
}

function providerHealth(envelopes: ProviderEnvelope<unknown>[]): ProviderHealth[] {
  const grouped = new Map<string, ProviderEnvelope<unknown>[]>();
  for (const envelope of envelopes) {
    const rows = grouped.get(envelope.provider) ?? [];
    rows.push(envelope);
    grouped.set(envelope.provider, rows);
  }

  return [...grouped.entries()].map(([provider, rows]) => {
    const warnings = rows.flatMap((row) => [
      ...row.warnings,
      ...row.coverage.warnings,
      ...(row.error ? [row.error] : []),
      ...(QUOTA_SEVERITY[row.quota] >= QUOTA_SEVERITY.high ? [`${provider}_quota_${row.quota}`] : []),
    ]);
    const reachable = rows.some((row) => row.success);
    const reliability: ProviderReliability = !reachable
      ? 'bad'
      : warnings.length > 0
        ? 'degraded'
        : 'good';
    return {
      provider: asProviderId(provider),
      roles: [...new Set(rows.map((row) => row.role))],
      reachable,
      lastFetchedAt: rows.map((row) => row.fetchedAt).sort().at(-1) ?? null,
      statusCode: [...rows].reverse().find((row) => row.statusCode != null)?.statusCode ?? null,
      quotaState: rows.map((row) => row.quota).sort((left, right) => QUOTA_SEVERITY[right] - QUOTA_SEVERITY[left])[0]!,
      latencyMs: rows.find((row) => row.latencyMs != null)?.latencyMs ?? null,
      reliability,
      warnings: [...new Set(warnings)],
    };
  });
}

function scoreKey(clock: CanonicalScoreClock | null): string | null {
  if (clock?.score.home == null || clock.score.away == null) return null;
  return `${clock.score.home}-${clock.score.away}`;
}

function scoreAgreement(scoreCandidates: Candidate<CanonicalScoreClock>[]): ProviderConsensus['scoreAgreement'] {
  const scores = scoreCandidates
    .filter((candidate) => candidate.envelope.success && candidate.envelope.normalized)
    .map((candidate) => scoreKey(candidate.envelope.normalized))
    .filter((key): key is string => Boolean(key));
  if (scores.length === 0) return 'unknown';
  if (scores.length === 1) return 'single_source';
  return new Set(scores).size === 1 ? 'agree' : 'conflict';
}

function minuteAgreement(scoreCandidates: Candidate<CanonicalScoreClock>[]): ProviderConsensus['minuteAgreement'] {
  const minutes = scoreCandidates
    .filter((candidate) => candidate.envelope.success && candidate.envelope.normalized?.minute != null)
    .map((candidate) => candidate.envelope.normalized!.minute!);
  if (minutes.length === 0) return 'unknown';
  if (minutes.length === 1) return 'single_source';
  const maxDiff = Math.max(...minutes) - Math.min(...minutes);
  if (maxDiff <= 2) return 'agree';
  if (maxDiff <= 8) return 'lag_detected';
  return 'conflict';
}

function goalCount(events: CanonicalMatchEvent[]): number {
  return events.filter((event) => event.type === 'goal' || event.type === 'penalty').length;
}

function eventAgreement(eventCandidates: Candidate<CanonicalMatchEvent[]>[]): ProviderConsensus['eventAgreement'] {
  const eventRows = eventCandidates
    .filter((candidate) => candidate.envelope.success && Array.isArray(candidate.envelope.normalized) && candidate.envelope.normalized.length > 0)
    .map((candidate) => candidate.envelope.normalized!);
  if (eventRows.length === 0) return 'unknown';
  if (eventRows.length === 1) return 'single_source';
  const goalCounts = new Set(eventRows.map(goalCount));
  return goalCounts.size === 1 ? 'agree' : 'partial';
}

function statEntries(stats: CanonicalTeamStatistics): Map<string, string> {
  const entries = new Map<string, string>();
  for (const [key, value] of Object.entries(stats)) {
    if (key === 'rawTypeMap') continue;
    const side = value as { home?: unknown; away?: unknown };
    if (side.home != null) entries.set(`${key}:home`, String(side.home));
    if (side.away != null) entries.set(`${key}:away`, String(side.away));
  }
  return entries;
}

function statsAgreement(statsCandidates: Candidate<CanonicalTeamStatistics>[]): ProviderConsensus['statsAgreement'] {
  const rows = statsCandidates
    .filter((candidate) => candidate.envelope.success && candidate.envelope.normalized && hasStatsData(candidate.envelope.normalized))
    .map((candidate) => statEntries(candidate.envelope.normalized!));
  if (rows.length === 0) return 'missing';
  if (rows.length === 1) return 'single_source';
  let overlap = 0;
  for (const [key, value] of rows[0]!) {
    if (rows.slice(1).some((row) => row.has(key))) {
      overlap += 1;
      if (rows.slice(1).some((row) => row.get(key) !== value)) return 'conflict';
    }
  }
  return overlap > 0 ? 'agree' : 'unknown';
}

function oddsAgreement(oddsCandidates: Candidate<CanonicalOddsSnapshot>[]): ProviderConsensus['oddsAgreement'] {
  const rows = oddsCandidates.filter((candidate) => candidate.envelope.success && candidate.envelope.normalized && hasLiveOdds(candidate.envelope.normalized));
  if (rows.length === 0) return 'missing';
  if (rows.length === 1) return 'single_source';
  const first = rows[0]!.envelope.normalized!.selections[0];
  const sameFirstMarket = rows.slice(1).some((row) => row.envelope.normalized!.selections.some((selection) => (
    selection.market === first?.market && selection.selection === first.selection && selection.line === first.line
  )));
  return sameFirstMarket ? 'agree' : 'conflict';
}

function buildConsensus(input: {
  scoreCandidates: Candidate<CanonicalScoreClock>[];
  eventCandidates: Candidate<CanonicalMatchEvent[]>[];
  statsCandidates: Candidate<CanonicalTeamStatistics>[];
  oddsCandidates: Candidate<CanonicalOddsSnapshot>[];
}): ProviderConsensus {
  return {
    scoreAgreement: scoreAgreement(input.scoreCandidates),
    minuteAgreement: minuteAgreement(input.scoreCandidates),
    eventAgreement: eventAgreement(input.eventCandidates),
    statsAgreement: statsAgreement(input.statsCandidates),
    oddsAgreement: oddsAgreement(input.oddsCandidates),
  };
}

function evidenceMode(input: {
  scoreSelected: Candidate<CanonicalScoreClock> | null;
  eventsSelected: Candidate<CanonicalMatchEvent[]> | null;
  statsSelected: Candidate<CanonicalTeamStatistics> | null;
  oddsSelected: Candidate<CanonicalOddsSnapshot> | null;
  hardBlocks: string[];
}): ProviderFusionEvidenceMode {
  if (input.hardBlocks.includes('score_conflict')
    || input.hardBlocks.includes('minute_conflict')) {
    return 'low_evidence';
  }
  const hasScore = Boolean(input.scoreSelected?.envelope.normalized);
  const hasEvents = Boolean(input.eventsSelected?.envelope.normalized?.length);
  const hasStats = Boolean(input.statsSelected?.envelope.normalized && hasStatsData(input.statsSelected.envelope.normalized));
  const hasOdds = Boolean(input.oddsSelected?.envelope.normalized && hasLiveOdds(input.oddsSelected.envelope.normalized));
  if (!hasScore) return 'none';
  if (hasOdds && hasEvents && hasStats) return 'full_live_data';
  if (hasOdds && hasEvents) return 'odds_events_only';
  if (hasStats) return 'stats_only';
  if (hasEvents) return 'events_only_degraded';
  return 'low_evidence';
}

function moneyGuard(mode: ProviderFusionEvidenceMode, hardBlocks: string[], warnings: string[]): ProviderMoneyGuard {
  const hardBlockReasons = [...new Set(hardBlocks)];
  const canUseForMoneyDecision = mode === 'full_live_data' && hardBlockReasons.length === 0;
  return {
    canUseForMoneyDecision,
    canSaveRecommendation: canUseForMoneyDecision,
    canPushStatsOnlySignal: mode === 'stats_only' && !hardBlockReasons.includes('score_conflict') && !hardBlockReasons.includes('minute_conflict'),
    hardBlockReasons,
    softWarnings: [...new Set(warnings)],
  };
}

function collectWarnings(envelopes: ProviderEnvelope<unknown>[], extra: unknown[] | undefined): string[] {
  const warnings = [
    ...stringArray(extra),
    ...envelopes.flatMap((envelope) => envelope.warnings),
    ...envelopes.flatMap((envelope) => envelope.coverage.warnings),
    ...envelopes.filter((envelope) => envelope.error).map((envelope) => envelope.error),
    ...envelopes.flatMap((envelope) => QUOTA_SEVERITY[envelope.quota] >= QUOTA_SEVERITY.high ? [`${envelope.provider}_quota_${envelope.quota}`] : []),
  ];
  return [...new Set(warnings.filter(Boolean))];
}

export function buildLiveProviderFusionSnapshot(input: BuildLiveProviderFusionSnapshotInput): LiveProviderFusionSnapshot {
  const primaryProvider = input.primaryProvider ?? PRIMARY_PROVIDER;
  const matchId = cleanString(input.matchId);
  const generatedAt = isoOrNow(input.generatedAt);
  const confidences = confidenceByProvider(input.providers);

  const fixtureCandidates = candidatesFor<CanonicalFixtureIdentity>(input.providers, 'fixture', confidences);
  const scoreCandidates = candidatesFor<CanonicalScoreClock>(input.providers, 'scoreClock', confidences);
  const eventCandidates = candidatesFor<CanonicalMatchEvent[]>(input.providers, 'events', confidences, (events) => events.length > 0);
  const statsCandidates = candidatesFor<CanonicalTeamStatistics>(input.providers, 'statistics', confidences, hasStatsData);
  const oddsCandidates = candidatesFor<CanonicalOddsSnapshot>(input.providers, 'odds', confidences, hasLiveOdds);

  const fixtureSelected = selectPrimaryFirst(fixtureCandidates, primaryProvider);
  const scoreSelected = selectPrimaryFirst(scoreCandidates, primaryProvider);
  const eventsSelected = selectHighestCoverage(eventCandidates, primaryProvider);
  const statsSelected = selectHighestCoverage(statsCandidates, primaryProvider);
  const oddsSelected = selectPrimaryFirst(oddsCandidates, primaryProvider);

  const consensus = buildConsensus({
    scoreCandidates,
    eventCandidates,
    statsCandidates,
    oddsCandidates,
  });
  const hardBlocks: string[] = [];
  if (consensus.scoreAgreement === 'conflict') hardBlocks.push('score_conflict');
  if (consensus.minuteAgreement === 'conflict') hardBlocks.push('minute_conflict');
  if (!oddsSelected) hardBlocks.push('no_live_odds');

  const fieldSources = {
    fixture: sourceForCandidate(fixtureSelected),
    scoreClock: sourceForCandidate(scoreSelected),
    events: sourceForCandidate(eventsSelected),
    statistics: sourceForCandidate(statsSelected),
    odds: sourceForCandidate(oddsSelected, oddsSelected ? [] : ['no_live_odds']),
  };

  const envelopes = allEnvelopes(input.providers);
  const warnings = collectWarnings(envelopes, input.warnings);
  const mode = evidenceMode({
    scoreSelected,
    eventsSelected,
    statsSelected,
    oddsSelected,
    hardBlocks,
  });

  return {
    matchId,
    generatedAt,
    canonical: {
      fixture: fixtureSelected?.envelope.normalized ?? null,
      scoreClock: scoreSelected?.envelope.normalized ?? null,
      events: eventsSelected?.envelope.normalized ?? [],
      statistics: statsSelected?.envelope.normalized ?? null,
      odds: oddsSelected?.envelope.normalized ?? null,
    },
    fieldSources,
    providerHealth: providerHealth(envelopes),
    consensus,
    evidenceMode: mode,
    warnings,
    moneyGuard: moneyGuard(mode, hardBlocks, warnings),
  };
}

export function compactFusionSnapshotForAudit(snapshot: LiveProviderFusionSnapshot): Record<string, unknown> {
  return {
    matchId: snapshot.matchId,
    generatedAt: snapshot.generatedAt,
    evidenceMode: snapshot.evidenceMode,
    fieldSources: snapshot.fieldSources,
    consensus: snapshot.consensus,
    moneyGuard: snapshot.moneyGuard,
    providerHealth: snapshot.providerHealth,
    warnings: snapshot.warnings,
    canonicalCounts: {
      events: snapshot.canonical.events.length,
      statistics: snapshot.canonical.statistics ? Object.keys(snapshot.canonical.statistics).length : 0,
      odds: snapshot.canonical.odds?.selections.length ?? 0,
    },
  };
}
