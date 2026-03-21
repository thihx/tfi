// ============================================================
// Job: Auto-Settle — Resolve recommendations & bets with FT scores
//
// 1. Find unsettled recommendations (result = '' or NULL)
// 2. Look up final scores from matches_history
// 3. Fallback: call Football API for matches not yet archived
// 4. Call AI (Gemini) to determine win/loss/push + explanation
// 5. Update recommendations, bets, and ai_performance
// ============================================================

import * as recommendationsRepo from '../repos/recommendations.repo.js';
import * as betsRepo from '../repos/bets.repo.js';
import * as matchHistoryRepo from '../repos/matches-history.repo.js';
import * as aiPerfRepo from '../repos/ai-performance.repo.js';
import { fetchFixturesByIds, fetchFixtureStatistics, type ApiFixture } from '../lib/football-api.js';
import { callGemini } from '../lib/gemini.js';
import { config } from '../config.js';
import type { RecommendationRow } from '../repos/recommendations.repo.js';
import type { MatchHistoryRow } from '../repos/matches-history.repo.js';
import { reportJobProgress } from './job-progress.js';
import { settleByRule } from '../lib/settle-rules.js';
import {
  calcSettlementPnl,
  type FinalSettlementResult,
  isFinalSettlementResult,
  settlementWasCorrect,
  type RegulationScore,
  type SettlementPersistenceMeta,
} from '../lib/settle-types.js';
import {
  extractRegularTimeScoreFromFixture,
  isNonStandardFinalStatus,
  requiresRegularTimeBreakdown,
  resolveSettlementScore,
} from '../lib/settle-context.js';
import {
  buildSettlePrompt as buildStrictSettlePrompt,
  parseAISettleResponse as parseStrictSettleResponse,
  type ParsedSettleResult,
  SETTLE_PROMPT_VERSION,
} from '../lib/settle-prompt.js';
import { auditSkipped } from '../lib/audit.js';

interface SettleResult {
  settled: number;
  skipped: number;
  errors: number;
}

// ==================== AI Settlement ====================

interface MatchContext {
  matchId: string;
  homeTeam: string;
  awayTeam: string;
  homeScore: number;
  awayScore: number;
  finalStatus: string;
  settlementScope: 'regular_time';
  statistics?: Array<{ type: string; home: string | number | null; away: string | number | null }>;
}

interface BetToSettle {
  id: number;
  market: string;
  selection: string;
  odds: number;
  stakePercent: number;
}

export interface AISettleResult {
  id: number;
  result: ParsedSettleResult['result'];
  explanation: string;
  source?: 'rules' | 'ai';
}

export function buildSettlePrompt(match: MatchContext, bets: BetToSettle[]): string {
  return buildStrictSettlePrompt(match, bets);
/*

  const score = `${match.homeScore}-${match.awayScore}`;
  const totalGoals = match.homeScore + match.awayScore;

  let statsSection = 'Không có thống kê chi tiết.';
  if (match.statistics && match.statistics.length > 0) {
    statsSection = match.statistics
      .map(s => `- ${s.type}: ${s.home ?? '?'} (Home) - ${s.away ?? '?'} (Away)`)
      .join('\n');
  }

  const betsSection = bets.map((b, i) =>
    `${i + 1}. [ID: ${b.id}] Market: "${b.market}", Selection: "${b.selection}", Odds: ${b.odds}`,
  ).join('\n');

  return `Bạn là chuyên gia settle kèo bóng đá. Dựa vào kết quả trận đấu và thống kê, hãy xác định mỗi kèo THẮNG (win), THUA (loss), hay HÒA (push).

KẾT QUẢ TRẬN ĐẤU:
${match.homeTeam} ${score} ${match.awayTeam}
Tổng bàn thắng: ${totalGoals}
Trạng thái chính thức: ${match.finalStatus || 'FT'}
Settlement scope: regular time only (90 phút + bù giờ). Extra time và penalty shootout KHÔNG được tính cho các market bóng đá tiêu chuẩn.
Tỷ số ở trên đã là tỷ số dùng để settle theo settlement scope này.

THỐNG KÊ TRẬN ĐẤU:
${statsSection}

CÁC KÈO CẦN SETTLE:
${betsSection}

QUY TẮC:
- Over/Under goals: So sánh tổng bàn thắng (${totalGoals}) với line
- Over/Under corners: So sánh tổng corners với line (dùng thống kê Corner Kicks)
- Over/Under cards: So sánh tổng thẻ với line (dùng thống kê Yellow Cards + Red Cards)
- BTTS (Both Teams To Score): Kiểm tra cả 2 đội đều ghi bàn
- 1X2: Home win / Draw / Away win
- Asian Handicap (AH): Áp dụng handicap vào tỷ số
- Nếu giá trị thực tế bằng đúng line → result = "push"
- Nếu không có thống kê cho kèo corners/cards → result = "push"

Trả về CHỈ một JSON array hợp lệ (không markdown, không giải thích ngoài JSON):
[
  { "id": <bet_id>, "result": "win|loss|push", "explanation": "<giải thích ngắn gọn bằng tiếng Việt>" }
]

VÍ DỤ explanation:
- "Tổng corners là 11, vượt mức 9.5 → Thắng"
- "Tỷ số 2-0, chỉ đội nhà ghi bàn → BTTS No thắng"
- "Tổng bàn thắng là 3, vượt mức 2.5"
- "Đội nhà thắng 2-1, kèo Home Win đúng"

QUAN TRỌNG: Trả về đúng ${bets.length} items, mỗi item cho một kèo. explanation phải ngắn gọn nhưng rõ ràng.`;
*/
}

export function parseAISettleResponse(aiText: string, bets: BetToSettle[]): AISettleResult[] {
  return parseStrictSettleResponse(aiText, bets);
/*

  // Extract JSON array from AI response
  const jsonMatch = aiText.match(/\[[\s\S]*\]/);
  if (!jsonMatch) {
    console.error('[ai-settle] Cannot parse AI response as JSON array:', aiText.substring(0, 300));
    return [];
  }

  try {
    const parsed = JSON.parse(jsonMatch[0]) as Array<{ id: number; result: string; explanation: string }>;
    const betIds = new Set(bets.map(b => b.id));

    return parsed
      .filter(item => betIds.has(item.id) && isFinalSettlementResult(item.result))
      .map(item => ({
        id: item.id,
        result: item.result as FinalSettlementResult,
        explanation: String(item.explanation || '').substring(0, 500),
      }));
  } catch (err) {
    console.error('[ai-settle] JSON parse error:', err instanceof Error ? err.message : err);
    return [];
  }
*/
}

/**
 * Settle a batch of bets for a single match.
 * 1. Try deterministic rules first for each bet
 * 2. For unresolved bets, batch-call AI
 * Returns results with explanation. PNL is calculated by caller.
 */
export async function settleMatch(
  match: MatchContext,
  bets: BetToSettle[],
): Promise<Map<number, AISettleResult>> {
  const resultsMap = new Map<number, AISettleResult>();
  const needAI: BetToSettle[] = [];

  // Phase 1: deterministic rules
  for (const bet of bets) {
    const ruleResult = settleByRule({
      market: bet.market,
      selection: bet.selection,
      homeScore: match.homeScore,
      awayScore: match.awayScore,
      statistics: match.statistics,
    });
    if (ruleResult) {
      resultsMap.set(bet.id, {
        id: bet.id,
        result: ruleResult.result,
        explanation: ruleResult.explanation,
        source: 'rules',
      });
    } else {
      needAI.push(bet);
    }
  }

  // Phase 2: AI fallback for unresolved markets
  if (needAI.length > 0) {
    const aiResults = await settleWithAI(match, needAI);
    for (const r of aiResults) resultsMap.set(r.id, r);
  }

  if (bets.length > 0) {
    console.log(`[autoSettleJob] Match ${match.matchId}: ${resultsMap.size - needAI.length} by rules, ${needAI.length} by AI`);
  }

  return resultsMap;
}

/** AI fallback for markets that can't be resolved by rules */
export async function settleWithAI(
  match: MatchContext,
  bets: BetToSettle[],
): Promise<AISettleResult[]> {
  const prompt = buildStrictSettlePrompt(match, bets);
  const model = config.geminiModel;
  const aiText = await callGemini(prompt, model);
  return parseStrictSettleResponse(aiText, bets).map((row) => ({
    ...row,
    source: 'ai',
  }));
}

/**
 * Calculate PNL based on result, odds, and stake.
 */
function calcPnl(result: FinalSettlementResult, odds: number, stakePercent: number): number {
  return calcSettlementPnl(result, odds, stakePercent);
}

function buildSettlementMeta(
  source: AISettleResult['source'],
  status: 'resolved' | 'corrected' | 'unresolved',
  note: string,
): SettlementPersistenceMeta {
  return {
    status,
    method: source === 'rules' || source === 'ai' ? source : undefined,
    settlePromptVersion: source === 'ai' ? SETTLE_PROMPT_VERSION : '',
    note,
    trusted: status !== 'unresolved',
  };
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
  // Use the repo's "pending" filter so quarter-line / void outcomes are not re-processed as open rows.
  const { rows } = await recommendationsRepo.getAllRecommendations({ result: 'pending', limit: 2000 });
  return rows;
}

async function settleRecommendations(recs: RecommendationRow[], stats: SettleResult) {
  const matchIds = [...new Set(recs.map((r) => r.match_id))];
  // Single batch query instead of N individual lookups
  const historyMap = await matchHistoryRepo.getHistoricalMatchesBatch(matchIds);
  const regularTimeScoreMap = await fetchRegularTimeScoresForHistoryMatches(historyMap);

  // Fallback: fetch results from Football API for matches not in history
  const missingIds = matchIds.filter((id) => !historyMap.has(id));
  if (missingIds.length > 0) {
    const fetchedRegularTimeScores = await fetchAndArchiveMissingResults(missingIds, historyMap);
    for (const [matchId, score] of fetchedRegularTimeScores) {
      regularTimeScoreMap.set(matchId, score);
    }
  }

  // Fetch match statistics for all matches (AI needs full context)
  const allStatsMap = await fetchMatchStatistics(matchIds);

  // Group recs by match_id for batch AI settle
  const recsByMatch = new Map<string, RecommendationRow[]>();
  for (const rec of recs) {
    const list = recsByMatch.get(rec.match_id) || [];
    list.push(rec);
    recsByMatch.set(rec.match_id, list);
  }

  for (const [matchId, matchRecs] of recsByMatch) {
    const hist = historyMap.get(matchId);
    if (!hist) {
      for (const rec of matchRecs) {
        const note = 'No historical result available for settlement.';
        await recommendationsRepo.markRecommendationUnresolved(rec.id, { note });
        await aiPerfRepo.markAiPerformanceSettlementState(rec.id, {
          status: 'unresolved',
          trusted: false,
          note,
        });
        auditSkipped('JOB', 'SETTLEMENT_UNRESOLVED', {
          actor: 'auto-settle',
          match_id: rec.match_id,
          metadata: { recommendationId: rec.id, reason: note, selection: rec.selection },
        });
      }
      stats.skipped += matchRecs.length;
      continue;
    }

    const matchContext = buildMatchContextForSettlement(matchId, hist, regularTimeScoreMap.get(matchId), allStatsMap.get(matchId));
    if (!matchContext) {
      for (const rec of matchRecs) {
        const note = `Settlement context unavailable for final status ${hist.final_status}.`;
        await recommendationsRepo.markRecommendationUnresolved(rec.id, { note });
        await aiPerfRepo.markAiPerformanceSettlementState(rec.id, {
          status: 'unresolved',
          trusted: false,
          note,
        });
        auditSkipped('JOB', 'SETTLEMENT_UNRESOLVED', {
          actor: 'auto-settle',
          match_id: rec.match_id,
          metadata: { recommendationId: rec.id, reason: note, finalStatus: hist.final_status, selection: rec.selection },
        });
      }
      stats.skipped += matchRecs.length;
      continue;
    }

    const betsToSettle: BetToSettle[] = matchRecs.map(rec => ({
      id: rec.id,
      market: rec.bet_market || rec.bet_type,
      selection: rec.selection,
      odds: rec.odds ?? 0,
      stakePercent: rec.stake_percent ?? 1,
    }));

    try {
      const resultsMap = await settleMatch(matchContext, betsToSettle);

      for (const rec of matchRecs) {
        const aiResult = resultsMap.get(rec.id);
        if (!aiResult) {
          const note = 'No settlement result returned from settle pipeline.';
          console.warn(`[autoSettleJob] No result for rec ${rec.id}, skipping`);
          await recommendationsRepo.markRecommendationUnresolved(rec.id, {
            method: 'ai',
            settlePromptVersion: SETTLE_PROMPT_VERSION,
            note,
          });
          await aiPerfRepo.markAiPerformanceSettlementState(rec.id, {
            status: 'unresolved',
            method: 'ai',
            settlePromptVersion: SETTLE_PROMPT_VERSION,
            trusted: false,
            note,
          });
          auditSkipped('JOB', 'SETTLEMENT_UNRESOLVED', {
            actor: 'auto-settle',
            match_id: rec.match_id,
            metadata: { recommendationId: rec.id, reason: note, selection: rec.selection },
          });
          stats.skipped++;
          continue;
        }
        if (!isFinalSettlementResult(aiResult.result)) {
          console.warn(`[autoSettleJob] Unresolved settlement for rec ${rec.id}: ${aiResult.explanation}`);
          const unresolvedMeta = buildSettlementMeta(aiResult.source, 'unresolved', aiResult.explanation);
          await recommendationsRepo.markRecommendationUnresolved(rec.id, unresolvedMeta);
          await aiPerfRepo.markAiPerformanceSettlementState(rec.id, unresolvedMeta);
          auditSkipped('JOB', 'SETTLEMENT_UNRESOLVED', {
            actor: 'auto-settle',
            match_id: rec.match_id,
            metadata: {
              recommendationId: rec.id,
              reason: aiResult.explanation,
              source: aiResult.source ?? 'unknown',
              selection: rec.selection,
            },
          });
          stats.skipped++;
          continue;
        }

        const pnl = calcPnl(aiResult.result, rec.odds ?? 0, rec.stake_percent ?? 1);
        const settlementMeta = buildSettlementMeta(aiResult.source, 'resolved', aiResult.explanation);
        await recommendationsRepo.settleRecommendation(rec.id, aiResult.result, pnl, aiResult.explanation, settlementMeta);
        const wasCorrect = settlementWasCorrect(aiResult.result);
        await aiPerfRepo.settleAiPerformance(rec.id, aiResult.result, pnl, wasCorrect, settlementMeta);
        stats.settled++;
      }
    } catch (err) {
      console.error(`[autoSettleJob] Settle failed for match ${matchId}:`, err instanceof Error ? err.message : err);
      stats.errors += matchRecs.length;
    }
  }
}

async function settleBets(
  bets: betsRepo.BetRow[],
  stats: SettleResult,
) {
  const matchIds = [...new Set(bets.map((b) => b.match_id))];
  // Single batch query instead of N individual lookups
  const historyMap = await matchHistoryRepo.getHistoricalMatchesBatch(matchIds);
  const regularTimeScoreMap = await fetchRegularTimeScoresForHistoryMatches(historyMap);

  // Fallback: fetch results from Football API for matches not in history
  const missingIds = matchIds.filter((id) => !historyMap.has(id));
  if (missingIds.length > 0) {
    const fetchedRegularTimeScores = await fetchAndArchiveMissingResults(missingIds, historyMap);
    for (const [matchId, score] of fetchedRegularTimeScores) {
      regularTimeScoreMap.set(matchId, score);
    }
  }

  // Fetch match statistics for all matches
  const allStatsMap = await fetchMatchStatistics(matchIds);

  // Group bets by match_id
  const betsByMatch = new Map<string, betsRepo.BetRow[]>();
  for (const bet of bets) {
    const list = betsByMatch.get(bet.match_id) || [];
    list.push(bet);
    betsByMatch.set(bet.match_id, list);
  }

  for (const [matchId, matchBets] of betsByMatch) {
    const hist = historyMap.get(matchId);
    if (!hist) {
      for (const bet of matchBets) {
        const note = 'No historical result available for settlement.';
        await betsRepo.markBetUnresolved(bet.id, { note });
        auditSkipped('JOB', 'BET_SETTLEMENT_UNRESOLVED', {
          actor: 'auto-settle',
          match_id: bet.match_id,
          metadata: { betId: bet.id, reason: note, selection: bet.selection },
        });
      }
      stats.skipped += matchBets.length;
      continue;
    }

    const matchContext = buildMatchContextForSettlement(matchId, hist, regularTimeScoreMap.get(matchId), allStatsMap.get(matchId));
    if (!matchContext) {
      for (const bet of matchBets) {
        const note = `Settlement context unavailable for final status ${hist.final_status}.`;
        await betsRepo.markBetUnresolved(bet.id, { note });
        auditSkipped('JOB', 'BET_SETTLEMENT_UNRESOLVED', {
          actor: 'auto-settle',
          match_id: bet.match_id,
          metadata: { betId: bet.id, reason: note, finalStatus: hist.final_status, selection: bet.selection },
        });
      }
      stats.skipped += matchBets.length;
      continue;
    }

    const betsToSettle: BetToSettle[] = matchBets.map(bet => ({
      id: bet.id,
      market: bet.bet_market,
      selection: bet.selection,
      odds: bet.odds,
      stakePercent: bet.stake_percent || 1,
    }));

    try {
      const resultsMap = await settleMatch(matchContext, betsToSettle);

      for (const bet of matchBets) {
        const aiResult = resultsMap.get(bet.id);
        if (!aiResult) {
          const note = 'No settlement result returned from settle pipeline.';
          console.warn(`[autoSettleJob] No result for bet ${bet.id}, skipping`);
          await betsRepo.markBetUnresolved(bet.id, {
            method: 'ai',
            settlePromptVersion: SETTLE_PROMPT_VERSION,
            note,
          });
          auditSkipped('JOB', 'BET_SETTLEMENT_UNRESOLVED', {
            actor: 'auto-settle',
            match_id: bet.match_id,
            metadata: { betId: bet.id, reason: note, selection: bet.selection },
          });
          stats.skipped++;
          continue;
        }
        if (!isFinalSettlementResult(aiResult.result)) {
          console.warn(`[autoSettleJob] Unresolved settlement for bet ${bet.id}: ${aiResult.explanation}`);
          const unresolvedMeta = buildSettlementMeta(aiResult.source, 'unresolved', aiResult.explanation);
          await betsRepo.markBetUnresolved(bet.id, unresolvedMeta);
          auditSkipped('JOB', 'BET_SETTLEMENT_UNRESOLVED', {
            actor: 'auto-settle',
            match_id: bet.match_id,
            metadata: {
              betId: bet.id,
              reason: aiResult.explanation,
              source: aiResult.source ?? 'unknown',
              selection: bet.selection,
            },
          });
          stats.skipped++;
          continue;
        }

        const pnl = calcPnl(aiResult.result, bet.odds, bet.stake_percent || 1);
        const settlementMeta = buildSettlementMeta(aiResult.source, 'resolved', aiResult.explanation);
        await betsRepo.settleBet(bet.id, aiResult.result, pnl, aiResult.explanation, 'auto', settlementMeta);
        stats.settled++;
      }
    } catch (err) {
      console.error(`[autoSettleJob] Settle failed for match ${matchId}:`, err instanceof Error ? err.message : err);
      stats.errors += matchBets.length;
    }
  }
}

// ==================== Statistics Fetcher ====================

/**
 * Fetch full match statistics from Football API for a list of match IDs.
 * Returns a Map of matchId → array of stat objects (type, home, away).
 */
type StatRow = { type: string; home: string | number | null; away: string | number | null };

async function fetchMatchStatistics(
  matchIds: string[],
): Promise<Map<string, StatRow[]>> {
  if (matchIds.length === 0) return new Map();
  const statsMap = new Map<string, StatRow[]>();

  // Parallel fetches (concurrency 5) instead of sequential
  await batchRun(matchIds.map((matchId) => async () => {
    try {
      const statsRaw = await fetchFixtureStatistics(matchId);
      if (statsRaw.length >= 2) {
        const homeStats = statsRaw[0]!.statistics || [];
        const awayStats = statsRaw[1]!.statistics || [];
        const merged: StatRow[] = homeStats.map((hs) => ({
          type: hs.type,
          home: hs.value,
          away: awayStats.find((a) => a.type === hs.type)?.value ?? null,
        }));
        statsMap.set(matchId, merged);
      }
    } catch (err) {
      console.warn(`[autoSettleJob] Stats fetch failed for ${matchId}:`, err instanceof Error ? err.message : err);
    }
  }), 5);

  if (statsMap.size > 0) {
    console.log(`[autoSettleJob] Fetched statistics for ${statsMap.size}/${matchIds.length} matches`);
  }
  return statsMap;
}

export async function batchRun<T>(tasks: (() => Promise<T>)[], concurrency = 5): Promise<T[]> {
  const results: T[] = [];
  for (let i = 0; i < tasks.length; i += concurrency) {
    results.push(...await Promise.all(tasks.slice(i, i + concurrency).map((t) => t())));
  }
  return results;
}

// ==================== Football API Fallback ====================

const FINISHED_STATUSES = new Set(['FT', 'AET', 'PEN', 'AWD', 'WO']);

async function fetchRegularTimeScoresForHistoryMatches(
  historyMap: Map<string, MatchHistoryRow>,
): Promise<Map<string, RegulationScore>> {
  const idsNeedingLookup = Array.from(historyMap.values())
    .filter((hist) => requiresRegularTimeBreakdown(hist.final_status))
    .map((hist) => hist.match_id);

  return fetchRegularTimeScoresForMatchIds(idsNeedingLookup);
}

async function fetchRegularTimeScoresForMatchIds(matchIds: string[]): Promise<Map<string, RegulationScore>> {
  const uniqueIds = [...new Set(matchIds.filter(Boolean))];
  if (uniqueIds.length === 0) return new Map();

  let fixtures: ApiFixture[] = [];
  try {
    fixtures = await fetchFixturesByIds(uniqueIds);
  } catch (err) {
    console.warn(
      '[autoSettleJob] Failed to fetch regular-time scores:',
      err instanceof Error ? err.message : err,
    );
    return new Map();
  }
  const out = new Map<string, RegulationScore>();
  for (const fx of fixtures) {
    const score = extractRegularTimeScoreFromFixture(fx);
    if (score) out.set(String(fx.fixture.id), score);
  }
  return out;
}

function buildMatchContextForSettlement(
  matchId: string,
  hist: MatchHistoryRow,
  regularTimeScore: RegulationScore | undefined,
  statistics?: Array<{ type: string; home: string | number | null; away: string | number | null }>,
): MatchContext | null {
  if (isNonStandardFinalStatus(hist.final_status)) return null;

  const settlementScore = resolveSettlementScore(
    hist.final_status,
    hist.home_score,
    hist.away_score,
    regularTimeScore,
  );
  if (!settlementScore) return null;

  return {
    matchId,
    homeTeam: hist.home_team,
    awayTeam: hist.away_team,
    homeScore: settlementScore.home,
    awayScore: settlementScore.away,
    finalStatus: hist.final_status || 'FT',
    settlementScope: 'regular_time',
    statistics,
  };
}

/**
 * Fetch match results from Football API for match IDs not found in matches_history.
 * If a fixture has finished (FT/AET/PEN/AWD/WO), archive it to matches_history
 * and add it to the historyMap for immediate settlement.
 */
async function fetchAndArchiveMissingResults(
  missingIds: string[],
  historyMap: Map<string, MatchHistoryRow>,
): Promise<Map<string, RegulationScore>> {
  const regularTimeScores = new Map<string, RegulationScore>();
  let fixtures: ApiFixture[];
  try {
    fixtures = await fetchFixturesByIds(missingIds);
  } catch (err) {
    console.warn('[autoSettleJob] Football API fallback failed:', err instanceof Error ? err.message : err);
    return regularTimeScores;
  }

  for (const fx of fixtures) {
    const matchId = String(fx.fixture.id);
    const status = fx.fixture.status?.short ?? '';

    if (!FINISHED_STATUSES.has(status)) continue;

    const regularTimeScore = extractRegularTimeScoreFromFixture(fx);
    if (regularTimeScore) {
      regularTimeScores.set(matchId, regularTimeScore);
    }

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
  return regularTimeScores;
}
