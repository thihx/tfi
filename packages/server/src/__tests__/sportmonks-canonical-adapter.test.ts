import { describe, expect, it } from 'vitest';
import {
  buildSportmonksAccessErrorEnvelope,
  buildSportmonksEventsEnvelope,
  buildSportmonksFixtureIdentityEnvelope,
  buildSportmonksOddsEnvelope,
  buildSportmonksScoreClockEnvelope,
  buildSportmonksStatisticsEnvelope,
  classifySportmonksAccessError,
  redactSportmonksParams,
  sportmonksFixtureToCanonicalEvents,
  sportmonksFixtureToCanonicalIdentity,
  sportmonksFixtureToCanonicalOddsSnapshot,
  sportmonksFixtureToCanonicalScoreClock,
  sportmonksFixtureToCanonicalStatistics,
} from '../lib/canonical/sportmonks-adapter.js';
import {
  validateCanonicalFixtureIdentity,
  validateCanonicalOddsSnapshot,
  validateCanonicalScoreClock,
  validateCanonicalTeamStatistics,
  validateProviderEnvelope,
} from '../lib/canonical/provider-domain.js';
import { normalizeSportmonksFixture, type SportmonksFixtureLike } from '../lib/sportmonks-normalize.js';

function sportmonksFixture(overrides: Partial<SportmonksFixtureLike> = {}): SportmonksFixtureLike {
  return {
    id: 98765,
    name: 'Mexico vs South Africa',
    league_id: 111,
    season_id: 2026,
    state_id: '2H',
    starting_at: '2026-06-12T19:00:00.000Z',
    starting_at_timestamp: 1781290800,
    result_info: '',
    length: 65,
    has_odds: true,
    has_premium_odds: false,
    league: {
      id: 111,
      name: 'World Cup',
      country_name: 'World',
      image_path: 'world-cup.png',
    },
    state: {
      name: '2nd Half',
      short_name: '2H',
    },
    participants: [
      { id: 10, name: 'Mexico', image_path: 'mexico.png', meta: { location: 'home' } },
      { id: 20, name: 'South Africa', image_path: 'sa.png', meta: { location: 'away' } },
    ],
    scores: [
      { description: 'CURRENT', score: { participant: 'home', goals: 0 } },
      { description: 'CURRENT', score: { participant: 'away', goals: 1 } },
    ],
    events: [
      {
        id: 1,
        participant_id: 20,
        type_id: 14,
        minute: 54,
        player_name: 'Forward',
        related_player_name: 'Winger',
        addition: 'Normal Goal',
      },
      {
        id: 2,
        participant_id: 10,
        type: { name: 'Card' },
        minute: 68,
        extra_minute: 2,
        player_name: 'Midfielder',
        addition: 'Yellow Card',
      },
      {
        id: 3,
        participant_id: 10,
        type_id: 18,
        minute: 72,
        player_name: 'Off',
        related_player_name: 'On',
      },
      {
        id: 4,
        participant_id: 20,
        type: { name: 'VAR' },
        minute: 73,
        info: 'Goal cancelled',
      },
      {
        id: 5,
        participant_id: 999,
        type: { name: 'Info' },
        minute: 80,
        info: 'Weather delay',
      },
    ],
    statistics: [
      { participant_id: 10, type: { name: 'Ball Possession' }, data: { value: '62%' } },
      { participant_id: 20, type: { name: 'Ball Possession' }, data: { value: '38%' } },
      { participant_id: 10, type: { name: 'Shots on target' }, data: { value: 5 } },
      { participant_id: 20, type: { code: 'xG' }, value: '0.44' },
      { participant_id: 10, type: { name: 'Corners' }, data: { value: 7 } },
      { participant_id: 20, type: { name: 'Dangerous Attacks' }, data: { value: 21 } },
      { participant_id: 10, type: { name: 'Big Chances' }, data: { value: 3 } },
      { participant_id: 999, type: { name: 'Fouls' }, data: { value: 1 } },
    ],
    inplayOdds: [
      {
        market_name: 'Over/Under',
        label: 'Over 1.5',
        odd: '1.92',
        line: '1.5',
        bookmaker_name: 'Sportmonks Live',
      },
      {
        market: { name: 'Match Winner' },
        selection: 'Away',
        price: 1.80,
        suspended: true,
        bookmaker: { name: 'Sportmonks Live' },
      },
      {
        market_name: '',
        label: 'Bad',
        odd: '2.10',
      },
    ],
    ...overrides,
  };
}

describe('sportmonks canonical adapter', () => {
  it('maps Sportmonks fixture participants into canonical identity envelope', () => {
    const raw = sportmonksFixture();
    const identity = sportmonksFixtureToCanonicalIdentity(raw, { matchId: '164327' });

    expect(identity).toEqual({
      matchId: '164327',
      providerFixtureIds: { sportmonks: '98765' },
      kickoffAtUtc: '2026-06-12T19:00:00.000Z',
      league: {
        id: '111',
        name: 'World Cup',
        country: 'World',
        season: 2026,
        logo: 'world-cup.png',
      },
      home: { id: '10', name: 'Mexico', logo: 'mexico.png' },
      away: { id: '20', name: 'South Africa', logo: 'sa.png' },
      mappingConfidence: 'high',
    });
    expect(validateCanonicalFixtureIdentity(identity)).toMatchObject({ ok: true });

    const envelope = buildSportmonksFixtureIdentityEnvelope(raw, {
      matchId: '164327',
      fetchedAt: '2026-06-12T20:05:00.000Z',
      statusCode: 200,
      latencyMs: 80,
      rateLimit: { remaining: 2499, resetsInSeconds: 3500, requestedEntity: 'Fixture' },
    });
    expect(envelope).toMatchObject({
      provider: 'sportmonks',
      role: 'fixture_identity',
      providerFixtureId: '98765',
      matchId: '164327',
      quota: 'ok',
      coverage: { level: 'complete', itemCount: 1 },
    });
    expect(validateProviderEnvelope(envelope)).toMatchObject({ ok: true });
  });

  it('extracts canonical score and period from Sportmonks score/state fields', () => {
    const clock = sportmonksFixtureToCanonicalScoreClock(sportmonksFixture());

    expect(clock).toEqual({
      status: '2H',
      minute: 65,
      injuryTime: null,
      period: '2h',
      score: { home: 0, away: 1 },
      wallClockMinuteEstimate: null,
      providerClockLagMinutes: null,
    });
    expect(validateCanonicalScoreClock(clock)).toMatchObject({ ok: true });

    expect(sportmonksFixtureToCanonicalScoreClock(sportmonksFixture({
      state_id: null,
      state: { name: 'Half Time' },
      length: null,
      scores: [],
    }))).toMatchObject({
      period: 'ht',
      minute: null,
      score: { home: null, away: null },
    });

    expect(buildSportmonksScoreClockEnvelope(sportmonksFixture(), {
      matchId: '164327',
      fetchedAt: '2026-06-12T20:06:00.000Z',
      rateLimit: { remaining: 5, resetsInSeconds: 300, requestedEntity: 'Fixture' },
    })).toMatchObject({
      role: 'fixture_score',
      quota: 'critical',
      coverage: { level: 'complete', itemCount: 1 },
    });
  });

  it('converts Sportmonks events into canonical taxonomy and team sides', () => {
    const mapped = sportmonksFixtureToCanonicalEvents(sportmonksFixture());

    expect(mapped).toEqual([
      expect.objectContaining({
        minute: 54,
        teamSide: 'away',
        team: { id: '20', name: 'South Africa', logo: 'sa.png' },
        playerName: 'Forward',
        assistName: 'Winger',
        type: 'goal',
        detail: 'Normal Goal',
        sourceEventId: '1',
      }),
      expect.objectContaining({
        minute: 68,
        extra: 2,
        teamSide: 'home',
        type: 'card',
        detail: 'Yellow Card',
      }),
      expect.objectContaining({
        teamSide: 'home',
        type: 'substitution',
        detail: 'Substitution',
      }),
      expect.objectContaining({
        teamSide: 'away',
        type: 'var',
        detail: 'Goal cancelled',
      }),
      expect.objectContaining({
        teamSide: 'unknown',
        team: { id: '999', name: '', logo: null },
        type: 'other',
        detail: 'Weather delay',
      }),
    ]);

    const envelope = buildSportmonksEventsEnvelope(sportmonksFixture(), {
      matchId: '164327',
      fetchedAt: '2026-06-12T20:07:00.000Z',
    });
    expect(envelope).toMatchObject({
      role: 'event_timeline',
      coverage: { level: 'complete', itemCount: 5 },
    });
    expect(validateProviderEnvelope(envelope)).toMatchObject({ ok: true });
  });

  it('converts Sportmonks statistics into canonical side values and preserves unknown stats', () => {
    const stats = sportmonksFixtureToCanonicalStatistics(sportmonksFixture());

    expect(stats).toEqual({
      possessionPct: { home: 62, away: 38 },
      shotsOnTarget: { home: 5, away: null },
      expectedGoals: { home: null, away: 0.44 },
      corners: { home: 7, away: null },
      dangerousAttacks: { home: null, away: 21 },
      rawTypeMap: {
        'Big Chances': { home: 3 },
        'unknown_participant:999': expect.objectContaining({ participant_id: 999 }),
      },
    });
    expect(validateCanonicalTeamStatistics(stats)).toMatchObject({ ok: true });

    const envelope = buildSportmonksStatisticsEnvelope(sportmonksFixture(), {
      matchId: '164327',
      fetchedAt: '2026-06-12T20:08:00.000Z',
      rateLimit: { remaining: 100, resetsInSeconds: 300, requestedEntity: 'Fixture' },
    });
    expect(envelope).toMatchObject({
      role: 'fixture_statistics',
      quota: 'elevated',
      coverage: { level: 'complete', itemCount: 6 },
    });
    expect(validateProviderEnvelope(envelope)).toMatchObject({ ok: true });
  });

  it('canonicalizes thin Sportmonks live statistics that only contain type ids', () => {
    const fixture = sportmonksFixture({
      statistics: [
        { participant_id: 10, type_id: 34, data: { value: 3 } },
        { participant_id: 20, type_id: 34, data: { value: 1 } },
        { participant_id: 10, type_id: 42, data: { value: 6 } },
        { participant_id: 20, type_id: 42, data: { value: 5 } },
        { participant_id: 10, type_id: 45, data: { value: 59 } },
        { participant_id: 20, type_id: 45, data: { value: 41 } },
        { participant_id: 10, type_id: 84, data: { value: 1 } },
        { participant_id: 20, type_id: 86, data: { value: 2 } },
      ],
    });

    const stats = sportmonksFixtureToCanonicalStatistics(fixture);

    expect(stats).toMatchObject({
      corners: { home: 3, away: 1 },
      shotsTotal: { home: 6, away: 5 },
      possessionPct: { home: 59, away: 41 },
      yellowCards: { home: 1, away: null },
      shotsOnTarget: { home: null, away: 2 },
    });
    expect(buildSportmonksStatisticsEnvelope(fixture).coverage).toMatchObject({
      level: 'complete',
      itemCount: 8,
    });
  });

  it('builds canonical live odds snapshots and marks missing odds entitlement explicitly', () => {
    const snapshot = sportmonksFixtureToCanonicalOddsSnapshot(sportmonksFixture(), {
      matchId: '164327',
      fetchedAt: '2026-06-12T20:09:00.000Z',
    });

    expect(snapshot).toMatchObject({
      matchId: '164327',
      sourceProvider: 'sportmonks',
      sourceKind: 'live',
      warnings: [],
    });
    expect(snapshot.selections).toEqual([
      expect.objectContaining({
        market: 'Over/Under',
        selection: 'Over 1.5',
        line: 1.5,
        price: 1.92,
        bookmaker: 'Sportmonks Live',
        provider: 'sportmonks',
        kind: 'live',
        suspended: false,
      }),
      expect.objectContaining({
        market: 'Match Winner',
        selection: 'Away',
        price: 1.8,
        bookmaker: 'Sportmonks Live',
        suspended: true,
      }),
    ]);
    expect(validateCanonicalOddsSnapshot(snapshot)).toMatchObject({ ok: true });

    const noEntitlement = buildSportmonksOddsEnvelope({
      fixture: sportmonksFixture({
        has_odds: false,
        has_premium_odds: false,
        inplayOdds: [],
      }),
      matchId: '164327',
      fetchedAt: '2026-06-12T20:09:00.000Z',
      rateLimit: { remaining: 0, resetsInSeconds: 300, requestedEntity: 'Odds' },
    });
    expect(noEntitlement).toMatchObject({
      quota: 'hourly_limit',
      normalized: {
        sourceProvider: null,
        sourceKind: 'unknown',
        selections: [],
        warnings: ['sportmonks_odds_not_included_or_not_entitled'],
      },
      coverage: { level: 'empty', itemCount: 0 },
    });
    expect(validateProviderEnvelope(noEntitlement)).toMatchObject({ ok: true });
  });

  it('handles World Cup locked/no-access responses as provider access errors', () => {
    expect(classifySportmonksAccessError({
      statusCode: 403,
      error: 'World Cup package locked: subscription required',
    })).toEqual({
      blocked: true,
      warnings: ['sportmonks_entitlement_or_subscription_required'],
    });
    expect(classifySportmonksAccessError({ statusCode: 500, error: 'temporary outage' })).toEqual({
      blocked: false,
      warnings: [],
    });

    const envelope = buildSportmonksAccessErrorEnvelope({
      role: 'fixture_statistics',
      matchId: '164327',
      providerFixtureId: '98765',
      statusCode: 403,
      error: 'World Cup package locked: subscription required',
      fetchedAt: '2026-06-12T20:10:00.000Z',
      rateLimit: { remaining: 50, resetsInSeconds: 300, requestedEntity: 'Fixture' },
      warnings: ['world_cup_locked'],
    });

    expect(envelope).toMatchObject({
      provider: 'sportmonks',
      role: 'fixture_statistics',
      success: false,
      normalized: null,
      statusCode: 403,
      quota: 'high',
      coverage: { level: 'missing', itemCount: 0 },
      warnings: ['world_cup_locked', 'sportmonks_entitlement_or_subscription_required'],
    });
    expect(validateProviderEnvelope(envelope)).toMatchObject({ ok: true });
  });

  it('redacts Sportmonks API tokens and maps rate-limit metadata into provider quota state', () => {
    expect(redactSportmonksParams({
      api_token: 'secret',
      token: 'secret2',
      include: 'participants;scores',
      fixture: 98765,
    })).toEqual({
      api_token: '[redacted]',
      token: '[redacted]',
      include: 'participants;scores',
      fixture: '98765',
    });

    expect(buildSportmonksEventsEnvelope(sportmonksFixture(), {
      fetchedAt: '2026-06-12T20:11:00.000Z',
      rateLimit: { remaining: 251, resetsInSeconds: 300, requestedEntity: 'Fixture' },
    })).toMatchObject({ quota: 'ok' });
    expect(buildSportmonksEventsEnvelope(sportmonksFixture(), {
      fetchedAt: '2026-06-12T20:11:00.000Z',
      rateLimit: { remaining: 30, resetsInSeconds: 300, requestedEntity: 'Fixture' },
    })).toMatchObject({ quota: 'high' });
    expect(buildSportmonksEventsEnvelope(sportmonksFixture(), {
      fetchedAt: '2026-06-12T20:11:00.000Z',
      rateLimit: null,
    })).toMatchObject({ quota: 'unknown' });
  });

  it('maps Sportmonks period variants without depending on one provider state spelling', () => {
    const cases = [
      { state_id: 'NS', state: { name: 'Not Started' }, length: null, period: 'pre' },
      { state_id: null, state: { developer_name: 'FIRST_HALF' }, length: null, period: '1h' },
      { state_id: null, state: { code: 'HT' }, length: null, period: 'ht' },
      { state_id: null, state: { short_name: '2H' }, length: null, period: '2h' },
      { state_id: null, state: { name: 'Extra Time' }, length: null, period: 'et' },
      { state_id: null, state: { name: 'Penalty Shootout' }, length: null, period: 'pen' },
      { state_id: null, state: { name: 'Finished' }, length: null, period: 'ft' },
      { state_id: null, state: null, length: 80, period: '2h' },
      { state_id: null, state: null, length: 30, period: '1h' },
      { state_id: null, state: null, length: null, period: 'unknown' },
    ] as const;

    for (const entry of cases) {
      expect(sportmonksFixtureToCanonicalScoreClock(sportmonksFixture({
        state_id: entry.state_id,
        state: entry.state,
        length: entry.length,
      })).period).toBe(entry.period);
    }
  });

  it('keeps event taxonomy stable across Sportmonks text and id variants', () => {
    const mapped = sportmonksFixtureToCanonicalEvents(sportmonksFixture({
      events: [
        'bad-row',
        { id: 11, participant_id: 10, type_id: 15, minute: 20, addition: 'Penalty scored' },
        { id: 12, participant_id: 20, type_id: 16, minute: 21, info: 'Goal' },
        { id: 13, participant_id: 10, type_id: 21, minute: 22, info: 'Red card' },
        { id: 14, participant_id: 20, type: 'Subst', minute: 23 },
        { id: 15, participant_id: null, type: { display_name: 'Period' }, minute: 45, info: 'Half time' },
      ],
    }));

    expect(mapped.map((event) => event.type)).toEqual([
      'penalty',
      'goal',
      'card',
      'substitution',
      'period',
    ]);
    expect(mapped[0]).toMatchObject({
      teamSide: 'home',
      team: { id: '10', name: 'Mexico', logo: 'mexico.png' },
      detail: 'Penalty scored',
    });
    expect(mapped[3]).toMatchObject({ detail: 'Substitution' });
    expect(mapped[4]).toMatchObject({ teamSide: 'unknown', team: null });
  });

  it('normalizes Sportmonks statistic name/value variants into the canonical stat contract', () => {
    const stats = sportmonksFixtureToCanonicalStatistics(sportmonksFixture({
      statistics: [
        'bad-row',
        { participant_id: 10, type: { display_name: 'Total Shots' }, data: { value: 12 } },
        { participant_id: 20, name: 'Shots', value: '4' },
        { participant_id: 10, type: { code: 'passes' }, value: 390 },
        { participant_id: 20, type: 'Attacks', data: { value: '42' } },
        { participant_id: 10, type_id: 777, data: { value: 9 } },
        { participant_id: 20, type_id: 777, data: { value: 8 } },
        { participant_id: 20, type: { name: 'Yellow Cards' }, data: { value: '' } },
        { participant_id: 10, type: { name: 'Red Cards' }, data: { value: '0' } },
      ],
    }));

    expect(stats).toMatchObject({
      shotsTotal: { home: 12, away: 4 },
      passes: { home: 390, away: null },
      attacks: { home: null, away: 42 },
      yellowCards: { home: null, away: null },
      redCards: { home: 0, away: null },
      rawTypeMap: {
        '777': { home: 9, away: 8 },
      },
    });
  });

  it('normalizes Sportmonks live odds fallback fields and filters unusable selections', () => {
    const snapshot = sportmonksFixtureToCanonicalOddsSnapshot(sportmonksFixture({
      inplayOdds: [
        'bad-row',
        {
          market_description: 'Asian Handicap',
          value: 'Mexico -0.5',
          odds: '1.91',
          handicap: '-0.5',
          bookmaker: 'Book A',
          suspended: 'true',
        },
        {
          market: 'Totals',
          name: 'Over 2.5',
          decimal: 2.05,
          total: '2.5',
          status: 'suspended',
        },
        {
          name: 'Fallback Market',
          selection: 'Away +1.0',
          odd: 1.99,
          bookmaker: { display_name: 'Book B' },
        },
        {
          market_name: 'Bad Price',
          label: 'Home',
          odd: 1,
        },
        {
          market_name: 'Missing Selection',
          odd: 2.1,
        },
      ],
    }), {
      matchId: '164327',
      fetchedAt: '2026-06-12T20:12:00.000Z',
      generatedAt: '2026-06-12T20:12:01.000Z',
      warnings: ['sportmonks_odds_shadow_sample'],
    });

    expect(snapshot).toMatchObject({
      generatedAt: '2026-06-12T20:12:01.000Z',
      sourceProvider: 'sportmonks',
      sourceKind: 'live',
      warnings: ['sportmonks_odds_shadow_sample'],
    });
    expect(snapshot.selections).toEqual([
      expect.objectContaining({
        market: 'Asian Handicap',
        selection: 'Mexico -0.5',
        line: -0.5,
        price: 1.91,
        bookmaker: 'Book A',
        suspended: true,
      }),
      expect.objectContaining({
        market: 'Totals',
        selection: 'Over 2.5',
        line: 2.5,
        price: 2.05,
        bookmaker: null,
        suspended: true,
      }),
      expect.objectContaining({
        market: 'Fallback Market',
        selection: 'Away +1.0',
        line: 1,
        price: 1.99,
        bookmaker: 'Book B',
        suspended: false,
      }),
    ]);
  });

  it('accepts already-normalized Sportmonks fixtures and preserves failure envelope metadata', () => {
    const normalized = normalizeSportmonksFixture(sportmonksFixture({
      league: { display_name: 'FIFA World Cup', country_code: 'INT', logo_path: 'fifa.png' },
      state: { name: 'Full Time' },
    }));

    expect(sportmonksFixtureToCanonicalIdentity(normalized)).toMatchObject({
      matchId: '98765',
      league: {
        id: '111',
        name: 'FIFA World Cup',
        country: null,
        logo: null,
      },
      mappingConfidence: 'unknown',
    });
    expect(buildSportmonksEventsEnvelope(normalized, {
      fetchedAt: '2026-06-12T20:13:00.000Z',
      statusCode: 502,
      error: new Error('upstream timeout'),
      warnings: [null, 'retryable_upstream_error'],
      rateLimit: { remaining: undefined, resetsInSeconds: 300, requestedEntity: 'Fixture' },
    })).toMatchObject({
      success: false,
      normalized: null,
      freshness: 'missing',
      statusCode: 502,
      error: 'upstream timeout',
      quota: 'unknown',
      warnings: ['retryable_upstream_error'],
      coverage: {
        itemCount: 0,
        warnings: ['retryable_upstream_error'],
      },
    });
  });

  it('keeps Sportmonks access-error and quota boundaries explicit for cost control', () => {
    expect(classifySportmonksAccessError({ statusCode: 401, error: 'token invalid' })).toMatchObject({
      blocked: true,
    });
    expect(classifySportmonksAccessError({ statusCode: null, error: 'not subscribed to requested league' })).toMatchObject({
      blocked: true,
    });
    expect(classifySportmonksAccessError({ statusCode: 200, error: 'FORBIDDEN league locked' })).toMatchObject({
      blocked: true,
    });

    const base = {
      role: 'live_odds' as const,
      error: 'temporary odds outage',
      fetchedAt: '2026-06-12T20:14:00.000Z',
    };
    expect(buildSportmonksAccessErrorEnvelope({ ...base, rateLimit: { remaining: 10, resetsInSeconds: 300, requestedEntity: 'Odds' } }))
      .toMatchObject({ quota: 'critical', providerFixtureId: null, matchId: null });
    expect(buildSportmonksAccessErrorEnvelope({ ...base, rateLimit: { remaining: 250, resetsInSeconds: 300, requestedEntity: 'Odds' } }))
      .toMatchObject({ quota: 'elevated' });
  });

  it('marks empty Sportmonks envelopes as valid empty data instead of fetch errors', () => {
    const emptyFixture = sportmonksFixture({
      id: '',
      participants: [],
      scores: [],
      events: [],
      statistics: [],
      inplayOdds: [],
      has_odds: true,
    });

    expect(buildSportmonksFixtureIdentityEnvelope(emptyFixture)).toMatchObject({
      success: true,
      providerFixtureId: null,
      matchId: null,
      fetchedAt: '1970-01-01T00:00:00.000Z',
      coverage: { level: 'empty', itemCount: 0 },
      quota: 'unknown',
      warnings: [],
    });
    expect(buildSportmonksScoreClockEnvelope(emptyFixture)).toMatchObject({
      success: true,
      coverage: { level: 'empty', itemCount: 0 },
      normalized: {
        score: { home: null, away: null },
        period: '2h',
      },
    });
    expect(buildSportmonksEventsEnvelope(emptyFixture)).toMatchObject({
      success: true,
      coverage: { level: 'empty', itemCount: 0 },
      normalized: [],
    });
    expect(buildSportmonksStatisticsEnvelope(emptyFixture)).toMatchObject({
      success: true,
      coverage: { level: 'empty', itemCount: 0 },
      normalized: { rawTypeMap: {} },
    });
  });

  it('keeps failed Sportmonks odds envelopes non-actionable while preserving audit metadata', () => {
    const failed = buildSportmonksOddsEnvelope({
      fixture: sportmonksFixture(),
      matchId: null,
      fetchedAt: '2026-06-12T20:15:00.000Z',
      statusCode: 503,
      latencyMs: null,
      error: 'odds endpoint unavailable',
      raw: { response: [] },
      warnings: ['sportmonks_live_odds_error'],
      rateLimit: { remaining: 11, resetsInSeconds: 300, requestedEntity: 'Odds' },
    });

    expect(failed).toMatchObject({
      success: false,
      providerFixtureId: '98765',
      matchId: '98765',
      latencyMs: null,
      statusCode: 503,
      raw: { response: [] },
      normalized: null,
      freshness: 'missing',
      quota: 'high',
      error: 'odds endpoint unavailable',
      warnings: ['sportmonks_live_odds_error'],
      coverage: {
        level: 'missing',
        itemCount: 0,
        warnings: ['sportmonks_live_odds_error'],
      },
    });
  });

  it('normalizes access-error Error objects without leaking provider token context', () => {
    const envelope = buildSportmonksAccessErrorEnvelope({
      role: 'fixture_identity',
      providerFixtureId: 98765,
      error: new Error('subscription required for World Cup'),
      fetchedAt: '2026-06-12T20:16:00.000Z',
      rateLimit: { remaining: 51, resetsInSeconds: 300, requestedEntity: 'Fixture' },
    });

    expect(envelope).toMatchObject({
      success: false,
      providerFixtureId: '98765',
      matchId: null,
      error: 'subscription required for World Cup',
      quota: 'elevated',
      warnings: ['sportmonks_entitlement_or_subscription_required'],
    });
  });
});
