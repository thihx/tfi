import { describe, expect, it } from 'vitest';
import type { ApiFixture, ApiFixtureEvent, ApiFixtureStat } from '../lib/football-api.js';
import { shouldBuildProviderFusionShadow } from '../lib/provider-fusion-pipeline-read.js';
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
  yellow_cards: { home: '1', away: null },
  red_cards: { home: null, away: null },
};

const eventsCompact = [
  { minute: 54, extra: null, team: 'Czech Republic', type: 'goal', detail: 'Normal Goal', player: 'Forward' },
  { minute: 63, extra: null, team: 'South Korea', type: 'card', detail: 'Yellow Card', player: 'Midfielder' },
];

function completeOddsResponse(marker = 'RAW_SECRET_ODDS') {
  return [
    {
      marker,
      bookmakers: [
        {
          name: 'Live Book',
          bets: [
            {
              name: 'Over/Under',
              values: [
                { value: 'Over 2.5', odd: '1.92', handicap: '2.5' },
                { value: 'Under 2.5', odd: '1.96', handicap: '2.5' },
              ],
            },
            {
              name: 'Match Winner',
              values: [
                { value: 'Home', odd: '3.10' },
                { value: 'Draw', odd: '3.30' },
                { value: 'Away', odd: '2.35' },
              ],
            },
          ],
        },
      ],
    },
  ];
}

const oddsCanonical = {
  ou: { line: 2.5, over: 1.92, under: 1.96 },
  '1x2': { home: 3.10, draw: 3.30, away: 2.35 },
};

describe('provider fusion pipeline read adapter', () => {
  it('keeps provider fusion shadow opt-in and disables it for replay shadow mode', () => {
    expect(shouldBuildProviderFusionShadow({
      providerFusionEnabled: false,
      providerFusionShadowEnabled: true,
    })).toBe(false);
    expect(shouldBuildProviderFusionShadow({
      providerFusionEnabled: true,
      providerFusionShadowEnabled: true,
    })).toBe(true);
    expect(shouldBuildProviderFusionShadow({
      providerFusionEnabled: true,
      providerFusionShadowEnabled: true,
    }, { shadowMode: true })).toBe(false);
  });

  it('builds an API-Football-only fusion read equivalent to legacy prompt inputs', () => {
    const result = buildProviderFusionPipelineRead({
      matchId: '164327',
      fixture,
      statisticsRaw,
      eventsRaw,
      statsCompact,
      eventsCompact,
      oddsCanonical,
      oddsResponse: completeOddsResponse(),
      oddsSource: 'live',
      oddsFetchedAt: '2026-06-13T12:00:00.000Z',
      statisticsProvider: 'api-football',
      eventsProvider: 'api-football',
      generatedAt: '2026-06-13T12:00:01.000Z',
      promotionEnabled: false,
    });

    expect(result.diff.promptEquivalent).toBe(true);
    expect(result.diff.changedFields).toEqual([]);
    expect(result.legacyRead.evidenceMode).toBe('full_live_data');
    expect(result.fusionRead.evidenceMode).toBe('full_live_data');
    expect(result.snapshot.fieldSources.statistics.provider).toBe('api-football');
    expect(result.snapshot.fieldSources.events.provider).toBe('api-football');
    expect(result.diff.moneyGuard).toEqual(expect.objectContaining({
      promotionEnabled: false,
      legacyCanSaveRecommendation: true,
      fusionCanSaveRecommendation: true,
      canPromoteWithoutBehaviorChange: false,
      hardBlockReasons: ['promotion_disabled'],
    }));
  });

  it('records Sportmonks provenance when cache fallback data is read through fusion shadow', () => {
    const result = buildProviderFusionPipelineRead({
      matchId: '164327',
      fixture,
      statisticsRaw,
      eventsRaw,
      statsCompact,
      eventsCompact,
      oddsCanonical,
      oddsResponse: completeOddsResponse(),
      oddsSource: 'live',
      oddsFetchedAt: '2026-06-13T12:00:00.000Z',
      statisticsProvider: 'sportmonks',
      eventsProvider: 'sportmonks',
      statisticsProviderFixtureId: 98765,
      eventsProviderFixtureId: 98765,
      statisticsMappingConfidence: 'high',
      eventsMappingConfidence: 'high',
      generatedAt: '2026-06-13T12:00:01.000Z',
      promotionEnabled: false,
    });

    expect(result.diff.promptEquivalent).toBe(true);
    expect(result.snapshot.fieldSources.statistics).toEqual(expect.objectContaining({
      provider: 'sportmonks',
      providerFixtureId: '98765',
      confidence: 'high',
    }));
    expect(result.snapshot.fieldSources.events).toEqual(expect.objectContaining({
      provider: 'sportmonks',
      providerFixtureId: '98765',
      confidence: 'high',
    }));
  });

  it('flags money guard mismatch when raw odds have a one-sided selection but legacy canonical odds are not tradable', () => {
    const result = buildProviderFusionPipelineRead({
      matchId: '164327',
      fixture,
      statisticsRaw,
      eventsRaw,
      statsCompact,
      eventsCompact,
      oddsCanonical: {},
      oddsResponse: [
        {
          bookmakers: [
            {
              name: 'Live Book',
              bets: [
                {
                  name: 'Over/Under',
                  values: [
                    { value: 'Over 2.5', odd: '1.92', handicap: '2.5' },
                  ],
                },
              ],
            },
          ],
        },
      ],
      oddsSource: 'live',
      oddsFetchedAt: '2026-06-13T12:00:00.000Z',
      statisticsProvider: 'api-football',
      eventsProvider: 'api-football',
      generatedAt: '2026-06-13T12:00:01.000Z',
      promotionEnabled: false,
    });

    expect(result.diff.changedFields).toEqual(['evidenceMode', 'odds']);
    expect(result.diff.moneyGuard.hardBlockReasons).toEqual(expect.arrayContaining([
      'legacy_money_guard_blocked',
      'money_guard_mismatch',
      'prompt_relevant_diff',
      'promotion_disabled',
    ]));
    expect(result.diff.moneyGuard.canPromoteWithoutBehaviorChange).toBe(false);
  });

  it('keeps stats-only reads blocked for money even when promotion is requested', () => {
    const result = buildProviderFusionPipelineRead({
      matchId: '164327',
      fixture,
      statisticsRaw,
      eventsRaw: [],
      statsCompact,
      eventsCompact: [],
      oddsCanonical: {},
      oddsResponse: [],
      oddsSource: 'none',
      oddsFetchedAt: null,
      statisticsProvider: null,
      eventsProvider: null,
      generatedAt: '2026-06-13T12:00:01.000Z',
      promotionEnabled: true,
    });

    expect(result.legacyRead.evidenceMode).toBe('stats_only');
    expect(result.fusionRead.evidenceMode).toBe('stats_only');
    expect(result.snapshot.moneyGuard).toEqual(expect.objectContaining({
      canSaveRecommendation: false,
      canPushStatsOnlySignal: true,
      hardBlockReasons: ['no_live_odds'],
    }));
    expect(result.diff.moneyGuard).toEqual(expect.objectContaining({
      promotionEnabled: true,
      legacyCanSaveRecommendation: false,
      fusionCanSaveRecommendation: false,
      canPromoteWithoutBehaviorChange: false,
      hardBlockReasons: ['fusion_money_guard_blocked', 'legacy_money_guard_blocked', 'no_live_odds'],
    }));
  });

  it('maps odds plus events without statistics to degraded evidence parity', () => {
    const result = buildProviderFusionPipelineRead({
      matchId: '164327',
      fixture,
      statisticsRaw: [],
      eventsRaw,
      statsCompact: {},
      eventsCompact,
      oddsCanonical,
      oddsResponse: completeOddsResponse(),
      oddsSource: 'live',
      oddsFetchedAt: '2026-06-13T12:00:00.000Z',
      statisticsProvider: 'api-football',
      eventsProvider: 'api-football',
      generatedAt: '2026-06-13T12:00:01.000Z',
      promotionEnabled: false,
    });

    expect(result.legacyRead.evidenceMode).toBe('odds_events_only_degraded');
    expect(result.fusionRead.evidenceMode).toBe('odds_events_only_degraded');
    expect(result.diff.fields.evidenceMode.changed).toBe(false);
    expect(result.diff.moneyGuard.hardBlockReasons).toEqual(expect.arrayContaining([
      'fusion_money_guard_blocked',
      'promotion_disabled',
    ]));
  });

  it('treats reference-only odds without core live data as low evidence', () => {
    const result = buildProviderFusionPipelineRead({
      matchId: '164327',
      fixture,
      statisticsRaw: [],
      eventsRaw: [],
      statsCompact: {},
      eventsCompact: [
        { minute: '', extra: null, team: '', type: '', detail: '', player: '' },
      ],
      oddsCanonical: {
        reference_market: { price: 2.25 },
      },
      oddsResponse: completeOddsResponse(),
      oddsSource: 'reference-prematch',
      oddsFetchedAt: '2026-06-13T10:30:00.000Z',
      statisticsProvider: 'api-football',
      eventsProvider: 'api-football',
      generatedAt: '2026-06-13T12:00:01.000Z',
      promotionEnabled: false,
    });

    expect(result.fusionRead.odds.available).toBe(false);
    expect(result.fusionRead.evidenceMode).toBe('low_evidence');
    expect(result.diff.moneyGuard.hardBlockReasons).toEqual(expect.arrayContaining([
      'fusion_money_guard_blocked',
      'legacy_money_guard_blocked',
      'no_live_odds',
      'prompt_relevant_diff',
    ]));
  });

  it('keeps events-only reads degraded and blocked for money', () => {
    const result = buildProviderFusionPipelineRead({
      matchId: '164327',
      fixture,
      statisticsRaw: [],
      eventsRaw,
      statsCompact: {},
      eventsCompact,
      oddsCanonical: {},
      oddsResponse: [],
      oddsSource: 'none',
      oddsFetchedAt: null,
      statisticsProvider: 'api-football',
      eventsProvider: 'api-football',
      generatedAt: '2026-06-13T12:00:01.000Z',
      promotionEnabled: false,
    });

    expect(result.legacyRead.evidenceMode).toBe('events_only_degraded');
    expect(result.fusionRead.evidenceMode).toBe('events_only_degraded');
    expect(result.diff.moneyGuard.hardBlockReasons).toEqual(expect.arrayContaining([
      'fusion_money_guard_blocked',
      'legacy_money_guard_blocked',
      'no_live_odds',
      'promotion_disabled',
    ]));
  });

  it('summarizes extra ladders and unknown market families without raw leakage', () => {
    const substitutionRaw: ApiFixtureEvent = {
      time: { elapsed: 70, extra: 1 },
      team: { id: 10, name: 'South Korea', logo: 'kr.png' },
      player: { id: 8, name: 'Starter' },
      assist: { id: 18, name: 'Substitute' },
      type: 'subst',
      detail: 'Substitution 1',
      comments: null,
    };
    const otherRaw: ApiFixtureEvent = {
      time: { elapsed: null, extra: null },
      team: { id: 10, name: 'South Korea', logo: 'kr.png' },
      player: { id: null, name: null },
      assist: { id: null, name: null },
      type: 'Weather',
      detail: 'Rain delay note',
      comments: null,
    };
    const result = buildProviderFusionPipelineRead({
      matchId: '164327',
      fixture,
      statisticsRaw,
      eventsRaw: [...eventsRaw, substitutionRaw, otherRaw],
      statsCompact,
      eventsCompact: [
        ...eventsCompact,
        { minute: 70, extra: 1, team: 'South Korea', type: 'subst', detail: 'Substitute for Starter', player: 'Substitute' },
        { minute: null, extra: null, team: 'South Korea', type: 'weather', detail: 'Rain delay note', player: '' },
      ],
      oddsCanonical: {
        btts: { yes: 1.91, no: 1.93 },
        corners_ou: { line: 10.5, over: 2.20, under: 1.72 },
        custom_market: { line: 1, price: 2.40 },
        parlay_market: { line: 0, choices: [{ line: 1.5, price: 2.40 }] },
        ou_extra: [{ line: 3.5, over: 2.05, under: 1.80 }],
      },
      oddsResponse: [
        {
          marker: 'RAW_SECRET_UNKNOWN_MARKET',
          bookmakers: [
            {
              name: 'Live Book',
              bets: [
                {
                  name: 'Team Specials',
                  values: [{ value: 'Clean Sheet', odd: '2.40' }],
                },
                {
                  name: 'Corners Over Under',
                  values: [
                    { value: 'Over 10.5', odd: '2.20', handicap: '10.5' },
                    { value: 'Under 10.5', odd: '1.72', handicap: '10.5' },
                  ],
                },
                {
                  name: 'Both Teams Score',
                  values: [
                    { value: 'Yes', odd: '1.91' },
                    { value: 'No', odd: '1.93' },
                  ],
                },
              ],
            },
          ],
        },
      ],
      oddsSource: 'live',
      oddsFetchedAt: '2026-06-13T12:00:00.000Z',
      statisticsProvider: 'api-football',
      eventsProvider: 'api-football',
      generatedAt: '2026-06-13T12:00:01.000Z',
      promotionEnabled: false,
    });

    expect(result.legacyRead.events.substitutionCount).toBe(1);
    expect(result.fusionRead.events.substitutionCount).toBe(1);
    expect(result.legacyRead.odds.marketFamilies).toEqual(expect.arrayContaining([
      'btts',
      'corners_ou',
      'custom_market',
      'goals_ou',
    ]));
    expect(result.fusionRead.odds.marketFamilies).toEqual(expect.arrayContaining([
      'btts',
      'corners_ou',
      'team_specials',
    ]));
    expect(result.legacyRead.odds.lineKeys).toEqual(expect.arrayContaining([
      'corners_ou:10.5',
      'custom_market:1',
      'goals_ou:3.5',
      'parlay_market:0',
      'parlay_market:1.5',
    ]));
    expect(JSON.stringify(result.audit)).not.toContain('RAW_SECRET_UNKNOWN_MARKET');
  });

  it('does not leak raw provider payloads into the audit payload', () => {
    const result = buildProviderFusionPipelineRead({
      matchId: '164327',
      fixture,
      statisticsRaw,
      eventsRaw,
      statsCompact,
      eventsCompact,
      oddsCanonical,
      oddsResponse: completeOddsResponse('RAW_SECRET_ODDS'),
      oddsSource: 'live',
      oddsFetchedAt: '2026-06-13T12:00:00.000Z',
      statisticsProvider: 'api-football',
      eventsProvider: 'api-football',
      generatedAt: '2026-06-13T12:00:01.000Z',
      promotionEnabled: false,
    });

    expect(JSON.stringify(result.audit)).not.toContain('RAW_SECRET_ODDS');
    expect(result.audit).toEqual(expect.objectContaining({
      contract: 'provider-fusion-phase-6-shadow-parity',
      promptEquivalent: true,
    }));
  });
});
