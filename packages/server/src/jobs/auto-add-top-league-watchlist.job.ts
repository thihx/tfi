import * as leagueRepo from '../repos/leagues.repo.js';
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

export async function autoAddTopLeagueWatchlistJob(): Promise<{
  candidates: number;
  added: number;
  skippedExisting: number;
}> {
  const JOB = 'auto-add-top-league-watchlist';

  await reportJobProgress(JOB, 'load', 'Loading top leagues and match candidates...', 10);
  const [allMatches, topLeagues] = await Promise.all([
    matchRepo.getAllMatches(),
    leagueRepo.getTopLeagues(),
  ]);

  if (topLeagues.length === 0) {
    return { candidates: 0, added: 0, skippedExisting: 0 };
  }

  const topLeagueIds = new Set(topLeagues.map((league) => league.league_id));
  const candidates = allMatches.filter((match) => topLeagueIds.has(match.league_id) && match.status === 'NS');
  if (candidates.length === 0) {
    return { candidates: 0, added: 0, skippedExisting: 0 };
  }

  await reportJobProgress(JOB, 'existing', `Checking ${candidates.length} existing watchlist entries...`, 35);
  const existingIds = await watchlistRepo.getExistingWatchlistMatchIds(candidates.map((match) => match.match_id));
  const autoApplyCache = new Map<string, boolean>();
  const autoApplyRecommendedCondition = await getAutoApplyRecommendedCondition(autoApplyCache);

  let added = 0;
  let skippedExisting = 0;
  let index = 0;
  for (const match of candidates) {
    index++;
    await reportJobProgress(
      JOB,
      'create',
      `Auto-adding top league match ${index}/${candidates.length}: ${match.home_team} vs ${match.away_team}`,
      35 + (index / candidates.length) * 60,
    );
    if (existingIds.has(match.match_id)) {
      skippedExisting++;
      continue;
    }

    try {
      await watchlistRepo.createOperationalWatchlistEntry(
        buildAutoWatchlistEntry(match, autoApplyRecommendedCondition, 'top-league-auto'),
      );
      added++;
      existingIds.add(match.match_id);
    } catch (err) {
      if (isUniqueConflict(err)) {
        skippedExisting++;
        existingIds.add(match.match_id);
        continue;
      }
      throw err;
    }
  }

  return { candidates: candidates.length, added, skippedExisting };
}
