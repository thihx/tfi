// ============================================================
// Job: Expire Watchlist
// Mirrors: Apps Script checkAndDeleteExpiredMatches()
//
// Sets status='expired' for watchlist entries where
// kickoff + 120 minutes < now.
// ============================================================

import * as watchlistRepo from '../repos/watchlist.repo.js';
import { reportJobProgress } from './job-progress.js';

const EXPIRE_CUTOFF_MINUTES = 120;

export async function expireWatchlistJob(): Promise<{ expired: number }> {
  await reportJobProgress('expire-watchlist', 'expire', 'Checking for expired entries...', 30);
  const expired = await watchlistRepo.expireOldEntries(EXPIRE_CUTOFF_MINUTES);

  if (expired > 0) {
    console.log(`[expireWatchlistJob] ✅ Expired ${expired} watchlist entries`);
  }

  return { expired };
}
