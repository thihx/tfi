import type {
  ApiFixture,
  ApiFixtureEvent,
  ApiFixtureLineup,
  ApiFixtureStat,
} from './football-api.js';
import {
  apiFootballEventsToCanonicalEvents,
  apiFootballFixtureToCanonicalIdentity,
  apiFootballStatisticsToCanonicalTeamStatistics,
  buildApiFootballFixtureIdentityEnvelope,
  buildApiFootballOddsEnvelope,
  buildApiFootballScoreClockEnvelope,
} from './canonical/api-football-adapter.js';
import {
  buildProviderEnvelope,
  type CanonicalFixtureIdentity,
  type CanonicalMatchEvent,
  type CanonicalScoreClock,
  type CanonicalTeamStatistics,
  type ProviderEnvelope,
  type ProviderId,
  type ProviderMappingConfidence,
} from './canonical/provider-domain.js';
import type { ProviderFusionSourceEnvelopes } from './provider-fusion-snapshot.js';
import type { ResolvedOddsSource } from './odds-resolver.js';
import { extractHalftimeScoreFromFixture } from './settle-context.js';

export type PipelineProviderFixturePayload = ApiFixture;
export type PipelineProviderStatisticRow = ApiFixtureStat;
export type PipelineProviderEventRow = ApiFixtureEvent;
export type PipelineProviderLineupRow = ApiFixtureLineup;

export type PipelineSideValue = { home: string | null; away: string | null };

export interface PipelineStatsCompact {
  possession: PipelineSideValue;
  shots: PipelineSideValue;
  shots_on_target: PipelineSideValue;
  corners: PipelineSideValue;
  fouls: PipelineSideValue;
  offsides: PipelineSideValue;
  yellow_cards: PipelineSideValue;
  red_cards: PipelineSideValue;
  goalkeeper_saves: PipelineSideValue;
  blocked_shots: PipelineSideValue;
  total_passes: PipelineSideValue;
  passes_accurate: PipelineSideValue;
  shots_off_target?: PipelineSideValue;
  shots_inside_box?: PipelineSideValue;
  shots_outside_box?: PipelineSideValue;
  expected_goals?: PipelineSideValue;
  goals_prevented?: PipelineSideValue;
  passes_percent?: PipelineSideValue;
}

export interface PipelineEventCompact {
  minute: number;
  extra: number | null;
  team: string;
  type: string;
  detail: string;
  player: string;
}

export type PipelineProviderStatsCoverage = 'complete' | 'partial' | 'empty' | 'missing';
export type PipelineProviderClockLagStatus = 'ok' | 'warning' | 'degraded' | 'critical' | 'unknown';
export type PipelineProviderCoverageStatus = 'full' | 'no_live_stats' | 'clock_lag' | 'clock_lag_no_live_stats' | 'provider_unavailable';

export interface PipelineProviderHealthSnapshot {
  provider: ProviderId;
  statisticsCoverage: PipelineProviderStatsCoverage;
  providerReturnedNoLiveStatistics: boolean;
  providerClockLagMinutes: number | null;
  providerClockLagStatus: PipelineProviderClockLagStatus;
  providerReportedMinute: number | null;
  wallClockMinute: number | null;
  fixtureFreshness: string;
  statisticsFreshness: string;
  eventsFreshness: string;
  coverageStatus: PipelineProviderCoverageStatus;
  warnings: string[];
}

export interface PipelineTeamRef {
  id: number | null;
  name: string;
}

export interface PipelineFixtureInput {
  matchId: string;
  matchDisplay: string;
  home: PipelineTeamRef;
  away: PipelineTeamRef;
  league: {
    id: number | null;
    name: string;
    country: string | null;
    season: number | null;
    round: string | null;
  };
  status: {
    short: string;
    long: string;
    minute: number;
  };
  score: {
    home: number;
    away: number;
    text: string;
  };
  kickoff: {
    iso: string | null;
    timestamp: number | null;
  };
  halftimeScore: { home: number | null; away: number | null } | null;
  provider: {
    id: ProviderId;
    fixtureId: string | number | null;
    sourceShape: 'api-football';
  };
  providerPayload: ApiFixture;
}

export interface PipelineLineupsPromptSummary {
  available: boolean;
  teams: Array<{
    side: 'home' | 'away';
    teamName: string;
    formation: string | null;
    confirmedStarters: string[];
    benchCount: number;
  }>;
}

export interface PipelineProviderFusionSourceInput {
  matchId: string;
  fixture: PipelineFixtureInput;
  statisticsRaw: PipelineProviderStatisticRow[];
  eventsRaw: PipelineProviderEventRow[];
  oddsResponse: unknown[];
  oddsSource: ResolvedOddsSource;
  oddsFetchedAt: string | null;
  statisticsProvider?: string | null;
  eventsProvider?: string | null;
  statisticsProviderFixtureId?: string | number | null;
  eventsProviderFixtureId?: string | number | null;
  statisticsMappingConfidence?: ProviderMappingConfidence | string | null;
  eventsMappingConfidence?: ProviderMappingConfidence | string | null;
  generatedAt: string;
}

const API_FOOTBALL_PROVIDER: ProviderId = 'api-football';

function cleanString(value: unknown): string {
  return value == null ? '' : String(value).trim();
}

function getStatValue(
  teamStats: Array<{ type: string; value: string | number | null }>,
  statName: string,
): string | null {
  if (!Array.isArray(teamStats)) return null;
  const stat = teamStats.find((s) => s.type === statName);
  return stat?.value != null ? String(stat.value) : null;
}

function parseTwoSide(h: string | null, a: string | null): PipelineSideValue {
  return { home: h ?? null, away: a ?? null };
}

function normalizeProvider(value: string | null | undefined): ProviderId {
  const text = cleanString(value).toLowerCase();
  if (text.includes('sportmonks')) return 'sportmonks';
  return API_FOOTBALL_PROVIDER;
}

function normalizeMappingConfidence(value: unknown, fallback: ProviderMappingConfidence): ProviderMappingConfidence {
  if (value === 'verified' || value === 'high' || value === 'medium' || value === 'low' || value === 'unknown') {
    return value;
  }
  return fallback;
}

function oddsSourceKind(source: ResolvedOddsSource): 'live' | 'reference' {
  return source === 'reference-prematch' ? 'reference' : 'live';
}

function providerFixtureIdFor(provider: ProviderId, fixture: PipelineFixtureInput, explicit: string | number | null | undefined): string | number | null {
  return explicit ?? fixture.provider.fixtureId ?? provider;
}

function scoreText(home: number, away: number): string {
  return `${home}-${away}`;
}

export function buildPipelineFixtureInput(args: {
  matchId: string;
  fixture: ApiFixture;
  watchlistFallback?: {
    home_team?: string | null;
    away_team?: string | null;
    league?: string | null;
  };
}): PipelineFixtureInput {
  const homeName = cleanString(args.fixture.teams?.home?.name) || cleanString(args.watchlistFallback?.home_team);
  const awayName = cleanString(args.fixture.teams?.away?.name) || cleanString(args.watchlistFallback?.away_team);
  const homeGoals = args.fixture.goals?.home ?? 0;
  const awayGoals = args.fixture.goals?.away ?? 0;
  return {
    matchId: args.matchId,
    matchDisplay: `${homeName} vs ${awayName}`,
    home: {
      id: args.fixture.teams?.home?.id ?? null,
      name: homeName,
    },
    away: {
      id: args.fixture.teams?.away?.id ?? null,
      name: awayName,
    },
    league: {
      id: args.fixture.league?.id ?? null,
      name: cleanString(args.fixture.league?.name) || cleanString(args.watchlistFallback?.league),
      country: args.fixture.league?.country ?? null,
      season: args.fixture.league?.season ?? null,
      round: args.fixture.league?.round ?? null,
    },
    status: {
      short: cleanString(args.fixture.fixture?.status?.short) || 'UNKNOWN',
      long: cleanString(args.fixture.fixture?.status?.long),
      minute: args.fixture.fixture?.status?.elapsed ?? 0,
    },
    score: {
      home: homeGoals,
      away: awayGoals,
      text: scoreText(homeGoals, awayGoals),
    },
    kickoff: {
      iso: args.fixture.fixture?.date ?? null,
      timestamp: args.fixture.fixture?.timestamp ?? null,
    },
    halftimeScore: extractHalftimeScoreFromFixture(args.fixture),
    provider: {
      id: API_FOOTBALL_PROVIDER,
      fixtureId: args.fixture.fixture?.id ?? args.matchId,
      sourceShape: 'api-football',
    },
    providerPayload: args.fixture,
  };
}

export function buildPipelineStatsCompact(
  homeStats: Array<{ type: string; value: string | number | null }>,
  awayStats: Array<{ type: string; value: string | number | null }>,
): PipelineStatsCompact {
  const getStat = (name: string) => parseTwoSide(
    getStatValue(homeStats, name),
    getStatValue(awayStats, name),
  );
  return {
    possession: getStat('Ball Possession'),
    shots: getStat('Total Shots'),
    shots_on_target: getStat('Shots on Goal'),
    corners: getStat('Corner Kicks'),
    fouls: getStat('Fouls'),
    offsides: getStat('Offsides'),
    yellow_cards: getStat('Yellow Cards'),
    red_cards: getStat('Red Cards'),
    goalkeeper_saves: getStat('Goalkeeper Saves'),
    blocked_shots: getStat('Blocked Shots'),
    total_passes: getStat('Total passes'),
    passes_accurate: getStat('Passes accurate'),
    shots_off_target: getStat('Shots off Goal'),
    shots_inside_box: getStat('Shots insidebox'),
    shots_outside_box: getStat('Shots outsidebox'),
    expected_goals: getStat('expected_goals'),
    goals_prevented: getStat('goals_prevented'),
    passes_percent: getStat('Passes %'),
  };
}

export function buildPipelineEventsCompact(
  events: PipelineProviderEventRow[],
  fixture: PipelineFixtureInput,
): PipelineEventCompact[] {
  const sorted = [...events].sort((a, b) => (a.time?.elapsed || 0) - (b.time?.elapsed || 0));
  const compact: PipelineEventCompact[] = [];

  for (const ev of sorted) {
    const teamId = ev.team?.id;
    const sideName = teamId === fixture.home.id ? fixture.home.name : teamId === fixture.away.id ? fixture.away.name : (ev.team?.name || '');
    const type = ev.type || '';
    const detail = ev.detail || '';
    const minute = ev.time?.elapsed ?? 0;

    if (type === 'Goal') {
      compact.push({ minute, extra: ev.time?.extra ?? null, team: sideName, type: 'goal', detail, player: ev.player?.name || '' });
    }
    if (type === 'Card') {
      compact.push({ minute, extra: ev.time?.extra ?? null, team: sideName, type: 'card', detail, player: ev.player?.name || '' });
    }
    if (type === 'subst') {
      const playerIn = ev.assist?.name || '';
      const playerOut = ev.player?.name || '';
      compact.push({ minute, extra: ev.time?.extra ?? null, team: sideName, type: 'subst', detail: `${playerIn} for ${playerOut}`, player: playerIn });
    }
  }

  return compact;
}

export function summarizePipelineStatsCoverage(
  statsCompact: PipelineStatsCompact,
  statsRaw: PipelineProviderStatisticRow[],
  eventsRaw: PipelineProviderEventRow[],
  statsError: unknown,
  eventsError: unknown,
): Record<string, unknown> {
  const tracked = [
    statsCompact.possession,
    statsCompact.shots,
    statsCompact.shots_on_target,
    statsCompact.corners,
    statsCompact.fouls,
    statsCompact.offsides,
    statsCompact.yellow_cards,
    statsCompact.red_cards,
    statsCompact.goalkeeper_saves,
    statsCompact.blocked_shots,
    statsCompact.total_passes,
    statsCompact.passes_accurate,
  ];
  const populated = tracked.filter((value) => value.home != null || value.away != null).length;
  return {
    team_count: statsRaw.length,
    event_count: eventsRaw.length,
    populated_stat_pairs: populated,
    total_stat_pairs: tracked.length,
    has_possession: statsCompact.possession.home != null || statsCompact.possession.away != null,
    has_shots: statsCompact.shots.home != null || statsCompact.shots.away != null,
    has_shots_on_target: statsCompact.shots_on_target.home != null || statsCompact.shots_on_target.away != null,
    has_corners: statsCompact.corners.home != null || statsCompact.corners.away != null,
    stats_fetch_ok: !statsError,
    events_fetch_ok: !eventsError,
  };
}

export function classifyPipelineProviderStatisticsCoverage(args: {
  statsRaw: PipelineProviderStatisticRow[];
  statsAvailable: boolean;
  freshness: string;
  cacheStatus: string;
}): PipelineProviderStatsCoverage {
  if (args.statsAvailable) return args.statsRaw.length >= 2 ? 'complete' : 'partial';
  if (Array.isArray(args.statsRaw) && args.statsRaw.length === 0 && args.cacheStatus !== 'miss') return 'empty';
  if (args.freshness === 'fresh' && Array.isArray(args.statsRaw) && args.statsRaw.length === 0) return 'empty';
  return 'missing';
}

export function buildPipelineProviderHealthSnapshot(args: {
  provider: ProviderId;
  minute: number;
  statsRaw: PipelineProviderStatisticRow[];
  statsAvailable: boolean;
  fixtureFreshness: string;
  statisticsFreshness: string;
  statisticsCacheStatus: string;
  eventsFreshness: string;
}): PipelineProviderHealthSnapshot {
  const clock: Pick<PipelineProviderHealthSnapshot, 'providerClockLagMinutes' | 'providerClockLagStatus' | 'providerReportedMinute' | 'wallClockMinute'> = {
    providerClockLagMinutes: null,
    providerClockLagStatus: 'unknown',
    providerReportedMinute: Number.isFinite(args.minute) ? args.minute : null,
    wallClockMinute: null,
  };
  const statisticsCoverage = classifyPipelineProviderStatisticsCoverage({
    statsRaw: args.statsRaw,
    statsAvailable: args.statsAvailable,
    freshness: args.statisticsFreshness,
    cacheStatus: args.statisticsCacheStatus,
  });
  const providerReturnedNoLiveStatistics = statisticsCoverage === 'empty';
  const warnings: string[] = [];
  if (providerReturnedNoLiveStatistics) warnings.push('provider_returned_no_live_statistics');

  // Phase 10 keeps clock lag unknown unless a provider exposes a trusted live-clock field.
  // This prevents the old false "provider clock delayed" diagnosis from re-entering the pipeline.
  let coverageStatus: PipelineProviderCoverageStatus = 'full';
  if (providerReturnedNoLiveStatistics) {
    coverageStatus = 'no_live_stats';
  } else if (args.fixtureFreshness === 'missing') {
    coverageStatus = 'provider_unavailable';
  }

  return {
    provider: args.provider,
    statisticsCoverage,
    providerReturnedNoLiveStatistics,
    providerClockLagMinutes: clock.providerClockLagMinutes,
    providerClockLagStatus: clock.providerClockLagStatus,
    providerReportedMinute: clock.providerReportedMinute,
    wallClockMinute: clock.wallClockMinute,
    fixtureFreshness: args.fixtureFreshness,
    statisticsFreshness: args.statisticsFreshness,
    eventsFreshness: args.eventsFreshness,
    coverageStatus,
    warnings,
  };
}

export function summarizePipelineLineupsForPrompt(
  lineups: PipelineProviderLineupRow[] | null | undefined,
  fixture: Pick<PipelineFixtureInput, 'home' | 'away'>,
): PipelineLineupsPromptSummary | null {
  if (!Array.isArray(lineups) || lineups.length === 0) return null;

  const teams = lineups.map((row) => {
    const normalizedName = String(row.team?.name ?? '').trim().toLowerCase();
    const side: 'home' | 'away' = normalizedName === fixture.away.name.trim().toLowerCase() ? 'away' : 'home';
    return {
      side,
      teamName: String(row.team?.name ?? (side === 'home' ? fixture.home.name : fixture.away.name)).trim(),
      formation: row.formation ? String(row.formation).trim() : null,
      confirmedStarters: Array.isArray(row.startXI)
        ? row.startXI
            .map((entry) => {
              const name = String(entry.player?.name ?? '').trim();
              const pos = entry.player?.pos ? ` (${entry.player.pos})` : '';
              return name ? `${name}${pos}` : '';
            })
            .filter(Boolean)
            .slice(0, 11)
        : [],
      benchCount: Array.isArray(row.substitutes) ? row.substitutes.length : 0,
    };
  });

  return { available: teams.length > 0, teams };
}

function mappedFixtureIdentity(
  fixture: PipelineFixtureInput,
  provider: ProviderId,
  providerFixtureId: string | number | null | undefined,
  confidence: ProviderMappingConfidence,
): CanonicalFixtureIdentity {
  const identity = apiFootballFixtureToCanonicalIdentity(fixture.providerPayload);
  return {
    ...identity,
    providerFixtureIds: {
      ...identity.providerFixtureIds,
      [provider]: cleanString(providerFixtureId ?? fixture.provider.fixtureId),
    },
    mappingConfidence: confidence,
  };
}

function buildMappedFixtureEnvelope(
  fixture: PipelineFixtureInput,
  provider: ProviderId,
  providerFixtureId: string | number | null | undefined,
  confidence: ProviderMappingConfidence,
  fetchedAt: string,
): ProviderEnvelope<CanonicalFixtureIdentity> {
  return buildProviderEnvelope<CanonicalFixtureIdentity>({
    provider,
    role: 'fixture_identity',
    providerFixtureId: providerFixtureIdFor(provider, fixture, providerFixtureId),
    matchId: fixture.matchId,
    fetchedAt,
    raw: null,
    normalized: mappedFixtureIdentity(fixture, provider, providerFixtureId, confidence),
    coverage: { fetched: true, itemCount: 1, expectedItemCount: 1 },
    freshness: 'fresh',
    quota: 'unknown',
    warnings: ['mapped_fixture_identity_for_shadow_read'],
  });
}

function countCanonicalStats(stats: CanonicalTeamStatistics): number {
  return Object.entries(stats)
    .filter(([key]) => key !== 'rawTypeMap')
    .reduce((count, [, value]) => {
      const side = value as { home?: unknown; away?: unknown } | undefined;
      return count + (side?.home != null ? 1 : 0) + (side?.away != null ? 1 : 0);
    }, 0);
}

function buildStatisticsEnvelope(
  input: PipelineProviderFusionSourceInput,
  provider: ProviderId,
  fetchedAt: string,
): ProviderEnvelope<CanonicalTeamStatistics> {
  const normalized = apiFootballStatisticsToCanonicalTeamStatistics(input.fixture.providerPayload, input.statisticsRaw);
  return buildProviderEnvelope<CanonicalTeamStatistics>({
    provider,
    role: 'fixture_statistics',
    providerFixtureId: providerFixtureIdFor(provider, input.fixture, input.statisticsProviderFixtureId),
    matchId: input.matchId,
    fetchedAt,
    raw: null,
    normalized,
    coverage: {
      fetched: true,
      itemCount: countCanonicalStats(normalized),
      expectedItemCount: input.statisticsRaw.length > 0 ? 2 : null,
      warnings: provider === API_FOOTBALL_PROVIDER ? [] : ['api_football_shape_from_provider_cache'],
    },
    freshness: 'fresh',
    quota: 'unknown',
  });
}

function buildEventsEnvelope(
  input: PipelineProviderFusionSourceInput,
  provider: ProviderId,
  fetchedAt: string,
): ProviderEnvelope<CanonicalMatchEvent[]> {
  const normalized = apiFootballEventsToCanonicalEvents(input.fixture.providerPayload, input.eventsRaw);
  return buildProviderEnvelope<CanonicalMatchEvent[]>({
    provider,
    role: 'event_timeline',
    providerFixtureId: providerFixtureIdFor(provider, input.fixture, input.eventsProviderFixtureId),
    matchId: input.matchId,
    fetchedAt,
    raw: null,
    normalized,
    coverage: {
      fetched: true,
      itemCount: normalized.length,
      warnings: provider === API_FOOTBALL_PROVIDER ? [] : ['api_football_shape_from_provider_cache'],
    },
    freshness: 'fresh',
    quota: 'unknown',
  });
}

function buildScoreEnvelope(
  fixture: PipelineFixtureInput,
  fetchedAt: string,
): ProviderEnvelope<CanonicalScoreClock> {
  return buildApiFootballScoreClockEnvelope(fixture.providerPayload, { fetchedAt, raw: null });
}

export function buildPipelineProviderFusionSources(input: PipelineProviderFusionSourceInput): ProviderFusionSourceEnvelopes[] {
  const statisticsProvider = normalizeProvider(input.statisticsProvider);
  const eventsProvider = normalizeProvider(input.eventsProvider);
  const statisticsConfidence = normalizeMappingConfidence(
    input.statisticsMappingConfidence,
    statisticsProvider === API_FOOTBALL_PROVIDER ? 'verified' : 'high',
  );
  const eventsConfidence = normalizeMappingConfidence(
    input.eventsMappingConfidence,
    eventsProvider === API_FOOTBALL_PROVIDER ? 'verified' : 'high',
  );
  const sources = new Map<string, ProviderFusionSourceEnvelopes>();
  const sourceFor = (provider: ProviderId): ProviderFusionSourceEnvelopes => {
    const existing = sources.get(provider);
    if (existing) return existing;
    const next: ProviderFusionSourceEnvelopes = {};
    sources.set(provider, next);
    return next;
  };

  const api = sourceFor(API_FOOTBALL_PROVIDER);
  api.fixture = buildApiFootballFixtureIdentityEnvelope(input.fixture.providerPayload, { fetchedAt: input.generatedAt, raw: null });
  api.scoreClock = buildScoreEnvelope(input.fixture, input.generatedAt);
  api.odds = buildApiFootballOddsEnvelope({
    matchId: input.matchId,
    providerFixtureId: input.fixture.provider.fixtureId,
    response: input.oddsResponse,
    sourceKind: oddsSourceKind(input.oddsSource),
    fetchedAt: input.oddsFetchedAt ?? input.generatedAt,
    generatedAt: input.generatedAt,
    raw: null,
    warnings: input.oddsSource === 'none' ? ['legacy_odds_source_none'] : [],
  });

  const statsSource = sourceFor(statisticsProvider);
  statsSource.fixture ??= buildMappedFixtureEnvelope(
    input.fixture,
    statisticsProvider,
    input.statisticsProviderFixtureId,
    statisticsConfidence,
    input.generatedAt,
  );
  statsSource.statistics = buildStatisticsEnvelope(input, statisticsProvider, input.generatedAt);

  const eventsSource = sourceFor(eventsProvider);
  eventsSource.fixture ??= buildMappedFixtureEnvelope(
    input.fixture,
    eventsProvider,
    input.eventsProviderFixtureId,
    eventsConfidence,
    input.generatedAt,
  );
  eventsSource.events = buildEventsEnvelope(input, eventsProvider, input.generatedAt);

  return [...sources.values()];
}
