import { describe, expect, it } from 'vitest';
import type { ApiFixture, ApiFixtureEvent, ApiFixtureStat } from '../lib/football-api.js';
import {
  canonicalEventsToEventsCompact,
  decideProviderFusionStatsEventsPromotion,
  shouldEvaluateProviderFusionStatsEventsPromotion,
} from '../lib/provider-fusion-stats-events-promotion.js';
import { buildProviderFusionPipelineRead } from './provider-fusion-test-utils.js';

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
  score: {},
} as ApiFixture;

const statisticsRaw: ApiFixtureStat[] = [
  {
    team: { id: 10, name: 'South Korea', logo: 'kr.png' },
    statistics: [
      { type: 'Ball Possession', value: '58%' },
      { type: 'Total Shots', value: 12 },
      { type: 'Shots on Goal', value: 4 },
      { type: 'Corner Kicks', value: 7 },
      { type: 'Fouls', value: 10 },
      { type: 'Yellow Cards', value: 1 },
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
      { type: 'Fouls', value: 12 },
      { type: 'Yellow Cards', value: null },
      { type: 'expected_goals', value: '0.50' },
    ],
  },
];

const eventsRaw: ApiFixtureEvent[] = [
  {
    time: { elapsed: 54, extra: null },
    team: { id: 20, name: 'Czech Republic', logo: 'cz.png' },
    player: { id: 9, name: 'Forward' },
    assist: { id: 11, name: 'Winger' },
    type: 'Goal',
    detail: 'Normal Goal',
    comments: null,
  },
  {
    time: { elapsed: 63, extra: null },
    team: { id: 10, name: 'South Korea', logo: 'kr.png' },
    player: { id: 6, name: 'Midfielder' },
    assist: { id: null, name: null },
    type: 'Card',
    detail: 'Yellow Card',
    comments: null,
  },
];

const statsCompact = {
  possession: { home: '58%', away: '42%' },
  shots: { home: '12', away: '10' },
  shots_on_target: { home: '4', away: '3' },
  corners: { home: '7', away: '3' },
  fouls: { home: '10', away: '12' },
  offsides: { home: null, away: null },
  yellow_cards: { home: '1', away: null },
  red_cards: { home: null, away: null },
  goalkeeper_saves: { home: null, away: null },
  blocked_shots: { home: null, away: null },
  total_passes: { home: null, away: null },
  passes_accurate: { home: null, away: null },
  expected_goals: { home: '0.85', away: '0.50' },
};

const eventsCompact = [
  { minute: 54, extra: null, team: 'Czech Republic', type: 'goal', detail: 'Normal Goal', player: 'Forward' },
  { minute: 63, extra: null, team: 'South Korea', type: 'card', detail: 'Yellow Card', player: 'Midfielder' },
];

function sportmonksRead() {
  return buildProviderFusionPipelineRead({
    matchId: '164327',
    fixture,
    statisticsRaw,
    eventsRaw,
    statsCompact,
    eventsCompact,
    oddsCanonical: {},
    oddsResponse: [],
    oddsSource: 'none',
    oddsFetchedAt: null,
    statisticsProvider: 'sportmonks',
    eventsProvider: 'sportmonks',
    statisticsProviderFixtureId: 98765,
    eventsProviderFixtureId: 98765,
    statisticsMappingConfidence: 'high',
    eventsMappingConfidence: 'high',
    generatedAt: '2026-06-13T12:00:01.000Z',
    promotionEnabled: false,
  });
}

describe('provider fusion stats/events promotion', () => {
  it('requires explicit stats/events promotion and keeps replay shadow mode disabled', () => {
    expect(shouldEvaluateProviderFusionStatsEventsPromotion({
      providerFusionEnabled: true,
      providerFusionStatsEventsPromotion: true,
      providerFusionOddsPromotion: false,
    })).toBe(true);
    expect(shouldEvaluateProviderFusionStatsEventsPromotion({
      providerFusionEnabled: true,
      providerFusionStatsEventsPromotion: true,
    }, { shadowMode: true })).toBe(false);
    expect(shouldEvaluateProviderFusionStatsEventsPromotion({
      providerFusionEnabled: true,
      providerFusionStatsEventsPromotion: true,
      providerFusionOddsPromotion: true,
    })).toBe(true);
  });

  it('blocks promotion when API-Football stats and events are already present', () => {
    const decision = decideProviderFusionStatsEventsPromotion({
      enabled: true,
      read: sportmonksRead(),
      homeName: 'South Korea',
      awayName: 'Czech Republic',
      apiFootballStatsPresent: true,
      apiFootballEventsPresent: true,
      oddsPromotionEnabled: false,
    });

    expect(decision.promoted).toBe(false);
    expect(decision.blockedReasons).toEqual(expect.arrayContaining([
      'api_football_statistics_present',
      'api_football_events_present',
    ]));
    expect(decision.audit).toEqual(expect.objectContaining({
      contract: 'provider-fusion-phase-7-stats-events-promotion',
      savePolicyChanged: false,
      oddsPolicy: 'unchanged',
    }));
  });

  it('promotes Sportmonks stats and events when API-Football data is absent', () => {
    const decision = decideProviderFusionStatsEventsPromotion({
      enabled: true,
      read: sportmonksRead(),
      homeName: 'South Korea',
      awayName: 'Czech Republic',
      apiFootballStatsPresent: false,
      apiFootballEventsPresent: false,
      oddsPromotionEnabled: false,
    });

    expect(decision.status).toBe('promoted');
    expect(decision.statsSource).toBe('sportmonks');
    expect(decision.statsPromoted).toBe(true);
    expect(decision.eventsPromoted).toBe(true);
    expect(decision.statsCompact).toEqual(expect.objectContaining({
      possession: { home: '58%', away: '42%' },
      shots: { home: '12', away: '10' },
      expected_goals: { home: '0.85', away: '0.5' },
    }));
    expect(decision.eventsCompact).toEqual([
      { minute: 54, extra: null, team: 'Czech Republic', type: 'goal', detail: 'Normal Goal', player: 'Forward' },
      { minute: 63, extra: null, team: 'South Korea', type: 'card', detail: 'Yellow Card', player: 'Midfielder' },
    ]);
    expect(decision.audit).toEqual(expect.objectContaining({
      promoted: true,
      statsPromoted: true,
      eventsPromoted: true,
      oddsPromotionEnabled: false,
      savePolicyChanged: false,
    }));
  });

  it('can promote Sportmonks stats/events while odds promotion is also enabled', () => {
    const decision = decideProviderFusionStatsEventsPromotion({
      enabled: true,
      read: sportmonksRead(),
      homeName: 'South Korea',
      awayName: 'Czech Republic',
      apiFootballStatsPresent: false,
      apiFootballEventsPresent: false,
      oddsPromotionEnabled: true,
    });

    expect(decision.status).toBe('promoted');
    expect(decision.statsPromoted).toBe(true);
    expect(decision.eventsPromoted).toBe(true);
    expect(decision.audit).toEqual(expect.objectContaining({
      promoted: true,
      oddsPromotionEnabled: true,
      oddsPolicy: 'unchanged',
      savePolicyChanged: false,
    }));
  });

  it('does not promote stats/events across score conflicts', () => {
    const read = sportmonksRead();
    read.snapshot.consensus.scoreAgreement = 'conflict';
    read.snapshot.moneyGuard.hardBlockReasons.push('score_conflict');

    const decision = decideProviderFusionStatsEventsPromotion({
      enabled: true,
      read,
      homeName: 'South Korea',
      awayName: 'Czech Republic',
      apiFootballStatsPresent: false,
      apiFootballEventsPresent: false,
      oddsPromotionEnabled: false,
    });

    expect(decision.promoted).toBe(false);
    expect(decision.blockedReasons).toEqual(['score_conflict']);
  });

  it('does not promote stats/events across minute conflicts', () => {
    const read = sportmonksRead();
    read.snapshot.consensus.minuteAgreement = 'conflict';
    read.snapshot.moneyGuard.hardBlockReasons.push('minute_conflict');

    const decision = decideProviderFusionStatsEventsPromotion({
      enabled: true,
      read,
      homeName: 'South Korea',
      awayName: 'Czech Republic',
      apiFootballStatsPresent: false,
      apiFootballEventsPresent: false,
      oddsPromotionEnabled: false,
    });

    expect(decision.promoted).toBe(false);
    expect(decision.blockedReasons).toEqual(['minute_conflict']);
  });

  it('does not promote low-confidence Sportmonks mapping', () => {
    const read = sportmonksRead();
    read.snapshot.fieldSources.statistics.confidence = 'low';
    read.snapshot.fieldSources.events.confidence = 'low';

    const decision = decideProviderFusionStatsEventsPromotion({
      enabled: true,
      read,
      homeName: 'South Korea',
      awayName: 'Czech Republic',
      apiFootballStatsPresent: false,
      apiFootballEventsPresent: false,
      oddsPromotionEnabled: false,
    });

    expect(decision.promoted).toBe(false);
    expect(decision.blockedReasons).toEqual(expect.arrayContaining([
      'sportmonks_statistics_mapping_not_trusted',
      'sportmonks_events_mapping_not_trusted',
    ]));
  });

  it('does not promote Sportmonks data when selected role coverage is not usable', () => {
    const read = sportmonksRead();
    read.snapshot.fieldSources.statistics.coverage = 'empty';
    read.snapshot.fieldSources.events.coverage = 'missing';

    const decision = decideProviderFusionStatsEventsPromotion({
      enabled: true,
      read,
      homeName: 'South Korea',
      awayName: 'Czech Republic',
      apiFootballStatsPresent: false,
      apiFootballEventsPresent: false,
      oddsPromotionEnabled: false,
    });

    expect(decision.promoted).toBe(false);
    expect(decision.blockedReasons).toEqual(expect.arrayContaining([
      'sportmonks_statistics_coverage_not_usable',
      'sportmonks_events_coverage_not_usable',
    ]));
  });

  it('can promote only events without changing odds or save policy', () => {
    const read = sportmonksRead();
    read.snapshot.fieldSources.statistics.provider = 'api-football';

    const decision = decideProviderFusionStatsEventsPromotion({
      enabled: true,
      read,
      homeName: 'South Korea',
      awayName: 'Czech Republic',
      apiFootballStatsPresent: false,
      apiFootballEventsPresent: false,
      oddsPromotionEnabled: false,
    });

    expect(decision.promoted).toBe(true);
    expect(decision.statsPromoted).toBe(false);
    expect(decision.eventsPromoted).toBe(true);
    expect(decision.statsSource).toBe('api-football+sportmonks');
    expect(decision.statsCompact).toBeUndefined();
    expect(decision.eventsCompact).toHaveLength(2);
    expect(decision.audit).toEqual(expect.objectContaining({
      oddsPolicy: 'unchanged',
      savePolicyChanged: false,
    }));
  });

  it('reports disabled and missing-read states without throwing', () => {
    expect(decideProviderFusionStatsEventsPromotion({
      enabled: false,
      read: sportmonksRead(),
      homeName: 'South Korea',
      awayName: 'Czech Republic',
      apiFootballStatsPresent: false,
      apiFootballEventsPresent: false,
      oddsPromotionEnabled: false,
    })).toEqual(expect.objectContaining({
      status: 'disabled',
      blockedReasons: ['stats_events_promotion_disabled'],
    }));

    expect(decideProviderFusionStatsEventsPromotion({
      enabled: true,
      read: null,
      homeName: 'South Korea',
      awayName: 'Czech Republic',
      apiFootballStatsPresent: false,
      apiFootballEventsPresent: false,
      oddsPromotionEnabled: false,
    })).toEqual(expect.objectContaining({
      status: 'blocked',
      blockedReasons: ['provider_fusion_read_missing'],
    }));
  });

  it('converts canonical events with side fallback and non-money event types', () => {
    expect(canonicalEventsToEventsCompact([
      {
        minute: null,
        extra: null,
        teamSide: 'home',
        team: null,
        playerName: null,
        assistName: null,
        type: 'substitution',
        detail: 'Fresh legs',
      },
      {
        minute: 70,
        extra: 1,
        teamSide: 'unknown',
        team: null,
        playerName: 'VAR official',
        assistName: null,
        type: 'var',
        detail: 'Goal check',
      },
      {
        minute: 75,
        extra: null,
        teamSide: 'away',
        team: null,
        playerName: 'Penalty taker',
        assistName: null,
        type: 'penalty',
        detail: 'Penalty scored',
      },
    ], 'Home FC', 'Away FC')).toEqual([
      { minute: 0, extra: null, team: 'Home FC', type: 'subst', detail: 'Fresh legs', player: '' },
      { minute: 70, extra: 1, team: '', type: 'var', detail: 'Goal check', player: 'VAR official' },
      { minute: 75, extra: null, team: 'Away FC', type: 'goal', detail: 'Penalty scored', player: 'Penalty taker' },
    ]);
  });
});
