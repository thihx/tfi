// ============================================================
// Job: Enrich Watchlist with Strategic Context
//
// For each active watchlist entry that hasn't been enriched yet
// (or was enriched >6h ago), fetch strategic match context
// (motivation, rotation, injuries) via AI + Google Search.
// Also auto-generates recommended_custom_condition from the context.
// ============================================================

import { fetchStrategicContext } from '../lib/strategic-context.service.js';
import * as matchRepo from '../repos/matches.repo.js';
import * as watchlistRepo from '../repos/watchlist.repo.js';
import { reportJobProgress } from './job-progress.js';

const STALE_HOURS = 6;
const API_DELAY_MS = 2000; // Respect API rate limits

let forceNext = false;

/** Force next run to skip the stale-check and re-enrich all active entries. */
export function setForceEnrich(): void {
  forceNext = true;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

        // Auto-generate conditions if not manually set, still in old narrative format, or force mode
        // Valid evaluable conditions always start with '(' — anything else is old format
        const existingCond = (entry.recommended_custom_condition || '').trim();
        const isEvaluable = existingCond.startsWith('(');
        if (force || !existingCond || !isEvaluable) {
          // AI-generated condition (context-aware, handles European comps)
          const aiCond = (context.ai_condition || '').trim();
          const aiCondIsEvaluable = aiCond.startsWith('(');

          if (aiCondIsEvaluable) {
            (updateFields as Record<string, unknown>).recommended_custom_condition = aiCond;
            (updateFields as Record<string, unknown>).recommended_condition_reason = context.ai_condition_reason || '';
            (updateFields as Record<string, unknown>).recommended_condition_reason_vi = context.ai_condition_reason_vi || '';
            console.log(`[enrichWatchlistJob] 🤖 AI condition: ${aiCond}`);
          } else {
            console.log(`[enrichWatchlistJob] ⚠️ AI did not generate evaluable condition for ${entry.home_team} vs ${entry.away_team}`);
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
