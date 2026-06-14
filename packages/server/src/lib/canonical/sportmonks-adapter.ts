import {
  getSportmonksCurrentScore,
  getSportmonksFixtureSides,
  normalizeSportmonksFixture,
  type NormalizedSportmonksFixture,
  type SportmonksFixtureLike,
} from '../sportmonks-normalize.js';
import type { SportmonksRateLimit } from '../sportmonks-api.js';
import {
  buildCanonicalFixtureIdentity,
  buildCanonicalMatchEvent,
  buildCanonicalOddsSelection,
  buildCanonicalOddsSnapshot,
  buildCanonicalScoreClock,
  buildCanonicalTeamStatistics,
  buildProviderEnvelope,
  type CanonicalFixtureIdentity,
  type CanonicalMatchEvent,
  type CanonicalOddsSnapshot,
  type CanonicalPeriod,
  type CanonicalScoreClock,
  type CanonicalTeamSide,
  type CanonicalTeamStatistics,
  type ProviderEnvelope,
  type ProviderQuotaState,
  type ProviderRole,
} from './provider-domain.js';

export const SPORTMONKS_CANONICAL_PROVIDER = 'sportmonks';

export interface SportmonksCanonicalMeta {
  matchId?: string | number | null;
  fetchedAt?: string;
  latencyMs?: number | null;
  statusCode?: number | null;
  raw?: unknown;
  error?: unknown;
  warnings?: unknown[];
  rateLimit?: SportmonksRateLimit | null;
}

export interface BuildSportmonksOddsEnvelopeInput extends SportmonksCanonicalMeta {
  fixture: SportmonksFixtureLike | NormalizedSportmonksFixture;
  generatedAt?: string;
}

interface SportmonksAccessErrorInput {
  role: ProviderRole;
  matchId?: string | number | null;
  providerFixtureId?: string | number | null;
  statusCode?: number | null;
  error: unknown;
  fetchedAt?: string;
  rateLimit?: SportmonksRateLimit | null;
  warnings?: unknown[];
}

const EMPTY_EPOCH = new Date(0).toISOString();

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

function warningStrings(value: unknown[] | undefined): string[] {
  return (value ?? []).map((item) => cleanString(item)).filter(Boolean);
}

function errorMessage(value: unknown): string {
  return value instanceof Error ? value.message : cleanString(value);
}

function fetchedAt(meta?: SportmonksCanonicalMeta): string {
  return stringOrNull(meta?.fetchedAt) ?? EMPTY_EPOCH;
}

function normalizedFixture(fixture: SportmonksFixtureLike | NormalizedSportmonksFixture): NormalizedSportmonksFixture {
  return (fixture as NormalizedSportmonksFixture).provider === SPORTMONKS_CANONICAL_PROVIDER
    ? fixture as NormalizedSportmonksFixture
    : normalizeSportmonksFixture(fixture as SportmonksFixtureLike);
}

function metaRaw(meta: SportmonksCanonicalMeta | undefined, fallback: unknown): unknown {
  return meta && 'raw' in meta ? meta.raw : fallback;
}

function recordName(value: unknown): string {
  if (!isRecord(value)) return '';
  return stringOrNull(value['name'])
    ?? stringOrNull(value['display_name'])
    ?? stringOrNull(value['code'])
    ?? '';
}

function leagueRef(raw: SportmonksFixtureLike | NormalizedSportmonksFixture, fixture: NormalizedSportmonksFixture) {
  const league = isRecord((raw as SportmonksFixtureLike).league) ? (raw as SportmonksFixtureLike).league as Record<string, unknown> : null;
  return {
    id: fixture.leagueId,
    name: recordName(league) || fixture.leagueName || fixture.name.split(' vs ')[0]?.trim() || '',
    country: stringOrNull(league?.['country_name'] ?? league?.['country'] ?? league?.['country_code']),
    season: numberOrNull(fixture.seasonId),
    logo: stringOrNull(league?.['image_path'] ?? league?.['logo_path'] ?? league?.['logo']),
  };
}

function periodFromState(fixture: NormalizedSportmonksFixture, raw: SportmonksFixtureLike | NormalizedSportmonksFixture): CanonicalPeriod {
  const state = isRecord((raw as SportmonksFixtureLike).state) ? (raw as SportmonksFixtureLike).state as Record<string, unknown> : null;
  const text = [
    fixture.stateId,
    state?.['name'],
    state?.['short_name'],
    state?.['code'],
    state?.['developer_name'],
    fixture.resultInfo,
  ].map((part) => cleanString(part).toLowerCase()).join(' ');
  if (text.includes('not started') || text.includes('not_started') || text.includes('pre')) return 'pre';
  if (text.includes('1st') || text.includes('first') || text.includes('1h')) return '1h';
  if (text.includes('half time') || text.includes('halftime') || text.includes('ht')) return 'ht';
  if (text.includes('2nd') || text.includes('second') || text.includes('2h')) return '2h';
  if (text.includes('extra') || text.includes('aet')) return 'et';
  if (text.includes('pen')) return 'pen';
  if (text.includes('full') || text.includes('ended') || text.includes('finished') || text.includes('ft')) return 'ft';
  return fixture.lengthMinutes != null && fixture.lengthMinutes > 45 ? '2h' : fixture.lengthMinutes != null ? '1h' : 'unknown';
}

function teamSideByParticipant(fixture: NormalizedSportmonksFixture, participantId: unknown): CanonicalTeamSide {
  const sides = getSportmonksFixtureSides(fixture);
  const id = numberOrNull(participantId);
  if (id != null && sides.home?.id === id) return 'home';
  if (id != null && sides.away?.id === id) return 'away';
  return 'unknown';
}

function participantTeam(fixture: NormalizedSportmonksFixture, participantId: unknown) {
  const sides = getSportmonksFixtureSides(fixture);
  const side = teamSideByParticipant(fixture, participantId);
  const team = side === 'home' ? sides.home : side === 'away' ? sides.away : null;
  const fallbackId = numberOrNull(participantId);
  return team
    ? { id: String(team.id ?? ''), name: team.name, logo: team.logo }
    : fallbackId != null
      ? { id: String(fallbackId), name: '', logo: '' }
      : null;
}

function sportmonksEventType(row: Record<string, unknown>): CanonicalMatchEvent['type'] {
  const typeText = cleanString(isRecord(row['type']) ? recordName(row['type']) : row['type']).toLowerCase();
  const detailText = cleanString(row['addition'] ?? row['info']).toLowerCase();
  const typeId = numberOrNull(row['type_id']);
  const text = `${typeText} ${detailText}`;
  if (text.includes('var')) return 'var';
  if (text.includes('penalty') || typeId === 15) return 'penalty';
  if (text.includes('goal') || typeId === 14 || typeId === 16) return 'goal';
  if (text.includes('card') || typeId === 19 || typeId === 20 || typeId === 21) return 'card';
  if (text.includes('substitution') || text.includes('subst') || typeId === 18) return 'substitution';
  if (text.includes('period')) return 'period';
  return 'other';
}

function sportmonksEventDetail(row: Record<string, unknown>): string {
  return stringOrNull(row['addition']) ?? stringOrNull(row['info']) ?? '';
}

function statTypeName(row: Record<string, unknown>): string {
  const type = isRecord(row['type']) ? row['type'] : null;
  return stringOrNull(type?.['name'])
    ?? stringOrNull(type?.['display_name'])
    ?? stringOrNull(type?.['code'])
    ?? stringOrNull(row['name'])
    ?? stringOrNull(row['type'])
    ?? SPORTMONKS_STAT_TYPE_NAME_BY_ID[stringOrNull(row['type_id']) ?? '']
    ?? stringOrNull(row['type_id'])
    ?? '';
}

const SPORTMONKS_STAT_TYPE_NAME_BY_ID: Record<string, string> = {
  '34': 'Corners',
  '42': 'Shots Total',
  '43': 'Attacks',
  '44': 'Dangerous Attacks',
  '45': 'Ball Possession',
  '56': 'Fouls',
  '80': 'Passes',
  '83': 'Red Cards',
  '84': 'Yellow Cards',
  '86': 'Shots On Target',
};

function statKey(type: string): Exclude<keyof CanonicalTeamStatistics, 'rawTypeMap'> | null {
  const normalized = type.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const byName: Record<string, Exclude<keyof CanonicalTeamStatistics, 'rawTypeMap'>> = {
    possession: 'possessionPct',
    'ball possession': 'possessionPct',
    'ball possession percentage': 'possessionPct',
    shots: 'shotsTotal',
    'shots total': 'shotsTotal',
    'total shots': 'shotsTotal',
    'shots on target': 'shotsOnTarget',
    'shots on goal': 'shotsOnTarget',
    corners: 'corners',
    'corner kicks': 'corners',
    fouls: 'fouls',
    'yellow cards': 'yellowCards',
    yellowcards: 'yellowCards',
    'red cards': 'redCards',
    redcards: 'redCards',
    'expected goals': 'expectedGoals',
    xg: 'expectedGoals',
    expected_goals: 'expectedGoals',
    passes: 'passes',
    'total passes': 'passes',
    attacks: 'attacks',
    'dangerous attacks': 'dangerousAttacks',
  };
  return byName[normalized] ?? null;
}

function statValue(row: Record<string, unknown>): number | null {
  const data = isRecord(row['data']) ? row['data'] : null;
  const value = data?.['value'] ?? row['value'];
  if (typeof value === 'string' && value.trim().endsWith('%')) return numberOrNull(value.trim().slice(0, -1));
  return numberOrNull(value);
}

function oddsMarket(row: Record<string, unknown>): string {
  return stringOrNull(row['market_description'])
    ?? stringOrNull(row['market_name'])
    ?? stringOrNull(isRecord(row['market']) ? recordName(row['market']) : null)
    ?? stringOrNull(row['market'])
    ?? stringOrNull(row['name'])
    ?? '';
}

function oddsSelection(row: Record<string, unknown>): string {
  return stringOrNull(row['label'])
    ?? stringOrNull(row['value'])
    ?? stringOrNull(row['selection'])
    ?? stringOrNull(row['name'])
    ?? '';
}

function oddsPrice(row: Record<string, unknown>): number | null {
  return numberOrNull(row['odd'] ?? row['odds'] ?? row['price'] ?? row['decimal']);
}

function oddsBookmaker(row: Record<string, unknown>): string | null {
  return stringOrNull(row['bookmaker_name'])
    ?? stringOrNull(isRecord(row['bookmaker']) ? recordName(row['bookmaker']) : null)
    ?? stringOrNull(row['bookmaker']);
}

function oddsLine(row: Record<string, unknown>): number | null {
  const direct = numberOrNull(row['handicap'] ?? row['line'] ?? row['total']);
  if (direct != null) return direct;
  const match = oddsSelection(row).match(/[-+]?\d+(?:\.\d+)?/);
  return match ? numberOrNull(match[0]) : null;
}

function oddsSuspended(row: Record<string, unknown>): boolean {
  return row['suspended'] === true
    || String(row['suspended']).toLowerCase() === 'true'
    || String(row['status']).toLowerCase() === 'suspended';
}

function quotaState(rateLimit: SportmonksRateLimit | null | undefined): ProviderQuotaState {
  if (!rateLimit || rateLimit.remaining == null) return 'unknown';
  if (rateLimit.remaining <= 0) return 'hourly_limit';
  if (rateLimit.remaining <= 10) return 'critical';
  if (rateLimit.remaining <= 50) return 'high';
  if (rateLimit.remaining <= 250) return 'elevated';
  return 'ok';
}

function providerEnvelope<T>(input: {
  role: ProviderRole;
  fixture?: NormalizedSportmonksFixture | null;
  providerFixtureId?: string | number | null;
  normalized: T | null;
  itemCount: number;
  expectedItemCount?: number | null;
  raw: unknown;
  meta?: SportmonksCanonicalMeta;
}): ProviderEnvelope<T> {
  const error = errorMessage(input.meta?.error);
  const success = error === '';
  return buildProviderEnvelope<T>({
    provider: SPORTMONKS_CANONICAL_PROVIDER,
    role: input.role,
    providerFixtureId: input.providerFixtureId ?? input.fixture?.providerFixtureId ?? null,
    matchId: input.meta?.matchId ?? input.fixture?.providerFixtureId ?? null,
    fetchedAt: fetchedAt(input.meta),
    latencyMs: input.meta?.latencyMs ?? null,
    statusCode: input.meta?.statusCode ?? null,
    raw: input.raw,
    normalized: success ? input.normalized : null,
    coverage: {
      fetched: success,
      itemCount: success ? input.itemCount : 0,
      expectedItemCount: input.expectedItemCount,
      warnings: warningStrings(input.meta?.warnings),
    },
    freshness: success ? 'fresh' : 'missing',
    quota: quotaState(input.meta?.rateLimit),
    error,
    warnings: warningStrings(input.meta?.warnings),
  });
}

export function redactSportmonksParams(params: Record<string, unknown>): Record<string, string> {
  const redacted: Record<string, string> = {};
  for (const [key, value] of Object.entries(params)) {
    const normalizedKey = key.toLowerCase();
    redacted[key] = normalizedKey.includes('token') || normalizedKey === 'api_token'
      ? '[redacted]'
      : cleanString(value);
  }
  return redacted;
}

export function classifySportmonksAccessError(input: { statusCode?: number | null; error?: unknown }): {
  blocked: boolean;
  warnings: string[];
} {
  const text = cleanString(input.error).toLowerCase();
  const status = input.statusCode ?? null;
  const entitlement = status === 401 || status === 403
    || text.includes('subscription')
    || text.includes('entitlement')
    || text.includes('not subscribed')
    || text.includes('forbidden')
    || text.includes('locked');
  return {
    blocked: entitlement,
    warnings: entitlement ? ['sportmonks_entitlement_or_subscription_required'] : [],
  };
}

export function sportmonksFixtureToCanonicalIdentity(
  raw: SportmonksFixtureLike | NormalizedSportmonksFixture,
  meta?: SportmonksCanonicalMeta,
): CanonicalFixtureIdentity {
  const fixture = normalizedFixture(raw);
  const sides = getSportmonksFixtureSides(fixture);
  return buildCanonicalFixtureIdentity({
    matchId: meta?.matchId ?? fixture.providerFixtureId,
    providerFixtureIds: {
      [SPORTMONKS_CANONICAL_PROVIDER]: fixture.providerFixtureId,
    },
    kickoffAtUtc: fixture.startingAt,
    league: leagueRef(raw, fixture),
    home: {
      id: sides.home?.id == null ? null : String(sides.home.id),
      name: sides.home?.name ?? '',
      logo: sides.home?.logo ?? null,
    },
    away: {
      id: sides.away?.id == null ? null : String(sides.away.id),
      name: sides.away?.name ?? '',
      logo: sides.away?.logo ?? null,
    },
    mappingConfidence: meta?.matchId ? 'high' : 'unknown',
  });
}

export function sportmonksFixtureToCanonicalScoreClock(
  raw: SportmonksFixtureLike | NormalizedSportmonksFixture,
): CanonicalScoreClock {
  const fixture = normalizedFixture(raw);
  const score = getSportmonksCurrentScore(fixture);
  return buildCanonicalScoreClock({
    status: fixture.stateId ?? '',
    minute: fixture.lengthMinutes,
    injuryTime: null,
    period: periodFromState(fixture, raw),
    score,
    wallClockMinuteEstimate: null,
    providerClockLagMinutes: null,
  });
}

export function sportmonksFixtureToCanonicalEvents(
  raw: SportmonksFixtureLike | NormalizedSportmonksFixture,
): CanonicalMatchEvent[] {
  const fixture = normalizedFixture(raw);
  return fixture.events
    .map((event): CanonicalMatchEvent | null => {
      if (!isRecord(event)) return null;
      const type = sportmonksEventType(event);
      return buildCanonicalMatchEvent({
        minute: event['minute'],
        extra: event['extra_minute'],
        teamSide: teamSideByParticipant(fixture, event['participant_id']),
        team: participantTeam(fixture, event['participant_id']),
        playerName: event['player_name'],
        assistName: event['related_player_name'],
        type,
        detail: type === 'substitution' ? 'Substitution' : sportmonksEventDetail(event),
        sourceEventId: event['id'],
      });
    })
    .filter((event): event is CanonicalMatchEvent => event != null);
}

export function sportmonksFixtureToCanonicalStatistics(
  raw: SportmonksFixtureLike | NormalizedSportmonksFixture,
): CanonicalTeamStatistics {
  const fixture = normalizedFixture(raw);
  const accum: Record<string, { home: number | null; away: number | null }> = {};
  const rawTypeMap: Record<string, unknown> = {};

  for (const statistic of fixture.statistics) {
    if (!isRecord(statistic)) continue;
    const side = teamSideByParticipant(fixture, statistic['participant_id']);
    if (side !== 'home' && side !== 'away') {
      rawTypeMap[`unknown_participant:${cleanString(statistic['participant_id'])}`] = statistic;
      continue;
    }
    const type = statTypeName(statistic);
    const key = statKey(type);
    if (!key) {
      rawTypeMap[type || 'unknown'] = {
        ...(isRecord(rawTypeMap[type]) ? rawTypeMap[type] as Record<string, unknown> : {}),
        [side]: isRecord(statistic['data']) ? (statistic['data'] as Record<string, unknown>)['value'] : statistic['value'],
      };
      continue;
    }
    accum[key] ??= { home: null, away: null };
    accum[key][side] = statValue(statistic);
  }

  return buildCanonicalTeamStatistics({
    ...accum,
    rawTypeMap,
  });
}

export function sportmonksFixtureToCanonicalOddsSnapshot(
  raw: SportmonksFixtureLike | NormalizedSportmonksFixture,
  input: { matchId?: string | number | null; fetchedAt: string; generatedAt?: string; warnings?: unknown[] } = { fetchedAt: EMPTY_EPOCH },
): CanonicalOddsSnapshot {
  const fixture = normalizedFixture(raw);
  const warnings = warningStrings(input.warnings);
  if (fixture.hasOdds !== true && fixture.hasPremiumOdds !== true && fixture.inplayOdds.length === 0) {
    warnings.push('sportmonks_odds_not_included_or_not_entitled');
  }
  const selections = fixture.inplayOdds
    .filter(isRecord)
    .map((row) => {
      const market = oddsMarket(row);
      const selection = oddsSelection(row);
      const price = oddsPrice(row);
      if (!market || !selection || price == null || price <= 1) return null;
      return buildCanonicalOddsSelection({
        market,
        selection,
        line: oddsLine(row),
        price,
        bookmaker: oddsBookmaker(row),
        provider: SPORTMONKS_CANONICAL_PROVIDER,
        kind: 'live',
        fetchedAt: input.fetchedAt,
        suspended: oddsSuspended(row),
      });
    })
    .filter((selection): selection is NonNullable<typeof selection> => selection != null);

  return buildCanonicalOddsSnapshot({
    matchId: input.matchId ?? fixture.providerFixtureId,
    generatedAt: input.generatedAt ?? input.fetchedAt,
    selections,
    sourceProvider: selections.length > 0 ? SPORTMONKS_CANONICAL_PROVIDER : null,
    sourceKind: selections.length > 0 ? 'live' : 'unknown',
    warnings,
  });
}

export function buildSportmonksFixtureIdentityEnvelope(
  fixture: SportmonksFixtureLike | NormalizedSportmonksFixture,
  meta?: SportmonksCanonicalMeta,
): ProviderEnvelope<CanonicalFixtureIdentity> {
  const normalized = normalizedFixture(fixture);
  return providerEnvelope({
    role: 'fixture_identity',
    fixture: normalized,
    normalized: sportmonksFixtureToCanonicalIdentity(fixture, meta),
    itemCount: normalized.providerFixtureId ? 1 : 0,
    expectedItemCount: 1,
    raw: metaRaw(meta, fixture),
    meta,
  });
}

export function buildSportmonksScoreClockEnvelope(
  fixture: SportmonksFixtureLike | NormalizedSportmonksFixture,
  meta?: SportmonksCanonicalMeta,
): ProviderEnvelope<CanonicalScoreClock> {
  const normalized = normalizedFixture(fixture);
  const score = getSportmonksCurrentScore(normalized);
  return providerEnvelope({
    role: 'fixture_score',
    fixture: normalized,
    normalized: sportmonksFixtureToCanonicalScoreClock(fixture),
    itemCount: score.home == null && score.away == null ? 0 : 1,
    expectedItemCount: 1,
    raw: metaRaw(meta, fixture),
    meta,
  });
}

export function buildSportmonksEventsEnvelope(
  fixture: SportmonksFixtureLike | NormalizedSportmonksFixture,
  meta?: SportmonksCanonicalMeta,
): ProviderEnvelope<CanonicalMatchEvent[]> {
  const normalized = normalizedFixture(fixture);
  const events = sportmonksFixtureToCanonicalEvents(normalized);
  return providerEnvelope({
    role: 'event_timeline',
    fixture: normalized,
    normalized: events,
    itemCount: events.length,
    raw: metaRaw(meta, fixture),
    meta,
  });
}

export function buildSportmonksStatisticsEnvelope(
  fixture: SportmonksFixtureLike | NormalizedSportmonksFixture,
  meta?: SportmonksCanonicalMeta,
): ProviderEnvelope<CanonicalTeamStatistics> {
  const normalized = normalizedFixture(fixture);
  const stats = sportmonksFixtureToCanonicalStatistics(normalized);
  const itemCount = Object.entries(stats)
    .filter(([key]) => key !== 'rawTypeMap')
    .reduce((count, [, value]) => {
      const side = value as { home?: unknown; away?: unknown };
      return count + (side.home != null ? 1 : 0) + (side.away != null ? 1 : 0);
    }, 0);
  return providerEnvelope({
    role: 'fixture_statistics',
    fixture: normalized,
    normalized: stats,
    itemCount,
    expectedItemCount: normalized.statistics.length > 0 ? 2 : null,
    raw: metaRaw(meta, fixture),
    meta,
  });
}

export function buildSportmonksOddsEnvelope(
  input: BuildSportmonksOddsEnvelopeInput,
): ProviderEnvelope<CanonicalOddsSnapshot> {
  const normalized = normalizedFixture(input.fixture);
  const snapshot = sportmonksFixtureToCanonicalOddsSnapshot(normalized, {
    matchId: input.matchId,
    fetchedAt: fetchedAt(input),
    generatedAt: input.generatedAt,
    warnings: input.warnings,
  });
  return providerEnvelope({
    role: 'live_odds',
    fixture: normalized,
    normalized: snapshot,
    itemCount: snapshot.selections.length,
    raw: metaRaw(input, input.fixture),
    meta: input,
  });
}

export function buildSportmonksAccessErrorEnvelope<T>(
  input: SportmonksAccessErrorInput,
): ProviderEnvelope<T> {
  const access = classifySportmonksAccessError(input);
  return providerEnvelope<T>({
    role: input.role,
    providerFixtureId: input.providerFixtureId ?? null,
    normalized: null,
    itemCount: 0,
    raw: null,
    meta: {
      matchId: input.matchId,
      fetchedAt: input.fetchedAt,
      statusCode: input.statusCode,
      error: input.error instanceof Error ? input.error.message : String(input.error),
      rateLimit: input.rateLimit,
      warnings: [...warningStrings(input.warnings), ...access.warnings],
    },
  });
}
