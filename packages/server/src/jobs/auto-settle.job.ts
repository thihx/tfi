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
  result: 'win' | 'loss' | 'push';
  explanation: string;
}

function buildSettlePrompt(match: MatchContext, bets: BetToSettle[]): string {
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
}

function parseAISettleResponse(aiText: string, bets: BetToSettle[]): AISettleResult[] {
  // Extract JSON array from AI response
  const jsonMatch = aiText.match(/\[[\s\S]*\]/);
  if (!jsonMatch) {
    console.error('[ai-settle] Cannot parse AI response as JSON array:', aiText.substring(0, 300));
    return [];
  }

  try {
    const parsed = JSON.parse(jsonMatch[0]) as Array<{ id: number; result: string; explanation: string }>;
    const validResults = ['win', 'loss', 'push'];
    const betIds = new Set(bets.map(b => b.id));

    return parsed
      .filter(item => betIds.has(item.id) && validResults.includes(item.result))
      .map(item => ({
        id: item.id,
        result: item.result as 'win' | 'loss' | 'push',
        explanation: String(item.explanation || '').substring(0, 500),
      }));
  } catch (err) {
    console.error('[ai-settle] JSON parse error:', err instanceof Error ? err.message : err);
    return [];
  }
}

/**
 * Settle a batch of bets for a single match using AI.
 * Returns results with explanation. PNL is calculated by caller.
 */
export async function settleWithAI(
  match: MatchContext,
  bets: BetToSettle[],
): Promise<AISettleResult[]> {
  const prompt = buildSettlePrompt(match, bets);
  const model = config.geminiModel;
  const aiText = await callGemini(prompt, model);
  return parseAISettleResponse(aiText, bets);
}

/**
 * Calculate PNL based on result, odds, and stake.
 */
function calcPnl(result: 'win' | 'loss' | 'push', odds: number, stakePercent: number): number {
  if (result === 'win') return round((odds - 1) * stakePercent);
  if (result === 'loss') return round(-stakePercent);
  return 0;
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
  // Use 'pending' filter which maps to SQL: result IS NULL OR result NOT IN ('win','loss','push')
  // Avoids full-table scan + client-side filter; handles >1000 rows correctly
  const { rows } = await recommendationsRepo.getAllRecommendations({ result: 'pending', limit: 2000 });
  return rows;
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
      stats.skipped += matchRecs.length;
      continue;
    }

    const matchContext: MatchContext = {
      matchId,
      homeTeam: hist.home_team,
      awayTeam: hist.away_team,
      homeScore: hist.home_score,
      awayScore: hist.away_score,
      statistics: allStatsMap.get(matchId),
    };

    const betsToSettle: BetToSettle[] = matchRecs.map(rec => ({
      id: rec.id,
      market: rec.bet_market || rec.bet_type,
      selection: rec.selection,
      odds: rec.odds ?? 0,
      stakePercent: rec.stake_percent ?? 1,
    }));

    try {
      const aiResults = await settleWithAI(matchContext, betsToSettle);
      const resultsMap = new Map(aiResults.map(r => [r.id, r]));

      for (const rec of matchRecs) {
        const aiResult = resultsMap.get(rec.id);
        if (!aiResult) {
          console.warn(`[autoSettleJob] AI did not return result for rec ${rec.id}, skipping`);
          stats.skipped++;
          continue;
        }

        const pnl = calcPnl(aiResult.result, rec.odds ?? 0, rec.stake_percent ?? 1);
        await recommendationsRepo.settleRecommendation(rec.id, aiResult.result, pnl, aiResult.explanation);
        await aiPerfRepo.settleAiPerformance(rec.id, aiResult.result, pnl, aiResult.result === 'win');
        stats.settled++;
      }
    } catch (err) {
      console.error(`[autoSettleJob] AI settle failed for match ${matchId}:`, err instanceof Error ? err.message : err);
      stats.errors += matchRecs.length;
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
      stats.skipped += matchBets.length;
      continue;
    }

    const matchContext: MatchContext = {
      matchId,
      homeTeam: hist.home_team,
      awayTeam: hist.away_team,
      homeScore: hist.home_score,
      awayScore: hist.away_score,
      statistics: allStatsMap.get(matchId),
    };

    const betsToSettle: BetToSettle[] = matchBets.map(bet => ({
      id: bet.id,
      market: bet.bet_market,
      selection: bet.selection,
      odds: bet.odds,
      stakePercent: bet.stake_percent || 1,
    }));

    try {
      const aiResults = await settleWithAI(matchContext, betsToSettle);
      const resultsMap = new Map(aiResults.map(r => [r.id, r]));

      for (const bet of matchBets) {
        const aiResult = resultsMap.get(bet.id);
        if (!aiResult) {
          console.warn(`[autoSettleJob] AI did not return result for bet ${bet.id}, skipping`);
          stats.skipped++;
          continue;
        }

        const pnl = calcPnl(aiResult.result, bet.odds, bet.stake_percent || 1);
        await betsRepo.settleBet(bet.id, aiResult.result, pnl, aiResult.explanation, 'auto');
        stats.settled++;
      }
    } catch (err) {
      console.error(`[autoSettleJob] AI settle failed for match ${matchId}:`, err instanceof Error ? err.message : err);
      stats.errors += matchBets.length;
    }
  }
}

// ==================== Statistics Fetcher ====================

/**
 * Fetch full match statistics from Football API for a list of match IDs.
 * Returns a Map of matchId → array of stat objects (type, home, away).
 */
async function fetchMatchStatistics(
  matchIds: string[],
): Promise<Map<string, Array<{ type: string; home: string | number | null; away: string | number | null }>>> {
  const statsMap = new Map<string, Array<{ type: string; home: string | number | null; away: string | number | null }>>();

  for (const matchId of matchIds) {
    try {
      const statsRaw = await fetchFixtureStatistics(matchId);
      if (statsRaw.length >= 2) {
        const homeStats = statsRaw[0]!.statistics || [];
        const awayStats = statsRaw[1]!.statistics || [];

        // Merge home + away stats by type
        const merged: Array<{ type: string; home: string | number | null; away: string | number | null }> = [];
        for (const hs of homeStats) {
          const as = awayStats.find(a => a.type === hs.type);
          merged.push({ type: hs.type, home: hs.value, away: as?.value ?? null });
        }
        statsMap.set(matchId, merged);
      }
    } catch (err) {
      console.warn(`[autoSettleJob] Failed to fetch statistics for match ${matchId}:`, err instanceof Error ? err.message : err);
    }
  }

  if (matchIds.length > 0 && statsMap.size > 0) {
    console.log(`[autoSettleJob] Fetched statistics for ${statsMap.size}/${matchIds.length} matches`);
  }

  return statsMap;
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
