import type { ApiFixture, ApiFixtureEvent, ApiFixtureStat } from '../lib/football-api.js';
import type { ResolvedOddsSource } from '../lib/odds-resolver.js';
import {
  buildPipelineFixtureInput,
  buildPipelineProviderFusionSources,
} from '../lib/pipeline-live-input.js';
import {
  buildProviderFusionPipelineRead as buildProviderFusionPipelineReadCore,
} from '../lib/provider-fusion-pipeline-read.js';
import type { ProviderMappingConfidence } from '../lib/canonical/provider-domain.js';

export function buildProviderFusionPipelineRead(input: {
  matchId: string;
  fixture: ApiFixture;
  statisticsRaw: ApiFixtureStat[];
  eventsRaw: ApiFixtureEvent[];
  statsCompact: Record<string, unknown>;
  eventsCompact: Array<Record<string, unknown>>;
  oddsCanonical: Record<string, unknown>;
  oddsResponse: unknown[];
  oddsSource: ResolvedOddsSource;
  oddsFetchedAt: string | null;
  statisticsProvider?: string | null;
  eventsProvider?: string | null;
  statisticsProviderFixtureId?: string | number | null;
  eventsProviderFixtureId?: string | number | null;
  statisticsMappingConfidence?: ProviderMappingConfidence | string | null;
  eventsMappingConfidence?: ProviderMappingConfidence | string | null;
  generatedAt?: string;
  promotionEnabled?: boolean;
}) {
  const generatedAt = input.generatedAt ?? new Date().toISOString();
  const fixture = buildPipelineFixtureInput({
    matchId: input.matchId,
    fixture: input.fixture,
  });
  return buildProviderFusionPipelineReadCore({
    matchId: input.matchId,
    fixture,
    providerSources: buildPipelineProviderFusionSources({
      matchId: input.matchId,
      fixture,
      statisticsRaw: input.statisticsRaw,
      eventsRaw: input.eventsRaw,
      oddsResponse: input.oddsResponse,
      oddsSource: input.oddsSource,
      oddsFetchedAt: input.oddsFetchedAt,
      statisticsProvider: input.statisticsProvider,
      eventsProvider: input.eventsProvider,
      statisticsProviderFixtureId: input.statisticsProviderFixtureId,
      eventsProviderFixtureId: input.eventsProviderFixtureId,
      statisticsMappingConfidence: input.statisticsMappingConfidence,
      eventsMappingConfidence: input.eventsMappingConfidence,
      generatedAt,
    }),
    statsCompact: input.statsCompact,
    eventsCompact: input.eventsCompact,
    oddsCanonical: input.oddsCanonical,
    oddsResponse: input.oddsResponse,
    oddsSource: input.oddsSource,
    oddsFetchedAt: input.oddsFetchedAt,
    statisticsProvider: input.statisticsProvider,
    eventsProvider: input.eventsProvider,
    generatedAt,
    promotionEnabled: input.promotionEnabled,
  });
}
