import { beforeEach, describe, expect, test, vi } from 'vitest';
import { ensureFixturesForMatchIds, ensureMatchInsight } from '../lib/provider-insight-cache.js';
import type { ApiFixture, ApiFixtureEvent, ApiFixtureStat } from '../lib/football-api.js';

const { fetchSportmonksSupplementForFixture } = vi.hoisted(() => ({
  fetchSportmonksSupplementForFixture: vi.fn(),
}));

vi.mock('../lib/sportmonks-provider-fallback.js', () => ({
  fetchSportmonksSupplementForFixture,
}));

beforeEach(() => {
  fetchSportmonksSupplementForFixture.mockReset();
});

function makeFixture(id: string, status: string): ApiFixture {
  return {
    fixture: {
      id: Number(id),
      date: '2026-06-02T10:00:00+00:00',
      status: { short: status, elapsed: null },
    },
    league: { id: 39, name: 'Premier League' },
    teams: {
      home: { id: 1, name: 'Home', logo: '' },
      away: { id: 2, name: 'Away', logo: '' },
    },
    goals: { home: null, away: null },
    score: { halftime: { home: null, away: null } },
  } as ApiFixture;
}

describe('ensureFixturesForMatchIds', () => {
  test('forceRefreshIds bypasses a fresh NS fixture cache during kickoff transition', async () => {
    const cachedFixture = makeFixture('100', 'NS');
    const liveFixture = makeFixture('100', '1H');
    liveFixture.fixture.status.elapsed = 2;
    liveFixture.goals = { home: 0, away: 0 };

    const fetchFixturesByIds = vi.fn().mockResolvedValue([liveFixture]);
    const upsertProviderFixtureCache = vi.fn().mockResolvedValue(undefined);

    const result = await ensureFixturesForMatchIds(
      ['100'],
      { freshnessMode: 'stale_safe', forceRefreshIds: ['100'] },
      {
        now: () => new Date('2026-06-02T10:01:00.000Z'),
        getProviderFixtureCaches: vi.fn().mockResolvedValue([{
          match_id: '100',
          fixture_payload: cachedFixture,
          fixture_fetched_at: '2026-06-02T10:00:55.000Z',
          cached_at: '2026-06-02T10:00:55.000Z',
          match_status: 'NS',
          match_minute: null,
          freshness: 'fresh',
          degraded: false,
          last_refresh_error: '',
        }]),
        fetchFixturesByIds,
        upsertProviderFixtureCache,
      },
    );

    expect(fetchFixturesByIds).toHaveBeenCalledWith(['100']);
    expect(upsertProviderFixtureCache).toHaveBeenCalledWith(expect.objectContaining({
      match_id: '100',
      fixture_payload: liveFixture,
      match_status: '1H',
      match_minute: 2,
      freshness: 'fresh',
      degraded: false,
    }));
    expect(result[0]?.fixture.status.short).toBe('1H');
  });

  test('fixtureTtlMs lets realtime-interest callers refresh stale live cache without real_required', async () => {
    const cachedFixture = makeFixture('100', '1H');
    cachedFixture.fixture.status.elapsed = 12;
    cachedFixture.goals = { home: 0, away: 0 };
    const updatedFixture = makeFixture('100', '1H');
    updatedFixture.fixture.status.elapsed = 13;
    updatedFixture.goals = { home: 1, away: 0 };

    const fetchFixturesByIds = vi.fn().mockResolvedValue([updatedFixture]);
    const upsertProviderFixtureCache = vi.fn().mockResolvedValue(undefined);

    const result = await ensureFixturesForMatchIds(
      ['100'],
      { freshnessMode: 'stale_safe', fixtureTtlMs: 5_000 },
      {
        now: () => new Date('2026-06-02T10:00:06.000Z'),
        getProviderFixtureCaches: vi.fn().mockResolvedValue([{
          match_id: '100',
          fixture_payload: cachedFixture,
          fixture_fetched_at: '2026-06-02T10:00:00.000Z',
          cached_at: '2026-06-02T10:00:00.000Z',
          match_status: '1H',
          match_minute: 12,
          freshness: 'fresh',
          degraded: false,
          last_refresh_error: '',
        }]),
        fetchFixturesByIds,
        upsertProviderFixtureCache,
      },
    );

    expect(fetchFixturesByIds).toHaveBeenCalledWith(['100']);
    expect(result[0]?.fixture.status.elapsed).toBe(13);
    expect(result[0]?.goals.home).toBe(1);
  });
});

describe('ensureMatchInsight', () => {
  test('supplements fresh empty API-Football detail caches with Sportmonks fallback data', async () => {
    const fixture = makeFixture('100', '1H');
    fixture.fixture.status.elapsed = 55;
    fixture.goals = { home: 1, away: 0 };

    const sportmonksStats: ApiFixtureStat[] = [{
      team: { id: 1, name: 'Home', logo: '' },
      statistics: [{ type: 'Shots on Goal', value: 4 }],
    }];
    const sportmonksEvents: ApiFixtureEvent[] = [{
      time: { elapsed: 22, extra: null },
      team: { id: 1, name: 'Home', logo: '' },
      player: { id: null, name: 'Scorer' },
      assist: { id: null, name: null },
      type: 'Goal',
      detail: 'Normal Goal',
      comments: null,
    }];

    fetchSportmonksSupplementForFixture.mockResolvedValueOnce({
      provider: 'sportmonks',
      providerFixtureId: '19427456',
      mappingMethod: 'date_team_match',
      mappingConfidence: 'high',
      used: true,
      statistics: sportmonksStats,
      events: sportmonksEvents,
      coverageFlags: { provider: 'sportmonks', statistics_count: 2, event_count: 1 },
      warnings: [],
    });

    const getProviderFixtureCache = vi.fn().mockResolvedValue({
      match_id: '100',
      fixture_payload: fixture,
      fixture_fetched_at: '2026-06-02T10:01:00.000Z',
      cached_at: '2026-06-02T10:01:00.000Z',
      match_status: '1H',
      match_minute: 55,
      freshness: 'fresh',
      degraded: false,
      last_refresh_error: '',
    });
    const getProviderFixtureStatsCache = vi.fn()
      .mockResolvedValueOnce({
        match_id: '100',
        statistics_payload: [],
        coverage_flags: { team_count: 0, stat_pairs: 0, has_payload: false },
        stats_fetched_at: '2026-06-02T10:01:00.000Z',
        cached_at: '2026-06-02T10:01:00.000Z',
        match_status: '1H',
        match_minute: 55,
        freshness: 'fresh',
        degraded: false,
        last_refresh_error: '',
      })
      .mockResolvedValueOnce({
        match_id: '100',
        statistics_payload: sportmonksStats,
        coverage_flags: { provider: 'sportmonks', stat_pairs: 1, has_payload: true },
        stats_fetched_at: '2026-06-02T10:01:05.000Z',
        cached_at: '2026-06-02T10:01:05.000Z',
        match_status: '1H',
        match_minute: 55,
        freshness: 'fresh',
        degraded: false,
        last_refresh_error: '',
      });
    const getProviderFixtureEventsCache = vi.fn()
      .mockResolvedValueOnce({
        match_id: '100',
        events_payload: [],
        coverage_flags: { event_count: 0, has_payload: false },
        events_fetched_at: '2026-06-02T10:01:00.000Z',
        cached_at: '2026-06-02T10:01:00.000Z',
        match_status: '1H',
        match_minute: 55,
        freshness: 'fresh',
        degraded: false,
        last_refresh_error: '',
      })
      .mockResolvedValueOnce({
        match_id: '100',
        events_payload: sportmonksEvents,
        coverage_flags: { provider: 'sportmonks', event_count: 1, has_payload: true },
        events_fetched_at: '2026-06-02T10:01:05.000Z',
        cached_at: '2026-06-02T10:01:05.000Z',
        match_status: '1H',
        match_minute: 55,
        freshness: 'fresh',
        degraded: false,
        last_refresh_error: '',
      });
    const upsertProviderFixtureStatsCache = vi.fn().mockResolvedValue(undefined);
    const upsertProviderFixtureEventsCache = vi.fn().mockResolvedValue(undefined);

    const result = await ensureMatchInsight('100', {
      includeStartedDetails: true,
      refreshOdds: false,
    }, {
      now: () => new Date('2026-06-02T10:01:05.000Z'),
      getProviderFixtureCache,
      getProviderFixtureStatsCache,
      getProviderFixtureEventsCache,
      upsertProviderFixtureStatsCache,
      upsertProviderFixtureEventsCache,
    });

    expect(fetchSportmonksSupplementForFixture).toHaveBeenCalledWith(fixture);
    expect(upsertProviderFixtureStatsCache).toHaveBeenCalledWith(expect.objectContaining({
      match_id: '100',
      statistics_payload: sportmonksStats,
      coverage_flags: expect.objectContaining({
        provider: 'sportmonks',
        provider_fixture_id: '19427456',
        fallback_from: 'api-football',
      }),
    }));
    expect(upsertProviderFixtureEventsCache).toHaveBeenCalledWith(expect.objectContaining({
      match_id: '100',
      events_payload: sportmonksEvents,
      coverage_flags: expect.objectContaining({
        provider: 'sportmonks',
        provider_fixture_id: '19427456',
        fallback_from: 'api-football',
      }),
    }));
    expect(result.statistics.provider).toBe('sportmonks');
    expect(result.statistics.payload).toEqual(sportmonksStats);
    expect(result.events.provider).toBe('sportmonks');
    expect(result.events.payload).toEqual(sportmonksEvents);
  });

  test('does not spend Sportmonks calls for empty 0-0 event cache when stats are already present', async () => {
    const fixture = makeFixture('100', '1H');
    fixture.fixture.status.elapsed = 10;
    fixture.goals = { home: 0, away: 0 };
    const apiStats: ApiFixtureStat[] = [{
      team: { id: 1, name: 'Home', logo: '' },
      statistics: [{ type: 'Shots on Goal', value: 1 }],
    }];

    const result = await ensureMatchInsight('100', {
      includeStartedDetails: true,
      refreshOdds: false,
    }, {
      now: () => new Date('2026-06-02T10:01:05.000Z'),
      getProviderFixtureCache: vi.fn().mockResolvedValue({
        match_id: '100',
        fixture_payload: fixture,
        fixture_fetched_at: '2026-06-02T10:01:00.000Z',
        cached_at: '2026-06-02T10:01:00.000Z',
        match_status: '1H',
        match_minute: 10,
        freshness: 'fresh',
        degraded: false,
        last_refresh_error: '',
      }),
      getProviderFixtureStatsCache: vi.fn().mockResolvedValue({
        match_id: '100',
        statistics_payload: apiStats,
        coverage_flags: { team_count: 1, stat_pairs: 1, has_payload: true },
        stats_fetched_at: '2026-06-02T10:01:00.000Z',
        cached_at: '2026-06-02T10:01:00.000Z',
        match_status: '1H',
        match_minute: 10,
        freshness: 'fresh',
        degraded: false,
        last_refresh_error: '',
      }),
      getProviderFixtureEventsCache: vi.fn().mockResolvedValue({
        match_id: '100',
        events_payload: [],
        coverage_flags: { event_count: 0, has_payload: false },
        events_fetched_at: '2026-06-02T10:01:00.000Z',
        cached_at: '2026-06-02T10:01:00.000Z',
        match_status: '1H',
        match_minute: 10,
        freshness: 'fresh',
        degraded: false,
        last_refresh_error: '',
      }),
    });

    expect(fetchSportmonksSupplementForFixture).not.toHaveBeenCalled();
    expect(result.statistics.payload).toEqual(apiStats);
    expect(result.events.payload).toEqual([]);
  });
});
