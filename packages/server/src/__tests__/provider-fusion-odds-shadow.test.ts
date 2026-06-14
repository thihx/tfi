import { describe, expect, it } from 'vitest';
import type { ApiFixture, ApiFixtureEvent, ApiFixtureStat } from '../lib/football-api.js';
import {
  buildProviderFusionOddsShadow,
  canonicalOddsMarketFamily,
  shouldBuildProviderFusionOddsShadow,
} from '../lib/provider-fusion-odds-shadow.js';
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
    ],
  },
  {
    team: { id: 20, name: 'Czech Republic', logo: 'cz.png' },
    statistics: [
      { type: 'Ball Possession', value: '42%' },
      { type: 'Total Shots', value: 10 },
      { type: 'Shots on Goal', value: 3 },
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
      marker: 'RAW_SECRET_PHASE_8',
      bookmakers: [
        {
          name: 'Live Book A',
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
    promotionEnabled: false,
  });
}

function auditRecord(result: ReturnType<typeof buildProviderFusionOddsShadow>) {
  return result.audit as {
    sourceKind: string;
    providerOdds: {
      bookmakers: string[];
      liveFamilies: string[];
      lineKeys: string[];
      marketSignatures: string[];
    };
    marketDiff: {
      changed: boolean;
      familiesMissingInFusion: string[];
      familiesExtraInFusion: string[];
      linesMissingInFusion: string[];
      linesExtraInFusion: string[];
    };
    freshness: { freshness: string; ageMs: number | null; stale: boolean };
    moneyGuard: { canSaveRecommendation: boolean; hardBlockReasons: string[]; softWarnings: string[] };
  };
}

describe('provider fusion odds shadow', () => {
  it('keeps Phase 8 shadow opt-in and disabled when odds promotion is active', () => {
    expect(shouldBuildProviderFusionOddsShadow({
      providerFusionEnabled: true,
      providerFusionOddsShadowEnabled: true,
      providerFusionOddsPromotion: false,
    })).toBe(true);
    expect(shouldBuildProviderFusionOddsShadow({
      providerFusionEnabled: true,
      providerFusionShadowEnabled: true,
    })).toBe(true);
    expect(shouldBuildProviderFusionOddsShadow({
      providerFusionEnabled: true,
      providerFusionOddsShadowEnabled: true,
      providerFusionOddsPromotion: true,
    })).toBe(false);
    expect(shouldBuildProviderFusionOddsShadow({
      providerFusionEnabled: true,
      providerFusionOddsShadowEnabled: true,
    }, { shadowMode: true })).toBe(false);
  });

  it('classifies fresh live odds and records bookmaker, market family, and line provenance', () => {
    const result = buildProviderFusionOddsShadow({
      read: fusionRead(),
      matchId: '164327',
      oddsSource: 'live',
      oddsFetchedAt: '2026-06-13T12:00:00.000Z',
      generatedAt: '2026-06-13T12:00:01.000Z',
      status: '2H',
      minute: 65,
      score: '0-1',
    });
    const audit = auditRecord(result);

    expect(result.canUseFusionOddsForMoneyDecision).toBe(true);
    expect(result.canSaveRecommendation).toBe(false);
    expect(result.hardBlockReasons).toEqual([]);
    expect(audit.sourceKind).toBe('live');
    expect(audit.providerOdds.bookmakers).toEqual(['Live Book A']);
    expect(audit.providerOdds.liveFamilies).toEqual([
      '1x2',
      'asian_handicap',
      'btts',
      'corners_ou',
      'goals_ou',
    ]);
    expect(audit.providerOdds.lineKeys).toEqual(expect.arrayContaining([
      'goals_ou:2.5',
      'asian_handicap:-0.25',
      'asian_handicap:0.25',
      'corners_ou:10.5',
    ]));
    expect(audit.providerOdds.marketSignatures).toEqual(expect.arrayContaining([
      'goals_ou:2.5:over_2.5',
      'asian_handicap:-0.25:home_-0.25',
      'btts:none:yes',
    ]));
    expect(JSON.stringify(result.audit)).not.toContain('RAW_SECRET_PHASE_8');
  });

  it('treats prematch/reference odds as context-only and never saveable', () => {
    const result = buildProviderFusionOddsShadow({
      read: fusionRead({ oddsSource: 'reference-prematch' }),
      matchId: '164327',
      oddsSource: 'reference-prematch',
      oddsFetchedAt: '2026-06-13T11:40:00.000Z',
      generatedAt: '2026-06-13T12:00:01.000Z',
      status: '2H',
      minute: 65,
      score: '0-1',
    });
    const audit = auditRecord(result);

    expect(result.canUseFusionOddsForMoneyDecision).toBe(false);
    expect(result.hardBlockReasons).toEqual(expect.arrayContaining([
      'reference_odds_context_only',
      'no_tradable_live_odds',
    ]));
    expect(audit.sourceKind).toBe('reference');
    expect(audit.freshness.freshness).toBe('reference');
    expect(audit.moneyGuard.canSaveRecommendation).toBe(false);
  });

  it('downgrades stale live odds in shadow guard', () => {
    const result = buildProviderFusionOddsShadow({
      read: fusionRead({ oddsFetchedAt: '2026-06-13T12:00:00.000Z' }),
      matchId: '164327',
      oddsSource: 'live',
      oddsFetchedAt: '2026-06-13T12:00:00.000Z',
      generatedAt: '2026-06-13T12:03:00.000Z',
      maxLiveOddsAgeMs: 60_000,
      status: '2H',
      minute: 65,
      score: '0-1',
    });
    const audit = auditRecord(result);

    expect(result.canUseFusionOddsForMoneyDecision).toBe(false);
    expect(result.hardBlockReasons).toContain('live_odds_stale');
    expect(audit.freshness).toEqual({ freshness: 'stale', ageMs: 180_000, stale: true });
  });

  it('blocks odds use on score or minute conflicts', () => {
    const read = fusionRead();
    read.snapshot.consensus.scoreAgreement = 'conflict';
    read.snapshot.consensus.minuteAgreement = 'conflict';
    read.snapshot.moneyGuard.hardBlockReasons.push('score_conflict', 'minute_conflict');

    const result = buildProviderFusionOddsShadow({
      read,
      matchId: '164327',
      oddsSource: 'live',
      oddsFetchedAt: '2026-06-13T12:00:00.000Z',
      generatedAt: '2026-06-13T12:00:01.000Z',
      status: '2H',
      minute: 65,
      score: '0-1',
    });

    expect(result.canUseFusionOddsForMoneyDecision).toBe(false);
    expect(result.hardBlockReasons).toEqual(expect.arrayContaining([
      'score_conflict_blocks_odds',
      'minute_conflict_blocks_odds',
    ]));
  });

  it('records odds source conflicts as no-save shadow output', () => {
    const read = fusionRead({
      oddsSource: 'live',
      oddsCanonicalOverride: {},
      oddsResponseOverride: liveOddsResponse(),
    });
    read.snapshot.consensus.oddsAgreement = 'conflict';

    const result = buildProviderFusionOddsShadow({
      read,
      matchId: '164327',
      oddsSource: 'live',
      oddsFetchedAt: '2026-06-13T12:00:00.000Z',
      generatedAt: '2026-06-13T12:00:01.000Z',
      status: '2H',
      minute: 65,
      score: '0-1',
    });
    const audit = auditRecord(result);

    expect(result.canUseFusionOddsForMoneyDecision).toBe(false);
    expect(result.canSaveRecommendation).toBe(false);
    expect(result.hardBlockReasons).toEqual(expect.arrayContaining([
      'odds_source_conflict',
      'legacy_fusion_odds_availability_mismatch',
    ]));
    expect(audit.marketDiff.changed).toBe(true);
    expect(audit.marketDiff.familiesExtraInFusion).toEqual(expect.arrayContaining(['goals_ou']));
  });

  it('treats fallback-live as live source but blocks when freshness cannot be proven', () => {
    const read = fusionRead();
    read.snapshot.fieldSources.odds.fetchedAt = null;
    if (read.snapshot.canonical.odds) {
      read.snapshot.canonical.odds.generatedAt = '';
    }

    const result = buildProviderFusionOddsShadow({
      read,
      matchId: '164327',
      oddsSource: 'fallback-live',
      oddsFetchedAt: null,
      generatedAt: '2026-06-13T12:00:01.000Z',
      status: '2H',
      minute: 65,
      score: '0-1',
    });
    const audit = auditRecord(result);

    expect(audit.sourceKind).toBe('live');
    expect(audit.freshness).toEqual({ freshness: 'unknown', ageMs: null, stale: true });
    expect(result.hardBlockReasons).toContain('live_odds_freshness_unknown');
  });

  it('classifies fallback-live from resolver when provider snapshot has no selected odds', () => {
    const result = buildProviderFusionOddsShadow({
      read: fusionRead({
        oddsSource: 'none',
        oddsCanonicalOverride: {},
        oddsResponseOverride: [],
      }),
      matchId: '164327',
      oddsSource: 'fallback-live',
      oddsFetchedAt: null,
      generatedAt: '2026-06-13T12:00:01.000Z',
      status: '2H',
      minute: 65,
      score: '0-1',
    });
    const audit = auditRecord(result);

    expect(audit.sourceKind).toBe('live');
    expect(audit.freshness.freshness).toBe('missing');
    expect(result.hardBlockReasons).toContain('no_tradable_live_odds');
  });

  it('keeps canonical unknown source kind explicit when selections exist', () => {
    const read = fusionRead();
    if (read.snapshot.canonical.odds) {
      read.snapshot.canonical.odds.sourceKind = 'unknown';
    }

    const result = buildProviderFusionOddsShadow({
      read,
      matchId: '164327',
      oddsSource: 'live',
      oddsFetchedAt: '2026-06-13T12:00:00.000Z',
      generatedAt: '2026-06-13T12:00:01.000Z',
      status: '2H',
      minute: 65,
      score: '0-1',
    });
    const audit = auditRecord(result);

    expect(audit.sourceKind).toBe('unknown');
    expect(result.canUseFusionOddsForMoneyDecision).toBe(false);
  });

  it('falls back to resolver source when canonical unknown has no selections', () => {
    const read = fusionRead({
      oddsSource: 'none',
      oddsCanonicalOverride: {},
      oddsResponseOverride: [],
    });
    if (read.snapshot.canonical.odds) {
      read.snapshot.canonical.odds.sourceKind = 'unknown';
    }

    const result = buildProviderFusionOddsShadow({
      read,
      matchId: '164327',
      oddsSource: 'none',
      oddsFetchedAt: null,
      generatedAt: '2026-06-13T12:00:01.000Z',
      status: '2H',
      minute: 65,
      score: '0-1',
    });
    const audit = auditRecord(result);

    expect(audit.sourceKind).toBe('none');
    expect(result.hardBlockReasons).toContain('no_tradable_live_odds');
  });

  it('keeps explicit prematch source kind context-only', () => {
    const read = fusionRead();
    if (read.snapshot.canonical.odds) {
      read.snapshot.canonical.odds.sourceKind = 'prematch';
      for (const selection of read.snapshot.canonical.odds.selections) {
        selection.kind = 'prematch';
      }
    }

    const result = buildProviderFusionOddsShadow({
      read,
      matchId: '164327',
      oddsSource: 'live',
      oddsFetchedAt: '2026-06-13T12:00:00.000Z',
      generatedAt: '2026-06-13T12:00:01.000Z',
      status: '2H',
      minute: 65,
      score: '0-1',
    });
    const audit = auditRecord(result);

    expect(audit.sourceKind).toBe('prematch');
    expect(audit.freshness.freshness).toBe('reference');
    expect(result.hardBlockReasons).toEqual(expect.arrayContaining([
      'reference_odds_context_only',
      'no_tradable_live_odds',
    ]));
  });

  it('normalizes empty market and selection signatures safely', () => {
    const read = fusionRead();
    const first = read.snapshot.canonical.odds?.selections[0];
    if (first) {
      first.market = '';
      first.selection = '';
      first.line = null;
    }

    const result = buildProviderFusionOddsShadow({
      read,
      matchId: '164327',
      oddsSource: 'live',
      oddsFetchedAt: '2026-06-13T12:00:00.000Z',
      status: '2H',
      minute: 65,
      score: '0-1',
    });
    const audit = auditRecord(result);

    expect(audit.providerOdds.liveFamilies).toContain('unknown');
    expect(audit.providerOdds.marketSignatures).toContain('unknown:none:unknown');
  });

  it('flags resolver none when canonical provider odds still contain selections', () => {
    const result = buildProviderFusionOddsShadow({
      read: fusionRead(),
      matchId: '164327',
      oddsSource: 'none',
      oddsFetchedAt: null,
      generatedAt: '2026-06-13T12:00:01.000Z',
      status: '2H',
      minute: 65,
      score: '0-1',
    });

    expect(result.canUseFusionOddsForMoneyDecision).toBe(false);
    expect(result.hardBlockReasons).toContain('odds_source_conflict');
    expect(result.canSaveRecommendation).toBe(false);
  });

  it('handles entitlement or no-access warnings as non-fatal shadow diagnostics', () => {
    const read = fusionRead({
      oddsSource: 'none',
      oddsCanonicalOverride: {},
      oddsResponseOverride: [],
    });
    read.snapshot.fieldSources.odds.notes.push('Sportmonks All-in subscription required for odds');

    const result = buildProviderFusionOddsShadow({
      read,
      matchId: '164327',
      oddsSource: 'none',
      oddsFetchedAt: null,
      generatedAt: '2026-06-13T12:00:01.000Z',
      status: '2H',
      minute: 65,
      score: '0-1',
    });

    expect(result.status).toBe('shadowed');
    expect(result.canUseFusionOddsForMoneyDecision).toBe(false);
    expect(result.softWarnings).toContain('odds_entitlement_or_no_access');
    expect(result.hardBlockReasons).toContain('no_tradable_live_odds');
  });

  it('reports missing fusion read as blocked without throwing', () => {
    const result = buildProviderFusionOddsShadow({
      read: null,
      matchId: '164327',
      oddsSource: 'none',
      oddsFetchedAt: null,
      generatedAt: '2026-06-13T12:00:01.000Z',
      status: '2H',
      minute: 65,
      score: '0-1',
    });

    expect(result).toEqual(expect.objectContaining({
      status: 'blocked',
      canUseFusionOddsForMoneyDecision: false,
      canSaveRecommendation: false,
      hardBlockReasons: ['provider_fusion_read_missing'],
    }));
  });

  it('normalizes unknown market families deterministically', () => {
    expect(canonicalOddsMarketFamily('Total Goals', 'Over 3.5')).toBe('goals_ou');
    expect(canonicalOddsMarketFamily('Full Time Result', 'Home')).toBe('1x2');
    expect(canonicalOddsMarketFamily('1X2', 'Draw')).toBe('1x2');
    expect(canonicalOddsMarketFamily('', '')).toBe('unknown');
    expect(canonicalOddsMarketFamily('Team Specials', 'Clean Sheet')).toBe('team_specials');
  });
});
