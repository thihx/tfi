import { describe, expect, it } from 'vitest';
import {
  buildCanonicalFixtureIdentity,
  buildCanonicalMatchEvent,
  buildCanonicalOddsSelection,
  buildCanonicalOddsSnapshot,
  buildCanonicalScoreClock,
  buildCanonicalTeamStatistics,
  buildProviderCoverageFlags,
  buildProviderEnvelope,
  buildProviderFieldSource,
  classifyCoverageLevel,
  classifyFreshnessState,
  validateCanonicalDomainObject,
  validateCanonicalFixtureIdentity,
  validateCanonicalMatchEvent,
  validateCanonicalOddsSnapshot,
  validateCanonicalScoreClock,
  validateCanonicalTeamStatistics,
  validateProviderEnvelope,
} from '../lib/canonical/provider-domain.js';

describe('canonical provider domain', () => {
  it('builds and validates canonical fixture identity without provider raw schema', () => {
    const fixture = buildCanonicalFixtureIdentity({
      matchId: 12345,
      providerFixtureIds: {
        'api-football': 12345,
        sportmonks: ' 98765 ',
        empty: ' ',
      },
      kickoffAtUtc: '2026-06-12T19:00:00.000Z',
      league: {
        id: 1,
        name: 'World Cup',
        country: 'World',
        season: '2026' as unknown as number,
        logo: ' ',
      },
      home: { id: 10, name: 'Mexico', logo: 'home.png' },
      away: { id: 20, name: 'South Africa', logo: null },
      mappingConfidence: 'verified',
    });

    expect(fixture).toEqual({
      matchId: '12345',
      providerFixtureIds: {
        'api-football': '12345',
        sportmonks: '98765',
      },
      kickoffAtUtc: '2026-06-12T19:00:00.000Z',
      league: {
        id: '1',
        name: 'World Cup',
        country: 'World',
        season: 2026,
        logo: null,
      },
      home: { id: '10', name: 'Mexico', logo: 'home.png' },
      away: { id: '20', name: 'South Africa', logo: null },
      mappingConfidence: 'verified',
    });
    expect(validateCanonicalFixtureIdentity(fixture)).toMatchObject({ ok: true, value: fixture });
    expect(validateCanonicalDomainObject('fixture', fixture)).toMatchObject({ ok: true });
  });

  it('builds score and clock snapshots with safe period fallback', () => {
    const scoreClock = buildCanonicalScoreClock({
      status: 'Live',
      minute: '65',
      injuryTime: '',
      period: '2h',
      score: { home: '0', away: 1 },
      wallClockMinuteEstimate: 68.8,
      providerClockLagMinutes: '3',
    });

    expect(scoreClock).toEqual({
      status: 'Live',
      minute: 65,
      injuryTime: null,
      period: '2h',
      score: { home: 0, away: 1 },
      wallClockMinuteEstimate: 68.8,
      providerClockLagMinutes: 3,
    });
    expect(validateCanonicalScoreClock(scoreClock)).toMatchObject({ ok: true });

    expect(buildCanonicalScoreClock({
      status: null,
      minute: 'bad',
      period: 'quarter',
      score: null,
    })).toMatchObject({
      status: '',
      minute: null,
      period: 'unknown',
      score: { home: null, away: null },
    });
  });

  it('builds canonical events and preserves partial player/team evidence', () => {
    const goal = buildCanonicalMatchEvent({
      minute: '12',
      extra: null,
      teamSide: 'home',
      team: { id: 10, name: 'Mexico', logo: '' },
      playerName: 'Scorer',
      assistName: 'Assist',
      type: 'goal',
      detail: '1st Goal',
      sourceEventId: 555,
    });
    const unknown = buildCanonicalMatchEvent({
      minute: 'bad',
      teamSide: 'neutral',
      type: 'weird',
      detail: null,
    });

    expect(goal).toEqual({
      minute: 12,
      extra: null,
      teamSide: 'home',
      team: { id: '10', name: 'Mexico', logo: null },
      playerName: 'Scorer',
      assistName: 'Assist',
      type: 'goal',
      detail: '1st Goal',
      sourceEventId: '555',
    });
    expect(unknown).toMatchObject({
      minute: null,
      teamSide: 'unknown',
      team: null,
      playerName: null,
      assistName: null,
      type: 'other',
      detail: '',
    });
    expect(validateCanonicalMatchEvent(goal)).toMatchObject({ ok: true });
  });

  it('builds canonical team statistics and keeps unknown provider stats in rawTypeMap', () => {
    const stats = buildCanonicalTeamStatistics({
      possessionPct: { home: '62%', away: '38%' },
      shotsTotal: { home: 12, away: '4' },
      shotsOnTarget: { home: '5', away: 1 },
      expectedGoals: { home: '0.85', away: '0.29' },
      dangerousAttacks: { home: '', away: 'bad' },
      rawTypeMap: {
        'API-Football:Shots on Goal': ['mapped-to-shotsOnTarget'],
        'Sportmonks:Big Chances': { home: 2, away: 0 },
      },
    });

    expect(stats).toEqual({
      possessionPct: { home: null, away: null },
      shotsTotal: { home: 12, away: 4 },
      shotsOnTarget: { home: 5, away: 1 },
      expectedGoals: { home: 0.85, away: 0.29 },
      dangerousAttacks: { home: null, away: null },
      rawTypeMap: {
        'API-Football:Shots on Goal': ['mapped-to-shotsOnTarget'],
        'Sportmonks:Big Chances': { home: 2, away: 0 },
      },
    });
    expect(validateCanonicalTeamStatistics(stats)).toMatchObject({ ok: true });

    expect(buildCanonicalTeamStatistics({
      corners: null,
      rawTypeMap: null,
    })).toEqual({ rawTypeMap: {} });
  });

  it('builds canonical odds snapshots and validates tradable live odds provenance', () => {
    const selection = buildCanonicalOddsSelection({
      market: ' over_1.5 ',
      selection: 'Over 1.5',
      line: '1.5',
      price: '1.92',
      bookmaker: '',
      provider: 'api-football',
      kind: 'live',
      fetchedAt: '2026-06-12T20:01:00.000Z',
      suspended: false,
    });
    const snapshot = buildCanonicalOddsSnapshot({
      matchId: '12345',
      generatedAt: '2026-06-12T20:01:01.000Z',
      selections: [selection],
      warnings: ['no secondary odds provider'],
    });

    expect(snapshot).toEqual({
      matchId: '12345',
      generatedAt: '2026-06-12T20:01:01.000Z',
      selections: [{
        market: 'over_1.5',
        selection: 'Over 1.5',
        line: 1.5,
        price: 1.92,
        bookmaker: null,
        provider: 'api-football',
        kind: 'live',
        fetchedAt: '2026-06-12T20:01:00.000Z',
        suspended: false,
      }],
      sourceProvider: null,
      sourceKind: 'live',
      warnings: ['no secondary odds provider'],
    });
    expect(validateCanonicalOddsSnapshot(snapshot)).toMatchObject({ ok: true });

    expect(buildCanonicalOddsSnapshot({
      matchId: null,
      generatedAt: null,
      sourceProvider: 'the-odds-api',
      sourceKind: 'prematch',
      warnings: [null, 'reference only'],
    })).toEqual({
      matchId: '',
      generatedAt: '',
      selections: [],
      sourceProvider: 'the-odds-api',
      sourceKind: 'prematch',
      warnings: ['reference only'],
    });
  });

  it('classifies provider coverage and freshness for empty, missing, stale, partial, complete, and conflict states', () => {
    expect(classifyCoverageLevel({ fetched: false })).toBe('missing');
    expect(classifyCoverageLevel({ fetched: true, itemCount: 0 })).toBe('empty');
    expect(classifyCoverageLevel({ fetched: true, itemCount: 1, expectedItemCount: 2 })).toBe('partial');
    expect(classifyCoverageLevel({ fetched: true, itemCount: 2, expectedItemCount: 2 })).toBe('complete');
    expect(classifyCoverageLevel({ fetched: true, itemCount: 2, conflicted: true })).toBe('unknown');

    expect(classifyFreshnessState({ fetched: false })).toBe('missing');
    expect(classifyFreshnessState({ fetched: true, fetchedAt: '2026-06-12T20:00:00.000Z', stale: true })).toBe('stale');
    expect(classifyFreshnessState({ fetched: true, fetchedAt: '2026-06-12T20:00:00.000Z' })).toBe('fresh');
    expect(classifyFreshnessState({ fetched: true, fetchedAt: '2026-06-12T20:00:00.000Z', conflicted: true })).toBe('conflicted');

    expect(buildProviderFieldSource({
      provider: 'sportmonks',
      providerFixtureId: 98765,
      fetchedAt: '2026-06-12T20:00:00.000Z',
      fetched: true,
      itemCount: 1,
      expectedItemCount: 2,
      confidence: 'verified',
      notes: ['stats fallback', '', null],
    })).toEqual({
      provider: 'sportmonks',
      providerFixtureId: '98765',
      fetchedAt: '2026-06-12T20:00:00.000Z',
      freshness: 'fresh',
      coverage: 'partial',
      confidence: 'high',
      notes: ['stats fallback'],
    });

    expect(buildProviderFieldSource({
      provider: '',
      fetched: true,
      fetchedAt: '',
      itemCount: -1,
      confidence: 'medium',
      stale: true,
    })).toEqual({
      provider: null,
      providerFixtureId: null,
      fetchedAt: null,
      freshness: 'missing',
      coverage: 'empty',
      confidence: 'medium',
      notes: [],
    });

    expect(buildProviderCoverageFlags({
      level: 'partial',
      itemCount: -2,
      warnings: ['manual override', null],
    })).toEqual({
      level: 'partial',
      roles: {},
      hasData: true,
      itemCount: 0,
      warnings: ['manual override'],
    });
  });

  it('builds provider envelopes with coverage, freshness, quota, and redaction-ready raw metadata slots', () => {
    const successEnvelope = buildProviderEnvelope({
      provider: 'sportmonks',
      role: 'fixture_statistics',
      providerFixtureId: 98765,
      matchId: 12345,
      fetchedAt: '2026-06-12T20:00:00.000Z',
      latencyMs: '120',
      statusCode: '200',
      raw: { data: [{ id: 1 }] },
      normalized: { shotsOnTarget: { home: 4, away: 1 }, rawTypeMap: {} },
      coverage: buildProviderCoverageFlags({
        fetched: true,
        itemCount: 2,
        expectedItemCount: 2,
        roles: { fixture_statistics: 'complete' },
      }),
      quota: 'ok',
      warnings: ['secondary provider'],
    });

    expect(successEnvelope).toMatchObject({
      provider: 'sportmonks',
      role: 'fixture_statistics',
      providerFixtureId: '98765',
      matchId: '12345',
      latencyMs: 120,
      success: true,
      statusCode: 200,
      coverage: {
        level: 'complete',
        roles: { fixture_statistics: 'complete' },
        hasData: true,
        itemCount: 2,
      },
      freshness: 'fresh',
      quota: 'ok',
      error: '',
      warnings: ['secondary provider'],
    });
    expect(validateProviderEnvelope(successEnvelope)).toMatchObject({ ok: true });

    const failureEnvelope = buildProviderEnvelope({
      provider: 'sportmonks',
      role: 'live_odds',
      fetchedAt: '2026-06-12T20:00:00.000Z',
      success: false,
      error: '403 entitlement',
      statusCode: 403,
      coverage: { fetched: false, itemCount: 0, warnings: ['entitlement'] },
      quota: 'unknown',
    });

    expect(failureEnvelope).toMatchObject({
      success: false,
      normalized: null,
      coverage: { level: 'missing', hasData: false },
      freshness: 'missing',
      error: '403 entitlement',
    });
    expect(validateProviderEnvelope(failureEnvelope)).toMatchObject({ ok: true });

    expect(buildProviderEnvelope({
      provider: 'api-football',
      role: 'event_timeline',
      error: 'timeout',
    })).toMatchObject({
      provider: 'api-football',
      providerFixtureId: null,
      matchId: null,
      fetchedAt: '1970-01-01T00:00:00.000Z',
      latencyMs: null,
      success: false,
      statusCode: null,
      raw: null,
      normalized: null,
      coverage: { level: 'missing', hasData: false, itemCount: 0 },
      freshness: 'missing',
      quota: 'unknown',
      error: 'timeout',
      warnings: [],
    });
  });

  it('rejects malformed canonical runtime objects', () => {
    expect(validateCanonicalFixtureIdentity(null)).toEqual({
      ok: false,
      errors: ['fixture must be an object'],
    });
    expect(validateCanonicalScoreClock(null)).toEqual({
      ok: false,
      errors: ['scoreClock must be an object'],
    });
    expect(validateCanonicalMatchEvent(null)).toEqual({
      ok: false,
      errors: ['event must be an object'],
    });
    expect(validateCanonicalTeamStatistics(null)).toEqual({
      ok: false,
      errors: ['statistics must be an object'],
    });
    expect(validateCanonicalOddsSnapshot(null)).toEqual({
      ok: false,
      errors: ['oddsSnapshot must be an object'],
    });
    expect(validateProviderEnvelope(null)).toEqual({
      ok: false,
      errors: ['envelope must be an object'],
    });

    expect(validateCanonicalFixtureIdentity({
      matchId: '',
      providerFixtureIds: [],
      kickoffAtUtc: 'not-date',
      league: { name: '' },
      home: null,
      away: { id: 1, name: '', logo: 2 },
      mappingConfidence: 'sure',
    })).toMatchObject({ ok: false });

    expect(validateCanonicalScoreClock({
      status: 1,
      minute: Number.NaN,
      injuryTime: '2',
      period: 'q1',
      score: null,
      wallClockMinuteEstimate: Infinity,
      providerClockLagMinutes: null,
    })).toMatchObject({ ok: false });

    expect(validateCanonicalMatchEvent({
      minute: '12',
      extra: null,
      teamSide: 'both',
      team: { id: null, name: '', logo: null },
      playerName: 1,
      assistName: null,
      type: 'kick',
      detail: 3,
      sourceEventId: {},
    })).toMatchObject({ ok: false });

    expect(validateCanonicalTeamStatistics({
      shotsTotal: { home: '5', away: 1 },
      corners: null,
      rawTypeMap: null,
    })).toMatchObject({ ok: false });

    expect(validateCanonicalOddsSnapshot({
      matchId: '',
      generatedAt: 'bad-date',
      selections: [{
        market: '',
        selection: '',
        line: '1.5',
        price: 1,
        bookmaker: 1,
        provider: '',
        kind: 'future',
        fetchedAt: '',
        suspended: 'false',
      }],
      sourceProvider: 99,
      sourceKind: 'bad',
      warnings: ['ok', 1],
    })).toMatchObject({ ok: false });

    expect(validateCanonicalOddsSnapshot({
      matchId: 'match-1',
      generatedAt: '2026-06-12T20:01:01.000Z',
      selections: ['bad-row'],
      sourceProvider: null,
      sourceKind: 'unknown',
      warnings: [],
    })).toMatchObject({ ok: false });

    expect(validateCanonicalOddsSnapshot({
      matchId: 'match-1',
      generatedAt: '2026-06-12T20:01:01.000Z',
      selections: 'bad-list',
      sourceProvider: null,
      sourceKind: 'unknown',
      warnings: [],
    })).toMatchObject({ ok: false });

    expect(validateProviderEnvelope({
      provider: '',
      role: 'bad-role',
      providerFixtureId: 123,
      matchId: null,
      fetchedAt: 'bad-date',
      latencyMs: 'fast',
      success: 'true',
      statusCode: '200',
      coverage: {
        level: 'great',
        hasData: 'yes',
        itemCount: 'many',
        warnings: [1],
      },
      freshness: 'now',
      quota: 'none',
      error: 1,
      warnings: 'bad',
    })).toMatchObject({ ok: false });

    expect(validateProviderEnvelope({
      provider: 'api-football',
      role: 'fixture_score',
      providerFixtureId: null,
      matchId: null,
      fetchedAt: '2026-06-12T20:00:00.000Z',
      latencyMs: null,
      success: true,
      statusCode: null,
      coverage: null,
      freshness: 'fresh',
      quota: 'ok',
      error: '',
      warnings: [],
    })).toMatchObject({ ok: false });

    expect(validateCanonicalDomainObject('providerEnvelope', 'bad')).toEqual({
      ok: false,
      errors: ['envelope must be an object'],
    });
    expect(validateCanonicalDomainObject('scoreClock', buildCanonicalScoreClock({ period: 'pre', score: null }))).toMatchObject({ ok: true });
    expect(validateCanonicalDomainObject('event', buildCanonicalMatchEvent({ teamSide: 'away', type: 'period' }))).toMatchObject({ ok: true });
    expect(validateCanonicalDomainObject('statistics', buildCanonicalTeamStatistics({ rawTypeMap: {} }))).toMatchObject({ ok: true });
    expect(validateCanonicalDomainObject('oddsSnapshot', buildCanonicalOddsSnapshot({
      matchId: 'match-1',
      generatedAt: '2026-06-12T20:01:01.000Z',
      selections: [{
        market: 'under_2.5',
        selection: 'Under 2.5',
        price: 1.8,
        provider: 'api-football',
        kind: 'reference',
        fetchedAt: '2026-06-12T20:01:00.000Z',
        suspended: true,
      }],
      sourceKind: 'reference',
      warnings: [],
    }))).toMatchObject({ ok: true });
    expect(validateCanonicalDomainObject('unknown' as 'fixture', {})).toMatchObject({ ok: false });
  });
});
