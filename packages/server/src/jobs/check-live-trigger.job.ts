// ============================================================
// Job: Check Live Matches
// Detects active watchlist matches that are currently live.
// The frontend Live Monitor pipeline handles AI analysis and
// notifications — this job just increments check counts.
// ============================================================

import { config } from '../config.js';
import * as watchlistRepo from '../repos/watchlist.repo.js';
import * as matchRepo from '../repos/matches.repo.js';
import { reportJobProgress } from './job-progress.js';

export async function checkLiveTriggerJob(): Promise<{ liveCount: number }> {
  const JOB = 'check-live-trigger';

  // 1. Get active watchlist match IDs
  await reportJobProgress(JOB, 'load', 'Loading active watchlist...', 15);
  const activeWatchlist = await watchlistRepo.getActiveWatchlist();
  if (activeWatchlist.length === 0) {
    return { liveCount: 0 };
  }
  const activeMatchIds = activeWatchlist.map((w) => w.match_id);

  // 2. Get matches and find live ones
  await reportJobProgress(JOB, 'check', `Checking ${activeMatchIds.length} match statuses...`, 45);
  const matches = await matchRepo.getMatchesByIds(activeMatchIds);
  const statusMap = new Map(matches.map((m) => [m.match_id, m.status]));

  const liveMatchIds = activeMatchIds.filter((id) => {
    const status = statusMap.get(id);
    return status && config.liveStatuses.includes(status);
  });

  if (liveMatchIds.length === 0) {
    return { liveCount: 0 };
  }

  // 3. Increment check count for live watchlist entries
  await reportJobProgress(JOB, 'increment', `Updating ${liveMatchIds.length} live matches...`, 80);
  for (const id of liveMatchIds) {
    await watchlistRepo.incrementChecks(id);
  }

  console.log(`[checkLiveTriggerJob] ${liveMatchIds.length} live matches detected`);
  return { liveCount: liveMatchIds.length };
}
