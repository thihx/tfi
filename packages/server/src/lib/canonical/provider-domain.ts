export const PROVIDER_ROLES = [
  'fixture_identity',
  'fixture_score',
  'event_timeline',
  'fixture_statistics',
  'live_odds',
  'reference_odds',
  'lineups',
  'standings',
  'league_coverage',
  'xg',
  'predictions',
] as const;

export type ProviderRole = typeof PROVIDER_ROLES[number];
export type ProviderId = 'api-football' | 'sportmonks' | (string & {});

export const PROVIDER_QUOTA_STATES = [
  'ok',
  'elevated',
  'high',
  'critical',
  'daily_limit',
  'hourly_limit',
  'unknown',
] as const;

export type ProviderQuotaState = typeof PROVIDER_QUOTA_STATES[number];

export const PROVIDER_FRESHNESS_STATES = [
  'fresh',
  'stale',
  'missing',
  'conflicted',
  'unknown',
] as const;

export type ProviderFreshnessState = typeof PROVIDER_FRESHNESS_STATES[number];

export const PROVIDER_COVERAGE_LEVELS = [
  'complete',
  'partial',
  'empty',
  'missing',
  'unknown',
] as const;

export type ProviderCoverageLevel = typeof PROVIDER_COVERAGE_LEVELS[number];

export const PROVIDER_RELIABILITY_STATES = [
  'good',
  'degraded',
  'bad',
  'unknown',
] as const;

export type ProviderReliability = typeof PROVIDER_RELIABILITY_STATES[number];

export const PROVIDER_MAPPING_CONFIDENCES = [
  'verified',
  'high',
  'medium',
  'low',
  'unknown',
] as const;

export type ProviderMappingConfidence = typeof PROVIDER_MAPPING_CONFIDENCES[number];

export const CANONICAL_PERIODS = [
  'pre',
  '1h',
  'ht',
  '2h',
  'et',
  'pen',
  'ft',
  'unknown',
] as const;

export type CanonicalPeriod = typeof CANONICAL_PERIODS[number];

export const CANONICAL_TEAM_SIDES = ['home', 'away', 'unknown'] as const;
export type CanonicalTeamSide = typeof CANONICAL_TEAM_SIDES[number];

export const CANONICAL_EVENT_TYPES = [
  'goal',
  'card',
  'substitution',
  'penalty',
  'var',
  'period',
  'other',
] as const;

export type CanonicalEventType = typeof CANONICAL_EVENT_TYPES[number];

export const CANONICAL_ODDS_KINDS = [
  'live',
  'reference',
  'prematch',
  'unknown',
] as const;

export type CanonicalOddsKind = typeof CANONICAL_ODDS_KINDS[number];

export const PROVIDER_FUSION_EVIDENCE_MODES = [
  'full_live_data',
  'stats_only',
  'odds_events_only',
  'odds_events_only_degraded',
  'events_only_degraded',
  'low_evidence',
  'none',
] as const;

export type ProviderFusionEvidenceMode = typeof PROVIDER_FUSION_EVIDENCE_MODES[number];

export interface CanonicalLeagueRef {
  id: string | null;
  name: string;
  country: string | null;
  season: number | null;
  logo: string | null;
}

export interface CanonicalTeamRef {
  id: string | null;
  name: string;
  logo: string | null;
}

export interface CanonicalFixtureIdentity {
  matchId: string;
  providerFixtureIds: Record<string, string>;
  kickoffAtUtc: string | null;
  league: CanonicalLeagueRef;
  home: CanonicalTeamRef;
  away: CanonicalTeamRef;
  mappingConfidence: ProviderMappingConfidence;
}

export interface CanonicalScoreClock {
  status: string;
  minute: number | null;
  injuryTime: number | null;
  period: CanonicalPeriod;
  score: { home: number | null; away: number | null };
  wallClockMinuteEstimate: number | null;
  providerClockLagMinutes: number | null;
}

export interface CanonicalMatchEvent {
  minute: number | null;
  extra: number | null;
  teamSide: CanonicalTeamSide;
  team: CanonicalTeamRef | null;
  playerName: string | null;
  assistName: string | null;
  type: CanonicalEventType;
  detail: string;
  sourceEventId?: string | null;
}

export interface CanonicalSideValue<T = number | string | null> {
  home: T;
  away: T;
}

export interface CanonicalTeamStatistics {
  possessionPct?: CanonicalSideValue<number | null>;
  shotsTotal?: CanonicalSideValue<number | null>;
  shotsOnTarget?: CanonicalSideValue<number | null>;
  corners?: CanonicalSideValue<number | null>;
  fouls?: CanonicalSideValue<number | null>;
  yellowCards?: CanonicalSideValue<number | null>;
  redCards?: CanonicalSideValue<number | null>;
  expectedGoals?: CanonicalSideValue<number | null>;
  passes?: CanonicalSideValue<number | null>;
  attacks?: CanonicalSideValue<number | null>;
  dangerousAttacks?: CanonicalSideValue<number | null>;
  rawTypeMap: Record<string, unknown>;
}

export interface CanonicalOddsSelection {
  market: string;
  selection: string;
  line: number | null;
  price: number;
  bookmaker: string | null;
  provider: ProviderId;
  kind: CanonicalOddsKind;
  fetchedAt: string;
  suspended: boolean;
}

export interface CanonicalOddsSnapshot {
  matchId: string;
  generatedAt: string;
  selections: CanonicalOddsSelection[];
  sourceProvider: ProviderId | null;
  sourceKind: CanonicalOddsKind;
  warnings: string[];
}

export interface ProviderCoverageFlags {
  level: ProviderCoverageLevel;
  roles: Partial<Record<ProviderRole, ProviderCoverageLevel>>;
  hasData: boolean;
  itemCount: number;
  warnings: string[];
}

export interface ProviderEnvelope<T> {
  provider: ProviderId;
  role: ProviderRole;
  providerFixtureId: string | null;
  matchId: string | null;
  fetchedAt: string;
  latencyMs: number | null;
  success: boolean;
  statusCode: number | null;
  raw: unknown;
  normalized: T | null;
  coverage: ProviderCoverageFlags;
  freshness: ProviderFreshnessState;
  quota: ProviderQuotaState;
  error: string;
  warnings: string[];
}

export interface ProviderHealth {
  provider: ProviderId;
  roles: ProviderRole[];
  reachable: boolean;
  lastFetchedAt: string | null;
  statusCode: number | null;
  quotaState: ProviderQuotaState;
  latencyMs: number | null;
  reliability: ProviderReliability;
  warnings: string[];
}

export interface ProviderFieldSource {
  provider: ProviderId | null;
  providerFixtureId: string | null;
  fetchedAt: string | null;
  freshness: ProviderFreshnessState;
  coverage: ProviderCoverageLevel;
  confidence: Exclude<ProviderMappingConfidence, 'verified'> | 'high';
  notes: string[];
}

export interface ProviderConsensus {
  scoreAgreement: 'agree' | 'single_source' | 'conflict' | 'unknown';
  minuteAgreement: 'agree' | 'single_source' | 'lag_detected' | 'conflict' | 'unknown';
  eventAgreement: 'agree' | 'single_source' | 'partial' | 'conflict' | 'unknown';
  statsAgreement: 'agree' | 'single_source' | 'missing' | 'conflict' | 'unknown';
  oddsAgreement: 'agree' | 'single_source' | 'missing' | 'conflict' | 'unknown';
}

export interface ProviderMoneyGuard {
  canUseForMoneyDecision: boolean;
  canSaveRecommendation: boolean;
  canPushStatsOnlySignal: boolean;
  hardBlockReasons: string[];
  softWarnings: string[];
}

export interface LiveProviderFusionSnapshot {
  matchId: string;
  generatedAt: string;
  canonical: {
    fixture: CanonicalFixtureIdentity | null;
    scoreClock: CanonicalScoreClock | null;
    events: CanonicalMatchEvent[];
    statistics: CanonicalTeamStatistics | null;
    odds: CanonicalOddsSnapshot | null;
  };
  fieldSources: {
    fixture: ProviderFieldSource;
    scoreClock: ProviderFieldSource;
    events: ProviderFieldSource;
    statistics: ProviderFieldSource;
    odds: ProviderFieldSource;
  };
  providerHealth: ProviderHealth[];
  consensus: ProviderConsensus;
  evidenceMode: ProviderFusionEvidenceMode;
  warnings: string[];
  moneyGuard: ProviderMoneyGuard;
}

export type CanonicalValidationResult<T> =
  | { ok: true; value: T; errors: [] }
  | { ok: false; errors: string[] };

interface FieldClassificationInput {
  fetched: boolean;
  itemCount?: number | null;
  expectedItemCount?: number | null;
  conflicted?: boolean;
  stale?: boolean;
  fetchedAt?: string | null;
}

interface BuildProviderFieldSourceInput extends FieldClassificationInput {
  provider?: unknown;
  providerFixtureId?: unknown;
  confidence?: ProviderMappingConfidence;
  notes?: unknown[];
}

interface BuildProviderEnvelopeInput<T> {
  provider: string;
  role: ProviderRole;
  providerFixtureId?: unknown;
  matchId?: unknown;
  fetchedAt?: unknown;
  latencyMs?: unknown;
  success?: boolean;
  statusCode?: unknown;
  raw?: unknown;
  normalized?: T | null;
  coverage?: Partial<ProviderCoverageFlags> & {
    fetched?: boolean;
    expectedItemCount?: number | null;
    conflicted?: boolean;
  };
  freshness?: ProviderFreshnessState;
  quota?: ProviderQuotaState;
  error?: unknown;
  warnings?: unknown[];
}

const STAT_KEYS = [
  'possessionPct',
  'shotsTotal',
  'shotsOnTarget',
  'corners',
  'fouls',
  'yellowCards',
  'redCards',
  'expectedGoals',
  'passes',
  'attacks',
  'dangerousAttacks',
] as const satisfies ReadonlyArray<keyof Omit<CanonicalTeamStatistics, 'rawTypeMap'>>;

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

function stringArray(value: unknown[] | undefined): string[] {
  return (value ?? []).map((item) => cleanString(item)).filter(Boolean);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value);
}

function isIsoDateString(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '' && !Number.isNaN(Date.parse(value));
}

function inList<T extends readonly string[]>(list: T, value: unknown): value is T[number] {
  return typeof value === 'string' && (list as readonly string[]).includes(value);
}

function normalizeEnum<T extends readonly string[]>(list: T, value: unknown, fallback: T[number]): T[number] {
  return inList(list, value) ? value : fallback;
}

function normalizeProviderId(value: unknown): ProviderId {
  return cleanString(value) as ProviderId;
}

function normalizeRecordOfStrings(value: unknown): Record<string, string> {
  if (!isRecord(value)) return {};
  return Object.fromEntries(
    Object.entries(value)
      .map(([key, raw]) => [cleanString(key), cleanString(raw)] as const)
      .filter(([key, raw]) => key !== '' && raw !== ''),
  );
}

function normalizeRawTypeMap(value: unknown): Record<string, unknown> {
  return isRecord(value) ? { ...value } : {};
}

function normalizeNumericSide(value: unknown): CanonicalSideValue<number | null> | undefined {
  if (!isRecord(value)) return undefined;
  return {
    home: numberOrNull(value['home']),
    away: numberOrNull(value['away']),
  };
}

function validationFailure<T>(errors: string[]): CanonicalValidationResult<T> {
  return { ok: false, errors };
}

function validationSuccess<T>(value: T): CanonicalValidationResult<T> {
  return { ok: true, value, errors: [] };
}

function requireString(value: unknown, label: string, errors: string[], allowEmpty = false): void {
  if (typeof value !== 'string' || (!allowEmpty && value.trim() === '')) {
    errors.push(`${label} must be a ${allowEmpty ? '' : 'non-empty '}string`.trim());
  }
}

function requireNullableNumber(value: unknown, label: string, errors: string[]): void {
  if (value != null && (typeof value !== 'number' || !Number.isFinite(value))) {
    errors.push(`${label} must be a finite number or null`);
  }
}

function requireNullableString(value: unknown, label: string, errors: string[]): void {
  if (value != null && typeof value !== 'string') {
    errors.push(`${label} must be a string or null`);
  }
}

function requireEnum<T extends readonly string[]>(value: unknown, label: string, list: T, errors: string[]): void {
  if (!inList(list, value)) errors.push(`${label} must be one of ${list.join(', ')}`);
}

function validateTeamRef(value: unknown, label: string, errors: string[]): void {
  if (!isRecord(value)) {
    errors.push(`${label} must be an object`);
    return;
  }
  requireNullableString(value['id'], `${label}.id`, errors);
  requireString(value['name'], `${label}.name`, errors);
  requireNullableString(value['logo'], `${label}.logo`, errors);
}

function validateLeagueRef(value: unknown, label: string, errors: string[]): void {
  if (!isRecord(value)) {
    errors.push(`${label} must be an object`);
    return;
  }
  requireNullableString(value['id'], `${label}.id`, errors);
  requireString(value['name'], `${label}.name`, errors);
  requireNullableString(value['country'], `${label}.country`, errors);
  requireNullableNumber(value['season'], `${label}.season`, errors);
  requireNullableString(value['logo'], `${label}.logo`, errors);
}

function validateSideValue(value: unknown, label: string, errors: string[]): void {
  if (!isRecord(value)) {
    errors.push(`${label} must be an object`);
    return;
  }
  requireNullableNumber(value['home'], `${label}.home`, errors);
  requireNullableNumber(value['away'], `${label}.away`, errors);
}

function validateWarnings(value: unknown, label: string, errors: string[]): void {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    errors.push(`${label} must be an array of strings`);
  }
}

export function buildCanonicalLeagueRef(input: Partial<CanonicalLeagueRef>): CanonicalLeagueRef {
  return {
    id: stringOrNull(input.id),
    name: cleanString(input.name),
    country: stringOrNull(input.country),
    season: numberOrNull(input.season),
    logo: stringOrNull(input.logo),
  };
}

export function buildCanonicalTeamRef(input: Partial<CanonicalTeamRef>): CanonicalTeamRef {
  return {
    id: stringOrNull(input.id),
    name: cleanString(input.name),
    logo: stringOrNull(input.logo),
  };
}

export function buildCanonicalFixtureIdentity(input: {
  matchId: unknown;
  providerFixtureIds?: unknown;
  kickoffAtUtc?: unknown;
  league: Partial<CanonicalLeagueRef>;
  home: Partial<CanonicalTeamRef>;
  away: Partial<CanonicalTeamRef>;
  mappingConfidence?: unknown;
}): CanonicalFixtureIdentity {
  return {
    matchId: cleanString(input.matchId),
    providerFixtureIds: normalizeRecordOfStrings(input.providerFixtureIds),
    kickoffAtUtc: stringOrNull(input.kickoffAtUtc),
    league: buildCanonicalLeagueRef(input.league),
    home: buildCanonicalTeamRef(input.home),
    away: buildCanonicalTeamRef(input.away),
    mappingConfidence: normalizeEnum(PROVIDER_MAPPING_CONFIDENCES, input.mappingConfidence, 'unknown'),
  };
}

export function buildCanonicalScoreClock(input: {
  status?: unknown;
  minute?: unknown;
  injuryTime?: unknown;
  period?: unknown;
  score?: { home?: unknown; away?: unknown } | null;
  wallClockMinuteEstimate?: unknown;
  providerClockLagMinutes?: unknown;
}): CanonicalScoreClock {
  return {
    status: cleanString(input.status),
    minute: numberOrNull(input.minute),
    injuryTime: numberOrNull(input.injuryTime),
    period: normalizeEnum(CANONICAL_PERIODS, input.period, 'unknown'),
    score: {
      home: numberOrNull(input.score?.home),
      away: numberOrNull(input.score?.away),
    },
    wallClockMinuteEstimate: numberOrNull(input.wallClockMinuteEstimate),
    providerClockLagMinutes: numberOrNull(input.providerClockLagMinutes),
  };
}

export function buildCanonicalMatchEvent(input: {
  minute?: unknown;
  extra?: unknown;
  teamSide?: unknown;
  team?: Partial<CanonicalTeamRef> | null;
  playerName?: unknown;
  assistName?: unknown;
  type?: unknown;
  detail?: unknown;
  sourceEventId?: unknown;
}): CanonicalMatchEvent {
  return {
    minute: numberOrNull(input.minute),
    extra: numberOrNull(input.extra),
    teamSide: normalizeEnum(CANONICAL_TEAM_SIDES, input.teamSide, 'unknown'),
    team: input.team ? buildCanonicalTeamRef(input.team) : null,
    playerName: stringOrNull(input.playerName),
    assistName: stringOrNull(input.assistName),
    type: normalizeEnum(CANONICAL_EVENT_TYPES, input.type, 'other'),
    detail: cleanString(input.detail),
    sourceEventId: stringOrNull(input.sourceEventId),
  };
}

export function buildCanonicalTeamStatistics(
  input: Partial<Record<keyof Omit<CanonicalTeamStatistics, 'rawTypeMap'>, unknown>> & {
    rawTypeMap?: unknown;
  },
): CanonicalTeamStatistics {
  const output: CanonicalTeamStatistics = {
    rawTypeMap: normalizeRawTypeMap(input.rawTypeMap),
  };
  for (const key of STAT_KEYS) {
    const side = normalizeNumericSide(input[key]);
    if (side) output[key] = side;
  }
  return output;
}

export function buildCanonicalOddsSelection(input: {
  market?: unknown;
  selection?: unknown;
  line?: unknown;
  price?: unknown;
  bookmaker?: unknown;
  provider?: unknown;
  kind?: unknown;
  fetchedAt?: unknown;
  suspended?: unknown;
}): CanonicalOddsSelection {
  return {
    market: cleanString(input.market),
    selection: cleanString(input.selection),
    line: numberOrNull(input.line),
    price: numberOrNull(input.price) ?? 0,
    bookmaker: stringOrNull(input.bookmaker),
    provider: normalizeProviderId(input.provider),
    kind: normalizeEnum(CANONICAL_ODDS_KINDS, input.kind, 'unknown'),
    fetchedAt: cleanString(input.fetchedAt),
    suspended: input.suspended === true,
  };
}

export function buildCanonicalOddsSnapshot(input: {
  matchId?: unknown;
  generatedAt?: unknown;
  selections?: Array<Parameters<typeof buildCanonicalOddsSelection>[0]>;
  sourceProvider?: unknown;
  sourceKind?: unknown;
  warnings?: unknown[];
}): CanonicalOddsSnapshot {
  const selections = (input.selections ?? []).map((selection) => buildCanonicalOddsSelection(selection));
  return {
    matchId: cleanString(input.matchId),
    generatedAt: cleanString(input.generatedAt),
    selections,
    sourceProvider: stringOrNull(input.sourceProvider) as ProviderId | null,
    sourceKind: normalizeEnum(CANONICAL_ODDS_KINDS, input.sourceKind, selections[0]?.kind ?? 'unknown'),
    warnings: stringArray(input.warnings),
  };
}

export function classifyCoverageLevel(input: FieldClassificationInput): ProviderCoverageLevel {
  if (!input.fetched) return 'missing';
  if (input.conflicted) return 'unknown';
  const itemCount = Math.max(0, Math.trunc(numberOrNull(input.itemCount) ?? 0));
  if (itemCount === 0) return 'empty';
  const expectedItemCount = Math.trunc(numberOrNull(input.expectedItemCount) ?? 0);
  return expectedItemCount > 0 && itemCount < expectedItemCount ? 'partial' : 'complete';
}

export function classifyFreshnessState(input: FieldClassificationInput): ProviderFreshnessState {
  if (input.conflicted) return 'conflicted';
  if (!input.fetched || !input.fetchedAt) return 'missing';
  if (input.stale) return 'stale';
  return 'fresh';
}

export function buildProviderFieldSource(input: BuildProviderFieldSourceInput): ProviderFieldSource {
  const confidence = normalizeEnum(PROVIDER_MAPPING_CONFIDENCES, input.confidence, 'unknown');
  return {
    provider: stringOrNull(input.provider) as ProviderId | null,
    providerFixtureId: stringOrNull(input.providerFixtureId),
    fetchedAt: stringOrNull(input.fetchedAt),
    freshness: classifyFreshnessState(input),
    coverage: classifyCoverageLevel(input),
    confidence: confidence === 'verified' ? 'high' : confidence,
    notes: stringArray(input.notes),
  };
}

export function buildProviderCoverageFlags(input: {
  level?: ProviderCoverageLevel;
  roles?: Partial<Record<ProviderRole, ProviderCoverageLevel>>;
  fetched?: boolean;
  itemCount?: number | null;
  expectedItemCount?: number | null;
  conflicted?: boolean;
  warnings?: unknown[];
}): ProviderCoverageFlags {
  const level = input.level ?? classifyCoverageLevel({
    fetched: input.fetched ?? true,
    itemCount: input.itemCount,
    expectedItemCount: input.expectedItemCount,
    conflicted: input.conflicted,
  });
  const itemCount = Math.max(0, Math.trunc(numberOrNull(input.itemCount) ?? 0));
  return {
    level,
    roles: input.roles ?? {},
    hasData: level === 'complete' || level === 'partial',
    itemCount,
    warnings: stringArray(input.warnings),
  };
}

export function buildProviderEnvelope<T>(input: BuildProviderEnvelopeInput<T>): ProviderEnvelope<T> {
  const success = input.success ?? cleanString(input.error) === '';
  return {
    provider: normalizeProviderId(input.provider),
    role: input.role,
    providerFixtureId: stringOrNull(input.providerFixtureId),
    matchId: stringOrNull(input.matchId),
    fetchedAt: stringOrNull(input.fetchedAt) ?? new Date(0).toISOString(),
    latencyMs: numberOrNull(input.latencyMs),
    success,
    statusCode: numberOrNull(input.statusCode),
    raw: input.raw ?? null,
    normalized: input.normalized ?? null,
    coverage: buildProviderCoverageFlags(input.coverage ?? { fetched: success, itemCount: input.normalized == null ? 0 : 1 }),
    freshness: input.freshness ?? (success ? 'fresh' : 'missing'),
    quota: input.quota ?? 'unknown',
    error: cleanString(input.error),
    warnings: stringArray(input.warnings),
  };
}

export function validateCanonicalFixtureIdentity(value: unknown): CanonicalValidationResult<CanonicalFixtureIdentity> {
  const errors: string[] = [];
  if (!isRecord(value)) return validationFailure(['fixture must be an object']);
  requireString(value['matchId'], 'matchId', errors);
  if (!isRecord(value['providerFixtureIds'])) errors.push('providerFixtureIds must be an object');
  if (value['kickoffAtUtc'] != null && !isIsoDateString(value['kickoffAtUtc'])) {
    errors.push('kickoffAtUtc must be an ISO date string or null');
  }
  validateLeagueRef(value['league'], 'league', errors);
  validateTeamRef(value['home'], 'home', errors);
  validateTeamRef(value['away'], 'away', errors);
  requireEnum(value['mappingConfidence'], 'mappingConfidence', PROVIDER_MAPPING_CONFIDENCES, errors);
  return errors.length ? validationFailure(errors) : validationSuccess(value as unknown as CanonicalFixtureIdentity);
}

export function validateCanonicalScoreClock(value: unknown): CanonicalValidationResult<CanonicalScoreClock> {
  const errors: string[] = [];
  if (!isRecord(value)) return validationFailure(['scoreClock must be an object']);
  requireString(value['status'], 'status', errors, true);
  requireNullableNumber(value['minute'], 'minute', errors);
  requireNullableNumber(value['injuryTime'], 'injuryTime', errors);
  requireEnum(value['period'], 'period', CANONICAL_PERIODS, errors);
  if (!isRecord(value['score'])) {
    errors.push('score must be an object');
  } else {
    requireNullableNumber(value['score']['home'], 'score.home', errors);
    requireNullableNumber(value['score']['away'], 'score.away', errors);
  }
  requireNullableNumber(value['wallClockMinuteEstimate'], 'wallClockMinuteEstimate', errors);
  requireNullableNumber(value['providerClockLagMinutes'], 'providerClockLagMinutes', errors);
  return errors.length ? validationFailure(errors) : validationSuccess(value as unknown as CanonicalScoreClock);
}

export function validateCanonicalMatchEvent(value: unknown): CanonicalValidationResult<CanonicalMatchEvent> {
  const errors: string[] = [];
  if (!isRecord(value)) return validationFailure(['event must be an object']);
  requireNullableNumber(value['minute'], 'minute', errors);
  requireNullableNumber(value['extra'], 'extra', errors);
  requireEnum(value['teamSide'], 'teamSide', CANONICAL_TEAM_SIDES, errors);
  if (value['team'] != null) validateTeamRef(value['team'], 'team', errors);
  requireNullableString(value['playerName'], 'playerName', errors);
  requireNullableString(value['assistName'], 'assistName', errors);
  requireEnum(value['type'], 'type', CANONICAL_EVENT_TYPES, errors);
  requireString(value['detail'], 'detail', errors, true);
  requireNullableString(value['sourceEventId'], 'sourceEventId', errors);
  return errors.length ? validationFailure(errors) : validationSuccess(value as unknown as CanonicalMatchEvent);
}

export function validateCanonicalTeamStatistics(value: unknown): CanonicalValidationResult<CanonicalTeamStatistics> {
  const errors: string[] = [];
  if (!isRecord(value)) return validationFailure(['statistics must be an object']);
  for (const key of STAT_KEYS) {
    if (value[key] !== undefined) validateSideValue(value[key], key, errors);
  }
  if (!isRecord(value['rawTypeMap'])) errors.push('rawTypeMap must be an object');
  return errors.length ? validationFailure(errors) : validationSuccess(value as unknown as CanonicalTeamStatistics);
}

export function validateCanonicalOddsSnapshot(value: unknown): CanonicalValidationResult<CanonicalOddsSnapshot> {
  const errors: string[] = [];
  if (!isRecord(value)) return validationFailure(['oddsSnapshot must be an object']);
  requireString(value['matchId'], 'matchId', errors);
  if (!isIsoDateString(value['generatedAt'])) errors.push('generatedAt must be an ISO date string');
  if (!Array.isArray(value['selections'])) {
    errors.push('selections must be an array');
  } else {
    value['selections'].forEach((selection, idx) => {
      if (!isRecord(selection)) {
        errors.push(`selections[${idx}] must be an object`);
        return;
      }
      requireString(selection['market'], `selections[${idx}].market`, errors);
      requireString(selection['selection'], `selections[${idx}].selection`, errors);
      requireNullableNumber(selection['line'], `selections[${idx}].line`, errors);
      if (typeof selection['price'] !== 'number' || !Number.isFinite(selection['price']) || selection['price'] <= 1) {
        errors.push(`selections[${idx}].price must be a finite number greater than 1`);
      }
      requireNullableString(selection['bookmaker'], `selections[${idx}].bookmaker`, errors);
      requireString(selection['provider'], `selections[${idx}].provider`, errors);
      requireEnum(selection['kind'], `selections[${idx}].kind`, CANONICAL_ODDS_KINDS, errors);
      if (!isIsoDateString(selection['fetchedAt'])) {
        errors.push(`selections[${idx}].fetchedAt must be an ISO date string`);
      }
      if (typeof selection['suspended'] !== 'boolean') {
        errors.push(`selections[${idx}].suspended must be a boolean`);
      }
    });
  }
  requireNullableString(value['sourceProvider'], 'sourceProvider', errors);
  requireEnum(value['sourceKind'], 'sourceKind', CANONICAL_ODDS_KINDS, errors);
  validateWarnings(value['warnings'], 'warnings', errors);
  return errors.length ? validationFailure(errors) : validationSuccess(value as unknown as CanonicalOddsSnapshot);
}

export function validateProviderEnvelope(value: unknown): CanonicalValidationResult<ProviderEnvelope<unknown>> {
  const errors: string[] = [];
  if (!isRecord(value)) return validationFailure(['envelope must be an object']);
  requireString(value['provider'], 'provider', errors);
  requireEnum(value['role'], 'role', PROVIDER_ROLES, errors);
  requireNullableString(value['providerFixtureId'], 'providerFixtureId', errors);
  requireNullableString(value['matchId'], 'matchId', errors);
  if (!isIsoDateString(value['fetchedAt'])) errors.push('fetchedAt must be an ISO date string');
  requireNullableNumber(value['latencyMs'], 'latencyMs', errors);
  if (typeof value['success'] !== 'boolean') errors.push('success must be a boolean');
  requireNullableNumber(value['statusCode'], 'statusCode', errors);
  if (!isRecord(value['coverage'])) {
    errors.push('coverage must be an object');
  } else {
    requireEnum(value['coverage']['level'], 'coverage.level', PROVIDER_COVERAGE_LEVELS, errors);
    if (typeof value['coverage']['hasData'] !== 'boolean') errors.push('coverage.hasData must be a boolean');
    requireNullableNumber(value['coverage']['itemCount'], 'coverage.itemCount', errors);
    validateWarnings(value['coverage']['warnings'], 'coverage.warnings', errors);
  }
  requireEnum(value['freshness'], 'freshness', PROVIDER_FRESHNESS_STATES, errors);
  requireEnum(value['quota'], 'quota', PROVIDER_QUOTA_STATES, errors);
  requireString(value['error'], 'error', errors, true);
  validateWarnings(value['warnings'], 'warnings', errors);
  return errors.length ? validationFailure(errors) : validationSuccess(value as unknown as ProviderEnvelope<unknown>);
}

export function validateCanonicalDomainObject(
  kind: 'fixture' | 'scoreClock' | 'event' | 'statistics' | 'oddsSnapshot' | 'providerEnvelope',
  value: unknown,
): CanonicalValidationResult<unknown> {
  switch (kind) {
    case 'fixture':
      return validateCanonicalFixtureIdentity(value);
    case 'scoreClock':
      return validateCanonicalScoreClock(value);
    case 'event':
      return validateCanonicalMatchEvent(value);
    case 'statistics':
      return validateCanonicalTeamStatistics(value);
    case 'oddsSnapshot':
      return validateCanonicalOddsSnapshot(value);
    case 'providerEnvelope':
      return validateProviderEnvelope(value);
    default:
      return validationFailure([`Unsupported canonical domain kind: ${kind}`]);
  }
}
