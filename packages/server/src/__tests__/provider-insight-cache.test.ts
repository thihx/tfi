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
});
