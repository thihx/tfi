import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { ApiFixture, ApiFixtureEvent, ApiFixtureLineup, ApiFixtureStat } from '../lib/football-api.js';
import {
  buildPipelineEventsCompact,
  buildPipelineFixtureInput,
  buildPipelineProviderFusionSources,
  buildPipelineProviderHealthSnapshot,
  buildPipelineStatsCompact,
  classifyPipelineProviderStatisticsCoverage,
  summarizePipelineLineupsForPrompt,
  summarizePipelineStatsCoverage,
} from '../lib/pipeline-live-input.js';

const fixture = {
  fixture: {
    id: 164327,
    referee: null,
    timezone: 'UTC',
    date: '2026-06-13T11:00:00+00:00',
    timestamp: 1781348400,
    periods: { first: 1781348400, second: 1781352000 },
    venue: { id: null, name: null, city: null },
    status: { long: 'Second Half', short: '2H', elapsed: 65 },
  },
  league: { id: 1, name: 'World Cup', country: 'World', logo: '', flag: null, season: 2026, round: 'Group' },
  teams: {
    home: { id: 10, name: 'South Korea', logo: 'kr.png', winner: null },
    away: { id: 20, name: 'Czech Republic', logo: 'cz.png', winner: null },
  },
  goals: { home: 0, away: 1 },
  score: {
    halftime: { home: 0, away: 0 },
  },
} as ApiFixture;

const statisticsRaw: ApiFixtureStat[] = [
  {
    team: { id: 10, name: 'South Korea', logo: 'kr.png' },
    statistics: [
      { type: 'Ball Possession', value: '58%' },
      { type: 'Total Shots', value: 12 },
      { type: 'Shots on Goal', value: 4 },
      { type: 'Corner Kicks', value: 7 },
      { type: 'expected_goals', value: '0.85' },
    ],
  },
  {
    team: { id: 20, name: 'Czech Republic', logo: 'cz.png' },
    statistics: [
      { type: 'Ball Possession', value: '42%' },
      { type: 'Total Shots', value: 10 },
      { type: 'Shots on Goal', value: 3 },
      { type: 'Corner Kicks', value: 3 },
      { type: 'expected_goals', value: '0.50' },
    ],
  },
];

const eventsRaw: ApiFixtureEvent[] = [
  {
    time: { elapsed: 63, extra: null },
    team: { id: 10, name: 'South Korea', logo: 'kr.png' },
    player: { id: 6, name: 'Midfielder' },
    assist: { id: null, name: null },
    type: 'Card',
    detail: 'Yellow Card',
    comments: null,
  },
  {
    time: { elapsed: 54, extra: null },
    team: { id: 20, name: 'Czech Republic', logo: 'cz.png' },
    player: { id: 9, name: 'Forward' },
    assist: { id: 11, name: 'Winger' },
    type: 'Goal',
    detail: 'Normal Goal',
    comments: null,
  },
];

describe('pipeline live input boundary', () => {
  it('builds the canonical fixture, stats, events, coverage, and lineup prompt views', () => {
    const pipelineFixture = buildPipelineFixtureInput({ matchId: '164327', fixture });
    const statsCompact = buildPipelineStatsCompact(
      statisticsRaw[0]?.statistics ?? [],
      statisticsRaw[1]?.statistics ?? [],
    );
    const eventsCompact = buildPipelineEventsCompact(eventsRaw, pipelineFixture);
    const coverage = summarizePipelineStatsCoverage(statsCompact, statisticsRaw, eventsRaw, null, null);
    const lineups = summarizePipelineLineupsForPrompt([
      {
        team: { id: 10, name: 'South Korea', logo: 'kr.png' },
        coach: { id: null, name: null, photo: null },
        formation: '4-2-3-1',
        startXI: [{ player: { id: 1, name: 'Keeper', number: 1, pos: 'G', grid: null } }],
        substitutes: [{ player: { id: 12, name: 'Reserve', number: 12, pos: 'M', grid: null } }],
      } as ApiFixtureLineup,
    ], pipelineFixture);

    expect(pipelineFixture).toEqual(expect.objectContaining({
      matchDisplay: 'South Korea vs Czech Republic',
      status: { short: '2H', long: 'Second Half', minute: 65 },
      score: { home: 0, away: 1, text: '0-1' },
      halftimeScore: { home: 0, away: 0 },
      provider: expect.objectContaining({ id: 'api-football', fixtureId: 164327 }),
    }));
    expect(statsCompact).toEqual(expect.objectContaining({
      possession: { home: '58%', away: '42%' },
      shots_on_target: { home: '4', away: '3' },
      expected_goals: { home: '0.85', away: '0.50' },
    }));
    expect(eventsCompact).toEqual([
      { minute: 54, extra: null, team: 'Czech Republic', type: 'goal', detail: 'Normal Goal', player: 'Forward' },
      { minute: 63, extra: null, team: 'South Korea', type: 'card', detail: 'Yellow Card', player: 'Midfielder' },
    ]);
    expect(coverage).toEqual(expect.objectContaining({
      team_count: 2,
      event_count: 2,
      has_possession: true,
      has_corners: true,
      stats_fetch_ok: true,
      events_fetch_ok: true,
    }));
    expect(lineups).toEqual({
      available: true,
      teams: [{
        side: 'home',
        teamName: 'South Korea',
        formation: '4-2-3-1',
        confirmedStarters: ['Keeper (G)'],
        benchCount: 1,
      }],
    });
  });

  it('builds provider fusion source envelopes outside the recommendation pipeline', () => {
    const pipelineFixture = buildPipelineFixtureInput({ matchId: '164327', fixture });
    const oddsResponse = [{
      marker: 'RAW_BOUNDARY_SECRET',
      bookmakers: [{
        name: 'Live Book',
        bets: [{ name: 'Over/Under', values: [{ value: 'Over 2.5', odd: '1.92', handicap: '2.5' }] }],
      }],
    }];

    const sources = buildPipelineProviderFusionSources({
      matchId: '164327',
      fixture: pipelineFixture,
      statisticsRaw,
      eventsRaw,
      oddsResponse,
      oddsSource: 'live',
      oddsFetchedAt: '2026-06-13T12:00:00.000Z',
      statisticsProvider: 'sportmonks',
      eventsProvider: 'sportmonks',
      statisticsProviderFixtureId: 98765,
      eventsProviderFixtureId: 98765,
      statisticsMappingConfidence: 'high',
      eventsMappingConfidence: 'high',
      generatedAt: '2026-06-13T12:00:01.000Z',
    });

    expect(sources).toHaveLength(2);
    expect(sources[0]?.fixture?.provider).toBe('api-football');
    expect(sources[0]?.odds?.normalized?.sourceProvider).toBe('api-football');
    expect(sources[1]?.statistics).toEqual(expect.objectContaining({
      provider: 'sportmonks',
      providerFixtureId: '98765',
    }));
    expect(sources[1]?.events).toEqual(expect.objectContaining({
      provider: 'sportmonks',
      providerFixtureId: '98765',
    }));
    expect(sources[1]?.statistics?.raw).toBeNull();
    expect(sources[1]?.events?.raw).toBeNull();
  });

  it('normalizes degraded provider payloads through explicit pipeline fallbacks', () => {
    const degradedFixture = {
      fixture: {
        id: undefined,
        referee: null,
        timezone: 'UTC',
        date: undefined,
        timestamp: undefined,
        periods: { first: null, second: null },
        venue: { id: null, name: null, city: null },
        status: { long: '', short: '', elapsed: null },
      },
      league: { id: undefined, name: '', country: null, logo: '', flag: null, season: null, round: null },
      teams: {
        home: { id: null, name: '', logo: '', winner: null },
        away: { id: null, name: '', logo: '', winner: null },
      },
      goals: { home: null, away: null },
      score: {},
    } as unknown as ApiFixture;

    const pipelineFixture = buildPipelineFixtureInput({
      matchId: 'fallback-164327',
      fixture: degradedFixture,
      watchlistFallback: {
        home_team: 'Fallback Home',
        away_team: 'Fallback Away',
        league: 'Fallback League',
      },
    });
    expect(pipelineFixture).toEqual(expect.objectContaining({
      matchDisplay: 'Fallback Home vs Fallback Away',
      home: { id: null, name: 'Fallback Home' },
      away: { id: null, name: 'Fallback Away' },
      league: expect.objectContaining({ id: null, name: 'Fallback League', country: null, season: null }),
      status: { short: 'UNKNOWN', long: '', minute: 0 },
      score: { home: 0, away: 0, text: '0-0' },
      kickoff: { iso: null, timestamp: null },
      provider: expect.objectContaining({ fixtureId: 'fallback-164327' }),
    }));

    const statsCompact = buildPipelineStatsCompact(
      null as unknown as ApiFixtureStat['statistics'],
      [{ type: 'Total Shots', value: 0 }],
    );
    expect(statsCompact).toEqual(expect.objectContaining({
      possession: { home: null, away: null },
      shots: { home: null, away: '0' },
      corners: { home: null, away: null },
    }));

    const coverage = summarizePipelineStatsCoverage(
      statsCompact,
      [],
      [],
      new Error('stats down'),
      new Error('events down'),
    );
    expect(coverage).toEqual(expect.objectContaining({
      team_count: 0,
      event_count: 0,
      has_possession: false,
      has_shots: true,
      has_shots_on_target: false,
      has_corners: false,
      stats_fetch_ok: false,
      events_fetch_ok: false,
    }));

    const eventsCompact = buildPipelineEventsCompact([
      {
        time: { elapsed: 2, extra: undefined },
        team: { id: 999, name: 'Mystery FC', logo: '' },
        player: { id: null, name: null },
        assist: { id: null, name: null },
        type: 'Goal',
        detail: '',
        comments: null,
      },
      {
        time: { elapsed: null, extra: 2 },
        team: { id: 999, name: 'Mystery FC', logo: '' },
        player: { id: null, name: null },
        assist: { id: null, name: null },
        type: 'subst',
        detail: 'Substitution',
        comments: null,
      },
      {
        time: { elapsed: 3, extra: undefined },
        team: { id: 999, name: '', logo: '' },
        player: { id: null, name: null },
        assist: { id: null, name: null },
        type: 'Card',
        detail: 'Yellow Card',
        comments: null,
      },
      {
        time: { elapsed: 71, extra: null },
        team: { id: 999, name: '', logo: '' },
        player: { id: null, name: null },
        assist: { id: null, name: null },
        type: '',
        detail: '',
        comments: null,
      },
    ] as unknown as ApiFixtureEvent[], pipelineFixture);
    expect(eventsCompact).toEqual([
      { minute: 0, extra: 2, team: 'Mystery FC', type: 'subst', detail: ' for ', player: '' },
      { minute: 2, extra: null, team: 'Mystery FC', type: 'goal', detail: '', player: '' },
      { minute: 3, extra: null, team: '', type: 'card', detail: 'Yellow Card', player: '' },
    ]);

    expect(summarizePipelineLineupsForPrompt(null, pipelineFixture)).toBeNull();
    expect(summarizePipelineLineupsForPrompt([
      {
        team: { id: null, name: 'Fallback Away', logo: '' },
        coach: { id: null, name: null, photo: null },
        formation: '',
      },
    ] as unknown as ApiFixtureLineup[], pipelineFixture)).toEqual({
      available: true,
      teams: [{
        side: 'away',
        teamName: 'Fallback Away',
        formation: null,
        confirmedStarters: [],
        benchCount: 0,
      }],
    });
    expect(summarizePipelineLineupsForPrompt([
      {
        coach: { id: null, name: null, photo: null },
        formation: '4-4-2',
        startXI: [
          { player: { id: 1, name: '', number: 1, pos: 'G', grid: null } },
          { player: { id: 2, name: 'No Pos', number: 2, pos: '', grid: null } },
        ],
        substitutes: null,
      },
    ] as unknown as ApiFixtureLineup[], pipelineFixture)).toEqual({
      available: true,
      teams: [{
        side: 'home',
        teamName: 'Fallback Home',
        formation: '4-4-2',
        confirmedStarters: ['No Pos'],
        benchCount: 0,
      }],
    });
  });

  it('falls back provider source metadata without raw payload leakage', () => {
    const pipelineFixture = buildPipelineFixtureInput({ matchId: '164327', fixture });

    const sources = buildPipelineProviderFusionSources({
      matchId: '164327',
      fixture: pipelineFixture,
      statisticsRaw: [],
      eventsRaw: [],
      oddsResponse: [],
      oddsSource: 'none',
      oddsFetchedAt: null,
      statisticsProvider: null,
      eventsProvider: null,
      statisticsProviderFixtureId: null,
      eventsProviderFixtureId: null,
      statisticsMappingConfidence: 'not-a-confidence',
      eventsMappingConfidence: 'not-a-confidence',
      generatedAt: '2026-06-13T12:00:01.000Z',
    });

    expect(sources).toHaveLength(1);
    expect(sources[0]?.statistics).toEqual(expect.objectContaining({
      provider: 'api-football',
      providerFixtureId: '164327',
      raw: null,
    }));
    expect(sources[0]?.events).toEqual(expect.objectContaining({
      provider: 'api-football',
      providerFixtureId: '164327',
      raw: null,
    }));
    expect(sources[0]?.odds).toEqual(expect.objectContaining({
      role: 'live_odds',
      providerFixtureId: '164327',
    }));
    expect(sources[0]?.odds?.normalized?.warnings).toContain('legacy_odds_source_none');

    const unmappedFixture = {
      ...pipelineFixture,
      provider: { ...pipelineFixture.provider, fixtureId: null },
    };
    const mappedSources = buildPipelineProviderFusionSources({
      matchId: '164327',
      fixture: unmappedFixture,
      statisticsRaw: [{ team: { id: 10, name: 'South Korea', logo: 'kr.png' }, statistics: [{ type: 'Total Shots', value: 12 }] }],
      eventsRaw: [],
      oddsResponse: [],
      oddsSource: 'reference-prematch',
      oddsFetchedAt: null,
      statisticsProvider: 'sportmonks',
      eventsProvider: 'sportmonks',
      statisticsProviderFixtureId: null,
      eventsProviderFixtureId: null,
      statisticsMappingConfidence: 'not-a-confidence',
      eventsMappingConfidence: 'not-a-confidence',
      generatedAt: '2026-06-13T12:00:01.000Z',
    });
    const sportmonksSource = mappedSources.find((source) => source.statistics?.provider === 'sportmonks');
    expect(sportmonksSource?.fixture).toEqual(expect.objectContaining({
      provider: 'sportmonks',
      providerFixtureId: 'sportmonks',
    }));
    expect(sportmonksSource?.fixture?.normalized?.providerFixtureIds?.sportmonks).toBe('');
  });

  it('keeps provider health conservative for missing or empty statistics', () => {
    expect(buildPipelineProviderHealthSnapshot({
      provider: 'api-football',
      minute: 65,
      statsRaw: [],
      statsAvailable: false,
      fixtureFreshness: 'fresh',
      statisticsFreshness: 'fresh',
      statisticsCacheStatus: 'hit',
      eventsFreshness: 'fresh',
    })).toEqual(expect.objectContaining({
      statisticsCoverage: 'empty',
      providerReturnedNoLiveStatistics: true,
      coverageStatus: 'no_live_stats',
      warnings: ['provider_returned_no_live_statistics'],
    }));

    expect(buildPipelineProviderHealthSnapshot({
      provider: 'api-football',
      minute: 65,
      statsRaw: [],
      statsAvailable: false,
      fixtureFreshness: 'missing',
      statisticsFreshness: 'missing',
      statisticsCacheStatus: 'miss',
      eventsFreshness: 'missing',
    })).toEqual(expect.objectContaining({
      statisticsCoverage: 'missing',
      providerReturnedNoLiveStatistics: false,
      coverageStatus: 'provider_unavailable',
    }));

    expect(buildPipelineProviderHealthSnapshot({
      provider: 'api-football',
      minute: Number.NaN,
      statsRaw: [{ team: { id: 10, name: 'Home', logo: '' }, statistics: [] }],
      statsAvailable: true,
      fixtureFreshness: 'fresh',
      statisticsFreshness: 'fresh',
      statisticsCacheStatus: 'hit',
      eventsFreshness: 'stale',
    })).toEqual(expect.objectContaining({
      statisticsCoverage: 'partial',
      providerReturnedNoLiveStatistics: false,
      providerReportedMinute: null,
      coverageStatus: 'full',
      warnings: [],
    }));

    expect(classifyPipelineProviderStatisticsCoverage({
      statsRaw: [],
      statsAvailable: false,
      freshness: 'fresh',
      cacheStatus: 'miss',
    })).toBe('empty');
    expect(classifyPipelineProviderStatisticsCoverage({
      statsRaw: statisticsRaw,
      statsAvailable: true,
      freshness: 'fresh',
      cacheStatus: 'hit',
    })).toBe('complete');
  });

  it('keeps API-Football-shaped imports isolated to the compatibility boundary', () => {
    const serverPipeline = readFileSync(resolve('src/lib/server-pipeline.ts'), 'utf8');
    const fusionRead = readFileSync(resolve('src/lib/provider-fusion-pipeline-read.ts'), 'utf8');

    expect(serverPipeline).not.toContain("from './football-api.js'");
    expect(serverPipeline).not.toMatch(/\bApiFixture(?:Event|Stat|Lineup)?\b/);
    expect(serverPipeline).not.toMatch(/\bfixture\.(fixture|teams|goals)\b/);
    expect(fusionRead).not.toContain("from './football-api.js'");
    expect(fusionRead).not.toContain("from './canonical/api-football-adapter.js'");
    expect(fusionRead).not.toMatch(/\bApiFixture(?:Event|Stat|Lineup)?\b/);
  });
});
