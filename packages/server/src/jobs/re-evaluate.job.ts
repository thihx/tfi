// ============================================================
// Job: Re-Evaluate — Re-check all settled results using real scores
//
// 1. Fetch all non-duplicate recommendations (settled + unsettled)
// 2. Look up final scores from matches_history + Football API
// 3. Re-run evaluateBet() with real scores
// 4. Compare with existing result, log & fix discrepancies
// 5. Sync ai_performance
// ============================================================

import { query } from '../db/pool.js';
import { evaluateBet } from './auto-settle.job.js';
import * as recommendationsRepo from '../repos/recommendations.repo.js';
import * as matchHistoryRepo from '../repos/matches-history.repo.js';
import * as aiPerfRepo from '../repos/ai-performance.repo.js';
import { fetchFixturesByIds } from '../lib/football-api.js';
import type { MatchHistoryRow } from '../repos/matches-history.repo.js';
import { normalizeMarket } from '../lib/normalize-market.js';

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

  // Step 2: Collect all unique match IDs and fetch scores
  const matchIds = [...new Set(allRecs.rows.map((r) => r.match_id))];
  const historyMap = new Map<string, MatchHistoryRow>();

  for (const id of matchIds) {
    try {
      const hist = await matchHistoryRepo.getHistoricalMatch(id);
      if (hist) historyMap.set(id, hist);
    } catch { /* skip */ }
  }

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

  // Step 4: Re-evaluate each recommendation
  for (const rec of allRecs.rows) {
    const hist = historyMap.get(rec.match_id);
    if (!hist) {
      result.skippedNoScore++;
      continue;
    }

    // Determine the market to use for evaluation
    const market = rec.bet_market || normalizeMarket(rec.selection, rec.bet_market);

    const { result: newResult, pnl: newPnl } = evaluateBet(
      market,
      rec.selection,
      rec.odds ?? 0,
      rec.stake_percent ?? 1,
      hist.home_score,
      hist.away_score,
    );

    const finalScore = `${hist.home_score}-${hist.away_score}`;
    const oldResult = rec.result || '';
    const oldPnl = rec.pnl ?? 0;

    result.evaluated++;

    // Check for discrepancy or newly settled
    const isUnsettled = !oldResult || oldResult === '';
    const isDiscrepancy = !isUnsettled && (oldResult !== newResult || Math.abs(oldPnl - newPnl) > 0.01);

    if (isUnsettled || isDiscrepancy) {
      // Update the recommendation
      await recommendationsRepo.settleRecommendation(rec.id, newResult, newPnl, finalScore);

      // Update AI performance
      await aiPerfRepo.settleAiPerformance(rec.id, newResult, newPnl, newResult === 'win');

      if (isDiscrepancy) {
        result.corrected++;
        result.discrepancies.push({
          id: rec.id,
          matchId: rec.match_id,
          selection: rec.selection,
          market,
          score: finalScore,
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

  console.log(`[re-evaluate] Done: ${result.evaluated} evaluated, ${result.corrected} corrected, ${result.newlySettled} newly settled, ${result.skippedNoScore} no score`);
  return result;
}
