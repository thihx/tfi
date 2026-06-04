import * as leaguesRepo from '../repos/leagues.repo.js';
import { config } from '../config.js';
import { skipIfFootballApiCircuitOpen } from '../lib/football-api-circuit.js';
import { refreshLeagueCatalog } from '../lib/league-catalog.service.js';
import { refreshLeagueTeamsDirectoryNow } from '../lib/league-team-directory.service.js';
import { syncDerivedPrematchProfiles } from '../lib/prematch-profile-sync.js';
import { classifyTacticalOverlayCompetition } from '../lib/tactical-overlay-eligibility.js';
import { reportJobProgress } from './job-progress.js';

const JOB = 'sync-reference-data';
const BATCH_SIZE = 4;

interface ReferenceDataLeagueScope {
  directoryLeagueIds: number[];
  profileActiveLeagues: Awaited<ReturnType<typeof leaguesRepo.getActiveLeagues>>;
  excludedNoRecentSignal: number;
  favoriteSignalLeagues: number;
  currentMatchSignalLeagues: number;
  recentHistorySignalLeagues: number;
}

function uniqueLeagueIds(ids: number[]): number[] {
  return [...new Set(ids.filter((id) => Number.isFinite(id) && id > 0))];
}

async function resolveReferenceDataLeagueScope(
  topLeagues: Awaited<ReturnType<typeof leaguesRepo.getTopLeagues>>,
  activeLeagues: Awaited<ReturnType<typeof leaguesRepo.getActiveLeagues>>,
): Promise<ReferenceDataLeagueScope> {
  const topIds = new Set(topLeagues.map((league) => league.league_id));
  const activeIds = uniqueLeagueIds(activeLeagues.map((league) => league.league_id));
  const activity = await leaguesRepo.getReferenceDataLeagueActivity(
    uniqueLeagueIds([...topIds, ...activeIds]),
    config.syncReferenceDataRecentHistoryDays,
  );

  let excludedNoRecentSignal = 0;
  let favoriteSignalLeagues = 0;
  let currentMatchSignalLeagues = 0;
  let recentHistorySignalLeagues = 0;

  const usefulActiveLeagues = activeLeagues.filter((league) => {
    if (topIds.has(league.league_id)) return true;
    const row = activity.get(league.league_id);
    const hasCurrentMatch = (row?.current_matches ?? 0) > 0;
    const hasRecentHistory = (row?.recent_history_matches ?? 0) > 0;
    const hasFavoriteSignal = (row?.favorite_team_count ?? 0) > 0;
    if (hasCurrentMatch) currentMatchSignalLeagues += 1;
    if (hasRecentHistory) recentHistorySignalLeagues += 1;
    if (hasFavoriteSignal) favoriteSignalLeagues += 1;
    if (hasCurrentMatch || hasRecentHistory || hasFavoriteSignal) return true;
    excludedNoRecentSignal += 1;
    return false;
  });

  return {
    directoryLeagueIds: uniqueLeagueIds([
      ...topLeagues.map((league) => league.league_id),
      ...usefulActiveLeagues.map((league) => league.league_id),
    ]),
    profileActiveLeagues: usefulActiveLeagues,
    excludedNoRecentSignal,
    favoriteSignalLeagues,
    currentMatchSignalLeagues,
    recentHistorySignalLeagues,
  };
}

function getApprovedPrematchProfileLeagueIds(
  topLeagues: Awaited<ReturnType<typeof leaguesRepo.getTopLeagues>>,
  activeLeagues: Awaited<ReturnType<typeof leaguesRepo.getActiveLeagues>>,
): number[] {
  const approvedActiveLeagueIds = activeLeagues
    .filter((league) =>
      classifyTacticalOverlayCompetition({
        leagueName: league.league_name,
        country: league.country,
        type: league.type,
        topLeague: league.top_league,
      }).eligible,
    )
    .map((league) => league.league_id);

  return uniqueLeagueIds([
    ...topLeagues.map((league) => league.league_id),
    ...approvedActiveLeagueIds,
  ]);
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
    directoryScopeExcludedLeagues: number;
    profileScopeExcludedLeagues: number;
    excludedNoRecentSignal: number;
    favoriteSignalLeagues: number;
    currentMatchSignalLeagues: number;
    recentHistorySignalLeagues: number;
  };
  prematchProfiles: {
    lookbackDays: number;
    candidateLeagues: number;
    refreshedLeagueProfiles: number;
    skippedLeagueProfiles: number;
    candidateTeams: number;
    refreshedTeamProfiles: number;
    skippedTeamProfiles: number;
  };
  skipped?: boolean;
  skipReason?: string;
  openUntil?: string;
}> {
  const circuitSkip = await skipIfFootballApiCircuitOpen();
  if (circuitSkip) {
    await reportJobProgress(JOB, 'skipped', `Football API daily limit until ${circuitSkip.openUntil}`, 100);
    return {
      entityGroups: [],
      leagueCatalog: {
        candidateLeagues: 0,
        attemptedLeagues: 0,
        refreshedLeagues: 0,
        skippedFreshLeagues: 0,
        failedLeagues: 0,
      },
      leagueTeamDirectory: {
        candidateLeagues: 0,
        refreshedLeagues: 0,
        skippedFreshLeagues: 0,
        staleFallbackLeagues: 0,
        emptyLeagues: 0,
        failedLeagues: 0,
        topLeagueCount: 0,
        activeLeagueCount: 0,
        directoryScopeExcludedLeagues: 0,
        profileScopeExcludedLeagues: 0,
        excludedNoRecentSignal: 0,
        favoriteSignalLeagues: 0,
        currentMatchSignalLeagues: 0,
        recentHistorySignalLeagues: 0,
      },
      prematchProfiles: {
        lookbackDays: 0,
        candidateLeagues: 0,
        refreshedLeagueProfiles: 0,
        skippedLeagueProfiles: 0,
        candidateTeams: 0,
        refreshedTeamProfiles: 0,
        skippedTeamProfiles: 0,
      },
      ...circuitSkip,
    };
  }

  const [topLeagues, activeLeagues] = await Promise.all([
    leaguesRepo.getTopLeagues(),
    leaguesRepo.getActiveLeagues(),
  ]);

  const leagueCatalog = await refreshLeagueCatalog({ mode: 'active-top', force: false });
  const leagueScope = await resolveReferenceDataLeagueScope(topLeagues, activeLeagues);

  const orderedIds = leagueScope.directoryLeagueIds;

  let refreshedLeagues = 0;
  let skippedFreshLeagues = 0;
  let staleFallbackLeagues = 0;
  let emptyLeagues = 0;
  let failedLeagues = 0;

  if (orderedIds.length === 0) {
    await reportJobProgress(JOB, 'complete', 'No active leagues available for reference-data sync.', 100);
    return {
      entityGroups: ['league-catalog', 'league-team-directory', 'prematch-profiles'],
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
        directoryScopeExcludedLeagues: leagueScope.excludedNoRecentSignal,
        profileScopeExcludedLeagues: activeLeagues.length - leagueScope.profileActiveLeagues.length,
        excludedNoRecentSignal: leagueScope.excludedNoRecentSignal,
        favoriteSignalLeagues: leagueScope.favoriteSignalLeagues,
        currentMatchSignalLeagues: leagueScope.currentMatchSignalLeagues,
        recentHistorySignalLeagues: leagueScope.recentHistorySignalLeagues,
      },
      prematchProfiles: {
        lookbackDays: 180,
        candidateLeagues: 0,
        refreshedLeagueProfiles: 0,
        skippedLeagueProfiles: 0,
        candidateTeams: 0,
        refreshedTeamProfiles: 0,
        skippedTeamProfiles: 0,
      },
    };
  }

  await reportJobProgress(
    JOB,
    'planning',
    `Preparing reference-data sync for ${orderedIds.length}/${activeLeagues.length} active league-team directories. Excluded no-signal=${leagueScope.excludedNoRecentSignal}. League catalog refreshed=${leagueCatalog.refreshedLeagues}, skipped=${leagueCatalog.skippedFreshLeagues}, failed=${leagueCatalog.failedLeagues}.`,
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

  const prematchProfileLeagueIds = getApprovedPrematchProfileLeagueIds(topLeagues, leagueScope.profileActiveLeagues);
  const prematchProfiles = await syncDerivedPrematchProfiles(prematchProfileLeagueIds);

  await reportJobProgress(
    JOB,
    'profiles',
    `Derived prematch profiles. Leagues refreshed=${prematchProfiles.refreshedLeagueProfiles}, skipped=${prematchProfiles.skippedLeagueProfiles}; teams refreshed=${prematchProfiles.refreshedTeamProfiles}, skipped=${prematchProfiles.skippedTeamProfiles}.`,
    98,
  );

  await reportJobProgress(
    JOB,
    'complete',
    `Reference-data sync complete. Refreshed=${refreshedLeagues}, fresh=${skippedFreshLeagues}, fallback=${staleFallbackLeagues}, empty=${emptyLeagues}, failed=${failedLeagues}. Prematch profiles refreshed=${prematchProfiles.refreshedLeagueProfiles}/${prematchProfiles.refreshedTeamProfiles}.`,
    100,
  );

  return {
    entityGroups: ['league-catalog', 'league-team-directory', 'prematch-profiles'],
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
      directoryScopeExcludedLeagues: leagueScope.excludedNoRecentSignal,
      profileScopeExcludedLeagues: activeLeagues.length - leagueScope.profileActiveLeagues.length,
      excludedNoRecentSignal: leagueScope.excludedNoRecentSignal,
      favoriteSignalLeagues: leagueScope.favoriteSignalLeagues,
      currentMatchSignalLeagues: leagueScope.currentMatchSignalLeagues,
      recentHistorySignalLeagues: leagueScope.recentHistorySignalLeagues,
    },
    prematchProfiles,
  };
}

export const __testables__ = {
  resolveReferenceDataLeagueScope,
};
