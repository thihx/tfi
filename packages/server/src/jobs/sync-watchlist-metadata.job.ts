import * as watchlistRepo from '../repos/watchlist.repo.js';
import { reportJobProgress } from './job-progress.js';

export async function syncWatchlistMetadataJob(): Promise<{ backfilled: number; synced: number }> {
  const JOB = 'sync-watchlist-metadata';

  await reportJobProgress(JOB, 'backfill', 'Backfilling operational watchlist metadata...', 10);
  const backfilled = await watchlistRepo.backfillOperationalWatchlistFromLegacy();

  await reportJobProgress(JOB, 'sync', 'Syncing watchlist date and kickoff metadata...', 60);
  const synced = await watchlistRepo.syncWatchlistDates();

  return { backfilled, synced };
}
