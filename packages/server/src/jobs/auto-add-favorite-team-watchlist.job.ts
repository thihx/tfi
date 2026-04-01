import { getFavoriteTeamOwnersByTeamIds } from '../repos/favorite-teams.repo.js';
import * as matchRepo from '../repos/matches.repo.js';
import * as watchlistRepo from '../repos/watchlist.repo.js';
import { reportJobProgress } from './job-progress.js';
import {
  buildAutoWatchlistEntry,
  getAutoApplyRecommendedCondition,
} from './watchlist-side-effects.shared.js';

function isUniqueConflict(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return message.includes('duplicate') || message.includes('unique');
}

export async function autoAddFavoriteTeamWatchlistJob(): Promise<{
  candidateMatches: number;
  targetUsers: number;
  added: number;
  skippedExisting: number;
}> {
  const JOB = 'auto-add-favorite-team-watchlist';

  await reportJobProgress(JOB, 'load', 'Loading favorite-team watchlist candidates...', 10);
  const allMatches = await matchRepo.getAllMatches();
  const candidateMatches = allMatches.filter((match) =>
    match.status === 'NS' && (match.home_team_id != null || match.away_team_id != null),
  );

  if (candidateMatches.length === 0) {
    return { candidateMatches: 0, targetUsers: 0, added: 0, skippedExisting: 0 };
  }

  const teamIds = Array.from(new Set(candidateMatches.flatMap((match) => [
    match.home_team_id != null ? String(match.home_team_id) : null,
    match.away_team_id != null ? String(match.away_team_id) : null,
  ].filter((teamId): teamId is string => teamId != null))));

  const favoriteTeamOwners = await getFavoriteTeamOwnersByTeamIds(teamIds);
  if (favoriteTeamOwners.length === 0) {
    return { candidateMatches: candidateMatches.length, targetUsers: 0, added: 0, skippedExisting: 0 };
  }

  const favoriteOwnersByTeamId = new Map<string, Set<string>>();
  for (const owner of favoriteTeamOwners) {
    const current = favoriteOwnersByTeamId.get(owner.teamId) ?? new Set<string>();
    current.add(owner.userId);
    favoriteOwnersByTeamId.set(owner.teamId, current);
  }

  const candidateMatchIdsByUserId = new Map<string, Set<string>>();
  const userIdsByMatchId = new Map<string, Set<string>>();
  for (const match of candidateMatches) {
    const matchingUserIds = new Set<string>();
    if (match.home_team_id != null) {
      for (const userId of favoriteOwnersByTeamId.get(String(match.home_team_id)) ?? []) {
        matchingUserIds.add(userId);
      }
    }
    if (match.away_team_id != null) {
      for (const userId of favoriteOwnersByTeamId.get(String(match.away_team_id)) ?? []) {
        matchingUserIds.add(userId);
      }
    }
    if (matchingUserIds.size === 0) continue;
    userIdsByMatchId.set(match.match_id, matchingUserIds);
    for (const userId of matchingUserIds) {
      const matchIds = candidateMatchIdsByUserId.get(userId) ?? new Set<string>();
      matchIds.add(match.match_id);
      candidateMatchIdsByUserId.set(userId, matchIds);
    }
  }

  const existingFavoriteIdsByUserId = new Map<string, Set<string>>();
  for (const [userId, matchIds] of candidateMatchIdsByUserId) {
    existingFavoriteIdsByUserId.set(
      userId,
      await watchlistRepo.getExistingUserWatchlistMatchIds(userId, [...matchIds]),
    );
  }

  const autoApplyCache = new Map<string, boolean>();
  let added = 0;
  let skippedExisting = 0;
  let index = 0;
  const actionableMatches = candidateMatches.filter((match) => userIdsByMatchId.has(match.match_id));

  for (const match of actionableMatches) {
    index++;
    await reportJobProgress(
      JOB,
      'create',
      `Auto-adding favorite team match ${index}/${actionableMatches.length}: ${match.home_team} vs ${match.away_team}`,
      25 + (index / actionableMatches.length) * 70,
    );
    for (const userId of userIdsByMatchId.get(match.match_id) ?? []) {
      const existingIds = existingFavoriteIdsByUserId.get(userId) ?? new Set<string>();
      if (existingIds.has(match.match_id)) {
        skippedExisting++;
        continue;
      }

      const autoApplyRecommendedCondition = await getAutoApplyRecommendedCondition(
        autoApplyCache,
        userId,
        { fallbackToDefault: false },
      );

      try {
        await watchlistRepo.createWatchlistEntry(
          buildAutoWatchlistEntry(match, autoApplyRecommendedCondition, 'favorite-team-auto'),
          userId,
        );
        existingIds.add(match.match_id);
        existingFavoriteIdsByUserId.set(userId, existingIds);
        added++;
      } catch (err) {
        if (isUniqueConflict(err)) {
          existingIds.add(match.match_id);
          existingFavoriteIdsByUserId.set(userId, existingIds);
          skippedExisting++;
          continue;
        }
        throw err;
      }
    }
  }

  return {
    candidateMatches: candidateMatches.length,
    targetUsers: candidateMatchIdsByUserId.size,
    added,
    skippedExisting,
  };
}
