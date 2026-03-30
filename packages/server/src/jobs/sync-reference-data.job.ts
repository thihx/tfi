import * as leaguesRepo from '../repos/leagues.repo.js';
import { refreshLeagueCatalog } from '../lib/league-catalog.service.js';
import { refreshLeagueTeamsDirectoryNow } from '../lib/league-team-directory.service.js';
import { reportJobProgress } from './job-progress.js';

const JOB = 'sync-reference-data';
const BATCH_SIZE = 4;

function uniqueLeagueIds(ids: number[]): number[] {
  return [...new Set(ids.filter((id) => Number.isFinite(id) && id > 0))];
}

export async function syncReferenceDataJob(): Promise<{
  entityGroups: string[];
  leagueCatalog: {
    candidateLeagues: number;
    attemptedLeagues: number;
    refreshedLeagues: number;
    skippedFreshLeagues: number;
    failedLeagues: number;
  };
  leagueTeamDirectory: {
    candidateLeagues: number;
    refreshedLeagues: number;
    skippedFreshLeagues: number;
    staleFallbackLeagues: number;
    emptyLeagues: number;
    failedLeagues: number;
    topLeagueCount: number;
    activeLeagueCount: number;
  };
}> {
  const [topLeagues, activeLeagues] = await Promise.all([
    leaguesRepo.getTopLeagues(),
    leaguesRepo.getActiveLeagues(),
  ]);

  const leagueCatalog = await refreshLeagueCatalog({ mode: 'active-top', force: false });

  const orderedIds = uniqueLeagueIds([
    ...topLeagues.map((league) => league.league_id),
    ...activeLeagues.map((league) => league.league_id),
  ]);

  let refreshedLeagues = 0;
  let skippedFreshLeagues = 0;
  let staleFallbackLeagues = 0;
  let emptyLeagues = 0;
  let failedLeagues = 0;

  if (orderedIds.length === 0) {
    await reportJobProgress(JOB, 'complete', 'No active leagues available for reference-data sync.', 100);
    return {
      entityGroups: ['league-catalog', 'league-team-directory'],
      leagueCatalog: {
        candidateLeagues: leagueCatalog.candidateLeagues,
        attemptedLeagues: leagueCatalog.attemptedLeagues,
        refreshedLeagues: leagueCatalog.refreshedLeagues,
        skippedFreshLeagues: leagueCatalog.skippedFreshLeagues,
        failedLeagues: leagueCatalog.failedLeagues,
      },
      leagueTeamDirectory: {
        candidateLeagues: 0,
        refreshedLeagues: 0,
        skippedFreshLeagues: 0,
        staleFallbackLeagues: 0,
        emptyLeagues: 0,
        failedLeagues: 0,
        topLeagueCount: topLeagues.length,
        activeLeagueCount: activeLeagues.length,
      },
    };
  }

  await reportJobProgress(
    JOB,
    'planning',
    `Preparing reference-data sync for ${orderedIds.length} league-team directories. League catalog refreshed=${leagueCatalog.refreshedLeagues}, skipped=${leagueCatalog.skippedFreshLeagues}, failed=${leagueCatalog.failedLeagues}.`,
    5,
  );

  for (let start = 0; start < orderedIds.length; start += BATCH_SIZE) {
    const batch = orderedIds.slice(start, start + BATCH_SIZE);
    const batchResults = await Promise.allSettled(batch.map((leagueId) => refreshLeagueTeamsDirectoryNow(leagueId)));

    for (const result of batchResults) {
      if (result.status === 'fulfilled') {
        switch (result.value.source) {
          case 'provider_refreshed':
          case 'remote_refreshed':
            refreshedLeagues += 1;
            break;
          case 'fresh_cache':
            skippedFreshLeagues += 1;
            break;
          case 'stale_fallback':
            staleFallbackLeagues += 1;
            break;
          case 'empty_provider':
            emptyLeagues += 1;
            break;
        }
      } else {
        failedLeagues += 1;
      }
    }

    const completed = Math.min(start + BATCH_SIZE, orderedIds.length);
    const percent = Math.max(10, Math.round((completed / orderedIds.length) * 100));
    await reportJobProgress(
      JOB,
      'syncing',
      `Synced league-team directory for ${completed}/${orderedIds.length} leagues. Refreshed=${refreshedLeagues}, fresh=${skippedFreshLeagues}, fallback=${staleFallbackLeagues}, empty=${emptyLeagues}, failed=${failedLeagues}.`,
      percent,
    );
  }

  await reportJobProgress(
    JOB,
    'complete',
    `Reference-data sync complete. Refreshed=${refreshedLeagues}, fresh=${skippedFreshLeagues}, fallback=${staleFallbackLeagues}, empty=${emptyLeagues}, failed=${failedLeagues}.`,
    100,
  );

  return {
    entityGroups: ['league-catalog', 'league-team-directory'],
    leagueCatalog: {
      candidateLeagues: leagueCatalog.candidateLeagues,
      attemptedLeagues: leagueCatalog.attemptedLeagues,
      refreshedLeagues: leagueCatalog.refreshedLeagues,
      skippedFreshLeagues: leagueCatalog.skippedFreshLeagues,
      failedLeagues: leagueCatalog.failedLeagues,
    },
    leagueTeamDirectory: {
      candidateLeagues: orderedIds.length,
      refreshedLeagues,
      skippedFreshLeagues,
      staleFallbackLeagues,
      emptyLeagues,
      failedLeagues,
      topLeagueCount: topLeagues.length,
      activeLeagueCount: activeLeagues.length,
    },
  };
}
