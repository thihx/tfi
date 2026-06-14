import { describe, expect, it } from 'vitest';
import type { ApiFixture, ApiFixtureEvent, ApiFixtureStat } from '../lib/football-api.js';
import { buildCanonicalOddsSnapshot } from '../lib/canonical/provider-domain.js';
import {
  canonicalFusionOddsToPipelineOddsCanonical,
  decideProviderFusionOddsPromotion,
  shouldEvaluateProviderFusionOddsPromotion,
} from '../lib/provider-fusion-odds-promotion.js';
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
    ],
  },
  {
    team: { id: 20, name: 'Czech Republic', logo: 'cz.png' },
    statistics: [
      { type: 'Ball Possession', value: '42%' },
      { type: 'Total Shots', value: 10 },
      { type: 'Shots on Goal', value: 3 },
      { type: 'Corner Kicks', value: 3 },
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
];

const statsCompact = {
  possession: { home: '58%', away: '42%' },
  shots: { home: '12', away: '10' },
  shots_on_target: { home: '4', away: '3' },
  corners: { home: '7', away: '3' },
};

const eventsCompact = [
  { minute: 54, extra: null, team: 'Czech Republic', type: 'goal', detail: 'Normal Goal', player: 'Forward' },
];

const oddsCanonical = {
  ou: { line: 2.5, over: 1.92, under: 1.96 },
  '1x2': { home: 3.10, draw: 3.30, away: 2.35 },
  ah: { line: -0.25, home: 1.88, away: 1.98 },
  btts: { yes: 1.91, no: 1.93 },
  corners_ou: { line: 10.5, over: 2.20, under: 1.72 },
};

function liveOddsResponse() {
  return [
    {
      marker: 'RAW_SECRET_PHASE_9',
      bookmakers: [
        {
          name: 'Live Book A',
          bets: [
            {
              name: 'Over/Under',
              values: [
                { value: 'Over 2.5', odd: '1.92', handicap: '2.5' },
                { value: 'Under 2.5', odd: '1.96', handicap: '2.5' },
                { value: 'Over 3.5', odd: '2.20', handicap: '3.5' },
                { value: 'Under 3.5', odd: '1.72', handicap: '3.5' },
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
            {
              name: 'Asian Handicap',
              values: [
                { value: 'Home -0.25', odd: '1.88', handicap: '-0.25' },
                { value: 'Away +0.25', odd: '1.98', handicap: '+0.25' },
              ],
            },
            {
              name: 'Both Teams To Score',
              values: [
                { value: 'Yes', odd: '1.91' },
                { value: 'No', odd: '1.93' },
              ],
            },
            {
              name: 'Corners Over Under',
              values: [
                { value: 'Over 10.5', odd: '2.20', handicap: '10.5' },
                { value: 'Under 10.5', odd: '1.72', handicap: '10.5' },
              ],
            },
          ],
        },
      ],
    },
  ];
}

function fusionRead(args: {
  oddsSource?: 'live' | 'reference-prematch' | 'none';
  oddsFetchedAt?: string | null;
  oddsCanonicalOverride?: Record<string, unknown>;
  oddsResponseOverride?: unknown[];
} = {}) {
  return buildProviderFusionPipelineRead({
    matchId: '164327',
    fixture,
    statisticsRaw,
    eventsRaw,
    statsCompact,
    eventsCompact,
    oddsCanonical: args.oddsCanonicalOverride ?? oddsCanonical,
    oddsResponse: args.oddsResponseOverride ?? liveOddsResponse(),
    oddsSource: args.oddsSource ?? 'live',
    oddsFetchedAt: args.oddsFetchedAt ?? '2026-06-13T12:00:00.000Z',
    statisticsProvider: 'api-football',
    eventsProvider: 'api-football',
    generatedAt: '2026-06-13T12:00:01.000Z',
    promotionEnabled: true,
  });
}

function baseDecision(overrides: Partial<Parameters<typeof decideProviderFusionOddsPromotion>[0]> = {}) {
  return decideProviderFusionOddsPromotion({
    read: fusionRead(),
    matchId: '164327',
    oddsSource: 'live',
    oddsFetchedAt: '2026-06-13T12:00:00.000Z',
    generatedAt: '2026-06-13T12:00:01.000Z',
    status: '2H',
    minute: 65,
    score: '0-1',
    homeName: 'South Korea',
    awayName: 'Czech Republic',
    currentTotalGoals: 1,
    config: {
      killSwitch: false,
      providerAllowlist: ['api-football'],
      rolloutPercent: 100,
    },
    ...overrides,
  });
}

describe('provider fusion odds promotion', () => {
  it('requires explicit provider fusion odds promotion and ignores shadow mode', () => {
    expect(shouldEvaluateProviderFusionOddsPromotion({
      providerFusionEnabled: true,
      providerFusionOddsPromotion: true,
    })).toBe(true);
    expect(shouldEvaluateProviderFusionOddsPromotion({
      providerFusionEnabled: true,
      providerFusionOddsPromotion: true,
    }, { shadowMode: true })).toBe(false);
    expect(shouldEvaluateProviderFusionOddsPromotion({
      providerFusionEnabled: true,
      providerFusionOddsPromotion: false,
    })).toBe(false);
  });

  it('promotes fresh allowlisted live odds and converts canonical selections to pipeline odds shape', () => {
    const result = baseDecision();

    expect(result).toEqual(expect.objectContaining({
      status: 'promoted',
      promoted: true,
      productionBehaviorChanged: true,
      canUseFusionOddsForMoneyDecision: true,
      canSaveRecommendation: true,
      blocksRecommendationSave: false,
      provider: 'api-football',
      hardBlockReasons: [],
    }));
    expect(result.oddsCanonical).toEqual(expect.objectContaining({
      ou: { line: 2.5, over: 1.92, under: 1.96 },
      ou_adjacent: { line: 3.5, over: 2.2, under: 1.72 },
      ah: { line: -0.25, home: 1.88, away: 1.98 },
      btts: { yes: 1.91, no: 1.93 },
      corners_ou: { line: 10.5, over: 2.2, under: 1.72 },
    }));
    expect(result.audit).toEqual(expect.objectContaining({
      contract: 'provider-fusion-phase-9-odds-promotion',
      promoted: true,
      reason: 'promoted_controlled_live_odds',
    }));
    expect(JSON.stringify(result.audit)).not.toContain('RAW_SECRET_PHASE_9');
  });

  it('blocks reference odds and marks recommendation save as blocked while promotion is active', () => {
    const result = baseDecision({
      read: fusionRead({ oddsSource: 'reference-prematch' }),
      oddsSource: 'reference-prematch',
      oddsFetchedAt: '2026-06-13T11:40:00.000Z',
    });

    expect(result.promoted).toBe(false);
    expect(result.status).toBe('blocked');
    expect(result.blocksRecommendationSave).toBe(true);
    expect(result.hardBlockReasons).toEqual(expect.arrayContaining([
      'reference_odds_context_only',
      'no_tradable_live_odds',
    ]));
  });

  it('blocks provider source conflicts without promoting odds', () => {
    const read = fusionRead();
    read.snapshot.consensus.oddsAgreement = 'conflict';

    const result = baseDecision({ read });

    expect(result.promoted).toBe(false);
    expect(result.blocksRecommendationSave).toBe(true);
    expect(result.hardBlockReasons).toContain('odds_source_conflict');
  });

  it('honors kill switch, allowlist, and rollout as rollback/config gates without save blocking', () => {
    expect(baseDecision({
      config: { killSwitch: true, providerAllowlist: ['api-football'], rolloutPercent: 100 },
    })).toEqual(expect.objectContaining({
      status: 'disabled',
      reason: 'promotion_kill_switch',
      blocksRecommendationSave: false,
    }));

    expect(baseDecision({
      config: { killSwitch: false, providerAllowlist: [], rolloutPercent: 100 },
    })).toEqual(expect.objectContaining({
      status: 'disabled',
      reason: 'provider_allowlist_empty',
      blocksRecommendationSave: false,
    }));

    expect(baseDecision({
      config: { killSwitch: false, providerAllowlist: ['sportmonks'], rolloutPercent: 100 },
    })).toEqual(expect.objectContaining({
      status: 'disabled',
      reason: 'provider_not_allowlisted',
      blocksRecommendationSave: false,
    }));

    expect(baseDecision({
      config: { killSwitch: false, providerAllowlist: ['api-football'], rolloutPercent: 0 },
    })).toEqual(expect.objectContaining({
      status: 'disabled',
      reason: 'rollout_zero',
      blocksRecommendationSave: false,
    }));

    expect(baseDecision({
      config: { killSwitch: false, providerAllowlist: ['api-football'], rolloutPercent: 0.000001 },
    })).toEqual(expect.objectContaining({
      status: 'disabled',
      reason: 'outside_rollout_sample',
      blocksRecommendationSave: false,
    }));

    expect(baseDecision({
      config: { killSwitch: false, providerAllowlist: ['api-football'], rolloutPercent: Number.NaN },
    })).toEqual(expect.objectContaining({
      status: 'disabled',
      reason: 'rollout_zero',
      rolloutPercent: 0,
    }));
  });

  it('blocks when canonical odds cannot be converted into supported pipeline markets', () => {
    const snapshot = buildCanonicalOddsSnapshot({
      matchId: '164327',
      generatedAt: '2026-06-13T12:00:00.000Z',
      sourceProvider: 'api-football',
      sourceKind: 'live',
      selections: [
        {
          market: 'Team Specials',
          selection: 'Clean Sheet',
          line: null,
          price: 2.2,
          bookmaker: 'Live Book A',
          provider: 'api-football',
          kind: 'live',
          fetchedAt: '2026-06-13T12:00:00.000Z',
          suspended: false,
        },
      ],
    });
    const read = fusionRead();
    read.snapshot.canonical.odds = snapshot;
    read.snapshot.fieldSources.odds.provider = 'api-football';
    read.snapshot.fieldSources.odds.fetchedAt = '2026-06-13T12:00:00.000Z';

    const result = baseDecision({ read, oddsFetchedAt: null });

    expect(result.promoted).toBe(false);
    expect(result.blocksRecommendationSave).toBe(true);
    expect(result.oddsFetchedAt).toBe('2026-06-13T12:00:00.000Z');
    expect(result.hardBlockReasons).toContain('canonical_odds_no_supported_markets');
  });

  it('converts first-half markets and team-name selections deterministically', () => {
    const snapshot = buildCanonicalOddsSnapshot({
      matchId: '164327',
      generatedAt: '2026-06-13T12:00:00.000Z',
      sourceProvider: 'sportmonks',
      sourceKind: 'live',
      selections: [
        { market: 'First Half Over/Under', selection: 'Over 1.5', line: 1.5, price: 1.9, bookmaker: 'SM', provider: 'sportmonks', kind: 'live', fetchedAt: '2026-06-13T12:00:00.000Z', suspended: false },
        { market: 'First Half Over/Under', selection: 'Under 1.5', line: 1.5, price: 1.9, bookmaker: 'SM', provider: 'sportmonks', kind: 'live', fetchedAt: '2026-06-13T12:00:00.000Z', suspended: false },
        { market: 'Full Time Result', selection: 'South Korea', line: null, price: 2.4, bookmaker: 'SM', provider: 'sportmonks', kind: 'live', fetchedAt: '2026-06-13T12:00:00.000Z', suspended: false },
        { market: 'Full Time Result', selection: 'Draw', line: null, price: 3.2, bookmaker: 'SM', provider: 'sportmonks', kind: 'live', fetchedAt: '2026-06-13T12:00:00.000Z', suspended: false },
        { market: 'Full Time Result', selection: 'Czech Republic', line: null, price: 3.1, bookmaker: 'SM', provider: 'sportmonks', kind: 'live', fetchedAt: '2026-06-13T12:00:00.000Z', suspended: false },
      ],
    });

    const converted = canonicalFusionOddsToPipelineOddsCanonical(snapshot, {
      homeName: 'South Korea',
      awayName: 'Czech Republic',
    });

    expect(converted.available).toBe(true);
    expect(converted.canonical.ht_ou).toEqual({ line: 1.5, over: 1.9, under: 1.9 });
    expect(converted.canonical['1x2']).toEqual({ home: 2.4, draw: 3.2, away: 3.1 });
  });

  it('converts first-half handicap ladders, BTTS, duplicate best prices, and parsed text lines', () => {
    const snapshot = buildCanonicalOddsSnapshot({
      matchId: '164327',
      generatedAt: '2026-06-13T12:00:00.000Z',
      sourceProvider: 'sportmonks',
      sourceKind: 'live',
      selections: [
        { market: 'First Half Asian Handicap', selection: 'Home 0', line: null, price: 1.92, bookmaker: 'SM', provider: 'sportmonks', kind: 'live', fetchedAt: '2026-06-13T12:00:00.000Z', suspended: false },
        { market: 'First Half Asian Handicap', selection: 'Away 0', line: null, price: 1.92, bookmaker: 'SM', provider: 'sportmonks', kind: 'live', fetchedAt: '2026-06-13T12:00:00.000Z', suspended: false },
        { market: 'First Half Asian Handicap', selection: 'Home -0.5', line: null, price: 2.05, bookmaker: 'SM', provider: 'sportmonks', kind: 'live', fetchedAt: '2026-06-13T12:00:00.000Z', suspended: false },
        { market: 'First Half Asian Handicap', selection: 'Away +0.5', line: null, price: 1.8, bookmaker: 'SM', provider: 'sportmonks', kind: 'live', fetchedAt: '2026-06-13T12:00:00.000Z', suspended: false },
        { market: 'First Half Asian Handicap', selection: 'Home -1.0', line: null, price: 2.4, bookmaker: 'SM', provider: 'sportmonks', kind: 'live', fetchedAt: '2026-06-13T12:00:00.000Z', suspended: false },
        { market: 'First Half Asian Handicap', selection: 'Away +1.0', line: null, price: 1.55, bookmaker: 'SM', provider: 'sportmonks', kind: 'live', fetchedAt: '2026-06-13T12:00:00.000Z', suspended: false },
        { market: 'First Half Both Teams To Score', selection: 'Yes', line: null, price: 1.95, bookmaker: 'SM', provider: 'sportmonks', kind: 'live', fetchedAt: '2026-06-13T12:00:00.000Z', suspended: false },
        { market: 'First Half Both Teams To Score', selection: 'Yes', line: null, price: 1.98, bookmaker: 'SM2', provider: 'sportmonks', kind: 'live', fetchedAt: '2026-06-13T12:00:00.000Z', suspended: false },
        { market: 'First Half Both Teams To Score', selection: 'No', line: null, price: 1.85, bookmaker: 'SM', provider: 'sportmonks', kind: 'live', fetchedAt: '2026-06-13T12:00:00.000Z', suspended: false },
      ],
    });

    const converted = canonicalFusionOddsToPipelineOddsCanonical(snapshot);

    expect(converted.canonical.ht_ah).toEqual({ line: 0, home: 1.92, away: 1.92 });
    expect(converted.canonical.ht_ah_adjacent).toEqual({ line: -0.5, home: 2.05, away: 1.8 });
    expect(converted.canonical.ht_ah_extra).toEqual([{ line: -1, home: 2.4, away: 1.55 }]);
    expect(converted.canonical.ht_btts).toEqual({ yes: 1.98, no: 1.85 });
    expect(converted.lineKeys).toContain('ht_asian_handicap:0');
  });

  it('prunes unsupported, suspended, stale-shaped, and impossible-margin markets', () => {
    const snapshot = buildCanonicalOddsSnapshot({
      matchId: '164327',
      generatedAt: '2026-06-13T12:00:00.000Z',
      sourceProvider: 'api-football',
      sourceKind: 'live',
      selections: [
        { market: 'Full Time Result', selection: 'Home', line: null, price: 1.01, bookmaker: 'BadBook', provider: 'api-football', kind: 'live', fetchedAt: '2026-06-13T12:00:00.000Z', suspended: false },
        { market: 'Full Time Result', selection: 'Draw', line: null, price: 1.01, bookmaker: 'BadBook', provider: 'api-football', kind: 'live', fetchedAt: '2026-06-13T12:00:00.000Z', suspended: false },
        { market: 'Full Time Result', selection: 'Away', line: null, price: 1.01, bookmaker: 'BadBook', provider: 'api-football', kind: 'live', fetchedAt: '2026-06-13T12:00:00.000Z', suspended: false },
        { market: 'Both Teams To Score', selection: 'Yes', line: null, price: 1.01, bookmaker: 'BadBook', provider: 'api-football', kind: 'live', fetchedAt: '2026-06-13T12:00:00.000Z', suspended: false },
        { market: 'Both Teams To Score', selection: 'No', line: null, price: 1.01, bookmaker: 'BadBook', provider: 'api-football', kind: 'live', fetchedAt: '2026-06-13T12:00:00.000Z', suspended: false },
        { market: 'Over/Under', selection: 'Over', line: null, price: 1.9, bookmaker: 'NoLine', provider: 'api-football', kind: 'live', fetchedAt: '2026-06-13T12:00:00.000Z', suspended: false },
        { market: 'Over/Under', selection: 'Under 2.5', line: 2.5, price: 1.9, bookmaker: 'Suspended', provider: 'api-football', kind: 'live', fetchedAt: '2026-06-13T12:00:00.000Z', suspended: true },
        { market: 'Over/Under', selection: 'Over 3.5', line: 3.5, price: 0.99, bookmaker: 'BadPrice', provider: 'api-football', kind: 'live', fetchedAt: '2026-06-13T12:00:00.000Z', suspended: false },
        { market: 'Over/Under', selection: 'Under 3.5', line: 3.5, price: 1.9, bookmaker: 'PrematchShape', provider: 'api-football', kind: 'prematch', fetchedAt: '2026-06-13T12:00:00.000Z', suspended: false },
      ],
    });

    const converted = canonicalFusionOddsToPipelineOddsCanonical(snapshot);

    expect(converted.available).toBe(false);
    expect(converted.canonical).toEqual({});
  });

  it('keeps alternate full-time ladder branches and prunes invalid extras', () => {
    const selections = [
      ['Over/Under', 'Over 1.5', 1.5, 1.5],
      ['Over/Under', 'Under 1.5', 1.5, 3.0],
      ['Over/Under', 'Over 2.5', 2.5, 1.88],
      ['Over/Under', 'Over 2.5', 2.5, 1.9],
      ['Over/Under', 'Under 2.5', 2.5, 1.9],
      ['Over/Under', 'Over 3.5', 3.5, 2.0],
      ['Over/Under', 'Under 3.5', 3.5, 1.8],
      ['Over/Under', 'Over 4.5', 4.5, 1.01],
      ['Over/Under', 'Under 4.5', 4.5, 1.01],
      ['Asian Handicap', 'Home 0', 0, 1.9],
      ['Asian Handicap', 'Away 0', 0, 1.9],
      ['Asian Handicap', 'Home -0.5', -0.5, 2.05],
      ['Asian Handicap', 'Away +0.5', 0.5, 1.8],
      ['Asian Handicap', 'Home -1.0', -1, 2.4],
      ['Asian Handicap', 'Away +1.0', 1, 1.55],
      ['Asian Handicap', 'Home -1.5', -1.5, 1.01],
      ['Asian Handicap', 'Away +1.5', 1.5, 1.01],
    ].map(([market, selection, line, price]) => ({
      market,
      selection,
      line,
      price,
      bookmaker: 'DeepBook',
      provider: 'api-football',
      kind: 'live',
      fetchedAt: '2026-06-13T12:00:00.000Z',
      suspended: false,
    }));
    const snapshot = buildCanonicalOddsSnapshot({
      matchId: '164327',
      generatedAt: '2026-06-13T12:00:00.000Z',
      sourceProvider: 'api-football',
      sourceKind: 'live',
      selections,
    });

    const converted = canonicalFusionOddsToPipelineOddsCanonical(snapshot);

    expect(converted.canonical.ou).toEqual({ line: 2.5, over: 1.9, under: 1.9 });
    expect(converted.canonical.ou_adjacent).toEqual({ line: 3.5, over: 2, under: 1.8 });
    expect(converted.canonical.ou_extra).toEqual([{ line: 1.5, over: 1.5, under: 3 }]);
    expect(converted.canonical.ah).toEqual({ line: 0, home: 1.9, away: 1.9 });
    expect(converted.canonical.ah_adjacent).toEqual({ line: -0.5, home: 2.05, away: 1.8 });
    expect(converted.canonical.ah_extra).toEqual([{ line: -1, home: 2.4, away: 1.55 }]);
    expect(converted.lineKeys).toEqual(expect.arrayContaining([
      'goals_ou:1.5',
      'asian_handicap:-1',
    ]));
  });

  it('handles half-time market fallback sides and bad margin pruning', () => {
    const snapshot = buildCanonicalOddsSnapshot({
      matchId: '164327',
      generatedAt: '2026-06-13T12:00:00.000Z',
      sourceProvider: 'sportmonks',
      sourceKind: 'live',
      selections: [
        { market: 'First Half Full Time Result', selection: 'Home', line: null, price: 1.01, bookmaker: 'SM', provider: 'sportmonks', kind: 'live', fetchedAt: '2026-06-13T12:00:00.000Z', suspended: false },
        { market: 'First Half Full Time Result', selection: 'Draw', line: null, price: 1.01, bookmaker: 'SM', provider: 'sportmonks', kind: 'live', fetchedAt: '2026-06-13T12:00:00.000Z', suspended: false },
        { market: 'First Half Full Time Result', selection: 'Away', line: null, price: 1.01, bookmaker: 'SM', provider: 'sportmonks', kind: 'live', fetchedAt: '2026-06-13T12:00:00.000Z', suspended: false },
        { market: 'Home Full Time Result', selection: 'Participant', line: null, price: 2.5, bookmaker: 'SM', provider: 'sportmonks', kind: 'live', fetchedAt: '2026-06-13T12:00:00.000Z', suspended: false },
        { market: 'Away Full Time Result', selection: 'Participant', line: null, price: 2.8, bookmaker: 'SM', provider: 'sportmonks', kind: 'live', fetchedAt: '2026-06-13T12:00:00.000Z', suspended: false },
        { market: 'Full Time Result', selection: 'Draw', line: null, price: 3.2, bookmaker: 'SM', provider: 'sportmonks', kind: 'live', fetchedAt: '2026-06-13T12:00:00.000Z', suspended: false },
      ],
    });

    const converted = canonicalFusionOddsToPipelineOddsCanonical(snapshot);

    expect(converted.canonical.ht_1x2).toBeUndefined();
    expect(converted.canonical['1x2']).toEqual({ home: 2.5, draw: 3.2, away: 2.8 });
  });

  it('covers one-sided ladder fallback and handicap absolute-line tie-breaks', () => {
    const snapshot = buildCanonicalOddsSnapshot({
      matchId: '164327',
      generatedAt: '2026-06-13T12:00:00.000Z',
      sourceProvider: 'api-football',
      sourceKind: 'live',
      selections: [
        { market: 'Over/Under', selection: 'Over 2.5', line: 2.5, price: 1.9, bookmaker: 'FallbackBook', provider: 'api-football', kind: 'live', fetchedAt: '2026-06-13T12:00:00.000Z', suspended: false },
        { market: 'Asian Handicap', selection: 'Home -0.5', line: -0.5, price: 1.95, bookmaker: 'TieBook', provider: 'api-football', kind: 'live', fetchedAt: '2026-06-13T12:00:00.000Z', suspended: false },
        { market: 'Asian Handicap', selection: 'Away +0.5', line: 0.5, price: 1.85, bookmaker: 'TieBook', provider: 'api-football', kind: 'live', fetchedAt: '2026-06-13T12:00:00.000Z', suspended: false },
        { market: 'Asian Handicap', selection: 'Home +0.5', line: 0.5, price: 1.88, bookmaker: 'TieBook', provider: 'api-football', kind: 'live', fetchedAt: '2026-06-13T12:00:00.000Z', suspended: false },
        { market: 'Asian Handicap', selection: 'Away -0.5', line: -0.5, price: 1.92, bookmaker: 'TieBook', provider: 'api-football', kind: 'live', fetchedAt: '2026-06-13T12:00:00.000Z', suspended: false },
      ],
    });

    const converted = canonicalFusionOddsToPipelineOddsCanonical(snapshot);

    expect(converted.canonical.ou).toBeUndefined();
    expect(converted.canonical.ah).toEqual({ line: 0.5, home: 1.88, away: 1.92 });
    expect(converted.canonical.ah_adjacent).toEqual({ line: -0.5, home: 1.95, away: 1.85 });
  });

  it('keeps the best duplicate price and uses complete ladders when no line is above the goal hint', () => {
    const snapshot = buildCanonicalOddsSnapshot({
      matchId: '164327',
      generatedAt: '2026-06-13T12:00:00.000Z',
      sourceProvider: 'api-football',
      sourceKind: 'live',
      selections: [
        { market: 'Full Time Result', selection: 'Home', line: null, price: 2.6, bookmaker: 'BestBook', provider: 'api-football', kind: 'live', fetchedAt: '2026-06-13T12:00:00.000Z', suspended: false },
        { market: 'Full Time Result', selection: 'Home', line: null, price: 2.4, bookmaker: 'WorseBook', provider: 'api-football', kind: 'live', fetchedAt: '2026-06-13T12:00:00.000Z', suspended: false },
        { market: 'Full Time Result', selection: 'Draw', line: null, price: 3.2, bookmaker: 'BestBook', provider: 'api-football', kind: 'live', fetchedAt: '2026-06-13T12:00:00.000Z', suspended: false },
        { market: 'Full Time Result', selection: 'Away', line: null, price: 2.8, bookmaker: 'BestBook', provider: 'api-football', kind: 'live', fetchedAt: '2026-06-13T12:00:00.000Z', suspended: false },
        { market: 'Over/Under', selection: 'Over 2.5', line: 2.5, price: 1.9, bookmaker: 'BestBook', provider: 'api-football', kind: 'live', fetchedAt: '2026-06-13T12:00:00.000Z', suspended: false },
        { market: 'Over/Under', selection: 'Under 2.5', line: 2.5, price: 1.9, bookmaker: 'BestBook', provider: 'api-football', kind: 'live', fetchedAt: '2026-06-13T12:00:00.000Z', suspended: false },
        { market: 'Over/Under', selection: 'Over 3.5', line: 3.5, price: 1.95, bookmaker: 'BestBook', provider: 'api-football', kind: 'live', fetchedAt: '2026-06-13T12:00:00.000Z', suspended: false },
        { market: 'Over/Under', selection: 'Under 3.5', line: 3.5, price: 1.85, bookmaker: 'BestBook', provider: 'api-football', kind: 'live', fetchedAt: '2026-06-13T12:00:00.000Z', suspended: false },
      ],
    });

    const converted = canonicalFusionOddsToPipelineOddsCanonical(snapshot, { currentTotalGoals: 9 });

    expect(converted.canonical['1x2']).toEqual({ home: 2.6, draw: 3.2, away: 2.8 });
    expect(converted.canonical.ou).toEqual({ line: 3.5, over: 1.95, under: 1.85 });
    expect(converted.canonical.ou_adjacent).toEqual({ line: 2.5, over: 1.9, under: 1.9 });
  });

  it('prunes invalid extra ladders after keeping valid primary and adjacent lines', () => {
    const selections = [
      ['Over/Under', 'Over 1.5', 1.5, 1.9],
      ['Over/Under', 'Under 1.5', 1.5, 1.9],
      ['Over/Under', 'Over 2.5', 2.5, 1.95],
      ['Over/Under', 'Under 2.5', 2.5, 1.85],
      ['Over/Under', 'Over 4.5', 4.5, 1.1],
      ['Over/Under', 'Under 4.5', 4.5, 3],
      ['First Half Over/Under', 'Over 0.5', 0.5, 1.9],
      ['First Half Over/Under', 'Under 0.5', 0.5, 1.9],
      ['First Half Over/Under', 'Over 1.5', 1.5, 1.95],
      ['First Half Over/Under', 'Under 1.5', 1.5, 1.85],
      ['First Half Over/Under', 'Over 2.5', 2.5, 1.1],
      ['First Half Over/Under', 'Under 2.5', 2.5, 3],
      ['Asian Handicap', 'Home 0', 0, 1.9],
      ['Asian Handicap', 'Away 0', 0, 1.9],
      ['Asian Handicap', 'Home -0.5', -0.5, 1.95],
      ['Asian Handicap', 'Away +0.5', 0.5, 1.85],
      ['Asian Handicap', 'Home -1.5', -1.5, 1.1],
      ['Asian Handicap', 'Away +1.5', 1.5, 3],
      ['First Half Asian Handicap', 'Home 0', 0, 1.9],
      ['First Half Asian Handicap', 'Away 0', 0, 1.9],
      ['First Half Asian Handicap', 'Home -0.5', -0.5, 1.95],
      ['First Half Asian Handicap', 'Away +0.5', 0.5, 1.85],
      ['First Half Asian Handicap', 'Home -1.5', -1.5, 1.1],
      ['First Half Asian Handicap', 'Away +1.5', 1.5, 3],
    ].map(([market, selection, line, price]) => ({
      market,
      selection,
      line,
      price,
      bookmaker: 'PruneBook',
      provider: 'api-football',
      kind: 'live',
      fetchedAt: '2026-06-13T12:00:00.000Z',
      suspended: false,
    }));
    const snapshot = buildCanonicalOddsSnapshot({
      matchId: '164327',
      generatedAt: '2026-06-13T12:00:00.000Z',
      sourceProvider: 'api-football',
      sourceKind: 'live',
      selections,
    });

    const converted = canonicalFusionOddsToPipelineOddsCanonical(snapshot);

    expect(converted.canonical.ou).toEqual({ line: 1.5, over: 1.9, under: 1.9 });
    expect(converted.canonical.ou_adjacent).toEqual({ line: 2.5, over: 1.95, under: 1.85 });
    expect(converted.canonical.ou_extra).toBeUndefined();
    expect(converted.canonical.ht_ou).toEqual({ line: 0.5, over: 1.9, under: 1.9 });
    expect(converted.canonical.ht_ou_adjacent).toEqual({ line: 1.5, over: 1.95, under: 1.85 });
    expect(converted.canonical.ht_ou_extra).toBeUndefined();
    expect(converted.canonical.ah_extra).toBeUndefined();
    expect(converted.canonical.ht_ah_extra).toBeUndefined();
  });

  it('drops bad handicap mains and preserves fallback timestamps and soft warnings', () => {
    const badAhSnapshot = buildCanonicalOddsSnapshot({
      matchId: '164327',
      generatedAt: '2026-06-13T12:00:00.000Z',
      sourceProvider: 'api-football',
      sourceKind: 'live',
      selections: [
        { market: 'Asian Handicap', selection: 'Home 0', line: 0, price: 1.01, bookmaker: 'BadAh', provider: 'api-football', kind: 'live', fetchedAt: '2026-06-13T12:00:00.000Z', suspended: false },
        { market: 'Asian Handicap', selection: 'Away 0', line: 0, price: 1.01, bookmaker: 'BadAh', provider: 'api-football', kind: 'live', fetchedAt: '2026-06-13T12:00:00.000Z', suspended: false },
        { market: 'Both Teams To Score', selection: 'Yes', line: null, price: 1.9, bookmaker: 'GoodBook', provider: 'api-football', kind: 'live', fetchedAt: '2026-06-13T12:00:00.000Z', suspended: false },
        { market: 'Both Teams To Score', selection: 'No', line: null, price: 1.9, bookmaker: 'GoodBook', provider: 'api-football', kind: 'live', fetchedAt: '2026-06-13T12:00:00.000Z', suspended: false },
      ],
    });
    expect(canonicalFusionOddsToPipelineOddsCanonical(badAhSnapshot).canonical.ah).toBeUndefined();

    const read = fusionRead();
    const freshFetchedAt = new Date().toISOString();
    read.snapshot.fieldSources.odds.fetchedAt = freshFetchedAt;
    read.snapshot.warnings.push('provider quota near limit');

    const result = baseDecision({
      read,
      oddsFetchedAt: null,
      generatedAt: undefined,
    });

    expect(result.promoted).toBe(true);
    expect(result.oddsFetchedAt).toBe(freshFetchedAt);
    expect(result.softWarnings).toContain('provider quota near limit');
  });

  it('treats missing provider identity as non-promotable and blocks none-source odds conservatively', () => {
    const liveRead = fusionRead();
    liveRead.snapshot.fieldSources.odds.provider = null;
    if (liveRead.snapshot.canonical.odds) liveRead.snapshot.canonical.odds.sourceProvider = null;

    expect(baseDecision({ read: liveRead })).toEqual(expect.objectContaining({
      status: 'disabled',
      reason: 'provider_not_allowlisted',
      blocksRecommendationSave: false,
    }));

    const noneRead = fusionRead({ oddsSource: 'none' });
    noneRead.snapshot.fieldSources.odds.provider = null;
    if (noneRead.snapshot.canonical.odds) noneRead.snapshot.canonical.odds.sourceProvider = null;

    expect(baseDecision({ read: noneRead, oddsSource: 'none' })).toEqual(expect.objectContaining({
      status: 'blocked',
      reason: 'odds_source_conflict',
      blocksRecommendationSave: true,
    }));
  });

  it('blocks stale live odds as a money-safety save block', () => {
    const result = baseDecision({
      generatedAt: '2026-06-13T12:03:00.000Z',
      maxLiveOddsAgeMs: 60_000,
    });

    expect(result.status).toBe('blocked');
    expect(result.blocksRecommendationSave).toBe(true);
    expect(result.hardBlockReasons).toContain('live_odds_stale');
  });

  it('reports missing provider fusion read as money-safety blocked', () => {
    const result = baseDecision({ read: null });

    expect(result).toEqual(expect.objectContaining({
      status: 'blocked',
      reason: 'provider_fusion_read_missing',
      blocksRecommendationSave: true,
      hardBlockReasons: ['provider_fusion_read_missing'],
    }));
  });
});
