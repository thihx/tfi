// ============================================================
// Unit tests — Expire Watchlist Job
// ============================================================

import { describe, test, expect, vi, beforeEach } from 'vitest';

vi.mock('../lib/redis.js', () => ({
  getRedisClient: () => ({ hget: vi.fn(), hset: vi.fn(), expire: vi.fn(), del: vi.fn() }),
}));

vi.mock('../jobs/job-progress.js', () => ({
  reportJobProgress: vi.fn(),
}));

vi.mock('../repos/watchlist.repo.js', () => ({
  expireOldEntriesDetailed: vi.fn().mockResolvedValue({
    expiredSubscriptions: 3,
    refreshedSubscriberCounts: 2,
    deletedMonitoredMatches: 1,
    totalChanged: 3,
  }),
}));

const { expireWatchlistJob } = await import('../jobs/expire-watchlist.job.js');

beforeEach(() => {
  vi.clearAllMocks();
});

describe('expireWatchlistJob', () => {
  test('expires entries older than 120 minutes', async () => {
    const result = await expireWatchlistJob();
    expect(result).toEqual({
      expiredSubscriptions: 3,
      refreshedSubscriberCounts: 2,
      deletedMonitoredMatches: 1,
      totalChanged: 3,
    });

    const repo = await import('../repos/watchlist.repo.js');
    expect(repo.expireOldEntriesDetailed).toHaveBeenCalledWith(120);
  });

  test('reports 0 when nothing to expire', async () => {
    const repo = await import('../repos/watchlist.repo.js');
    vi.mocked(repo.expireOldEntriesDetailed).mockResolvedValueOnce({
      expiredSubscriptions: 0,
      refreshedSubscriberCounts: 0,
      deletedMonitoredMatches: 0,
      totalChanged: 0,
    });

    const result = await expireWatchlistJob();
    expect(result.totalChanged).toBe(0);
  });

  test('reports progress', async () => {
    await expireWatchlistJob();
    const { reportJobProgress } = await import('../jobs/job-progress.js');
    expect(reportJobProgress).toHaveBeenCalledWith('expire-watchlist', 'expire', expect.any(String), 30);
  });
});
