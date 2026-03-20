// ============================================================
// Job: Re-Evaluate — Re-check all settled results using AI
//
// 1. Fetch all non-duplicate recommendations (settled + unsettled)
// 2. Look up final scores from matches_history + Football API
// 3. Use AI to re-evaluate all results with match data + statistics
// 4. Compare with existing result, log & fix discrepancies
// 5. Sync ai_performance
// ============================================================

import { query } from '../db/pool.js';
import { settleMatch, type AISettleResult, batchRun } from './auto-settle.job.js';
import * as recommendationsRepo from '../repos/recommendations.repo.js';
import * as matchHistoryRepo from '../repos/matches-history.repo.js';
import * as aiPerfRepo from '../repos/ai-performance.repo.js';
import type { MatchHistoryRow } from '../repos/matches-history.repo.js';
import { fetchFixturesByIds, fetchFixtureStatistics, type ApiFixture } from '../lib/football-api.js';
import { normalizeMarket } from '../lib/normalize-market.js';
import {
  extractRegularTimeScoreFromFixture,
  isNonStandardFinalStatus,
  requiresRegularTimeBreakdown,
  resolveSettlementScore,
} from '../lib/settle-context.js';
import { settlementWasCorrect, type RegulationScore } from '../lib/settle-types.js';

export interface ReEvalResult {
  total: number;
  evaluated: number;
  corrected: number;
  newlySettled: number;
  skippedNoScore: number;
  discrepancies: Array<{
    id: number;
    matchId: string;
    selection: string;
    market: string;
    score: string;
    oldResult: string;
    oldPnl: number;
    newResult: string;
    newPnl: number;
  }>;
}

export async function reEvaluateAllResults(): Promise<ReEvalResult> {
  const result: ReEvalResult = {
    total: 0,
    evaluated: 0,
    corrected: 0,
    newlySettled: 0,
    skippedNoScore: 0,
    discrepancies: [],
  };

  // Step 1: Get ALL non-duplicate recommendations
  const allRecs = await query<recommendationsRepo.RecommendationRow>(
    `SELECT * FROM recommendations WHERE result != 'duplicate' ORDER BY id`,
  );
  result.total = allRecs.rows.length;

  // Step 2: Collect all unique match IDs and fetch scores — single batch query
  const matchIds = [...new Set(allRecs.rows.map((r) => r.match_id))];
  const historyMap = await matchHistoryRepo.getHistoricalMatchesBatch(matchIds);
  const regularTimeScoreMap = await fetchRegularTimeScoresForHistoryMatches(historyMap);

  // Step 3: Football API fallback for matches not in history — batch by 20
  const missingIds = matchIds.filter((id) => !historyMap.has(id));
  if (missingIds.length > 0) {
    const batchSize = 20;
    for (let i = 0; i < missingIds.length; i += batchSize) {
      const batch = missingIds.slice(i, i + batchSize);
      try {
        const fixtures = await fetchFixturesByIds(batch);
        const FINISHED = new Set(['FT', 'AET', 'PEN', 'AWD', 'WO']);
        for (const fx of fixtures) {
          const mId = String(fx.fixture.id);
          const status = fx.fixture.status?.short ?? '';
          if (!FINISHED.has(status)) continue;

          const regularTimeScore = extractRegularTimeScoreFromFixture(fx);
          if (regularTimeScore) {
            regularTimeScoreMap.set(mId, regularTimeScore);
          }

          const homeScore = fx.goals?.home ?? 0;
          const awayScore = fx.goals?.away ?? 0;

          // Archive for future
          try {
            await matchHistoryRepo.archiveFinishedMatches([{
              match_id: mId,
              date: fx.fixture.date?.substring(0, 10) ?? '',
              kickoff: fx.fixture.date?.substring(11, 16) ?? '00:00',
              league_id: fx.league?.id ?? 0,
              league_name: fx.league?.name ?? '',
              home_team: fx.teams?.home?.name ?? '',
              away_team: fx.teams?.away?.name ?? '',
              venue: fx.fixture.venue?.name ?? 'TBD',
              status,
              home_score: homeScore,
              away_score: awayScore,
            } as unknown as import('../repos/matches.repo.js').MatchRow]);
          } catch { /* skip archive error */ }

          historyMap.set(mId, {
            match_id: mId,
            date: fx.fixture.date?.substring(0, 10) ?? '',
            kickoff: fx.fixture.date?.substring(11, 16) ?? '00:00',
            league_id: fx.league?.id ?? 0,
            league_name: fx.league?.name ?? '',
            home_team: fx.teams?.home?.name ?? '',
            away_team: fx.teams?.away?.name ?? '',
            venue: fx.fixture.venue?.name ?? 'TBD',
            final_status: status,
            home_score: homeScore,
            away_score: awayScore,
            archived_at: new Date().toISOString(),
          });
        }
      } catch (err) {
        console.warn(`[re-evaluate] Football API batch failed:`, err instanceof Error ? err.message : err);
      }

      // Rate limit: wait 1s between batches
      if (i + batchSize < missingIds.length) {
        await new Promise((r) => setTimeout(r, 1000));
      }
    }
  }

  // Step 4: Fetch match statistics — parallel (concurrency 5) instead of sequential
  type StatRow = { type: string; home: string | number | null; away: string | number | null };
  const allMatchStatistics = new Map<string, StatRow[]>();
  const idsWithHistory = matchIds.filter((id) => historyMap.has(id));
  await batchRun(idsWithHistory.map((matchId) => async () => {
    try {
      const statsRaw = await fetchFixtureStatistics(matchId);
      if (statsRaw.length >= 2) {
        const homeStats = statsRaw[0]!.statistics || [];
        const awayStats = statsRaw[1]!.statistics || [];
        allMatchStatistics.set(matchId, homeStats.map((hs) => ({
          type: hs.type, home: hs.value,
          away: awayStats.find((a) => a.type === hs.type)?.value ?? null,
        })));
      }
    } catch { /* skip — stats are supplementary */ }
  }), 5);

  // Step 5: Re-evaluate using AI — group by match for batch AI calls
  const recsByMatch = new Map<string, recommendationsRepo.RecommendationRow[]>();
  for (const rec of allRecs.rows) {
    const hist = historyMap.get(rec.match_id);
    if (!hist) {
      result.skippedNoScore++;
      continue;
    }
    const list = recsByMatch.get(rec.match_id) || [];
    list.push(rec);
    recsByMatch.set(rec.match_id, list);
  }

  for (const [matchId, matchRecs] of recsByMatch) {
    const hist = historyMap.get(matchId)!;
    if (isNonStandardFinalStatus(hist.final_status)) {
      result.skippedNoScore += matchRecs.length;
      continue;
    }

    const settlementScore = resolveSettlementScore(
      hist.final_status,
      hist.home_score,
      hist.away_score,
      regularTimeScoreMap.get(matchId),
    );
    if (!settlementScore) {
      result.skippedNoScore += matchRecs.length;
      continue;
    }

    const betsToSettle = matchRecs.map(rec => ({
      id: rec.id,
      market: rec.bet_market || normalizeMarket(rec.selection, rec.bet_market),
      selection: rec.selection,
      odds: rec.odds ?? 0,
      stakePercent: rec.stake_percent ?? 1,
    }));

    let resultsMap: Map<number, AISettleResult>;
    try {
      resultsMap = await settleMatch(
        {
          matchId,
          homeTeam: hist.home_team,
          awayTeam: hist.away_team,
          homeScore: settlementScore.home,
          awayScore: settlementScore.away,
          finalStatus: hist.final_status || 'FT',
          settlementScope: 'regular_time',
          statistics: allMatchStatistics.get(matchId),
        },
        betsToSettle,
      );
    } catch (err) {
      console.warn(`[re-evaluate] Settle failed for match ${matchId}:`, err instanceof Error ? err.message : err);
      result.skippedNoScore += matchRecs.length;
      continue;
    }

    for (const rec of matchRecs) {
      const aiResult = resultsMap.get(rec.id);
      if (!aiResult) {
        result.skippedNoScore++;
        continue;
      }

      const newResult = aiResult.result;
      const newPnl = newResult === 'win'
        ? Math.round(((rec.odds ?? 0) - 1) * (rec.stake_percent ?? 1) * 100) / 100
        : newResult === 'loss'
          ? Math.round(-(rec.stake_percent ?? 1) * 100) / 100
          : 0;

      const oldResult = rec.result || '';
      const oldPnl = rec.pnl ?? 0;
      const market = rec.bet_market || normalizeMarket(rec.selection, rec.bet_market);

      result.evaluated++;

      const isUnsettled = !oldResult || oldResult === '';
      const isDiscrepancy = !isUnsettled && (oldResult !== newResult || Math.abs(oldPnl - newPnl) > 0.01);

      if (isUnsettled || isDiscrepancy) {
        await recommendationsRepo.settleRecommendation(rec.id, newResult, newPnl, aiResult.explanation);
        const wasCorrect = settlementWasCorrect(newResult);
        await aiPerfRepo.settleAiPerformance(rec.id, newResult, newPnl, wasCorrect);

        if (isDiscrepancy) {
          result.corrected++;
          result.discrepancies.push({
            id: rec.id,
            matchId: rec.match_id,
            selection: rec.selection,
            market,
            score: aiResult.explanation,
            oldResult,
            oldPnl,
            newResult,
            newPnl,
          });
        } else {
          result.newlySettled++;
        }
      }
    }
  }

  console.log(`[re-evaluate] Done: ${result.evaluated} evaluated, ${result.corrected} corrected, ${result.newlySettled} newly settled, ${result.skippedNoScore} no score`);
  return result;
}

async function fetchRegularTimeScoresForHistoryMatches(
  historyMap: Map<string, MatchHistoryRow>,
): Promise<Map<string, RegulationScore>> {
  const idsNeedingLookup = Array.from(historyMap.values())
    .filter((hist) => requiresRegularTimeBreakdown(hist.final_status))
    .map((hist) => hist.match_id);

  const uniqueIds = [...new Set(idsNeedingLookup.filter(Boolean))];
  if (uniqueIds.length === 0) return new Map();

  let fixtures: ApiFixture[] = [];
  try {
    fixtures = await fetchFixturesByIds(uniqueIds);
  } catch (err) {
    console.warn('[re-evaluate] Failed to fetch regular-time scores:', err instanceof Error ? err.message : err);
    return new Map();
  }

  const scoreMap = new Map<string, RegulationScore>();
  for (const fx of fixtures) {
    const regularTimeScore = extractRegularTimeScoreFromFixture(fx);
    if (regularTimeScore) {
      scoreMap.set(String(fx.fixture.id), regularTimeScore);
    }
  }
  return scoreMap;
}
