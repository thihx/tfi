// ============================================================
// Job: Auto-Settle — Resolve recommendations & bets with FT scores
//
// 1. Find unsettled recommendations (result = '' or NULL)
// 2. Look up final scores from matches_history
// 3. Fallback: call Football API for matches not yet archived
// 4. Determine win/loss/push based on selection vs actual score
// 5. Update recommendations, bets, and ai_performance
// ============================================================

import * as recommendationsRepo from '../repos/recommendations.repo.js';
import * as betsRepo from '../repos/bets.repo.js';
import * as matchHistoryRepo from '../repos/matches-history.repo.js';
import * as aiPerfRepo from '../repos/ai-performance.repo.js';
import { fetchFixturesByIds, type ApiFixture } from '../lib/football-api.js';
import type { RecommendationRow } from '../repos/recommendations.repo.js';
import type { MatchHistoryRow } from '../repos/matches-history.repo.js';
import { reportJobProgress } from './job-progress.js';

interface SettleResult {
  settled: number;
  skipped: number;
  errors: number;
}

/**
 * Determine bet result based on market, selection, and final score.
 * Returns { result: 'win'|'loss'|'push', pnl: number }
 */
export function evaluateBet(
  market: string,
  selection: string,
  odds: number,
  stakePercent: number,
  homeScore: number,
  awayScore: number,
): { result: 'win' | 'loss' | 'push'; pnl: number } {
  const totalGoals = homeScore + awayScore;
  const marketLower = market.toLowerCase();
  const selLower = selection.toLowerCase();

  // ── Over/Under ──
  if (marketLower.includes('over') || marketLower.includes('under') || marketLower.startsWith('ou')) {
    const lineMatch = marketLower.match(/([\d.]+)/);
    const line = lineMatch?.[1] ? parseFloat(lineMatch[1]) : 2.5;

    const isOver = selLower.includes('over');
    const isUnder = selLower.includes('under');

    if (totalGoals === line) return { result: 'push', pnl: 0 };
    if (isOver && totalGoals > line) return { result: 'win', pnl: round((odds - 1) * stakePercent) };
    if (isUnder && totalGoals < line) return { result: 'win', pnl: round((odds - 1) * stakePercent) };
    return { result: 'loss', pnl: round(-stakePercent) };
  }

  // ── BTTS (Both Teams To Score) ──
  if (marketLower.includes('btts') || marketLower.includes('both_teams')) {
    const btts = homeScore > 0 && awayScore > 0;
    const pickedYes = selLower.includes('yes');
    if ((pickedYes && btts) || (!pickedYes && !btts)) {
      return { result: 'win', pnl: round((odds - 1) * stakePercent) };
    }
    return { result: 'loss', pnl: round(-stakePercent) };
  }

  // ── 1X2 (Match Result) ──
  if (marketLower.includes('1x2') || marketLower.includes('match_result')) {
    let actualResult: 'home' | 'draw' | 'away';
    if (homeScore > awayScore) actualResult = 'home';
    else if (awayScore > homeScore) actualResult = 'away';
    else actualResult = 'draw';

    const pickedHome = selLower.includes('home') || selLower.startsWith('1');
    const pickedDraw = selLower.includes('draw') || selLower.includes('x');
    const pickedAway = selLower.includes('away') || selLower.startsWith('2');

    if (
      (pickedHome && actualResult === 'home') ||
      (pickedDraw && actualResult === 'draw') ||
      (pickedAway && actualResult === 'away')
    ) {
      return { result: 'win', pnl: round((odds - 1) * stakePercent) };
    }
    return { result: 'loss', pnl: round(-stakePercent) };
  }

  // ── Asian Handicap ──
  if (marketLower.includes('ah') || marketLower.includes('handicap')) {
    const lineMatch = marketLower.match(/([+-]?[\d.]+)/);
    const line = lineMatch?.[1] ? parseFloat(lineMatch[1]) : 0;
    const pickedHome = selLower.includes('home');

    const adjustedDiff = pickedHome
      ? homeScore - awayScore + line
      : awayScore - homeScore - line;

    if (adjustedDiff === 0) return { result: 'push', pnl: 0 };
    if (adjustedDiff > 0) return { result: 'win', pnl: round((odds - 1) * stakePercent) };
    return { result: 'loss', pnl: round(-stakePercent) };
  }

  // Unknown market — skip auto-settle
  return { result: 'push', pnl: 0 };
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}

export async function autoSettleJob(): Promise<SettleResult> {
  const JOB = 'auto-settle';
  const stats: SettleResult = { settled: 0, skipped: 0, errors: 0 };

  // ── 1. Settle unsettled recommendations ──
  await reportJobProgress(JOB, 'load-recs', 'Loading unsettled recommendations...', 5);
  const unsettledRecs = await getUnsettledRecommendations();
  if (unsettledRecs.length > 0) {
    await reportJobProgress(JOB, 'settle-recs', `Settling ${unsettledRecs.length} recommendations...`, 20);
    await settleRecommendations(unsettledRecs, stats);
  }

  // ── 2. Settle unsettled bets ──
  await reportJobProgress(JOB, 'load-bets', 'Loading unsettled bets...', 55);
  const unsettledBets = await betsRepo.getUnsettledBets();
  if (unsettledBets.length > 0) {
    await reportJobProgress(JOB, 'settle-bets', `Settling ${unsettledBets.length} bets...`, 65);
    await settleBets(unsettledBets, stats);
  }

  if (stats.settled > 0) {
    console.log(`[autoSettleJob] Settled ${stats.settled} items (skipped: ${stats.skipped}, errors: ${stats.errors})`);
  }

  return stats;
}

async function getUnsettledRecommendations(): Promise<RecommendationRow[]> {
  const { rows } = await recommendationsRepo.getAllRecommendations({ limit: 1000 });
  return rows.filter((r) => !r.result || r.result === '');
}

async function settleRecommendations(recs: RecommendationRow[], stats: SettleResult) {
  // Batch-fetch historical matches for all unique match IDs
  const matchIds = [...new Set(recs.map((r) => r.match_id))];
  const historyMap = new Map<string, MatchHistoryRow>();
  for (const id of matchIds) {
    try {
      const hist = await matchHistoryRepo.getHistoricalMatch(id);
      if (hist) historyMap.set(id, hist);
    } catch (err) {
      console.error(`[autoSettleJob] Failed to fetch history for match ${id}:`, err);
    }
  }

  // Fallback: fetch results from Football API for matches not in history
  const missingIds = matchIds.filter((id) => !historyMap.has(id));
  if (missingIds.length > 0) {
    await fetchAndArchiveMissingResults(missingIds, historyMap);
  }

  for (const rec of recs) {
    try {
      const hist = historyMap.get(rec.match_id);
      if (!hist) {
        stats.skipped++;
        continue;
      }

      const { result, pnl } = evaluateBet(
        rec.bet_market || rec.bet_type,
        rec.selection,
        rec.odds ?? 0,
        rec.stake_percent ?? 1,
        hist.home_score,
        hist.away_score,
      );

      const finalScore = `${hist.home_score}-${hist.away_score}`;

      await recommendationsRepo.settleRecommendation(rec.id, result, pnl, finalScore);

      // Update AI performance record if exists
      await aiPerfRepo.settleAiPerformance(rec.id, result, pnl, result === 'win');

      stats.settled++;
    } catch (err) {
      console.error(`[autoSettleJob] Error settling rec ${rec.id}:`, err);
      stats.errors++;
    }
  }
}

async function settleBets(
  bets: betsRepo.BetRow[],
  stats: SettleResult,
) {
  const matchIds = [...new Set(bets.map((b) => b.match_id))];
  const historyMap = new Map<string, MatchHistoryRow>();
  for (const id of matchIds) {
    try {
      const hist = await matchHistoryRepo.getHistoricalMatch(id);
      if (hist) historyMap.set(id, hist);
    } catch (err) {
      console.error(`[autoSettleJob] Failed to fetch history for match ${id}:`, err);
    }
  }

  // Fallback: fetch results from Football API for matches not in history
  const missingIds = matchIds.filter((id) => !historyMap.has(id));
  if (missingIds.length > 0) {
    await fetchAndArchiveMissingResults(missingIds, historyMap);
  }

  for (const bet of bets) {
    try {
      const hist = historyMap.get(bet.match_id);
      if (!hist) {
        stats.skipped++;
        continue;
      }

      const { result, pnl } = evaluateBet(
        bet.bet_market,
        bet.selection,
        bet.odds,
        bet.stake_percent || 1,
        hist.home_score,
        hist.away_score,
      );

      const finalScore = `${hist.home_score}-${hist.away_score}`;
      await betsRepo.settleBet(bet.id, result, pnl, finalScore, 'auto');

      stats.settled++;
    } catch (err) {
      console.error(`[autoSettleJob] Error settling bet ${bet.id}:`, err);
      stats.errors++;
    }
  }
}

// ==================== Football API Fallback ====================

const FINISHED_STATUSES = new Set(['FT', 'AET', 'PEN', 'AWD', 'WO']);

/**
 * Fetch match results from Football API for match IDs not found in matches_history.
 * If a fixture has finished (FT/AET/PEN/AWD/WO), archive it to matches_history
 * and add it to the historyMap for immediate settlement.
 */
async function fetchAndArchiveMissingResults(
  missingIds: string[],
  historyMap: Map<string, MatchHistoryRow>,
): Promise<void> {
  let fixtures: ApiFixture[];
  try {
    fixtures = await fetchFixturesByIds(missingIds);
  } catch (err) {
    console.warn('[autoSettleJob] Football API fallback failed:', err instanceof Error ? err.message : err);
    return;
  }

  for (const fx of fixtures) {
    const matchId = String(fx.fixture.id);
    const status = fx.fixture.status?.short ?? '';

    if (!FINISHED_STATUSES.has(status)) continue;

    const homeScore = fx.goals?.home ?? 0;
    const awayScore = fx.goals?.away ?? 0;

    // Archive to matches_history for future lookups
    try {
      const dateStr = fx.fixture.date ? fx.fixture.date.substring(0, 10) : '';
      const timeStr = fx.fixture.date ? fx.fixture.date.substring(11, 16) : '00:00';

      await matchHistoryRepo.archiveFinishedMatches([{
        match_id: matchId,
        date: dateStr,
        kickoff: timeStr,
        league_id: fx.league?.id ?? 0,
        league_name: fx.league?.name ?? '',
        home_team: fx.teams?.home?.name ?? '',
        away_team: fx.teams?.away?.name ?? '',
        venue: fx.fixture.venue?.name ?? 'TBD',
        status,
        home_score: homeScore,
        away_score: awayScore,
      } as unknown as import('../repos/matches.repo.js').MatchRow]);
    } catch (err) {
      console.warn(`[autoSettleJob] Failed to archive match ${matchId}:`, err instanceof Error ? err.message : err);
    }

    // Add to historyMap for immediate use
    historyMap.set(matchId, {
      match_id: matchId,
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

  if (fixtures.length > 0) {
    const archived = fixtures.filter((fx) => FINISHED_STATUSES.has(fx.fixture.status?.short ?? '')).length;
    if (archived > 0) {
      console.log(`[autoSettleJob] Fetched ${fixtures.length} fixtures from API, archived ${archived} finished matches`);
    }
  }
}
