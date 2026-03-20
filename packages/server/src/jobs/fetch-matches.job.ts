// ============================================================
// Job: Fetch Matches
// Mirrors: Apps Script fetchMatchesJob()
//
// 1. Read active approved leagues from DB
// 2. Call API-Football for today + tomorrow fixtures
// 3. Filter by league + status
// 4. Full-refresh matches table
// ============================================================

import { config } from '../config.js';
import { fetchFixturesForDate, fetchFixtureStatistics, type ApiFixture, type ApiFixtureStat } from '../lib/football-api.js';
import * as leagueRepo from '../repos/leagues.repo.js';
import * as matchRepo from '../repos/matches.repo.js';
import * as watchlistRepo from '../repos/watchlist.repo.js';
import { archiveFinishedMatches } from '../repos/matches-history.repo.js';
import { reportJobProgress } from './job-progress.js';
import { getRedisClient } from '../lib/redis.js';

const ALLOWED_STATUSES = ['NS', '1H', 'HT', '2H', 'ET', 'BT', 'P', 'LIVE', 'INT'];
const LIVE_STATUSES   = new Set(['1H', 'HT', '2H', 'ET', 'BT', 'LIVE', 'INT']);

/** Run tasks with max N in parallel */
async function batchRun<T>(tasks: (() => Promise<T>)[], concurrency = 5): Promise<T[]> {
  const results: T[] = [];
  for (let i = 0; i < tasks.length; i += concurrency) {
    const chunk = tasks.slice(i, i + concurrency);
    results.push(...await Promise.all(chunk.map(t => t())));
  }
  return results;
}

/** Extract integer stat from team stats array */
function statCount(stats: ApiFixtureStat[], teamIdx: 0 | 1, name: string): number {
  const v = stats[teamIdx]?.statistics.find(s => s.type === name)?.value;
  if (v == null) return 0;
  const n = typeof v === 'number' ? v : parseInt(String(v), 10);
  return isNaN(n) ? 0 : n;
}

/** Redis key storing the earliest timestamp (ms) at which the next real fetch is allowed. */
export const ADAPTIVE_SKIP_KEY = 'job:fetch-matches:next-run-at';

/**
 * Compute how many ms to wait before the next fetch, based on current match state.
 * Pure function — easy to unit test.
 */
export function computeNextPollDelayMs(
  state: matchRepo.MatchScheduleState,
  baseIntervalMs: number,
): number {
  const MIN = 60_000;

  if (state.liveCount > 0) return baseIntervalMs;           // live → base rate (1 min)
  if (state.minsToNextKickoff === null) return 30 * MIN;    // no matches at all → 30 min

  const m = state.minsToNextKickoff;
  if (m <= 5)   return baseIntervalMs;                      // kicking off very soon → 1 min
  if (m <= 120) return 2 * MIN;                             // within 2 hours → 2 min
  if (m <= 360) return 5 * MIN;                             // within 6 hours → 5 min
  return 30 * MIN;                                          // > 6 hours away → 30 min
}

function toDateString(d: Date, tz: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(d);
  const p = (t: string) => parts.find((x) => x.type === t)!.value;
  return `${p('year')}-${p('month')}-${p('day')}`;
}

function fixtureToMatchRow(f: ApiFixture): matchRepo.MatchRow {
  const parts = String(f.fixture.date).split('T');
  const datePart = parts[0] || '';
  const kickoff = (parts[1] || '').substring(0, 5);
  const ht = f.score?.halftime;

  return {
    match_id: String(f.fixture.id),
    date: datePart,
    kickoff,
    league_id: f.league.id,
    league_name: f.league.name,
    home_team: f.teams.home.name,
    away_team: f.teams.away.name,
    home_logo: f.teams.home.logo,
    away_logo: f.teams.away.logo,
    venue: f.fixture.venue?.name || 'TBD',
    status: f.fixture.status.short,
    home_score: f.goals.home,
    away_score: f.goals.away,
    current_minute: f.fixture.status.elapsed,
    last_updated: new Date().toISOString(),
    // Enriched from fixture (free)
    home_team_id: f.teams.home.id,
    away_team_id: f.teams.away.id,
    round: f.league.round ?? '',
    halftime_home: ht?.home ?? null,
    halftime_away: ht?.away ?? null,
    referee: f.fixture.referee ?? null,
    // Stats defaults — overwritten for live matches
    home_reds: 0,
    away_reds: 0,
    home_yellows: 0,
    away_yellows: 0,
  };
}

export async function fetchMatchesJob(): Promise<{ saved: number; leagues: number }> {
  const JOB = 'fetch-matches';

  // ── Adaptive skip: check if we should defer this run ──────────────────────
  try {
    const redis = getRedisClient();
    const nextRunAt = await redis.get(ADAPTIVE_SKIP_KEY);
    if (nextRunAt && Date.now() < Number(nextRunAt)) {
      const remainSec = Math.round((Number(nextRunAt) - Date.now()) / 1000);
      console.log(`[fetchMatchesJob] Skipping — next allowed run in ${remainSec}s`);
      return { saved: 0, leagues: 0 };
    }
  } catch {
    // Redis unavailable → proceed with fetch (safe fallback)
  }

  // 1. Get active league IDs
  await reportJobProgress(JOB, 'leagues', 'Loading active leagues...', 5);
  const activeLeagues = await leagueRepo.getActiveLeagues();
  if (activeLeagues.length === 0) {
    console.log('[fetchMatchesJob] No active leagues, skip.');
    // No active leagues — no point polling frequently
    try {
      const redis = getRedisClient();
      await redis.set(ADAPTIVE_SKIP_KEY, String(Date.now() + 30 * 60_000), 'PX', 30 * 60_000 + 5_000);
    } catch { /* non-critical */ }
    return { saved: 0, leagues: 0 };
  }
  const leagueIdSet = new Set(activeLeagues.map((l) => l.league_id));

  // 2. Calculate today + tomorrow
  const now = new Date();
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const dateFrom = toDateString(now, config.timezone);
  const dateTo = toDateString(tomorrow, config.timezone);

  // 3. Fetch from API-Football (allSettled so one day failing doesn't lose the other)
  await reportJobProgress(JOB, 'api', `Fetching fixtures for ${dateFrom} and ${dateTo}...`, 15);
  const results = await Promise.allSettled([
    fetchFixturesForDate(dateFrom),
    fetchFixturesForDate(dateTo),
  ]);
  const todayOk = results[0].status === 'fulfilled';
  const tomorrowOk = results[1].status === 'fulfilled';
  const todayFixtures = results[0].status === 'fulfilled' ? results[0].value : [];
  const tomorrowFixtures = results[1].status === 'fulfilled' ? results[1].value : [];
  if (results[0].status === 'rejected') console.error('[fetchMatchesJob] Today fetch failed:', results[0].reason);
  if (results[1].status === 'rejected') console.error('[fetchMatchesJob] Tomorrow fetch failed:', results[1].reason);

  // Abort if BOTH days failed — nothing useful to save
  if (!todayOk && !tomorrowOk) {
    console.error('[fetchMatchesJob] Both API calls failed — aborting to preserve existing data');
    throw new Error('Both fixture API calls failed');
  }

  const allFixtures = todayFixtures.concat(tomorrowFixtures);
  const partialFailure = !todayOk || !tomorrowOk;
  console.log(`[fetchMatchesJob] Raw: today=${todayFixtures.length} tomorrow=${tomorrowFixtures.length} total=${allFixtures.length}${partialFailure ? ' (PARTIAL — one day failed)' : ''}`);

  // 4. Filter by approved leagues
  await reportJobProgress(JOB, 'filter', `Filtering ${allFixtures.length} fixtures by ${leagueIdSet.size} leagues...`, 40);
  const leagueFiltered = allFixtures.filter((f) => leagueIdSet.has(f.league.id));

  // 5. Filter by status
  const statusFiltered = leagueFiltered.filter((f) => ALLOWED_STATUSES.includes(f.fixture.status.short));

  console.log(`[fetchMatchesJob] After league filter: ${leagueFiltered.length}, after status filter: ${statusFiltered.length}`);

  // 6. Transform to rows
  const rows = statusFiltered.map(fixtureToMatchRow);

  // 6b. Enrich live matches with card stats from /fixtures/statistics
  const liveRows = rows.filter(r => LIVE_STATUSES.has(r.status ?? ''));
  if (liveRows.length > 0) {
    await reportJobProgress(JOB, 'stats', `Fetching stats for ${liveRows.length} live matches...`, 55);
    const statsMap = new Map<string, { home_reds: number; away_reds: number; home_yellows: number; away_yellows: number }>();

    await batchRun(liveRows.map(r => async () => {
      try {
        const stats = await fetchFixtureStatistics(r.match_id);
        statsMap.set(r.match_id, {
          home_reds:    statCount(stats, 0, 'Red Cards'),
          away_reds:    statCount(stats, 1, 'Red Cards'),
          home_yellows: statCount(stats, 0, 'Yellow Cards'),
          away_yellows: statCount(stats, 1, 'Yellow Cards'),
        });
      } catch (err) {
        // Non-critical — keep defaults (0)
        console.warn(`[fetchMatchesJob] Stats fetch failed for ${r.match_id}:`, err instanceof Error ? err.message : err);
      }
    }), 5);

    for (const row of rows) {
      const s = statsMap.get(row.match_id);
      if (s) Object.assign(row, s);
    }
    console.log(`[fetchMatchesJob] Enriched stats for ${statsMap.size}/${liveRows.length} live matches`);
  }

  // 7. Archive finished matches before TRUNCATE
  // Archive from BOTH fresh API payload AND existing table to catch
  // matches that transitioned to FT between polls (F2 audit fix).
  await reportJobProgress(JOB, 'archive', 'Archiving finished matches...', 65);
  const freshFinished = leagueFiltered
    .filter((f) => ['FT', 'AET', 'PEN', 'AWD', 'WO'].includes(f.fixture.status.short))
    .map(fixtureToMatchRow);
  const allCurrentMatches = await matchRepo.getAllMatches();
  const archiveByMatchId = new Map<string, matchRepo.MatchRow>();
  // Deduplicate by match_id (fresh rows take precedence — they have final score)
  for (const row of allCurrentMatches) archiveByMatchId.set(row.match_id, row);
  for (const row of freshFinished) archiveByMatchId.set(row.match_id, row);
  const deduped = [...archiveByMatchId.values()];
  const archivedCount = await archiveFinishedMatches(deduped);
  if (archivedCount > 0) {
    console.log(`[fetchMatchesJob] Archived ${archivedCount} FT matches to history (${freshFinished.length} from fresh payload)`);
  }

  // 8. Full-refresh matches table
  // If one day's API call failed, preserve existing rows for the failed date
  // to avoid deleting live/valid matches we couldn't re-fetch.
  let mergedRows = rows;
  if (partialFailure && allCurrentMatches.length > 0) {
    const failedDate = !todayOk ? dateFrom : dateTo;
    const newMatchIds = new Set(rows.map(r => r.match_id));
    const preserved = allCurrentMatches.filter(m => m.date === failedDate && !newMatchIds.has(m.match_id));
    if (preserved.length > 0) {
      mergedRows = rows.concat(preserved);
      console.log(`[fetchMatchesJob] Partial failure — preserved ${preserved.length} existing rows for ${failedDate}`);
    }
  }

  await reportJobProgress(JOB, 'save', `Saving ${mergedRows.length} matches...`, 78);
  const saved = await matchRepo.replaceAllMatches(mergedRows);
  const uniqueLeagues = new Set(mergedRows.map((r) => r.league_id)).size;

  console.log(`[fetchMatchesJob] ✅ Saved ${saved} matches from ${uniqueLeagues} leagues`);

  // 8b. Sync watchlist dates from refreshed matches (fixes stale date/kickoff)
  const synced = await watchlistRepo.syncWatchlistDates();
  if (synced > 0) {
    console.log(`[fetchMatchesJob] Synced ${synced} watchlist date/kickoff entries`);
  }

  // 9. Auto-add Top League matches to Watchlist (NS status only)
  await reportJobProgress(JOB, 'top-leagues', 'Auto-adding top league matches to watchlist...', 85);
  const topLeagues = await leagueRepo.getTopLeagues();
  if (topLeagues.length > 0) {
    const topLeagueIds = new Set(topLeagues.map((l) => l.league_id));
    const topMatches = rows.filter((r) => topLeagueIds.has(r.league_id) && r.status === 'NS');

    // Batch-check existing watchlist entries — one query instead of N sequential queries
    const existingIds = await watchlistRepo.getExistingWatchlistMatchIds(topMatches.map((m) => m.match_id));

    let added = 0;
    for (const m of topMatches) {
      if (existingIds.has(m.match_id)) continue;

      try {
        await watchlistRepo.createWatchlistEntry({
          match_id: m.match_id,
          date: m.date,
          league: m.league_name,
          home_team: m.home_team,
          away_team: m.away_team,
          home_logo: m.home_logo,
          away_logo: m.away_logo,
          kickoff: m.kickoff,
          mode: 'B',
          prediction: null,
          recommended_custom_condition: '',
          recommended_condition_reason: '',
          recommended_condition_reason_vi: '',
          recommended_condition_at: null,
          custom_conditions: '',
          priority: 0,
          status: 'active',
          added_by: 'top-league-auto',
          last_checked: null,
          total_checks: 0,
          recommendations_count: 0,
          strategic_context: null,
          strategic_context_at: null,
        });
        added++;
      } catch (err: unknown) {
        // Unique constraint violation from concurrent insert — safe to ignore
        const msg = err instanceof Error ? err.message : String(err);
        if (!msg.includes('duplicate') && !msg.includes('unique')) throw err;
      }
    }

    if (added > 0) {
      console.log(`[fetchMatchesJob] ⭐ Auto-added ${added} top-league matches to watchlist`);
    }
  }

  // ── Adaptive polling: set next allowed run time based on match state ──────
  try {
    const scheduleState = await matchRepo.getMatchScheduleState(config.timezone);
    const delayMs = computeNextPollDelayMs(scheduleState, config.jobFetchMatchesMs);
    const redis = getRedisClient();
    await redis.set(ADAPTIVE_SKIP_KEY, String(Date.now() + delayMs), 'PX', delayMs + 10_000);
    if (delayMs > config.jobFetchMatchesMs) {
      console.log(
        `[fetchMatchesJob] Adaptive: next poll in ${(delayMs / 60_000).toFixed(0)}min` +
        ` (live=${scheduleState.liveCount}, ns=${scheduleState.nsCount}, minsToNext=${scheduleState.minsToNextKickoff?.toFixed(1) ?? 'none'})`,
      );
    }
  } catch {
    // Non-critical — if this fails, job just runs at base interval
  }

  return { saved, leagues: uniqueLeagues };
}
