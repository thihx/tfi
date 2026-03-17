// ============================================================
// Unit tests — Check Live Trigger Job
// ============================================================

import { describe, test, expect, vi, beforeEach } from 'vitest';

vi.mock('../lib/redis.js', () => ({
  getRedisClient: () => ({ hget: vi.fn(), hset: vi.fn(), expire: vi.fn(), del: vi.fn() }),
}));

vi.mock('../jobs/job-progress.js', () => ({
  reportJobProgress: vi.fn(),
}));

vi.mock('../config.js', () => ({
  config: { liveStatuses: ['1H', '2H', 'HT', 'ET', 'BT', 'LIVE'] },
}));

const mockWatchlist = [
  { match_id: '100' },
  { match_id: '200' },
  { match_id: '300' },
];

vi.mock('../repos/watchlist.repo.js', () => ({
  getActiveWatchlist: vi.fn().mockResolvedValue(mockWatchlist),
  incrementChecks: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../repos/matches.repo.js', () => ({
  getMatchesByIds: vi.fn().mockResolvedValue([
    { match_id: '100', status: '1H' },  // live
    { match_id: '200', status: 'NS' },  // not started
    { match_id: '300', status: '2H' },  // live
  ]),
}));

const { checkLiveTriggerJob } = await import('../jobs/check-live-trigger.job.js');

beforeEach(() => {
  vi.clearAllMocks();
});

describe('checkLiveTriggerJob', () => {
  test('detects live matches and increments their checks', async () => {
    const result = await checkLiveTriggerJob();
    expect(result).toEqual({ liveCount: 2 });

    const watchlistRepo = await import('../repos/watchlist.repo.js');
    expect(watchlistRepo.incrementChecks).toHaveBeenCalledTimes(2);
    expect(watchlistRepo.incrementChecks).toHaveBeenCalledWith('100');
    expect(watchlistRepo.incrementChecks).toHaveBeenCalledWith('300');
  });

  test('does not increment NS (non-live) matches', async () => {
    await checkLiveTriggerJob();
    const watchlistRepo = await import('../repos/watchlist.repo.js');
    const calledWith = vi.mocked(watchlistRepo.incrementChecks).mock.calls.map((c) => c[0]);
    expect(calledWith).not.toContain('200');
  });

  test('returns 0 when watchlist is empty', async () => {
    const watchlistRepo = await import('../repos/watchlist.repo.js');
    vi.mocked(watchlistRepo.getActiveWatchlist).mockResolvedValueOnce([]);

    const result = await checkLiveTriggerJob();
    expect(result).toEqual({ liveCount: 0 });
  });

  test('returns 0 when no matches are live', async () => {
    const matchRepo = await import('../repos/matches.repo.js');
    vi.mocked(matchRepo.getMatchesByIds).mockResolvedValueOnce([
      { match_id: '100', status: 'NS' },
      { match_id: '200', status: 'NS' },
      { match_id: '300', status: 'FT' },
    ] as never);

    const result = await checkLiveTriggerJob();
    expect(result).toEqual({ liveCount: 0 });
  });

  test('reports progress at each step', async () => {
    await checkLiveTriggerJob();
    const { reportJobProgress } = await import('../jobs/job-progress.js');
    expect(reportJobProgress).toHaveBeenCalledWith('check-live-trigger', 'load', expect.any(String), 15);
    expect(reportJobProgress).toHaveBeenCalledWith('check-live-trigger', 'check', expect.any(String), 45);
    expect(reportJobProgress).toHaveBeenCalledWith('check-live-trigger', 'increment', expect.any(String), 80);
  });
});
