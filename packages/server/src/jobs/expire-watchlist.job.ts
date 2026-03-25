// ============================================================
// Job: Expire Watchlist
// Mirrors: Apps Script checkAndDeleteExpiredMatches()
//
// Synchronizes expiry/reactivation status for monitored matches and
// user watch subscriptions when kickoff + 120 minutes < now.
// ============================================================

import * as watchlistRepo from '../repos/watchlist.repo.js';
import { reportJobProgress } from './job-progress.js';

const EXPIRE_CUTOFF_MINUTES = 120;

export async function expireWatchlistJob(): Promise<{ expired: number }> {
  await reportJobProgress('expire-watchlist', 'expire', 'Cleaning up completed watchlist entries...', 30);
  const expired = await watchlistRepo.expireOldEntries(EXPIRE_CUTOFF_MINUTES);

  if (expired > 0) {
    console.log(`[expireWatchlistJob] ✅ Cleaned up ${expired} completed watchlist matches`);
  }

  return { expired };
}
