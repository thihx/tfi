import type { ApiFixture } from './football-api.js';
import { ensureFixturesForMatchIds } from './provider-insight-cache.js';
import {
  extractRegularTimeScoreFromFixture,
  requiresRegularTimeBreakdown,
} from './settle-context.js';
import type { RegulationScore } from './settle-types.js';
import { kickoffAtUtcFromFixtureDate } from './kickoff-time.js';
import * as matchHistoryRepo from '../repos/matches-history.repo.js';
import type { MatchHistoryArchiveInput, MatchHistoryRow } from '../repos/matches-history.repo.js';

export const FINISHED_SETTLEMENT_STATUSES = new Set(['FT', 'AET', 'PEN', 'AWD', 'WO']);

export function buildHistoricalArchiveRowFromFixture(fx: ApiFixture): MatchHistoryArchiveInput {
  const regularTimeScore = extractRegularTimeScoreFromFixture(fx);
  return {
    match_id: String(fx.fixture.id),
    date: fx.fixture.date?.substring(0, 10) ?? '',
    kickoff: fx.fixture.date?.substring(11, 16) ?? '00:00',
    kickoff_at_utc: kickoffAtUtcFromFixtureDate(fx.fixture.date),
    league_id: fx.league?.id ?? 0,
    league_name: fx.league?.name ?? '',
    home_team_id: fx.teams?.home?.id ?? null,
    home_team: fx.teams?.home?.name ?? '',
    away_team_id: fx.teams?.away?.id ?? null,
    away_team: fx.teams?.away?.name ?? '',
    venue: fx.fixture.venue?.name ?? 'TBD',
    final_status: fx.fixture.status?.short ?? '',
    home_score: fx.goals?.home ?? 0,
    away_score: fx.goals?.away ?? 0,
    regular_home_score: regularTimeScore?.home ?? null,
    regular_away_score: regularTimeScore?.away ?? null,
    result_provider: 'api-football',
    settlement_stats: [],
    settlement_stats_provider: '',
  };
}

export async function fetchRegularTimeScoresForHistoryMatches(
  historyMap: Map<string, MatchHistoryRow>,
  logPrefix: string,
): Promise<Map<string, RegulationScore>> {
  const scoreMap = new Map<string, RegulationScore>();
  const idsNeedingLookup = Array.from(historyMap.values())
    .filter((hist) => requiresRegularTimeBreakdown(hist.final_status))
    .filter((hist) => {
      if (typeof hist.regular_home_score === 'number' && typeof hist.regular_away_score === 'number') {
        scoreMap.set(hist.match_id, {
          home: hist.regular_home_score,
          away: hist.regular_away_score,
        });
        return false;
      }
      return true;
    })
    .map((hist) => hist.match_id);

  const uniqueIds = [...new Set(idsNeedingLookup.filter(Boolean))];
  if (uniqueIds.length === 0) return scoreMap;

  let fixtures: ApiFixture[] = [];
  try {
    fixtures = await ensureFixturesForMatchIds(uniqueIds);
  } catch (err) {
    console.warn(`[${logPrefix}] Failed to fetch regular-time scores:`, err instanceof Error ? err.message : err);
    return scoreMap;
  }

  for (const fx of fixtures) {
    const regularTimeScore = extractRegularTimeScoreFromFixture(fx);
    if (!regularTimeScore) continue;
    const matchId = String(fx.fixture.id);
    scoreMap.set(matchId, regularTimeScore);
    await matchHistoryRepo.updateHistoricalMatchSettlementData(matchId, {
      regular_home_score: regularTimeScore.home,
      regular_away_score: regularTimeScore.away,
      result_provider: 'api-football',
    });
  }

  return scoreMap;
}

export async function hydrateMissingFinishedResults(
  missingIds: string[],
  historyMap: Map<string, MatchHistoryRow>,
  logPrefix: string,
): Promise<Map<string, RegulationScore>> {
  const regularTimeScores = new Map<string, RegulationScore>();
  const uniqueIds = [...new Set(missingIds.filter(Boolean))];
  if (uniqueIds.length === 0) return regularTimeScores;

  let fixtures: ApiFixture[];
  try {
    fixtures = await ensureFixturesForMatchIds(uniqueIds);
  } catch (err) {
    console.warn(`[${logPrefix}] Football API fallback failed:`, err instanceof Error ? err.message : err);
    return regularTimeScores;
  }

  for (const fx of fixtures) {
    const matchId = String(fx.fixture.id);
    const status = fx.fixture.status?.short ?? '';
    if (!FINISHED_SETTLEMENT_STATUSES.has(status)) continue;

    const regularTimeScore = extractRegularTimeScoreFromFixture(fx);
    if (regularTimeScore) {
      regularTimeScores.set(matchId, regularTimeScore);
    }

    const archiveRow = buildHistoricalArchiveRowFromFixture(fx);
    try {
      await matchHistoryRepo.archiveFinishedMatches([archiveRow]);
    } catch (err) {
      console.warn(`[${logPrefix}] Failed to archive match ${matchId}:`, err instanceof Error ? err.message : err);
    }

    historyMap.set(matchId, {
      ...archiveRow,
      archived_at: new Date().toISOString(),
    });
  }

  return regularTimeScores;
}
