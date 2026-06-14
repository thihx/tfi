import type { ApiFixture, ApiFixtureEvent, ApiFixtureStat } from '../football-api.js';
import {
  buildCanonicalFixtureIdentity,
  buildCanonicalMatchEvent,
  buildCanonicalScoreClock,
  buildCanonicalTeamStatistics,
  buildProviderEnvelope,
  type CanonicalFixtureIdentity,
  type CanonicalMatchEvent,
  type CanonicalPeriod,
  type CanonicalScoreClock,
  type CanonicalTeamSide,
  type CanonicalTeamStatistics,
  type ProviderEnvelope,
  type ProviderRole,
} from './provider-domain.js';
import {
  buildApiFootballOddsSnapshot,
  type ApiFootballOddsSourceKind,
} from './api-football-odds-adapter.js';

export const API_FOOTBALL_PROVIDER = 'api-football';

export interface ApiFootballAdapterMeta {
  fetchedAt?: string;
  latencyMs?: number | null;
  statusCode?: number | null;
  raw?: unknown;
  error?: string | null;
  warnings?: unknown[];
}

export interface BuildApiFootballOddsEnvelopeInput extends ApiFootballAdapterMeta {
  matchId: string;
  response: unknown[];
  sourceKind: ApiFootballOddsSourceKind;
  providerFixtureId?: string | number | null;
  generatedAt?: string;
}

const EMPTY_EPOCH = new Date(0).toISOString();

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

function fetchedAt(meta?: ApiFootballAdapterMeta): string {
  return stringOrNull(meta?.fetchedAt) ?? EMPTY_EPOCH;
}

function statusToPeriod(short: string): CanonicalPeriod {
  const status = short.toUpperCase();
  if (['TBD', 'NS', 'PST', 'CANC', 'ABD', 'AWD', 'WO'].includes(status)) return 'pre';
  if (status === '1H') return '1h';
  if (status === 'HT' || status === 'BT' || status === 'INT') return 'ht';
  if (status === '2H') return '2h';
  if (status === 'ET' || status === 'AET') return 'et';
  if (status === 'P') return 'pen';
  if (status === 'PEN' || status === 'FT') return 'ft';
  return 'unknown';
}

function teamSide(fixture: ApiFixture, teamId: number | null | undefined): CanonicalTeamSide {
  if (teamId === fixture.teams.home.id) return 'home';
  if (teamId === fixture.teams.away.id) return 'away';
  return 'unknown';
}

function periodStartTimestamp(fixture: ApiFixture, period: CanonicalPeriod): number | null {
  const periods = fixture.fixture.periods;
  if (period === '1h') return periods?.first ?? null;
  if (period === '2h') return periods?.second ?? periods?.first ?? null;
  return null;
}

function wallClockMinuteEstimate(fixture: ApiFixture, period: CanonicalPeriod, now?: Date): number | null {
  const periodStart = periodStartTimestamp(fixture, period);
  if (periodStart == null || !now) return null;
  const elapsed = Math.floor((now.getTime() / 1000 - periodStart) / 60);
  if (!Number.isFinite(elapsed) || elapsed < 0) return null;
  return Math.min(elapsed, 130);
}

function eventType(type: string, detail: string): CanonicalMatchEvent['type'] {
  const text = `${type} ${detail}`.toLowerCase();
  if (text.includes('var')) return 'var';
  if (text.includes('penalty')) return 'penalty';
  if (text.includes('goal')) return 'goal';
  if (text.includes('card')) return 'card';
  if (text.includes('subst')) return 'substitution';
  if (text.includes('period')) return 'period';
  return 'other';
}

function statKey(type: string): Exclude<keyof CanonicalTeamStatistics, 'rawTypeMap'> | null {
  const normalized = type.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const byName: Record<string, Exclude<keyof CanonicalTeamStatistics, 'rawTypeMap'>> = {
    'ball possession': 'possessionPct',
    possession: 'possessionPct',
    'total shots': 'shotsTotal',
    shots: 'shotsTotal',
    'shots on goal': 'shotsOnTarget',
    'shots on target': 'shotsOnTarget',
    corners: 'corners',
    'corner kicks': 'corners',
    fouls: 'fouls',
    'yellow cards': 'yellowCards',
    'red cards': 'redCards',
    'expected goals': 'expectedGoals',
    xg: 'expectedGoals',
    expected_goals: 'expectedGoals',
    'total passes': 'passes',
    passes: 'passes',
    attacks: 'attacks',
    'dangerous attacks': 'dangerousAttacks',
  };
  return byName[normalized] ?? null;
}

function numericStatValue(value: string | number | null): number | null {
  if (value == null || value === '') return null;
  if (typeof value === 'string' && value.trim().endsWith('%')) {
    return numberOrNull(value.trim().slice(0, -1));
  }
  return numberOrNull(value);
}

function statCoverageItemCount(stats: CanonicalTeamStatistics): number {
  return Object.entries(stats)
    .filter(([key, value]) => key !== 'rawTypeMap' && value && typeof value === 'object')
    .reduce((count, [, value]) => {
      const side = value as { home?: unknown; away?: unknown };
      return count + (side.home != null ? 1 : 0) + (side.away != null ? 1 : 0);
    }, 0);
}

function apiFootballEnvelope<T>(input: {
  role: ProviderRole;
  matchId?: string | number | null;
  providerFixtureId?: string | number | null;
  normalized: T | null;
  itemCount: number;
  expectedItemCount?: number | null;
  raw: unknown;
  meta?: ApiFootballAdapterMeta;
}): ProviderEnvelope<T> {
  const error = cleanString(input.meta?.error);
  const success = error === '';
  return buildProviderEnvelope<T>({
    provider: API_FOOTBALL_PROVIDER,
    role: input.role,
    providerFixtureId: input.providerFixtureId ?? input.matchId ?? null,
    matchId: input.matchId ?? null,
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
    quota: 'unknown',
    error,
    warnings: warningStrings(input.meta?.warnings),
  });
}

export function apiFootballFixtureToCanonicalIdentity(fixture: ApiFixture): CanonicalFixtureIdentity {
  return buildCanonicalFixtureIdentity({
    matchId: fixture.fixture.id,
    providerFixtureIds: {
      [API_FOOTBALL_PROVIDER]: fixture.fixture.id,
    },
    kickoffAtUtc: fixture.fixture.date,
    league: {
      id: String(fixture.league.id),
      name: fixture.league.name,
      country: fixture.league.country,
      season: fixture.league.season,
      logo: fixture.league.logo,
    },
    home: {
      id: String(fixture.teams.home.id),
      name: fixture.teams.home.name,
      logo: fixture.teams.home.logo,
    },
    away: {
      id: String(fixture.teams.away.id),
      name: fixture.teams.away.name,
      logo: fixture.teams.away.logo,
    },
    mappingConfidence: 'verified',
  });
}

export function apiFootballFixtureToCanonicalScoreClock(
  fixture: ApiFixture,
  options: { now?: Date } = {},
): CanonicalScoreClock {
  const period = statusToPeriod(fixture.fixture.status.short);
  const estimate = wallClockMinuteEstimate(fixture, period, options.now);
  const providerMinute = numberOrNull(fixture.fixture.status.elapsed);
  return buildCanonicalScoreClock({
    status: fixture.fixture.status.short || fixture.fixture.status.long,
    minute: providerMinute,
    injuryTime: null,
    period,
    score: {
      home: fixture.goals.home,
      away: fixture.goals.away,
    },
    wallClockMinuteEstimate: estimate,
    providerClockLagMinutes: estimate != null && providerMinute != null ? estimate - providerMinute : null,
  });
}

export function apiFootballEventsToCanonicalEvents(
  fixture: ApiFixture,
  events: ApiFixtureEvent[],
): CanonicalMatchEvent[] {
  return events.map((event) => buildCanonicalMatchEvent({
    minute: event.time.elapsed,
    extra: event.time.extra,
    teamSide: teamSide(fixture, event.team?.id),
    team: {
      id: String(event.team?.id ?? ''),
      name: event.team?.name ?? '',
      logo: event.team?.logo ?? null,
    },
    playerName: event.player?.name ?? null,
    assistName: event.assist?.name ?? null,
    type: eventType(event.type, event.detail),
    detail: event.detail,
    sourceEventId: null,
  }));
}

export function apiFootballStatisticsToCanonicalTeamStatistics(
  fixture: ApiFixture,
  stats: ApiFixtureStat[],
): CanonicalTeamStatistics {
  const accum: Record<string, { home: number | null; away: number | null }> = {};
  const rawTypeMap: Record<string, unknown> = {};

  for (const teamStats of stats) {
    const side = teamSide(fixture, teamStats.team.id);
    if (side !== 'home' && side !== 'away') {
      rawTypeMap[`unknown_team:${teamStats.team.id}`] = teamStats;
      continue;
    }

    for (const row of teamStats.statistics) {
      const key = statKey(row.type);
      const value = numericStatValue(row.value);
      if (!key) {
        rawTypeMap[row.type] = {
          ...(rawTypeMap[row.type] && typeof rawTypeMap[row.type] === 'object' ? rawTypeMap[row.type] as Record<string, unknown> : {}),
          [side]: row.value,
        };
        continue;
      }
      accum[key] ??= { home: null, away: null };
      accum[key][side] = value;
    }
  }

  return buildCanonicalTeamStatistics({
    ...accum,
    rawTypeMap,
  });
}

export function buildApiFootballFixtureIdentityEnvelope(
  fixture: ApiFixture,
  meta?: ApiFootballAdapterMeta,
): ProviderEnvelope<CanonicalFixtureIdentity> {
  return apiFootballEnvelope({
    role: 'fixture_identity',
    matchId: fixture.fixture.id,
    providerFixtureId: fixture.fixture.id,
    normalized: apiFootballFixtureToCanonicalIdentity(fixture),
    itemCount: 1,
    expectedItemCount: 1,
    raw: meta?.raw ?? fixture,
    meta,
  });
}

export function buildApiFootballScoreClockEnvelope(
  fixture: ApiFixture,
  meta?: ApiFootballAdapterMeta & { now?: Date },
): ProviderEnvelope<CanonicalScoreClock> {
  return apiFootballEnvelope({
    role: 'fixture_score',
    matchId: fixture.fixture.id,
    providerFixtureId: fixture.fixture.id,
    normalized: apiFootballFixtureToCanonicalScoreClock(fixture, { now: meta?.now }),
    itemCount: fixture.goals.home == null && fixture.goals.away == null ? 0 : 1,
    expectedItemCount: 1,
    raw: meta?.raw ?? fixture,
    meta,
  });
}

export function buildApiFootballEventsEnvelope(
  fixture: ApiFixture,
  events: ApiFixtureEvent[],
  meta?: ApiFootballAdapterMeta,
): ProviderEnvelope<CanonicalMatchEvent[]> {
  return apiFootballEnvelope({
    role: 'event_timeline',
    matchId: fixture.fixture.id,
    providerFixtureId: fixture.fixture.id,
    normalized: apiFootballEventsToCanonicalEvents(fixture, events),
    itemCount: events.length,
    raw: meta?.raw ?? events,
    meta,
  });
}

export function buildApiFootballStatisticsEnvelope(
  fixture: ApiFixture,
  stats: ApiFixtureStat[],
  meta?: ApiFootballAdapterMeta,
): ProviderEnvelope<CanonicalTeamStatistics> {
  const normalized = apiFootballStatisticsToCanonicalTeamStatistics(fixture, stats);
  return apiFootballEnvelope({
    role: 'fixture_statistics',
    matchId: fixture.fixture.id,
    providerFixtureId: fixture.fixture.id,
    normalized,
    itemCount: statCoverageItemCount(normalized),
    expectedItemCount: stats.length > 0 ? 2 : null,
    raw: meta?.raw ?? stats,
    meta,
  });
}

export function buildApiFootballOddsEnvelope(
  input: BuildApiFootballOddsEnvelopeInput,
): ProviderEnvelope<ReturnType<typeof buildApiFootballOddsSnapshot>> {
  const snapshot = buildApiFootballOddsSnapshot({
    matchId: input.matchId,
    response: input.response,
    sourceKind: input.sourceKind,
    fetchedAt: fetchedAt(input),
    generatedAt: input.generatedAt,
    warnings: input.warnings,
  });
  return apiFootballEnvelope({
    role: input.sourceKind === 'live' ? 'live_odds' : 'reference_odds',
    matchId: input.matchId,
    providerFixtureId: input.providerFixtureId ?? input.matchId,
    normalized: snapshot,
    itemCount: snapshot.selections.length,
    raw: input.raw ?? input.response,
    meta: input,
  });
}

export function buildApiFootballFetchErrorEnvelope<T>(
  input: {
    role: ProviderRole;
    matchId?: string | number | null;
    providerFixtureId?: string | number | null;
    error: unknown;
    raw?: unknown;
    fetchedAt?: string;
    statusCode?: number | null;
    warnings?: unknown[];
  },
): ProviderEnvelope<T> {
  return apiFootballEnvelope<T>({
    role: input.role,
    matchId: input.matchId ?? null,
    providerFixtureId: input.providerFixtureId ?? input.matchId ?? null,
    normalized: null,
    itemCount: 0,
    raw: input.raw ?? null,
    meta: {
      fetchedAt: input.fetchedAt,
      statusCode: input.statusCode,
      error: input.error instanceof Error ? input.error.message : String(input.error),
      warnings: input.warnings,
    },
  });
}
