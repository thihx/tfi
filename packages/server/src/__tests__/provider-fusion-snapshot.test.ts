import { describe, expect, it } from 'vitest';
import {
  buildApiFootballEventsEnvelope,
  buildApiFootballFixtureIdentityEnvelope,
  buildApiFootballOddsEnvelope,
  buildApiFootballScoreClockEnvelope,
  buildApiFootballStatisticsEnvelope,
} from '../lib/canonical/api-football-adapter.js';
import {
  buildSportmonksAccessErrorEnvelope,
  buildSportmonksEventsEnvelope,
  buildSportmonksFixtureIdentityEnvelope,
  buildSportmonksOddsEnvelope,
  buildSportmonksScoreClockEnvelope,
  buildSportmonksStatisticsEnvelope,
} from '../lib/canonical/sportmonks-adapter.js';
import type { ApiFixture, ApiFixtureEvent, ApiFixtureStat } from '../lib/football-api.js';
import {
  buildLiveProviderFusionSnapshot,
  compactFusionSnapshotForAudit,
} from '../lib/provider-fusion-snapshot.js';
import type { SportmonksFixtureLike } from '../lib/sportmonks-normalize.js';

const fetchedAt = '2026-06-13T12:00:00.000Z';

function apiFixture(overrides: Partial<ApiFixture> = {}): ApiFixture {
  return {
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
    ...overrides,
  } as ApiFixture;
}

function apiEvents(): ApiFixtureEvent[] {
  return [
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
}

function apiStats(): ApiFixtureStat[] {
  return [
    {
      team: { id: 10, name: 'South Korea', logo: 'kr.png' },
      statistics: [
        { type: 'Shots on Goal', value: 4 },
        { type: 'Ball Possession', value: '58%' },
      ],
    },
    {
      team: { id: 20, name: 'Czech Republic', logo: 'cz.png' },
      statistics: [
        { type: 'Shots on Goal', value: 3 },
        { type: 'Ball Possession', value: '42%' },
      ],
    },
  ];
}

function apiOdds() {
  return [
    {
      bookmakers: [
        {
          name: 'Live Book',
          bets: [
            {
              name: 'Over/Under',
              values: [
                { value: 'Over 1.5', odd: '1.92', handicap: '1.5' },
              ],
            },
          ],
        },
      ],
    },
  ];
}

function sportmonksFixture(overrides: Partial<SportmonksFixtureLike> = {}): SportmonksFixtureLike {
  return {
    id: 98765,
    name: 'South Korea vs Czech Republic',
    league_id: 1,
    season_id: 2026,
    state_id: '2H',
    starting_at: '2026-06-13T11:00:00.000Z',
    starting_at_timestamp: 1781348400,
    result_info: '',
    length: 65,
    participants: [
      { id: 101, name: 'South Korea', image_path: 'kr.png', meta: { location: 'home' } },
      { id: 202, name: 'Czech Republic', image_path: 'cz.png', meta: { location: 'away' } },
    ],
    scores: [
      { description: 'CURRENT', score: { participant: 'home', goals: 0 } },
      { description: 'CURRENT', score: { participant: 'away', goals: 1 } },
    ],
    events: [
      { id: 1, participant_id: 202, type_id: 14, minute: 54, player_name: 'Forward', addition: 'Normal Goal' },
    ],
    statistics: [
      { participant_id: 101, type: { name: 'Shots on target' }, data: { value: 5 } },
      { participant_id: 202, type: { name: 'Shots on target' }, data: { value: 3 } },
      { participant_id: 101, type: { name: 'Corners' }, data: { value: 7 } },
    ],
    ...overrides,
  };
}

function apiProvider(stats: ApiFixtureStat[] = apiStats()) {
  const fixture = apiFixture();
  return {
    fixture: buildApiFootballFixtureIdentityEnvelope(fixture, { fetchedAt, raw: { marker: 'RAW_SECRET_API_FIXTURE' } }),
    scoreClock: buildApiFootballScoreClockEnvelope(fixture, { fetchedAt }),
    events: buildApiFootballEventsEnvelope(fixture, apiEvents(), { fetchedAt }),
    statistics: buildApiFootballStatisticsEnvelope(fixture, stats, { fetchedAt, raw: { marker: 'RAW_SECRET_API_STATS' } }),
    odds: buildApiFootballOddsEnvelope({
      matchId: '164327',
      response: apiOdds(),
      sourceKind: 'live',
      fetchedAt,
      raw: { marker: 'RAW_SECRET_API_ODDS' },
    }),
  };
}

function sportmonksProvider(fixture: SportmonksFixtureLike = sportmonksFixture()) {
  return {
    fixture: buildSportmonksFixtureIdentityEnvelope(fixture, { matchId: '164327', fetchedAt }),
    scoreClock: buildSportmonksScoreClockEnvelope(fixture, { matchId: '164327', fetchedAt }),
    events: buildSportmonksEventsEnvelope(fixture, { matchId: '164327', fetchedAt }),
    statistics: buildSportmonksStatisticsEnvelope(fixture, { matchId: '164327', fetchedAt }),
  };
}

function sportmonksProviderWithOdds(fixture: SportmonksFixtureLike = sportmonksFixture({
  has_odds: true,
  inplayOdds: [
    {
      market_name: 'Over/Under',
      label: 'Over 1.5',
      odd: '1.95',
      line: '1.5',
      bookmaker_name: 'Sportmonks Live',
    },
  ],
})) {
  return {
    ...sportmonksProvider(fixture),
    odds: buildSportmonksOddsEnvelope({
      fixture,
      matchId: '164327',
      fetchedAt,
    }),
  };
}

describe('provider fusion snapshot builder', () => {
  it('builds a single-source API-Football fusion snapshot without changing production inputs', () => {
    const snapshot = buildLiveProviderFusionSnapshot({
      matchId: '164327',
      generatedAt: '2026-06-13T12:01:00.000Z',
      providers: [apiProvider()],
    });

    expect(snapshot).toMatchObject({
      matchId: '164327',
      evidenceMode: 'full_live_data',
      consensus: {
        scoreAgreement: 'single_source',
        minuteAgreement: 'single_source',
        eventAgreement: 'single_source',
        statsAgreement: 'single_source',
        oddsAgreement: 'single_source',
      },
      fieldSources: {
        fixture: { provider: 'api-football', confidence: 'high' },
        scoreClock: { provider: 'api-football', coverage: 'complete' },
        events: { provider: 'api-football', coverage: 'complete' },
        statistics: { provider: 'api-football', coverage: 'complete' },
        odds: { provider: 'api-football', coverage: 'complete' },
      },
      moneyGuard: {
        canUseForMoneyDecision: true,
        canSaveRecommendation: true,
        canPushStatsOnlySignal: false,
        hardBlockReasons: [],
      },
    });
    expect(snapshot.canonical.scoreClock?.score).toEqual({ home: 0, away: 1 });
    expect(JSON.stringify(snapshot.canonical)).not.toContain('RAW_SECRET');
  });

  it('reports agreement when API-Football and Sportmonks canonical data agree', () => {
    const snapshot = buildLiveProviderFusionSnapshot({
      matchId: 164327,
      generatedAt: '2026-06-13T12:02:00.000Z',
      providers: [apiProvider(), sportmonksProvider()],
    });

    expect(snapshot.consensus).toMatchObject({
      scoreAgreement: 'agree',
      minuteAgreement: 'agree',
      eventAgreement: 'agree',
    });
    expect(snapshot.fieldSources.scoreClock.provider).toBe('api-football');
    expect(snapshot.fieldSources.statistics.provider).toBe('api-football');
    expect(snapshot.providerHealth).toEqual(expect.arrayContaining([
      expect.objectContaining({ provider: 'api-football', reachable: true, reliability: 'good' }),
      expect.objectContaining({ provider: 'sportmonks', reachable: true, reliability: 'good' }),
    ]));
  });

  it('reports statistics agreement when overlapping stat values match exactly', () => {
    const api = apiProvider([
      {
        team: { id: 10, name: 'South Korea', logo: 'kr.png' },
        statistics: [{ type: 'Shots on Goal', value: 5 }],
      },
      {
        team: { id: 20, name: 'Czech Republic', logo: 'cz.png' },
        statistics: [{ type: 'Shots on Goal', value: 3 }],
      },
    ]);
    const snapshot = buildLiveProviderFusionSnapshot({
      matchId: '164327',
      generatedAt: '2026-06-13T12:02:30.000Z',
      providers: [api, sportmonksProvider()],
    });

    expect(snapshot.consensus.statsAgreement).toBe('agree');
  });

  it('downgrades to low evidence when provider scores conflict', () => {
    const snapshot = buildLiveProviderFusionSnapshot({
      matchId: '164327',
      generatedAt: '2026-06-13T12:03:00.000Z',
      providers: [
        apiProvider(),
        sportmonksProvider(sportmonksFixture({
          scores: [
            { description: 'CURRENT', score: { participant: 'home', goals: 1 } },
            { description: 'CURRENT', score: { participant: 'away', goals: 1 } },
          ],
        })),
      ],
    });

    expect(snapshot.consensus.scoreAgreement).toBe('conflict');
    expect(snapshot.evidenceMode).toBe('low_evidence');
    expect(snapshot.moneyGuard).toMatchObject({
      canUseForMoneyDecision: false,
      canSaveRecommendation: false,
      hardBlockReasons: ['score_conflict'],
    });
    expect(snapshot.canonical.scoreClock?.score).toEqual({ home: 0, away: 1 });
  });

  it('selects Sportmonks statistics in shadow when API-Football statistics are empty', () => {
    const snapshot = buildLiveProviderFusionSnapshot({
      matchId: '164327',
      generatedAt: '2026-06-13T12:04:00.000Z',
      providers: [
        apiProvider([]),
        sportmonksProvider(),
      ],
    });

    expect(snapshot.fieldSources.statistics).toMatchObject({
      provider: 'sportmonks',
      providerFixtureId: '98765',
      confidence: 'high',
    });
    expect(snapshot.canonical.statistics).toMatchObject({
      shotsOnTarget: { home: 5, away: 3 },
    });
    expect(snapshot.consensus.statsAgreement).toBe('single_source');
  });

  it('keeps Sportmonks no-access envelopes non-fatal and carries warnings into health and snapshot', () => {
    const sportmonksNoAccess = {
      fixture: buildSportmonksAccessErrorEnvelope({
        role: 'fixture_identity',
        matchId: '164327',
        providerFixtureId: '98765',
        statusCode: 403,
        error: 'World Cup subscription required',
        fetchedAt,
        warnings: ['world_cup_locked'],
        rateLimit: { remaining: 30, resetsInSeconds: 300, requestedEntity: 'Fixture' },
      }),
      statistics: buildSportmonksAccessErrorEnvelope({
        role: 'fixture_statistics',
        matchId: '164327',
        providerFixtureId: '98765',
        statusCode: 403,
        error: 'World Cup subscription required',
        fetchedAt,
        warnings: ['world_cup_locked'],
        rateLimit: { remaining: 30, resetsInSeconds: 300, requestedEntity: 'Fixture' },
      }),
    };

    const snapshot = buildLiveProviderFusionSnapshot({
      matchId: '164327',
      generatedAt: '2026-06-13T12:05:00.000Z',
      providers: [apiProvider(), sportmonksNoAccess],
      warnings: ['shadow_only'],
    });

    expect(snapshot.fieldSources.statistics.provider).toBe('api-football');
    expect(snapshot.warnings).toEqual(expect.arrayContaining([
      'shadow_only',
      'world_cup_locked',
      'sportmonks_entitlement_or_subscription_required',
      'World Cup subscription required',
      'sportmonks_quota_high',
    ]));
    expect(snapshot.providerHealth).toEqual(expect.arrayContaining([
      expect.objectContaining({
        provider: 'sportmonks',
        reachable: false,
        reliability: 'bad',
        quotaState: 'high',
        warnings: expect.arrayContaining(['sportmonks_quota_high']),
      }),
    ]));
    expect(snapshot.moneyGuard.canSaveRecommendation).toBe(true);
  });

  it('marks missing live odds as stats-only and pushable but not saveable', () => {
    const withoutOdds = apiProvider();
    withoutOdds.odds = buildApiFootballOddsEnvelope({
      matchId: '164327',
      response: [],
      sourceKind: 'live',
      fetchedAt,
      warnings: ['no_api_football_live_odds'],
    });

    const snapshot = buildLiveProviderFusionSnapshot({
      matchId: '164327',
      generatedAt: '2026-06-13T12:06:00.000Z',
      providers: [withoutOdds],
    });

    expect(snapshot.evidenceMode).toBe('stats_only');
    expect(snapshot.fieldSources.odds).toMatchObject({
      provider: null,
      coverage: 'missing',
      notes: ['no_live_odds'],
    });
    expect(snapshot.moneyGuard).toMatchObject({
      canUseForMoneyDecision: false,
      canSaveRecommendation: false,
      canPushStatsOnlySignal: true,
      hardBlockReasons: ['no_live_odds'],
    });
    expect(snapshot.warnings).toContain('no_api_football_live_odds');
  });

  it('detects minute conflicts and avoids saving even when score agrees', () => {
    const snapshot = buildLiveProviderFusionSnapshot({
      matchId: '164327',
      generatedAt: '2026-06-13T12:07:00.000Z',
      providers: [
        apiProvider(),
        sportmonksProvider(sportmonksFixture({ length: 51 })),
      ],
    });

    expect(snapshot.consensus.minuteAgreement).toBe('conflict');
    expect(snapshot.evidenceMode).toBe('low_evidence');
    expect(snapshot.moneyGuard.hardBlockReasons).toEqual(['minute_conflict']);
  });

  it('keeps low-confidence provider fields out of canonical selection and records audit warning', () => {
    const lowConfidenceSportmonks = sportmonksProvider();
    lowConfidenceSportmonks.fixture = buildSportmonksFixtureIdentityEnvelope(sportmonksFixture(), { fetchedAt });
    const snapshot = buildLiveProviderFusionSnapshot({
      matchId: '164327',
      generatedAt: '2026-06-13T12:08:00.000Z',
      providers: [
        {
          fixture: buildApiFootballFixtureIdentityEnvelope(apiFixture(), { fetchedAt }),
          scoreClock: buildApiFootballScoreClockEnvelope(apiFixture(), { fetchedAt }),
        },
        lowConfidenceSportmonks,
      ],
    });

    expect(snapshot.fieldSources.events.provider).toBeNull();
    expect(snapshot.fieldSources.statistics.provider).toBeNull();
    expect(snapshot.evidenceMode).toBe('low_evidence');
    expect(snapshot.moneyGuard.hardBlockReasons).toContain('no_live_odds');
  });

  it('builds a compact audit payload without embedding canonical payloads or provider raw data', () => {
    const snapshot = buildLiveProviderFusionSnapshot({
      matchId: '164327',
      generatedAt: '2026-06-13T12:09:00.000Z',
      providers: [apiProvider(), sportmonksProvider()],
    });
    const audit = compactFusionSnapshotForAudit(snapshot);

    expect(audit).toMatchObject({
      matchId: '164327',
      evidenceMode: 'full_live_data',
      canonicalCounts: {
        events: 1,
        odds: 1,
      },
    });
    expect(JSON.stringify(audit)).not.toContain('RAW_SECRET');
    expect(audit).not.toHaveProperty('canonical');
  });

  it('builds compact audit counts for an empty snapshot', () => {
    const snapshot = buildLiveProviderFusionSnapshot({
      matchId: '164327',
      generatedAt: '2026-06-13T12:09:30.000Z',
      providers: [],
    });
    expect(compactFusionSnapshotForAudit(snapshot)).toMatchObject({
      canonicalCounts: {
        events: 0,
        statistics: 0,
        odds: 0,
      },
    });
  });

  it('reports odds agreement when two live providers expose the same first market', () => {
    const snapshot = buildLiveProviderFusionSnapshot({
      matchId: '164327',
      generatedAt: '2026-06-13T12:10:00.000Z',
      providers: [apiProvider(), sportmonksProviderWithOdds()],
    });

    expect(snapshot.consensus.oddsAgreement).toBe('agree');
    expect(snapshot.fieldSources.odds.provider).toBe('api-football');
  });

  it('reports odds conflict when live providers expose different first markets', () => {
    const snapshot = buildLiveProviderFusionSnapshot({
      matchId: '164327',
      generatedAt: '2026-06-13T12:11:00.000Z',
      providers: [
        apiProvider(),
        sportmonksProviderWithOdds(sportmonksFixture({
          has_odds: true,
          inplayOdds: [
            {
              market_name: 'Match Winner',
              label: 'Away',
              odd: '1.80',
              bookmaker_name: 'Sportmonks Live',
            },
          ],
        })),
      ],
    });

    expect(snapshot.consensus.oddsAgreement).toBe('conflict');
    expect(snapshot.moneyGuard.canSaveRecommendation).toBe(true);
  });

  it('uses lag_detected for mild minute drift without hard-blocking money eligibility', () => {
    const snapshot = buildLiveProviderFusionSnapshot({
      matchId: '164327',
      generatedAt: '2026-06-13T12:12:00.000Z',
      providers: [
        apiProvider(),
        sportmonksProvider(sportmonksFixture({ length: 60 })),
      ],
    });

    expect(snapshot.consensus.minuteAgreement).toBe('lag_detected');
    expect(snapshot.evidenceMode).toBe('full_live_data');
    expect(snapshot.moneyGuard.hardBlockReasons).toEqual([]);
  });

  it('can classify odds-events-only and events-only degraded shadow snapshots', () => {
    const noStats = apiProvider([]);
    const noStatsNoOdds = apiProvider([]);
    noStatsNoOdds.odds = buildApiFootballOddsEnvelope({
      matchId: '164327',
      response: [],
      sourceKind: 'live',
      fetchedAt,
    });

    expect(buildLiveProviderFusionSnapshot({
      matchId: '164327',
      generatedAt: '2026-06-13T12:13:00.000Z',
      providers: [noStats],
    }).evidenceMode).toBe('odds_events_only');

    expect(buildLiveProviderFusionSnapshot({
      matchId: '164327',
      generatedAt: '2026-06-13T12:14:00.000Z',
      providers: [noStatsNoOdds],
    }).evidenceMode).toBe('events_only_degraded');
  });

  it('returns none with unknown consensus when no provider envelopes are available', () => {
    const snapshot = buildLiveProviderFusionSnapshot({
      matchId: '164327',
      providers: [],
      warnings: [null, 'no_provider_data'],
    });

    expect(snapshot.generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(snapshot.evidenceMode).toBe('none');
    expect(snapshot.providerHealth).toEqual([]);
    expect(snapshot.consensus).toEqual({
      scoreAgreement: 'unknown',
      minuteAgreement: 'unknown',
      eventAgreement: 'unknown',
      statsAgreement: 'missing',
      oddsAgreement: 'missing',
    });
    expect(snapshot.moneyGuard).toMatchObject({
      canUseForMoneyDecision: false,
      hardBlockReasons: ['no_live_odds'],
      softWarnings: ['no_provider_data'],
    });
  });

  it('keeps API-Football degraded but reachable when a successful source carries warnings', () => {
    const provider = apiProvider();
    provider.odds = buildApiFootballOddsEnvelope({
      matchId: '164327',
      response: apiOdds(),
      sourceKind: 'live',
      fetchedAt,
      warnings: ['api_football_quota_near_limit'],
    });
    const snapshot = buildLiveProviderFusionSnapshot({
      matchId: '164327',
      generatedAt: '2026-06-13T12:15:00.000Z',
      providers: [provider],
    });

    expect(snapshot.providerHealth).toEqual([
      expect.objectContaining({
        provider: 'api-football',
        reachable: true,
        reliability: 'degraded',
        warnings: expect.arrayContaining(['api_football_quota_near_limit']),
      }),
    ]);
  });

  it('uses deterministic provider-name tie-breaks when no configured primary owns the richest events', () => {
    const snapshot = buildLiveProviderFusionSnapshot({
      matchId: '164327',
      generatedAt: '2026-06-13T12:16:00.000Z',
      primaryProvider: 'shadow-primary',
      providers: [sportmonksProvider(), apiProvider()],
    });

    expect(snapshot.fieldSources.events.provider).toBe('api-football');
  });

  it('marks event agreement partial and stats agreement unknown when providers have incompatible coverage shapes', () => {
    const api = apiProvider([
      {
        team: { id: 10, name: 'South Korea', logo: 'kr.png' },
        statistics: [{ type: 'Shots on Goal', value: 4 }],
      },
    ]);
    const sportmonks = sportmonksProvider(sportmonksFixture({
      events: [
        { id: 1, participant_id: 202, type_id: 14, minute: 54, player_name: 'Forward', addition: 'Normal Goal' },
        { id: 2, participant_id: 101, type_id: 14, minute: 60, player_name: 'Forward', addition: 'Normal Goal' },
      ],
      statistics: [
        { participant_id: 101, type: { name: 'Corners' }, data: { value: 7 } },
        { participant_id: 202, type: { name: 'Corners' }, data: { value: 2 } },
      ],
    }));

    const snapshot = buildLiveProviderFusionSnapshot({
      matchId: '164327',
      generatedAt: '2026-06-13T12:17:00.000Z',
      providers: [api, sportmonks],
    });

    expect(snapshot.consensus.eventAgreement).toBe('partial');
    expect(snapshot.consensus.statsAgreement).toBe('unknown');
  });

  it('counts penalty events as goal-context events during event consensus', () => {
    const api = apiProvider();
    api.events = buildApiFootballEventsEnvelope(apiFixture(), [
      {
        time: { elapsed: 54, extra: null },
        team: { id: 20, name: 'Czech Republic', logo: 'cz.png' },
        player: { id: 9, name: 'Forward' },
        assist: { id: null, name: null },
        type: 'Penalty',
        detail: 'Penalty scored',
        comments: null,
      },
    ], { fetchedAt });
    const sportmonks = sportmonksProvider(sportmonksFixture({
      events: [
        { id: 1, participant_id: 202, type_id: 15, minute: 54, player_name: 'Forward', addition: 'Penalty scored' },
      ],
    }));

    const snapshot = buildLiveProviderFusionSnapshot({
      matchId: '164327',
      generatedAt: '2026-06-13T12:17:30.000Z',
      providers: [api, sportmonks],
    });

    expect(snapshot.consensus.eventAgreement).toBe('agree');
  });

  it('keeps score consensus unknown when providers only expose null scores', () => {
    const api = apiProvider();
    api.scoreClock = buildApiFootballScoreClockEnvelope(apiFixture({
      goals: { home: null, away: null },
    }), { fetchedAt });

    const snapshot = buildLiveProviderFusionSnapshot({
      matchId: '164327',
      generatedAt: '2026-06-13T12:18:00.000Z',
      providers: [api],
    });

    expect(snapshot.consensus.scoreAgreement).toBe('unknown');
  });

  it('does not treat suspended live odds as usable odds', () => {
    const api = apiProvider();
    api.odds = buildApiFootballOddsEnvelope({
      matchId: '164327',
      sourceKind: 'live',
      fetchedAt,
      response: [
        {
          bookmakers: [
            {
              name: 'Live Book',
              bets: [
                {
                  name: 'Over/Under',
                  values: [{ value: 'Over 1.5', odd: '1.92', handicap: '1.5', suspended: true }],
                },
              ],
            },
          ],
        },
      ],
    });

    const snapshot = buildLiveProviderFusionSnapshot({
      matchId: '164327',
      generatedAt: '2026-06-13T12:19:00.000Z',
      providers: [api],
    });

    expect(snapshot.consensus.oddsAgreement).toBe('missing');
    expect(snapshot.fieldSources.odds.provider).toBeNull();
    expect(snapshot.moneyGuard.hardBlockReasons).toEqual(['no_live_odds']);
  });
});
