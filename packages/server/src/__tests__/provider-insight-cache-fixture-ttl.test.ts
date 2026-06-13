import { describe, expect, test, vi } from 'vitest';
import { ensureFixturesForMatchIds } from '../lib/provider-insight-cache.js';
import type { ApiFixture } from '../lib/football-api.js';

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

describe('ensureFixturesForMatchIds fixture TTL override', () => {
  test('refreshes stale live fixture cache with stale_safe when fixtureTtlMs is exceeded', async () => {
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
