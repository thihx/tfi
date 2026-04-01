import { beforeEach, describe, expect, test, vi } from 'vitest';

vi.mock('../jobs/job-progress.js', () => ({
  reportJobProgress: vi.fn(),
}));

vi.mock('../repos/watchlist.repo.js', () => ({
  backfillOperationalWatchlistFromLegacy: vi.fn().mockResolvedValue(3),
  syncWatchlistDates: vi.fn().mockResolvedValue(5),
}));

const { syncWatchlistMetadataJob } = await import('../jobs/sync-watchlist-metadata.job.js');

beforeEach(() => {
  vi.clearAllMocks();
});

describe('syncWatchlistMetadataJob', () => {
  test('backfills legacy rows and syncs watchlist kickoff metadata', async () => {
    const result = await syncWatchlistMetadataJob();

    expect(result).toEqual({ backfilled: 3, synced: 5 });

    const watchlistRepo = await import('../repos/watchlist.repo.js');
    expect(watchlistRepo.backfillOperationalWatchlistFromLegacy).toHaveBeenCalledTimes(1);
    expect(watchlistRepo.syncWatchlistDates).toHaveBeenCalledTimes(1);
  });
});
