// ============================================================
// Job: Enrich Watchlist with Strategic Context
//
// For each active watchlist entry that hasn't been enriched yet
// (or was enriched >6h ago), use Gemini + Google Search to
// fetch strategic match context (motivation, rotation, injuries).
// Also auto-generates recommended_custom_condition from the context.
// ============================================================

import { fetchStrategicContext, type StrategicContext } from '../lib/strategic-context.service.js';
import * as matchRepo from '../repos/matches.repo.js';
import * as watchlistRepo from '../repos/watchlist.repo.js';
import { reportJobProgress } from './job-progress.js';

const STALE_HOURS = 6;
const API_DELAY_MS = 2000; // Respect Gemini rate limits

let forceNext = false;

/** Force next run to skip the stale-check and re-enrich all active entries. */
export function setForceEnrich(): void {
  forceNext = true;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Generate a recommended_custom_condition from strategic context.
 * Produces hybrid output:
 *   - condition: evaluable format like "(Minute >= 60) AND (Total goals <= 1)"
 *     combined with narrative advice for the AI
 *   - reason / reason_vi: explanation in EN + VI
 * Returns null if no strong signal detected.
 */
function generateCondition(
  ctx: StrategicContext,
  homeTeam: string,
  awayTeam: string,
): { condition: string; reason: string; reason_vi: string } | null {
  const conditions: string[] = [];
  const reasons: string[] = [];
  const reasonsVi: string[] = [];

  const homeMot = (ctx.home_motivation || '').toLowerCase();
  const awayMot = (ctx.away_motivation || '').toLowerCase();
  const rotation = (ctx.rotation_risk || '').toLowerCase();
  const congestion = (ctx.fixture_congestion || '').toLowerCase();
  const absences = (ctx.key_absences || '').toLowerCase();
  const positions = (ctx.league_positions || '').toLowerCase();
  const h2h = (ctx.h2h_narrative || '').toLowerCase();

  // ── Pattern: Both teams in high-stakes situation ──
  const urgentRe = /relegation|title race|must.?win|fighting for|battling|bottom [1-5]|play.?off|promotion|avoid.+drop|crucial|important|decisive|pressure|desperate|survival|top [1-4]\b|champion/;
  const homeUrgent = urgentRe.test(homeMot);
  const awayUrgent = urgentRe.test(awayMot);
  if (homeUrgent && awayUrgent) {
    conditions.push('(Minute >= 45) AND (Total goals <= 0) → favor Under 1.5 or Under 2.5');
    reasons.push('Both teams in high-stakes battle → tense start, cautious approach likely');
    reasonsVi.push('Cả hai đội đều đang trong cuộc chiến căng thẳng → kỳ vọng trận đấu thận trọng ban đầu');
  }

  // ── Pattern: One team relaxed, other motivated ──
  const relaxedRe = /nothing to play|mid.?table|safe|already (qualified|relegated)|no motivation|comfortable|secured|no pressure|no ambition|little to play|season over|dead rubber|meaningless|inconsequential|guaranteed/;
  const homeRelaxed = relaxedRe.test(homeMot);
  const awayRelaxed = relaxedRe.test(awayMot);
  if (homeRelaxed && !awayRelaxed) {
    conditions.push(`(Minute >= 30) AND (possession_away > 55) → favor ${awayTeam} or Away markets`);
    reasons.push(`${homeTeam} low motivation; ${awayTeam} should dominate if committed`);
    reasonsVi.push(`${homeTeam} thiếu động lực; ${awayTeam} nên chi phối nếu quyết tâm`);
  } else if (awayRelaxed && !homeRelaxed) {
    conditions.push(`(Minute >= 30) AND (possession_home > 55) → favor ${homeTeam} or Home markets`);
    reasons.push(`${awayTeam} low motivation; ${homeTeam} should dominate if committed`);
    reasonsVi.push(`${awayTeam} thiếu động lực; ${homeTeam} nên chi phối nếu quyết tâm`);
  }

  // ── Pattern: Large league position gap ──
  const posMatch = positions.match(/(\d+)(?:st|nd|rd|th).*?(\d+)(?:st|nd|rd|th)/);
  if (posMatch) {
    const pos1 = parseInt(posMatch[1]!, 10);
    const pos2 = parseInt(posMatch[2]!, 10);
    const gap = Math.abs(pos1 - pos2);
    if (gap >= 5) {
      const favourite = pos1 < pos2 ? homeTeam : awayTeam;
      const underdog = pos1 < pos2 ? awayTeam : homeTeam;
      conditions.push(`Large position gap (${gap} places) → ${favourite} strongly favoured; avoid backing ${underdog} in 1X2`);
      reasons.push(`${favourite} is ${Math.min(pos1, pos2)}th vs ${underdog} ${Math.max(pos1, pos2)}th — significant quality gap`);
      reasonsVi.push(`${favourite} đứng thứ ${Math.min(pos1, pos2)} vs ${underdog} thứ ${Math.max(pos1, pos2)} — chênh lệch đẳng cấp lớn`);
    }
  }

  // ── Pattern: Rotation risk → weakened lineup ──
  const homeLC = homeTeam.toLowerCase();
  const awayLC = awayTeam.toLowerCase();
  const noDataRe = /no data|no rotation|no significant|unlikely|low risk|none|no major/;
  const hasRotationSignal = !noDataRe.test(rotation) && rotation.length > 15;
  if (hasRotationSignal) {
    const homeRotation = rotation.includes(homeLC) || (rotation.includes('home') && !rotation.includes('away'));
    const awayRotation = rotation.includes(awayLC) || (rotation.includes('away') && !rotation.includes('home'));
    if (homeRotation && !awayRotation) {
      conditions.push(`${homeTeam} likely rotated → favor ${awayTeam}, Draw, or Under (weakened attack)`);
      reasons.push(`${homeTeam} expected to rotate key players due to fixture congestion`);
      reasonsVi.push(`${homeTeam} dự kiến xoay vòng cầu thủ chính do lịch thi đấu dày đặc`);
    } else if (awayRotation && !homeRotation) {
      conditions.push(`${awayTeam} likely rotated → favor ${homeTeam} or Under (weakened attack)`);
      reasons.push(`${awayTeam} expected to rotate key players due to fixture congestion`);
      reasonsVi.push(`${awayTeam} dự kiến xoay vòng cầu thủ chính do lịch thi đấu dày đặc`);
    }
  }

  // ── Pattern: Key absences (smarter matching) ──
  const noAbsenceRe = /no data|no major|no confirmed|no significant|none reported|no key|clean bill/;
  if (!noAbsenceRe.test(absences) && absences.length > 15) {
    // Check if either team side is mentioned (fuzzy: first word of team name)
    const homeFirstWord = homeLC.split(/\s+/)[0]!;
    const awayFirstWord = awayLC.split(/\s+/)[0]!;
    const homeAbsent = absences.includes(homeLC) || absences.includes(homeFirstWord);
    const awayAbsent = absences.includes(awayLC) || absences.includes(awayFirstWord);
    const hasAttackerKeyword = /striker|forward|top scorer|star|playmaker|captain|goal.?scor/.test(absences);
    if ((homeAbsent || awayAbsent) && hasAttackerKeyword) {
      conditions.push('Key attacker absent → consider Under markets, reduce expected goals for that side');
      reasons.push('Confirmed absence of key attacking player reduces goal threat');
      reasonsVi.push('Cầu thủ tấn công chủ chốt vắng mặt → giảm kỳ vọng bàn thắng');
    }
  }

  // ── Pattern: CL/EL congestion within 3 days ──
  const europeanRe = /champions league|europa league|conference league|ucl|uel|uecl/;
  const soonRe = /[1-3]\s*days?|tomorrow|mid.?week|next (tuesday|wednesday|thursday)|48.?hours?/;
  if (europeanRe.test(congestion) && soonRe.test(congestion)) {
    conditions.push('European match within 3 days → watch for fatigue, sloppy defending, early goals possible');
    reasons.push('Fixture congestion: European competition within 72h increases fatigue and error rate');
    reasonsVi.push('Lịch thi đấu dày: cúp châu Âu trong 72 giờ → mệt mỏi, phòng ngự cẩu thả');
  }

  // ── Pattern: H2H dominant side ──
  const h2hWinRe = /(?:won|winning)\s+(?:the\s+)?(?:last\s+)?(\d+)/;
  const h2hMatch = h2h.match(h2hWinRe);
  if (h2hMatch) {
    const winCount = parseInt(h2hMatch[1]!, 10);
    if (winCount >= 3) {
      // Determine who's dominant
      const homeH2H = h2h.includes(homeLC) && h2h.indexOf(homeLC) < h2h.indexOf('won');
      const side = homeH2H ? homeTeam : awayTeam;
      conditions.push(`H2H: ${side} won last ${winCount} meetings → strong psychological edge for ${side}`);
      reasons.push(`${side} dominates H2H (${winCount} consecutive wins) — psychological advantage`);
      reasonsVi.push(`${side} thống trị đối đầu (${winCount} trận thắng liên tiếp) — lợi thế tâm lý`);
    }
  }

  // ── Pattern: High-scoring H2H ──
  if (/high.?scoring|over 2\.5|avg.*[3-9]\.\d|goals? per game.*[3-9]/.test(h2h)) {
    conditions.push('H2H history is high-scoring → Over 2.5 has historical support');
    reasons.push('Head-to-head meetings tend to produce many goals');
    reasonsVi.push('Lịch sử đối đầu thường có nhiều bàn thắng');
  }

  // ── Fallback: generate a basic recommendation from the summary ──
  if (conditions.length === 0) {
    const summary = (ctx.summary || '').trim();
    if (!summary) return null;
    // Use the AI-generated summary as a narrative condition
    conditions.push(`Strategic context: ${summary}`);
    reasons.push(`Based on AI analysis of match context: ${summary}`);
    reasonsVi.push(`Dựa trên phân tích AI về bối cảnh trận đấu: ${summary}`);
  }

  return {
    condition: conditions.join('; '),
    reason: reasons.join('. '),
    reason_vi: reasonsVi.join('. '),
  };
}

export async function enrichWatchlistJob(): Promise<{ checked: number; enriched: number }> {
  const JOB = 'enrich-watchlist';

  // Build match status map
  await reportJobProgress(JOB, 'load', 'Loading matches and watchlist...', 5);
  const allMatches = await matchRepo.getAllMatches();
  const statusMap = new Map<string, string>();
  for (const m of allMatches) {
    statusMap.set(m.match_id, m.status.toUpperCase());
  }

  const watchlist = await watchlistRepo.getActiveWatchlist();
  if (watchlist.length === 0) {
    console.log('[enrichWatchlistJob] Watchlist empty, skip.');
    return { checked: 0, enriched: 0 };
  }

  // Filter eligible entries first to get accurate count
  const force = forceNext;
  forceNext = false; // consume the flag
  if (force) console.log('[enrichWatchlistJob] ⚡ Force mode — skipping stale check');

  const now = Date.now();
  const eligible = watchlist.filter((entry) => {
    const matchStatus = statusMap.get(entry.match_id)?.toUpperCase() ?? '';
    if (matchStatus !== 'NS' && matchStatus !== '') return false;

    if (force) return true; // skip stale check in force mode

    // Treat entries with poor/empty context as needing re-enrichment
    const ctx = entry.strategic_context as Record<string, string> | null;
    const hasPoorContext = ctx && (!ctx.summary || /^no data/i.test(ctx.summary));

    if (entry.strategic_context_at && !hasPoorContext) {
      const enrichedAt = new Date(entry.strategic_context_at).getTime();
      if (now - enrichedAt < STALE_HOURS * 60 * 60 * 1000) return false;
    }
    return true;
  });

  let checked = 0;
  let enriched = 0;

  for (const entry of eligible) {
    checked++;
    await reportJobProgress(
      JOB, 'enrich',
      `Enriching ${checked}/${eligible.length}: ${entry.home_team} vs ${entry.away_team}`,
      5 + (checked / eligible.length) * 90,
    );

    try {
      const context = await fetchStrategicContext(
        entry.home_team,
        entry.away_team,
        entry.league,
        entry.date,
      );

      if (context) {
        const updateFields: Partial<watchlistRepo.WatchlistRow> = {
          strategic_context: context as unknown,
          strategic_context_at: new Date().toISOString(),
        } as Partial<watchlistRepo.WatchlistRow>;

        // Auto-generate conditions if not manually set, previous result was poor, or force mode
        const existingCond = (entry.recommended_custom_condition || '').trim();
        if (force || !existingCond || /^Strategic context:\s*No data/i.test(existingCond)) {
          const generated = generateCondition(context, entry.home_team, entry.away_team);
          if (generated) {
            (updateFields as Record<string, unknown>).recommended_custom_condition = generated.condition;
            (updateFields as Record<string, unknown>).recommended_condition_reason = generated.reason;
            (updateFields as Record<string, unknown>).recommended_condition_reason_vi = generated.reason_vi;
          }
        }

        await watchlistRepo.updateWatchlistEntry(entry.match_id, updateFields);
        enriched++;
        console.log(`[enrichWatchlistJob] ✅ Enriched ${entry.home_team} vs ${entry.away_team}`);
      }
    } catch (err) {
      console.error(`[enrichWatchlistJob] Error for match ${entry.match_id}:`, err);
    }

    await sleep(API_DELAY_MS);
  }

  console.log(`[enrichWatchlistJob] ✅ Checked ${checked}, enriched ${enriched}`);
  return { checked, enriched };
}
