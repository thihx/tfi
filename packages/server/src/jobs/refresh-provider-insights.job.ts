import { config } from '../config.js';
import { getMatchesByStatus } from '../repos/matches.repo.js';
import { getActiveOperationalWatchlist } from '../repos/watchlist.repo.js';
import { refreshProviderInsightsForMatches } from '../lib/provider-insight-cache.js';
import { reportJobProgress } from './job-progress.js';

const LIVE_STATUSES = ['1H', '2H', 'HT', 'ET', 'BT', 'P', 'LIVE', 'INT'];

export async function refreshProviderInsightsJob(): Promise<{
  candidates: number;
  fixtureCached: number;
  detailRefreshed: number;
  oddsRefreshed: number;
}> {
  const job = 'refresh-provider-insights';
  await reportJobProgress(job, 'load', 'Loading live and watched matches...', 10);

  const [liveMatches, watchlist] = await Promise.all([
    getMatchesByStatus(LIVE_STATUSES),
    getActiveOperationalWatchlist(),
  ]);

  const candidateIds = Array.from(new Set([
    ...liveMatches.map((row) => String(row.match_id)),
    ...watchlist.map((row) => String(row.match_id)),
  ]));

  if (candidateIds.length === 0 || config.jobRefreshProviderInsightsMs === 0) {
    await reportJobProgress(job, 'skip', 'No active insight candidates', 100);
    return { candidates: 0, fixtureCached: 0, detailRefreshed: 0, oddsRefreshed: 0 };
  }

  await reportJobProgress(job, 'refresh', `Refreshing provider insights for ${candidateIds.length} matches...`, 50);
  const result = await refreshProviderInsightsForMatches(candidateIds);
  await reportJobProgress(job, 'complete', 'Provider insights refreshed', 100);
  return result;
}