// ============================================================
// Football API Service Tests
// Tests fetchFixturesBatch, fetchAllFixtures, fetchFixtureOdds
// ============================================================

import { describe, test, expect, vi, beforeEach } from 'vitest';

vi.mock('../services/proxy.service', () => ({
  fetchLiveFixtures: vi.fn(),
  fetchLiveOdds: vi.fn(),
}));

import { fetchFixturesBatch, fetchAllFixtures, fetchFixtureOdds } from '../services/football-api.service';
import { fetchLiveFixtures, fetchLiveOdds } from '../services/proxy.service';
import { createAppConfig, createFootballApiFixture, createOddsResponse } from './fixtures';

const appConfig = createAppConfig();

beforeEach(() => {
  vi.resetAllMocks();
});

describe('fetchFixturesBatch', () => {
  test('calls fetchLiveFixtures with batch match_ids', async () => {
    const fixture = createFootballApiFixture();
    (fetchLiveFixtures as ReturnType<typeof vi.fn>).mockResolvedValue([fixture]);

    const result = await fetchFixturesBatch(appConfig, { match_ids: ['111', '222'] });

    expect(fetchLiveFixtures).toHaveBeenCalledWith(appConfig, ['111', '222']);
    expect(result).toEqual([fixture]);
  });

  test('returns empty array when API returns empty', async () => {
    (fetchLiveFixtures as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    const result = await fetchFixturesBatch(appConfig, { match_ids: ['999'] });
    expect(result).toEqual([]);
  });

  test('propagates errors', async () => {
    (fetchLiveFixtures as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('API down'));
    await expect(fetchFixturesBatch(appConfig, { match_ids: ['111'] })).rejects.toThrow('API down');
  });
});

describe('fetchAllFixtures', () => {
  test('fetches single batch', async () => {
    const fixture = createFootballApiFixture();
    (fetchLiveFixtures as ReturnType<typeof vi.fn>).mockResolvedValue([fixture]);

    const result = await fetchAllFixtures(appConfig, [{ match_ids: ['111'] }]);

    expect(fetchLiveFixtures).toHaveBeenCalledTimes(1);
    expect(result).toEqual([fixture]);
  });

  test('fetches multiple batches sequentially', async () => {
    const f1 = createFootballApiFixture({ fixture: { ...createFootballApiFixture().fixture, id: 1 } });
    const f2 = createFootballApiFixture({ fixture: { ...createFootballApiFixture().fixture, id: 2 } });

    (fetchLiveFixtures as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce([f1])
      .mockResolvedValueOnce([f2]);

    const result = await fetchAllFixtures(appConfig, [
      { match_ids: ['1'] },
      { match_ids: ['2'] },
    ]);

    expect(fetchLiveFixtures).toHaveBeenCalledTimes(2);
    expect(result).toHaveLength(2);
    expect(result[0]!.fixture.id).toBe(1);
    expect(result[1]!.fixture.id).toBe(2);
  });

  test('handles empty batches array', async () => {
    const result = await fetchAllFixtures(appConfig, []);
    expect(result).toEqual([]);
    expect(fetchLiveFixtures).not.toHaveBeenCalled();
  });

  test('concatenates all fixtures from all batches', async () => {
    (fetchLiveFixtures as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce([
        createFootballApiFixture({ fixture: { ...createFootballApiFixture().fixture, id: 10 } }),
        createFootballApiFixture({ fixture: { ...createFootballApiFixture().fixture, id: 11 } }),
      ])
      .mockResolvedValueOnce([
        createFootballApiFixture({ fixture: { ...createFootballApiFixture().fixture, id: 20 } }),
      ]);

    const result = await fetchAllFixtures(appConfig, [
      { match_ids: ['10', '11'] },
      { match_ids: ['20'] },
    ]);

    expect(result).toHaveLength(3);
  });

  test('stops on first batch error', async () => {
    (fetchLiveFixtures as ReturnType<typeof vi.fn>)
      .mockRejectedValueOnce(new Error('Rate limited'));

    await expect(
      fetchAllFixtures(appConfig, [{ match_ids: ['1'] }, { match_ids: ['2'] }]),
    ).rejects.toThrow('Rate limited');

    expect(fetchLiveFixtures).toHaveBeenCalledTimes(1);
  });
});

describe('fetchFixtureOdds', () => {
  test('calls fetchLiveOdds with matchId', async () => {
    const odds = createOddsResponse();
    (fetchLiveOdds as ReturnType<typeof vi.fn>).mockResolvedValue(odds);

    const result = await fetchFixtureOdds(appConfig, '12345');

    expect(fetchLiveOdds).toHaveBeenCalledWith(appConfig, '12345', undefined, undefined);
    expect(result).toEqual(odds);
  });

  test('passes team names when provided', async () => {
    const odds = createOddsResponse();
    (fetchLiveOdds as ReturnType<typeof vi.fn>).mockResolvedValue(odds);

    const result = await fetchFixtureOdds(appConfig, '12345', 'Arsenal', 'Chelsea');

    expect(fetchLiveOdds).toHaveBeenCalledWith(appConfig, '12345', 'Arsenal', 'Chelsea');
    expect(result).toEqual(odds);
  });

  test('propagates errors', async () => {
    (fetchLiveOdds as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('429'));
    await expect(fetchFixtureOdds(appConfig, '999')).rejects.toThrow('429');
  });
});
