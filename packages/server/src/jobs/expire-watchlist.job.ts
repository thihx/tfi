// ============================================================
// Job: Expire Watchlist
// Mirrors: Apps Script checkAndDeleteExpiredMatches()
//
// Synchronizes expiry/reactivation status for monitored matches and
// user watch subscriptions when kickoff + 120 minutes < now.
// ============================================================

import * as watchlistRepo from '../repos/watchlist.repo.js';
import { config } from '../config.js';
import { applyLegacyWatchlistCleanup } from '../lib/legacy-watchlist-cleanup.js';
import { reportJobProgress } from './job-progress.js';

const EXPIRE_CUTOFF_MINUTES = 120;

export async function expireWatchlistJob(): Promise<{
  expiredSubscriptions: number;
  refreshedSubscriberCounts: number;
  deletedMonitoredMatches: number;
  totalChanged: number;
  legacyCleanup?: {
    deletedLegacyWatchlistRows: number;
    deletedMonitoredMatches: number;
    matchIds: string[];
  };
}> {
  await reportJobProgress('expire-watchlist', 'expire', 'Cleaning up completed watchlist entries...', 30);
  const result = await watchlistRepo.expireOldEntriesDetailed(EXPIRE_CUTOFF_MINUTES);

  let legacyCleanup: {
    deletedLegacyWatchlistRows: number;
    deletedMonitoredMatches: number;
    matchIds: string[];
  } | undefined;

  if (config.legacyWatchlistCleanupEnabled) {
    await reportJobProgress('expire-watchlist', 'legacy-cleanup', 'Removing stale legacy watchlist rows...', 70);
    legacyCleanup = await applyLegacyWatchlistCleanup();
    if (legacyCleanup.matchIds.length > 0) {
      console.log(
        `[expireWatchlistJob] legacy cleanup legacy=${legacyCleanup.deletedLegacyWatchlistRows} monitored=${legacyCleanup.deletedMonitoredMatches}`,
      );
    }
  }

  if (result.totalChanged > 0) {
    console.log(
      `[expireWatchlistJob] cleaned subscriptions=${result.expiredSubscriptions} monitored=${result.deletedMonitoredMatches}`,
    );
  }

  return legacyCleanup ? { ...result, legacyCleanup } : result;
}
