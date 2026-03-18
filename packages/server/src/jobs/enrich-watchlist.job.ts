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
 * Produces ONLY evaluable condition expressions using the allowed atomic set:
 *   (Minute >= N), (Minute <= N), (Total goals <= N), (Total goals >= N),
 *   (Draw), (Home leading), (Away leading), (NOT Home leading), (NOT Away leading)
 * Combined with AND/OR operators.
 * Strategic advice and reasoning go ONLY in reason/reason_vi fields.
 * Returns null if no strong signal detected.
 */
function generateCondition(
  ctx: StrategicContext,
  homeTeam: string,
  awayTeam: string,
): { condition: string; reason: string; reason_vi: string } | null {
  const atoms: string[] = [];
  const reasons: string[] = [];
  const reasonsVi: string[] = [];

  const homeMot = (ctx.home_motivation || '').toLowerCase();
  const awayMot = (ctx.away_motivation || '').toLowerCase();
  const rotation = (ctx.rotation_risk || '').toLowerCase();
  const congestion = (ctx.fixture_congestion || '').toLowerCase();
  const absences = (ctx.key_absences || '').toLowerCase();
  const positions = (ctx.league_positions || '').toLowerCase();
  const h2h = (ctx.h2h_narrative || '').toLowerCase();

  // ── Pattern: Both teams in high-stakes situation → cautious start expected ──
  const urgentRe = /relegation|title race|must.?win|fighting for|battling|bottom [1-5]|play.?off|promotion|avoid.+drop|crucial|important|decisive|pressure|desperate|survival|top [1-4]\b|champion/;
  const homeUrgent = urgentRe.test(homeMot);
  const awayUrgent = urgentRe.test(awayMot);
  if (homeUrgent && awayUrgent) {
    atoms.push('(Minute >= 45) AND (Total goals <= 0)');
    reasons.push(`Both teams in high-stakes battle → tense start likely; favor Under 1.5 or Under 2.5`);
    reasonsVi.push(`Cả hai đội đều đang trong cuộc chiến căng thẳng → kỳ vọng trận đấu thận trọng ban đầu; ưu tiên Under 1.5 hoặc Under 2.5`);
  }

  // ── Pattern: One team relaxed, other motivated → dominant side expected ──
  const relaxedRe = /nothing to play|mid.?table|safe|already (qualified|relegated)|no motivation|comfortable|secured|no pressure|no ambition|little to play|season over|dead rubber|meaningless|inconsequential|guaranteed/;
  const homeRelaxed = relaxedRe.test(homeMot);
  const awayRelaxed = relaxedRe.test(awayMot);
  if (homeRelaxed && !awayRelaxed) {
    atoms.push('(Minute >= 30) AND (NOT Away leading)');
    reasons.push(`${homeTeam} low motivation; favor ${awayTeam} or Away markets if not leading by min 30`);
    reasonsVi.push(`${homeTeam} thiếu động lực; ưu tiên ${awayTeam} hoặc Away nếu chưa dẫn ở phút 30`);
  } else if (awayRelaxed && !homeRelaxed) {
    atoms.push('(Minute >= 30) AND (NOT Home leading)');
    reasons.push(`${awayTeam} low motivation; favor ${homeTeam} or Home markets if not leading by min 30`);
    reasonsVi.push(`${awayTeam} thiếu động lực; ưu tiên ${homeTeam} hoặc Home nếu chưa dẫn ở phút 30`);
  }

  // ── Pattern: Large league position gap → favourite expected to lead ──
  const posMatch = positions.match(/(\d+)(?:st|nd|rd|th).*?(\d+)(?:st|nd|rd|th)/);
  if (posMatch) {
    const pos1 = parseInt(posMatch[1]!, 10);
    const pos2 = parseInt(posMatch[2]!, 10);
    const gap = Math.abs(pos1 - pos2);
    if (gap >= 5) {
      const favourite = pos1 < pos2 ? homeTeam : awayTeam;
      const underdog = pos1 < pos2 ? awayTeam : homeTeam;
      // If favourite is underperforming (not leading by minute 60) → alert
      const favIsHome = pos1 < pos2;
      atoms.push(`(Minute >= 60) AND (${favIsHome ? 'NOT Home leading' : 'NOT Away leading'})`);
      reasons.push(`${favourite} (${Math.min(pos1, pos2)}th) vs ${underdog} (${Math.max(pos1, pos2)}th) — gap of ${gap} places; alert if favourite not leading by 60'`);
      reasonsVi.push(`${favourite} (thứ ${Math.min(pos1, pos2)}) vs ${underdog} (thứ ${Math.max(pos1, pos2)}) — chênh lệch ${gap} bậc; cảnh báo nếu đội mạnh chưa dẫn ở phút 60`);
    }
  }

  // ── Pattern: Rotation risk → weakened lineup, expect fewer goals ──
  const homeLC = homeTeam.toLowerCase();
  const awayLC = awayTeam.toLowerCase();
  const noDataRe = /no data|no rotation|no significant|unlikely|low risk|none|no major/;
  const hasRotationSignal = !noDataRe.test(rotation) && rotation.length > 15;
  if (hasRotationSignal) {
    const homeRotation = rotation.includes(homeLC) || (rotation.includes('home') && !rotation.includes('away'));
    const awayRotation = rotation.includes(awayLC) || (rotation.includes('away') && !rotation.includes('home'));
    if (homeRotation && !awayRotation) {
      atoms.push('(Minute >= 60) AND (Total goals <= 1)');
      reasons.push(`${homeTeam} expected to rotate → weakened attack; favor ${awayTeam}, Draw or Under`);
      reasonsVi.push(`${homeTeam} dự kiến xoay vòng → tấn công suy yếu; ưu tiên ${awayTeam}, Hòa hoặc Under`);
    } else if (awayRotation && !homeRotation) {
      atoms.push('(Minute >= 60) AND (Total goals <= 1)');
      reasons.push(`${awayTeam} expected to rotate → weakened attack; favor ${homeTeam} or Under`);
      reasonsVi.push(`${awayTeam} dự kiến xoay vòng → tấn công suy yếu; ưu tiên ${homeTeam} hoặc Under`);
    }
  }

  // ── Pattern: Key absences → lower goal expectation ──
  const noAbsenceRe = /no data|no major|no confirmed|no significant|none reported|no key|clean bill/;
  if (!noAbsenceRe.test(absences) && absences.length > 15) {
    const homeFirstWord = homeLC.split(/\s+/)[0]!;
    const awayFirstWord = awayLC.split(/\s+/)[0]!;
    const homeAbsent = absences.includes(homeLC) || absences.includes(homeFirstWord);
    const awayAbsent = absences.includes(awayLC) || absences.includes(awayFirstWord);
    const hasAttackerKeyword = /striker|forward|top scorer|star|playmaker|captain|goal.?scor/.test(absences);
    if ((homeAbsent || awayAbsent) && hasAttackerKeyword) {
      atoms.push('(Total goals <= 1)');
      reasons.push('Key attacker absent → reduced goal threat; consider Under markets');
      reasonsVi.push('Cầu thủ tấn công chủ chốt vắng mặt → giảm kỳ vọng bàn thắng; xem xét Under');
    }
  }

  // ── Pattern: CL/EL congestion within 3 days → fatigue, early goals ──
  const europeanRe = /champions league|europa league|conference league|ucl|uel|uecl/;
  const soonRe = /[1-3]\s*days?|tomorrow|mid.?week|next (tuesday|wednesday|thursday)|48.?hours?/;
  if (europeanRe.test(congestion) && soonRe.test(congestion)) {
    atoms.push('(Minute <= 30) AND (Total goals >= 1)');
    reasons.push('European match within 72h → fatigue risk, sloppy defending, early goals possible');
    reasonsVi.push('Cúp châu Âu trong 72 giờ → mệt mỏi, phòng ngự cẩu thả, có thể có bàn sớm');
  }

  // ── Pattern: H2H dominant side → underperformance detection ──
  const h2hWinRe = /(?:won|winning)\s+(?:the\s+)?(?:last\s+)?(\d+)/;
  const h2hMatch = h2h.match(h2hWinRe);
  if (h2hMatch) {
    const winCount = parseInt(h2hMatch[1]!, 10);
    if (winCount >= 3) {
      const homeH2H = h2h.includes(homeLC) && h2h.indexOf(homeLC) < h2h.indexOf('won');
      const side = homeH2H ? homeTeam : awayTeam;
      const isHome = homeH2H;
      atoms.push(`(Minute >= 60) AND (${isHome ? 'NOT Home leading' : 'NOT Away leading'})`);
      reasons.push(`${side} won last ${winCount} H2H meetings → strong psychological edge; alert if not leading by 60'`);
      reasonsVi.push(`${side} thắng ${winCount} trận đối đầu gần nhất → lợi thế tâm lý; cảnh báo nếu chưa dẫn ở phút 60`);
    }
  }

  // ── Pattern: High-scoring H2H → expect goals ──
  if (/high.?scoring|over 2\.5|avg.*[3-9]\.\d|goals? per game.*[3-9]/.test(h2h)) {
    atoms.push('(Minute >= 60) AND (Total goals <= 1)');
    reasons.push('H2H history is high-scoring → alert if under-performing at 60 min; Over 2.5 has historical support');
    reasonsVi.push('Lịch sử đối đầu nhiều bàn thắng → cảnh báo nếu ít bàn ở phút 60; Over 2.5 có cơ sở');
  }

  // ── No patterns matched → fallback using summary ──
  if (atoms.length === 0) {
    const summary = (ctx.summary || '').trim();
    if (!summary) return null;
    // Default: alert at halftime if still goalless
    atoms.push('(Minute >= 45) AND (Total goals <= 0)');
    reasons.push(`Based on strategic context: ${summary}`);
    reasonsVi.push(`Dựa trên bối cảnh chiến thuật: ${summary}`);
  }

  // Combine all atoms with AND, deduplicate
  const uniqueAtoms = [...new Set(atoms)];
  const condition = uniqueAtoms.join(' AND ');

  return {
    condition,
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
