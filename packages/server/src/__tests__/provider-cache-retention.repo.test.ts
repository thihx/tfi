import { beforeEach, describe, expect, test, vi } from 'vitest';

vi.mock('../db/pool.js', () => ({
  query: vi.fn(),
}));

import { query } from '../db/pool.js';
import { purgeProviderOddsCache } from '../repos/provider-odds-cache.repo.js';
import { purgeProviderFixtureCaches } from '../repos/provider-fixture-insight.repo.js';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('provider cache retention repositories', () => {
  test('purgeProviderOddsCache deletes rows older than keepDays', async () => {
    vi.mocked(query).mockResolvedValueOnce({ rowCount: 5 } as never);

    const deleted = await purgeProviderOddsCache(7);

    expect(deleted).toBe(5);
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('DELETE FROM provider_odds_cache'),
      [7],
    );
  });

  test('purgeProviderFixtureCaches deletes each provider fixture cache table', async () => {
    vi.mocked(query)
      .mockResolvedValueOnce({ rowCount: 1 } as never)
      .mockResolvedValueOnce({ rowCount: 2 } as never)
      .mockResolvedValueOnce({ rowCount: 3 } as never)
      .mockResolvedValueOnce({ rowCount: 4 } as never)
      .mockResolvedValueOnce({ rowCount: 5 } as never)
      .mockResolvedValueOnce({ rowCount: 6 } as never);

    const result = await purgeProviderFixtureCaches(7);

    expect(result).toEqual({
      fixtureDeleted: 1,
      statsDeleted: 2,
      eventsDeleted: 3,
      lineupsDeleted: 4,
      predictionDeleted: 5,
      standingsDeleted: 6,
      totalDeleted: 21,
    });
    expect(query).toHaveBeenCalledTimes(6);
    expect(vi.mocked(query).mock.calls[0]?.[0]).toContain('DELETE FROM provider_fixture_cache');
    expect(vi.mocked(query).mock.calls[1]?.[0]).toContain('DELETE FROM provider_fixture_stats_cache');
    expect(vi.mocked(query).mock.calls[2]?.[0]).toContain('DELETE FROM provider_fixture_events_cache');
    expect(vi.mocked(query).mock.calls[3]?.[0]).toContain('DELETE FROM provider_fixture_lineups_cache');
    expect(vi.mocked(query).mock.calls[4]?.[0]).toContain('DELETE FROM provider_fixture_prediction_cache');
    expect(vi.mocked(query).mock.calls[5]?.[0]).toContain('DELETE FROM provider_league_standings_cache');
  });

  test('returns zero counts when keepDays is disabled', async () => {
    const oddsDeleted = await purgeProviderOddsCache(0);
    const fixtureDeleted = await purgeProviderFixtureCaches(0);

    expect(oddsDeleted).toBe(0);
    expect(fixtureDeleted.totalDeleted).toBe(0);
    expect(query).not.toHaveBeenCalled();
  });
});
