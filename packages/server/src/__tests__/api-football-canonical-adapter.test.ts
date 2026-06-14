import { describe, expect, it } from 'vitest';
import type { ApiFixture, ApiFixtureEvent, ApiFixtureStat } from '../lib/football-api.js';
import {
  apiFootballEventsToCanonicalEvents,
  apiFootballFixtureToCanonicalIdentity,
  apiFootballFixtureToCanonicalScoreClock,
  apiFootballStatisticsToCanonicalTeamStatistics,
  buildApiFootballEventsEnvelope,
  buildApiFootballFetchErrorEnvelope,
  buildApiFootballFixtureIdentityEnvelope,
  buildApiFootballOddsEnvelope,
  buildApiFootballScoreClockEnvelope,
  buildApiFootballStatisticsEnvelope,
} from '../lib/canonical/api-football-adapter.js';
import {
  apiFootballOddsToSelections,
  buildApiFootballOddsSnapshot,
  redactApiFootballLedgerParams,
} from '../lib/canonical/api-football-odds-adapter.js';
import {
  validateCanonicalFixtureIdentity,
  validateCanonicalOddsSnapshot,
  validateCanonicalScoreClock,
  validateCanonicalTeamStatistics,
  validateProviderEnvelope,
} from '../lib/canonical/provider-domain.js';

function fixture(overrides: Partial<ApiFixture> = {}): ApiFixture {
  return {
    fixture: {
      id: 164327,
      referee: null,
      timezone: 'UTC',
      date: '2026-06-12T19:00:00+00:00',
      timestamp: 1781290800,
      periods: { first: 1781290800, second: 1781294400 },
      venue: { id: null, name: 'Azteca', city: 'Mexico City' },
      status: { long: 'Second Half', short: '2H', elapsed: 65 },
    },
    league: {
      id: 1,
      name: 'World Cup',
      country: 'World',
      logo: 'league.png',
      flag: null,
      season: 2026,
      round: 'Group Stage - 1',
    },
    teams: {
      home: { id: 10, name: 'Mexico', logo: 'mexico.png', winner: null },
      away: { id: 20, name: 'South Africa', logo: 'sa.png', winner: null },
    },
    goals: { home: 0, away: 1 },
    score: {},
    ...overrides,
  } as ApiFixture;
}

const events: ApiFixtureEvent[] = [
  {
    time: { elapsed: 54, extra: null },
    team: { id: 20, name: 'South Africa', logo: 'sa.png' },
    player: { id: 200, name: 'Forward' },
    assist: { id: 201, name: 'Winger' },
    type: 'Goal',
    detail: 'Normal Goal',
    comments: null,
  },
  {
    time: { elapsed: 68, extra: 2 },
    team: { id: 10, name: 'Mexico', logo: 'mexico.png' },
    player: { id: 100, name: 'Midfielder' },
    assist: { id: null, name: null },
    type: 'Card',
    detail: 'Yellow Card',
    comments: null,
  },
  {
    time: { elapsed: 72, extra: null },
    team: { id: 999, name: 'Unknown Team', logo: '' },
    player: { id: null, name: null },
    assist: { id: null, name: null },
    type: 'Var',
    detail: 'Goal cancelled',
    comments: null,
  },
];

const stats: ApiFixtureStat[] = [
  {
    team: { id: 10, name: 'Mexico', logo: 'mexico.png' },
    statistics: [
      { type: 'Ball Possession', value: '62%' },
      { type: 'Total Shots', value: 12 },
      { type: 'Shots on Goal', value: 4 },
      { type: 'Corner Kicks', value: 7 },
      { type: 'expected_goals', value: '0.85' },
      { type: 'Big Chances', value: 3 },
    ],
  },
  {
    team: { id: 20, name: 'South Africa', logo: 'sa.png' },
    statistics: [
      { type: 'Ball Possession', value: '38%' },
      { type: 'Total Shots', value: 6 },
      { type: 'Shots on Target', value: 2 },
      { type: 'Corner Kicks', value: 2 },
      { type: 'expected_goals', value: '0.44' },
      { type: 'Big Chances', value: 1 },
    ],
  },
];

const liveOddsResponse = [{
  bookmakers: [{
    name: 'API Football Live',
    bets: [
      {
        name: 'Over/Under',
        values: [
          { value: 'Over', odd: '1.92', handicap: '1.5' },
          { value: 'Under', odd: '1.95', handicap: '1.5', suspended: 'true' },
          { value: 'Bad', odd: '1.00', handicap: '9.5' },
        ],
      },
      {
        name: 'Asian Handicap',
        values: [
          { value: 'Home -0.25', odd: '1.88' },
          { value: 'Away +0.25', odd: '1.98' },
        ],
      },
    ],
  }],
}];

describe('api-football canonical adapter', () => {
  it('maps API-Football fixture identity into TFI canonical identity envelope', () => {
    const canonical = apiFootballFixtureToCanonicalIdentity(fixture());
    expect(canonical).toEqual({
      matchId: '164327',
      providerFixtureIds: { 'api-football': '164327' },
      kickoffAtUtc: '2026-06-12T19:00:00+00:00',
      league: { id: '1', name: 'World Cup', country: 'World', season: 2026, logo: 'league.png' },
      home: { id: '10', name: 'Mexico', logo: 'mexico.png' },
      away: { id: '20', name: 'South Africa', logo: 'sa.png' },
      mappingConfidence: 'verified',
    });
    expect(validateCanonicalFixtureIdentity(canonical)).toMatchObject({ ok: true });

    const envelope = buildApiFootballFixtureIdentityEnvelope(fixture(), {
      fetchedAt: '2026-06-12T20:05:00.000Z',
      statusCode: 200,
      latencyMs: 55,
    });
    expect(envelope).toMatchObject({
      provider: 'api-football',
      role: 'fixture_identity',
      providerFixtureId: '164327',
      matchId: '164327',
      success: true,
      coverage: { level: 'complete', hasData: true, itemCount: 1 },
      freshness: 'fresh',
    });
    expect(validateProviderEnvelope(envelope)).toMatchObject({ ok: true });
  });

  it('maps score, period, and provider clock lag without changing runtime score source', () => {
    const currentFixture = fixture();
    const clock = apiFootballFixtureToCanonicalScoreClock(currentFixture, {
      now: new Date((1781294400 + 68 * 60) * 1000),
    });

    expect(clock).toEqual({
      status: '2H',
      minute: 65,
      injuryTime: null,
      period: '2h',
      score: { home: 0, away: 1 },
      wallClockMinuteEstimate: 68,
      providerClockLagMinutes: 3,
    });
    expect(validateCanonicalScoreClock(clock)).toMatchObject({ ok: true });

    expect(apiFootballFixtureToCanonicalScoreClock(fixture({
      fixture: {
        ...currentFixture.fixture,
        status: { long: 'Not Started', short: 'NS', elapsed: null },
      },
      goals: { home: null, away: null },
    }))).toMatchObject({
      period: 'pre',
      minute: null,
      score: { home: null, away: null },
      wallClockMinuteEstimate: null,
      providerClockLagMinutes: null,
    });

    expect(buildApiFootballScoreClockEnvelope(currentFixture, {
      fetchedAt: '2026-06-12T20:08:00.000Z',
      now: new Date((1781294400 + 68 * 60) * 1000),
    })).toMatchObject({
      role: 'fixture_score',
      coverage: { level: 'complete' },
      normalized: { providerClockLagMinutes: 3 },
    });

    const statusCases = [
      ['1H', '1h'],
      ['HT', 'ht'],
      ['INT', 'ht'],
      ['ET', 'et'],
      ['AET', 'et'],
      ['P', 'pen'],
      ['FT', 'ft'],
      ['PEN', 'ft'],
      ['SUSP', 'unknown'],
    ] as const;
    for (const [short, period] of statusCases) {
      expect(apiFootballFixtureToCanonicalScoreClock(fixture({
        fixture: {
          ...currentFixture.fixture,
          periods: { first: 1781290800, second: null },
          status: { long: short, short, elapsed: 1 },
        },
      }), { now: new Date((1781290800 - 60) * 1000) })).toMatchObject({
        period,
        wallClockMinuteEstimate: null,
        providerClockLagMinutes: null,
      });
    }

    expect(apiFootballFixtureToCanonicalScoreClock(fixture({
      fixture: {
        ...currentFixture.fixture,
        status: { long: 'First Half', short: '1H', elapsed: 45 },
      },
    }), { now: new Date((1781290800 + 180 * 60) * 1000) })).toMatchObject({
      period: '1h',
      wallClockMinuteEstimate: 130,
      providerClockLagMinutes: 85,
    });
  });

  it('maps API-Football events into canonical event taxonomy and team sides', () => {
    const mapped = apiFootballEventsToCanonicalEvents(fixture(), events);

    expect(mapped).toEqual([
      expect.objectContaining({
        minute: 54,
        teamSide: 'away',
        team: { id: '20', name: 'South Africa', logo: 'sa.png' },
        playerName: 'Forward',
        assistName: 'Winger',
        type: 'goal',
        detail: 'Normal Goal',
      }),
      expect.objectContaining({
        minute: 68,
        extra: 2,
        teamSide: 'home',
        type: 'card',
        detail: 'Yellow Card',
      }),
      expect.objectContaining({
        teamSide: 'unknown',
        type: 'var',
        detail: 'Goal cancelled',
      }),
    ]);

    const envelope = buildApiFootballEventsEnvelope(fixture(), events, {
      fetchedAt: '2026-06-12T20:09:00.000Z',
    });
    expect(envelope).toMatchObject({
      role: 'event_timeline',
      coverage: { level: 'complete', itemCount: 3 },
      normalized: mapped,
    });
    expect(validateProviderEnvelope(envelope)).toMatchObject({ ok: true });

    const moreEvents = apiFootballEventsToCanonicalEvents(fixture(), [
      {
        time: { elapsed: 75, extra: null },
        team: { id: 10, name: 'Mexico', logo: 'mexico.png' },
        player: { id: null, name: 'Sub out' },
        assist: { id: null, name: 'Sub in' },
        type: 'subst',
        detail: 'Substitution 1',
        comments: null,
      },
      {
        time: { elapsed: 80, extra: null },
        team: { id: 20, name: 'South Africa', logo: 'sa.png' },
        player: { id: null, name: 'Penalty taker' },
        assist: { id: null, name: null },
        type: 'Penalty',
        detail: 'Penalty missed',
        comments: null,
      },
      {
        time: { elapsed: 90, extra: 5 },
        team: { id: 20, name: 'South Africa', logo: 'sa.png' },
        player: { id: null, name: null },
        assist: { id: null, name: null },
        type: 'Period',
        detail: 'Match finished',
        comments: null,
      },
      {
        time: { elapsed: 1, extra: null },
        team: { id: 20, name: 'South Africa', logo: 'sa.png' },
        player: { id: null, name: null },
        assist: { id: null, name: null },
        type: 'Info',
        detail: 'Kick off',
        comments: null,
      },
    ]);
    expect(moreEvents.map((event) => event.type)).toEqual(['substitution', 'penalty', 'period', 'other']);
  });

  it('maps API-Football statistics into canonical side values and preserves unknown stats', () => {
    const mapped = apiFootballStatisticsToCanonicalTeamStatistics(fixture(), stats);

    expect(mapped).toEqual({
      possessionPct: { home: 62, away: 38 },
      shotsTotal: { home: 12, away: 6 },
      shotsOnTarget: { home: 4, away: 2 },
      corners: { home: 7, away: 2 },
      expectedGoals: { home: 0.85, away: 0.44 },
      rawTypeMap: {
        'Big Chances': { home: 3, away: 1 },
      },
    });
    expect(validateCanonicalTeamStatistics(mapped)).toMatchObject({ ok: true });

    const envelope = buildApiFootballStatisticsEnvelope(fixture(), stats, {
      fetchedAt: '2026-06-12T20:10:00.000Z',
    });
    expect(envelope).toMatchObject({
      role: 'fixture_statistics',
      coverage: { level: 'complete', itemCount: 10 },
      normalized: mapped,
    });
    expect(validateProviderEnvelope(envelope)).toMatchObject({ ok: true });

    const expanded = apiFootballStatisticsToCanonicalTeamStatistics(fixture(), [
      ...stats,
      {
        team: { id: 10, name: 'Mexico', logo: 'mexico.png' },
        statistics: [
          { type: 'Fouls', value: 11 },
          { type: 'Yellow Cards', value: 2 },
          { type: 'Red Cards', value: 0 },
          { type: 'Total passes', value: 510 },
          { type: 'Attacks', value: 88 },
          { type: 'Dangerous Attacks', value: 41 },
          { type: 'Shots', value: '' },
        ],
      },
      {
        team: { id: 999, name: 'Unknown', logo: '' },
        statistics: [{ type: 'Fouls', value: 1 }],
      },
    ]);
    expect(expanded).toMatchObject({
      fouls: { home: 11, away: null },
      yellowCards: { home: 2, away: null },
      redCards: { home: 0, away: null },
      passes: { home: 510, away: null },
      attacks: { home: 88, away: null },
      dangerousAttacks: { home: 41, away: null },
      shotsTotal: { home: null, away: 6 },
      rawTypeMap: expect.objectContaining({
        'unknown_team:999': expect.objectContaining({ team: { id: 999, name: 'Unknown', logo: '' } }),
      }),
    });
  });

  it('keeps provider empty response distinct from provider fetch errors', () => {
    const emptyStats = buildApiFootballStatisticsEnvelope(fixture(), [], {
      fetchedAt: '2026-06-12T20:10:00.000Z',
      statusCode: 200,
      raw: [],
    });
    expect(emptyStats).toMatchObject({
      success: true,
      normalized: { rawTypeMap: {} },
      coverage: { level: 'empty', hasData: false, itemCount: 0 },
      freshness: 'fresh',
      error: '',
    });

    const fetchError = buildApiFootballFetchErrorEnvelope({
      role: 'fixture_statistics',
      matchId: '164327',
      providerFixtureId: '164327',
      error: new Error('Football API 503'),
      fetchedAt: '2026-06-12T20:10:01.000Z',
      statusCode: 503,
      warnings: ['provider_unavailable'],
    });
    expect(fetchError).toMatchObject({
      success: false,
      normalized: null,
      coverage: { level: 'missing', hasData: false, itemCount: 0 },
      freshness: 'missing',
      statusCode: 503,
      error: 'Football API 503',
      warnings: ['provider_unavailable'],
    });
    expect(validateProviderEnvelope(fetchError)).toMatchObject({ ok: true });

    const noProviderFixtureId = buildApiFootballFetchErrorEnvelope({
      role: 'event_timeline',
      error: 'timeout',
    });
    expect(noProviderFixtureId).toMatchObject({
      providerFixtureId: null,
      matchId: null,
      error: 'timeout',
    });
  });

  it('converts API-Football live odds into canonical selections with provenance and skips invalid prices', () => {
    const selections = apiFootballOddsToSelections({
      response: liveOddsResponse,
      sourceKind: 'live',
      fetchedAt: '2026-06-12T20:11:00.000Z',
    });

    expect(selections).toEqual([
      expect.objectContaining({
        market: 'Over/Under',
        selection: 'Over',
        line: 1.5,
        price: 1.92,
        bookmaker: 'API Football Live',
        provider: 'api-football',
        kind: 'live',
        suspended: false,
      }),
      expect.objectContaining({
        selection: 'Under',
        line: 1.5,
        price: 1.95,
        suspended: true,
      }),
      expect.objectContaining({
        market: 'Asian Handicap',
        selection: 'Home -0.25',
        line: -0.25,
        price: 1.88,
      }),
      expect.objectContaining({
        selection: 'Away +0.25',
        line: 0.25,
        price: 1.98,
      }),
    ]);

    const envelope = buildApiFootballOddsEnvelope({
      matchId: '164327',
      response: liveOddsResponse,
      sourceKind: 'live',
      fetchedAt: '2026-06-12T20:11:00.000Z',
    });
    expect(envelope).toMatchObject({
      role: 'live_odds',
      coverage: { level: 'complete', itemCount: 4 },
      normalized: {
        matchId: '164327',
        sourceProvider: 'api-football',
        sourceKind: 'live',
        warnings: [],
      },
    });
    expect(validateCanonicalOddsSnapshot(envelope.normalized)).toMatchObject({ ok: true });
    expect(validateProviderEnvelope(envelope)).toMatchObject({ ok: true });

    expect(apiFootballOddsToSelections({
      response: [
        null,
        { bookmakers: { data: [{ name: 'Data Book', bets: { data: [
          { name: '', values: [{ value: 'Home', odd: '2.00' }] },
          { name: '1x2', values: { data: [
            { value: '', odd: '2.00' },
            { value: 'Home', odd: '' },
            { value: 'Draw', odd: '3.20', suspended: true },
          ] } },
          'bad bet row',
        ] } }] } },
        { bookmakers: [] },
        { odds: [] },
        { odds: [{
          name: 'Both Teams To Score',
          values: [
            { value: 'Yes', odd: '1.80' },
            { value: 'No price', odd: null },
          ],
        }] },
      ],
      sourceKind: 'reference',
      fetchedAt: '2026-06-12T20:11:30.000Z',
    })).toEqual([
      expect.objectContaining({
        market: '1x2',
        selection: 'Draw',
        price: 3.2,
        bookmaker: 'Data Book',
        kind: 'reference',
        suspended: true,
      }),
      expect.objectContaining({
        market: 'Both Teams To Score',
        selection: 'Yes',
        line: null,
        price: 1.8,
        bookmaker: 'Live Odds',
        kind: 'reference',
      }),
    ]);
  });

  it('marks API-Football prematch odds as reference-only canonical odds', () => {
    const prematch = buildApiFootballOddsSnapshot({
      matchId: '164327',
      response: [{
        odds: [{
          name: 'Match Winner',
          values: [
            { value: 'Home', odd: '2.00' },
            { value: 'Draw', odd: '3.20' },
            { value: 'Away', odd: '3.75' },
          ],
        }],
      }],
      sourceKind: 'prematch',
      fetchedAt: '2026-06-12T18:00:00.000Z',
    });

    expect(prematch).toMatchObject({
      matchId: '164327',
      sourceProvider: 'api-football',
      sourceKind: 'reference',
      warnings: ['prematch_reference_only'],
    });
    expect(prematch.selections).toHaveLength(3);
    expect(prematch.selections.every((selection) => selection.kind === 'reference')).toBe(true);
    expect(validateCanonicalOddsSnapshot(prematch)).toMatchObject({ ok: true });

    expect(buildApiFootballOddsSnapshot({
      matchId: '164327',
      response: [{ bookmakers: [], odds: [] }],
      sourceKind: 'reference',
      fetchedAt: '2026-06-12T18:00:00.000Z',
      warnings: [null, 'empty odds'],
    })).toMatchObject({
      sourceProvider: null,
      sourceKind: 'reference',
      selections: [],
      warnings: ['empty odds'],
    });
  });

  it('redacts API-Football secret request params before request ledger storage', () => {
    expect(redactApiFootballLedgerParams({
      fixture: 164327,
      league: 1,
      'x-apisports-key': 'secret',
      api_key: 'secret-2',
      apiToken: 'secret-3',
      authorization: 'Bearer secret-4',
      key: 'secret-5',
    })).toEqual({
      fixture: '164327',
      league: '1',
      'x-apisports-key': '[redacted]',
      api_key: '[redacted]',
      apiToken: '[redacted]',
      authorization: '[redacted]',
      key: '[redacted]',
    });
  });
});
