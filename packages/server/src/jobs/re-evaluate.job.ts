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
import type { MatchHistoryArchiveInput, MatchHistoryRow } from '../repos/matches-history.repo.js';
import { fetchFixturesByIds, fetchFixtureStatistics, type ApiFixture } from '../lib/football-api.js';
import { normalizeMarket } from '../lib/normalize-market.js';
import {
  extractRegularTimeScoreFromFixture,
  isNonStandardFinalStatus,
  requiresRegularTimeBreakdown,
  resolveSettlementScore,
} from '../lib/settle-context.js';
import {
  calcSettlementPnl,
  isFinalSettlementResult,
  settlementWasCorrect,
  type RegulationScore,
  type SettlementPersistenceMeta,
} from '../lib/settle-types.js';
import { SETTLE_PROMPT_VERSION } from '../lib/settle-prompt.js';
import { auditSkipped, auditSuccess } from '../lib/audit.js';
import {
  mergeApiFixtureStatistics,
  parseStoredSettlementStats,
  type SettlementStatRow,
} from '../lib/settlement-stat-cache.js';
import { kickoffAtUtcFromFixtureDate } from '../lib/kickoff-time.js';

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

function buildSettlementMeta(
  source: AISettleResult['source'],
  status: 'resolved' | 'corrected',
  note: string,
): SettlementPersistenceMeta {
  return {
    status,
    method: source === 'rules' || source === 'ai' ? source : undefined,
    settlePromptVersion: source === 'ai' ? SETTLE_PROMPT_VERSION : '',
    note,
    trusted: true,
  };
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

  const allRecs = await query<recommendationsRepo.RecommendationRow>(
    `SELECT * FROM recommendations WHERE result != 'duplicate' ORDER BY id`,
  );
  result.total = allRecs.rows.length;

  const matchIds = [...new Set(allRecs.rows.map((r) => r.match_id))];
  const historyMap = await matchHistoryRepo.getHistoricalMatchesBatch(matchIds);
  const regularTimeScoreMap = await fetchRegularTimeScoresForHistoryMatches(historyMap);

  const missingIds = matchIds.filter((id) => !historyMap.has(id));
  if (missingIds.length > 0) {
    const batchSize = 20;
    for (let i = 0; i < missingIds.length; i += batchSize) {
      const batch = missingIds.slice(i, i + batchSize);
      try {
        const fixtures = await fetchFixturesByIds(batch);
        const finished = new Set(['FT', 'AET', 'PEN', 'AWD', 'WO']);
        for (const fx of fixtures) {
          const matchId = String(fx.fixture.id);
          const status = fx.fixture.status?.short ?? '';
          if (!finished.has(status)) continue;

          const archiveRow = buildArchiveRowFromFixture(fx);
          if (
            typeof archiveRow.regular_home_score === 'number'
            && typeof archiveRow.regular_away_score === 'number'
          ) {
            regularTimeScoreMap.set(matchId, {
              home: archiveRow.regular_home_score,
              away: archiveRow.regular_away_score,
            });
          }

          try {
            await matchHistoryRepo.archiveFinishedMatches([archiveRow]);
          } catch {
            // Keep in-memory fallback even if archive write fails.
          }

          historyMap.set(matchId, {
            ...archiveRow,
            archived_at: new Date().toISOString(),
          });
        }
      } catch (err) {
        console.warn('[re-evaluate] Football API batch failed:', err instanceof Error ? err.message : err);
      }

      if (i + batchSize < missingIds.length) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    }
  }

  const allMatchStatistics = await fetchMatchStatistics(matchIds, historyMap);

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
    const hist = historyMap.get(matchId);
    if (!hist) {
      result.skippedNoScore += matchRecs.length;
      continue;
    }
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

    const betsToSettle = matchRecs.map((rec) => ({
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
        auditSkipped('JOB', 'RE_EVALUATION_UNRESOLVED', {
          actor: 're-evaluate',
          match_id: rec.match_id,
          metadata: {
            recommendationId: rec.id,
            reason: 'No settlement result returned from settle pipeline.',
            selection: rec.selection,
          },
        });
        result.skippedNoScore++;
        continue;
      }
      if (!isFinalSettlementResult(aiResult.result)) {
        auditSkipped('JOB', 'RE_EVALUATION_UNRESOLVED', {
          actor: 're-evaluate',
          match_id: rec.match_id,
          metadata: {
            recommendationId: rec.id,
            reason: aiResult.explanation,
            source: aiResult.source ?? 'unknown',
            selection: rec.selection,
          },
        });
        result.skippedNoScore++;
        continue;
      }

      const newResult = aiResult.result;
      const newPnl = calcSettlementPnl(newResult, rec.odds ?? 0, rec.stake_percent ?? 1);

      const oldResult = rec.result || '';
      const oldPnl = rec.pnl ?? 0;
      const market = rec.bet_market || normalizeMarket(rec.selection, rec.bet_market);

      result.evaluated++;

      const isUnsettled = !oldResult || oldResult === '';
      const isDiscrepancy = !isUnsettled && (oldResult !== newResult || Math.abs(oldPnl - newPnl) > 0.01);

      if (!isUnsettled && !isDiscrepancy) continue;

      const settlementMeta = buildSettlementMeta(
        aiResult.source,
        isDiscrepancy ? 'corrected' : 'resolved',
        aiResult.explanation,
      );
      await recommendationsRepo.settleRecommendation(rec.id, newResult, newPnl, aiResult.explanation, settlementMeta);
      const wasCorrect = settlementWasCorrect(newResult);
      await aiPerfRepo.settleAiPerformance(rec.id, newResult, newPnl, wasCorrect, settlementMeta);

      if (isDiscrepancy) {
        auditSuccess('JOB', 'SETTLEMENT_CORRECTED', {
          actor: 're-evaluate',
          match_id: rec.match_id,
          metadata: {
            recommendationId: rec.id,
            oldResult,
            newResult,
            oldPnl,
            newPnl,
            source: aiResult.source ?? 'unknown',
            promptVersion: settlementMeta.settlePromptVersion ?? '',
          },
        });
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

  console.log(
    `[re-evaluate] Done: ${result.evaluated} evaluated, ${result.corrected} corrected, ${result.newlySettled} newly settled, ${result.skippedNoScore} no score`,
  );
  return result;
}

async function fetchMatchStatistics(
  matchIds: string[],
  historyMap: Map<string, MatchHistoryRow>,
): Promise<Map<string, SettlementStatRow[]>> {
  const statsMap = new Map<string, SettlementStatRow[]>();
  const idsNeedingStats: string[] = [];

  for (const matchId of matchIds) {
    const hist = historyMap.get(matchId);
    if (!hist) continue;

    const storedStats = parseStoredSettlementStats(hist.settlement_stats);
    if (storedStats.length > 0) {
      statsMap.set(matchId, storedStats);
    } else {
      idsNeedingStats.push(matchId);
    }
  }

  await batchRun(idsNeedingStats.map((matchId) => async () => {
    try {
      const statsRaw = await fetchFixtureStatistics(matchId);
      const merged = mergeApiFixtureStatistics(statsRaw);
      if (merged.length === 0) return;
      statsMap.set(matchId, merged);
      await matchHistoryRepo.updateHistoricalMatchSettlementData(matchId, {
        settlement_stats: merged,
        settlement_stats_provider: 'api-football',
      });
    } catch {
      // Stats are supplementary for re-evaluation.
    }
  }), 5);

  return statsMap;
}

async function fetchRegularTimeScoresForHistoryMatches(
  historyMap: Map<string, MatchHistoryRow>,
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
    fixtures = await fetchFixturesByIds(uniqueIds);
  } catch (err) {
    console.warn('[re-evaluate] Failed to fetch regular-time scores:', err instanceof Error ? err.message : err);
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

function buildArchiveRowFromFixture(fx: ApiFixture): MatchHistoryArchiveInput {
  const regularTimeScore = extractRegularTimeScoreFromFixture(fx);
  return {
    match_id: String(fx.fixture.id),
    date: fx.fixture.date?.substring(0, 10) ?? '',
    kickoff: fx.fixture.date?.substring(11, 16) ?? '00:00',
    kickoff_at_utc: kickoffAtUtcFromFixtureDate(fx.fixture.date),
    league_id: fx.league?.id ?? 0,
    league_name: fx.league?.name ?? '',
    home_team: fx.teams?.home?.name ?? '',
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
