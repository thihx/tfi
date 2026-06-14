import type { ApiFixture, ApiFixtureEvent, ApiFixtureStat } from './football-api.js';
import {
  resolveProviderFixtureMapping,
  type ProviderFixtureMappingCandidate,
} from './provider-fixture-mapping-service.js';
import {
  fetchSportmonksFixtureById,
  fetchSportmonksFixturesByDate,
  normalizeSportmonksFixtures,
  SPORTMONKS_PROVIDER,
} from './sportmonks-api.js';
import {
  getSportmonksCurrentScore,
  getSportmonksFixtureSides,
  sportmonksEventsToApiFixtureEvents,
  sportmonksStatisticsToApiFixtureStats,
  summarizeSportmonksCoverage,
  type NormalizedSportmonksFixture,
  type SportmonksCoverageFlags,
} from './sportmonks-normalize.js';
import type { ProviderMappingConfidence } from './canonical/provider-domain.js';

export interface SportmonksSupplementResult {
  provider: typeof SPORTMONKS_PROVIDER;
  providerFixtureId: string;
  mappingMethod: string;
  mappingConfidence: ProviderMappingConfidence;
  used: boolean;
  statistics: ApiFixtureStat[];
  events: ApiFixtureEvent[];
  coverageFlags: SportmonksCoverageFlags & Record<string, unknown>;
  warnings: string[];
}

function isSportmonksRuntimeEnabled(): boolean {
  return Boolean(runtimeString('SPORTMONKS_API_TOKEN'))
    && runtimeBoolean('SPORTMONKS_ENABLED')
    && (
      runtimeBoolean('SPORTMONKS_ALLOW_STATS_FALLBACK')
      || runtimeBoolean('SPORTMONKS_ALLOW_EVENTS_FALLBACK')
    );
}

function runtimeString(key: string): string {
  return process.env[key] || '';
}

function runtimeBoolean(key: string): boolean {
  return process.env[key] === 'true';
}

function apiFixtureToMappingSource(apiFixture: ApiFixture) {
  return {
    matchId: apiFixture.fixture.id,
    kickoffAtUtc: apiFixture.fixture.date,
    kickoffTimestamp: apiFixture.fixture.timestamp,
    leagueId: apiFixture.league.id,
    leagueName: apiFixture.league.name,
    homeName: apiFixture.teams.home.name,
    awayName: apiFixture.teams.away.name,
  };
}

function sportmonksFixtureToMappingCandidate(fixture: NormalizedSportmonksFixture): ProviderFixtureMappingCandidate {
  const sides = getSportmonksFixtureSides(fixture);
  return {
    providerFixtureId: fixture.providerFixtureId,
    kickoffAtUtc: fixture.startingAt,
    kickoffTimestamp: fixture.startingAtTimestamp,
    leagueId: fixture.leagueId,
    leagueName: fixture.leagueName,
    homeName: sides.home?.name ?? '',
    awayName: sides.away?.name ?? '',
  };
}

function hasScoreConflict(apiFixture: ApiFixture, sportmonksFixture: NormalizedSportmonksFixture): boolean {
  const currentScore = getSportmonksCurrentScore(sportmonksFixture);
  const apiHome = apiFixture.goals.home;
  const apiAway = apiFixture.goals.away;
  if (apiHome == null || apiAway == null || currentScore.home == null || currentScore.away == null) return false;
  return apiHome !== currentScore.home || apiAway !== currentScore.away;
}

async function resolveSportmonksFixture(apiFixture: ApiFixture): Promise<{
  fixture: NormalizedSportmonksFixture | null;
  mappingMethod: string;
  mappingConfidence: ProviderMappingConfidence;
  providerFixtureId: string;
  canUseForMoneyDecision: boolean;
  warnings: string[];
}> {
  const resolved = await resolveProviderFixtureMapping({
    provider: SPORTMONKS_PROVIDER,
    source: apiFixtureToMappingSource(apiFixture),
    candidateToFixture: sportmonksFixtureToMappingCandidate,
    fetchFixtureByProviderId: async (providerFixtureId) => {
      const response = await fetchSportmonksFixtureById(providerFixtureId, {
        consumer: 'provider-fusion',
        jobName: 'sportmonks-provider-fallback',
      });
      return normalizeSportmonksFixtures(response.data)[0] ?? null;
    },
    fetchCandidatesByDate: async (dateKey) => {
      const response = await fetchSportmonksFixturesByDate(dateKey, {
        consumer: 'provider-fusion',
        jobName: 'sportmonks-provider-fallback',
      });
      return normalizeSportmonksFixtures(response.data);
    },
  });

  return {
    fixture: resolved.fixture,
    mappingMethod: resolved.mappingMethod,
    mappingConfidence: resolved.confidence,
    providerFixtureId: resolved.providerFixtureId,
    canUseForMoneyDecision: resolved.canUseForMoneyDecision,
    warnings: resolved.warnings,
  };
}

function unusedSupplement(input: {
  fixture: NormalizedSportmonksFixture | null;
  providerFixtureId?: string;
  mappingMethod: string;
  mappingConfidence: ProviderMappingConfidence;
  warnings: string[];
  extraCoverage?: Record<string, unknown>;
}): SportmonksSupplementResult {
  return {
    provider: SPORTMONKS_PROVIDER,
    providerFixtureId: input.providerFixtureId ?? input.fixture?.providerFixtureId ?? '',
    mappingMethod: input.mappingMethod,
    mappingConfidence: input.mappingConfidence,
    used: false,
    statistics: [],
    events: [],
    coverageFlags: {
      ...summarizeSportmonksCoverage(input.fixture),
      mapping_method: input.mappingMethod,
      mapping_confidence: input.mappingConfidence,
      ...(input.extraCoverage ?? {}),
    },
    warnings: input.warnings,
  };
}

export async function fetchSportmonksSupplementForFixture(
  apiFixture: ApiFixture | null,
): Promise<SportmonksSupplementResult | null> {
  if (!apiFixture || !isSportmonksRuntimeEnabled()) return null;

  try {
    const resolved = await resolveSportmonksFixture(apiFixture);
    if (!resolved.fixture) {
      return unusedSupplement({
        fixture: null,
        providerFixtureId: resolved.providerFixtureId,
        mappingMethod: resolved.mappingMethod,
        mappingConfidence: resolved.mappingConfidence,
        warnings: resolved.warnings,
      });
    }

    if (!resolved.canUseForMoneyDecision) {
      return unusedSupplement({
        fixture: resolved.fixture,
        providerFixtureId: resolved.providerFixtureId,
        mappingMethod: resolved.mappingMethod,
        mappingConfidence: resolved.mappingConfidence,
        warnings: resolved.warnings,
        extraCoverage: { mapping_money_eligible: false },
      });
    }

    if (hasScoreConflict(apiFixture, resolved.fixture)) {
      return unusedSupplement({
        fixture: resolved.fixture,
        providerFixtureId: resolved.providerFixtureId,
        mappingMethod: resolved.mappingMethod,
        mappingConfidence: resolved.mappingConfidence,
        warnings: ['sportmonks_score_conflict'],
        extraCoverage: { score_conflict: true },
      });
    }

    const statistics = runtimeBoolean('SPORTMONKS_ALLOW_STATS_FALLBACK')
      ? sportmonksStatisticsToApiFixtureStats(resolved.fixture)
      : [];
    const events = runtimeBoolean('SPORTMONKS_ALLOW_EVENTS_FALLBACK')
      ? sportmonksEventsToApiFixtureEvents(resolved.fixture)
      : [];
    return {
      provider: SPORTMONKS_PROVIDER,
      providerFixtureId: resolved.fixture.providerFixtureId,
      mappingMethod: resolved.mappingMethod,
      mappingConfidence: resolved.mappingConfidence,
      used: statistics.length > 0 || events.length > 0,
      statistics,
      events,
      coverageFlags: {
        ...summarizeSportmonksCoverage(resolved.fixture),
        mapping_method: resolved.mappingMethod,
        mapping_confidence: resolved.mappingConfidence,
        score_conflict: false,
      },
      warnings: resolved.warnings,
    };
  } catch (err) {
    return {
      provider: SPORTMONKS_PROVIDER,
      providerFixtureId: '',
      mappingMethod: 'unknown',
      mappingConfidence: 'low',
      used: false,
      statistics: [],
      events: [],
      coverageFlags: {
        ...summarizeSportmonksCoverage(null),
        fetch_error: err instanceof Error ? err.message : String(err),
      },
      warnings: ['sportmonks_fetch_error'],
    };
  }
}
