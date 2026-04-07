// ============================================================
// Job: Fetch Matches
//
// 1. Read active approved leagues from DB
// 2. Call API-Football for yesterday + today + tomorrow fixtures (3 date requests per run — no extra live=all call).
// 3. Filter by league + status
// 4. Full-refresh matches table
// 5. Archive finished rows before replacing the table
// ============================================================

import { config } from '../config.js';
import { fetchFixturesForDate, type ApiFixture, type ApiFixtureStat } from '../lib/football-api.js';
import { kickoffAtUtcFromFixtureDate } from '../lib/kickoff-time.js';
import { ensureFixtureStatistics } from '../lib/provider-insight-cache.js';
import { getRedisClient } from '../lib/redis.js';
import { extractRegularTimeScoreFromFixture } from '../lib/settle-context.js';
import { mergeApiFixtureStatistics } from '../lib/settlement-stat-cache.js';
import { reportJobProgress } from './job-progress.js';
import * as leagueRepo from '../repos/leagues.repo.js';
import {
  archiveFinishedMatches,
  getHistoricalMatchesBatch,
  type MatchHistoryArchiveInput,
} from '../repos/matches-history.repo.js';
import * as matchRepo from '../repos/matches.repo.js';

const ALLOWED_STATUSES = ['NS', '1H', 'HT', '2H', 'ET', 'BT', 'P', 'LIVE', 'INT'];
const LIVE_STATUSES = new Set(['1H', 'HT', '2H', 'ET', 'BT', 'LIVE', 'INT']);

async function batchRun<T>(tasks: Array<() => Promise<T>>, concurrency = 5): Promise<T[]> {
  const results: T[] = [];
  for (let i = 0; i < tasks.length; i += concurrency) {
    const chunk = tasks.slice(i, i + concurrency);
    results.push(...await Promise.all(chunk.map((task) => task())));
  }
  return results;
}

function statCount(stats: ApiFixtureStat[], teamIdx: 0 | 1, name: string): number {
  const value = stats[teamIdx]?.statistics.find((stat) => stat.type === name)?.value;
  if (value == null) return 0;
  const parsed = typeof value === 'number' ? value : parseInt(String(value), 10);
  return Number.isNaN(parsed) ? 0 : parsed;
}

export const ADAPTIVE_SKIP_KEY = 'job:fetch-matches:next-run-at';

export function computeNextPollDelayMs(
  state: matchRepo.MatchScheduleState,
  baseIntervalMs: number,
): number {
  const minute = 60_000;

  if (state.liveCount > 0) return baseIntervalMs;
  if (state.minsToNextKickoff === null) return 30 * minute;

  const minsToNextKickoff = state.minsToNextKickoff;
  if (minsToNextKickoff <= 5) return baseIntervalMs;
  if (minsToNextKickoff <= 120) return 2 * minute;
  if (minsToNextKickoff <= 360) return 5 * minute;
  return 30 * minute;
}

function toDateString(date: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const part = (type: string) => parts.find((entry) => entry.type === type)!.value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}

function fixtureToMatchRow(fixture: ApiFixture): matchRepo.MatchRow {
  const parts = String(fixture.fixture.date).split('T');
  const datePart = parts[0] || '';
  const kickoff = (parts[1] || '').substring(0, 5);
  const halftime = fixture.score?.halftime;

  return {
    match_id: String(fixture.fixture.id),
    date: datePart,
    kickoff,
    kickoff_at_utc: kickoffAtUtcFromFixtureDate(String(fixture.fixture.date)),
    league_id: fixture.league.id,
    league_name: fixture.league.name,
    home_team: fixture.teams.home.name,
    away_team: fixture.teams.away.name,
    home_logo: fixture.teams.home.logo,
    away_logo: fixture.teams.away.logo,
    venue: fixture.fixture.venue?.name || 'TBD',
    status: fixture.fixture.status.short,
    home_score: fixture.goals.home,
    away_score: fixture.goals.away,
    current_minute: fixture.fixture.status.elapsed,
    last_updated: new Date().toISOString(),
    home_team_id: fixture.teams.home.id,
    away_team_id: fixture.teams.away.id,
    round: fixture.league.round ?? '',
    halftime_home: halftime?.home ?? null,
    halftime_away: halftime?.away ?? null,
    referee: fixture.fixture.referee ?? null,
    home_reds: 0,
    away_reds: 0,
    home_yellows: 0,
    away_yellows: 0,
  };
}

export async function fetchMatchesJob(): Promise<{ saved: number; leagues: number }> {
  const jobName = 'fetch-matches';

  try {
    const redis = getRedisClient();
    const nextRunAt = await redis.get(ADAPTIVE_SKIP_KEY);
    if (nextRunAt && Date.now() < Number(nextRunAt)) {
      const remainSec = Math.round((Number(nextRunAt) - Date.now()) / 1000);
      console.log(`[fetchMatchesJob] Skipping - next allowed run in ${remainSec}s`);
      return { saved: 0, leagues: 0 };
    }
  } catch {
    // Redis unavailable -> proceed with fetch.
  }

  await reportJobProgress(jobName, 'leagues', 'Loading active leagues...', 5);
  const activeLeagues = await leagueRepo.getActiveLeagues();
  if (activeLeagues.length === 0) {
    console.log('[fetchMatchesJob] No active leagues, skip.');
    try {
      const redis = getRedisClient();
      await redis.set(ADAPTIVE_SKIP_KEY, String(Date.now() + 30 * 60_000), 'PX', 30 * 60_000 + 5_000);
    } catch {
      // ignore
    }
    return { saved: 0, leagues: 0 };
  }
  const leagueIdSet = new Set(activeLeagues.map((league) => league.league_id));

  const now = new Date();
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  /** Always include yesterday — not only 00:00–06:00 local. Otherwise after 06:00 the job
   * stops requesting the prior calendar day, and replaceAllMatches drops still-LIVE fixtures
   * whose API fixture.date is “yesterday” (cross-midnight / server TZ vs user TZ). */
  const dateYesterday = toDateString(yesterday, config.timezone);
  const dateFrom = toDateString(now, config.timezone);
  const dateTo = toDateString(tomorrow, config.timezone);

  const fetchLabel = `${dateYesterday}, ${dateFrom}, ${dateTo}`;
  await reportJobProgress(jobName, 'api', `Fetching fixtures for ${fetchLabel}...`, 15);

  let yesterdayFixtures: ApiFixture[] = [];
  try {
    yesterdayFixtures = await fetchFixturesForDate(dateYesterday);
    console.log(`[fetchMatchesJob] Yesterday window: ${yesterdayFixtures.length} fixtures for ${dateYesterday}`);
  } catch (err) {
    console.warn('[fetchMatchesJob] Yesterday fetch failed (non-critical):', err instanceof Error ? err.message : err);
  }

  const [resultToday, resultTomorrow] = await Promise.allSettled([
    fetchFixturesForDate(dateFrom),
    fetchFixturesForDate(dateTo),
  ]);
  const todayOk = resultToday.status === 'fulfilled';
  const tomorrowOk = resultTomorrow.status === 'fulfilled';
  const todayFixtures = todayOk ? resultToday.value : [];
  const tomorrowFixtures = tomorrowOk ? resultTomorrow.value : [];

  if (!todayOk) console.error('[fetchMatchesJob] Today fetch failed:', resultToday.reason);
  if (!tomorrowOk) console.error('[fetchMatchesJob] Tomorrow fetch failed:', resultTomorrow.reason);

  if (!todayOk && !tomorrowOk) {
    console.error('[fetchMatchesJob] Both API calls failed - aborting to preserve existing data');
    throw new Error('Both fixture API calls failed');
  }

  const allFixtures = yesterdayFixtures.concat(todayFixtures).concat(tomorrowFixtures);
  const partialFailure = !todayOk || !tomorrowOk;
  console.log(
    `[fetchMatchesJob] Raw: yesterday=${yesterdayFixtures.length} today=${todayFixtures.length}` +
    ` tomorrow=${tomorrowFixtures.length} total=${allFixtures.length}` +
    (partialFailure ? ' (partial - one day failed)' : ''),
  );

  await reportJobProgress(
    jobName,
    'filter',
    `Filtering ${allFixtures.length} fixtures by ${leagueIdSet.size} leagues...`,
    40,
  );
  const leagueFiltered = allFixtures.filter((fixture) => leagueIdSet.has(fixture.league.id));
  const statusFiltered = leagueFiltered.filter((fixture) => ALLOWED_STATUSES.includes(fixture.fixture.status.short));

  console.log(
    `[fetchMatchesJob] After league filter: ${leagueFiltered.length}, after status filter: ${statusFiltered.length}`,
  );

  const rows = statusFiltered.map(fixtureToMatchRow);
  const liveRows = rows.filter((row) => LIVE_STATUSES.has(row.status ?? ''));
  const freshFinishedFixtures = leagueFiltered.filter((fixture) =>
    ['FT', 'AET', 'PEN', 'AWD', 'WO'].includes(fixture.fixture.status.short),
  );
  const finishedHistoryMap = await getHistoricalMatchesBatch(
    freshFinishedFixtures.map((fixture) => String(fixture.fixture.id)),
  );

  const playableFinished = freshFinishedFixtures.filter((fixture) =>
    ['FT', 'AET', 'PEN'].includes(fixture.fixture.status.short) &&
    !finishedHistoryMap.get(String(fixture.fixture.id))?.settlement_stats_fetched_at,
  );

  const allNeedingStats = [
    ...liveRows.map((row) => row.match_id),
    ...playableFinished.map((fixture) => String(fixture.fixture.id)),
  ];
  const statsContext = new Map<string, {
    status: string;
    matchMinute: number | null;
    acceptFinishedPayloadRegardlessOfTtl: boolean;
    freshnessMode?: 'real_required';
  }>();
  for (const row of liveRows) {
    statsContext.set(row.match_id, {
      status: row.status,
      matchMinute: row.current_minute ?? null,
      acceptFinishedPayloadRegardlessOfTtl: false,
      freshnessMode: 'real_required',
    });
  }
  for (const fixture of playableFinished) {
    const matchId = String(fixture.fixture.id);
    statsContext.set(matchId, {
      status: fixture.fixture.status.short,
      matchMinute: fixture.fixture.status.elapsed,
      acceptFinishedPayloadRegardlessOfTtl: true,
    });
  }

  const rawStatsMap = new Map<string, ApiFixtureStat[]>();
  if (allNeedingStats.length > 0) {
    await reportJobProgress(
      jobName,
      'stats',
      `Fetching stats for ${liveRows.length} live + ${playableFinished.length} finished matches...`,
      55,
    );
    await batchRun(
      allNeedingStats.map((matchId) => async () => {
        try {
          const stats = await ensureFixtureStatistics(matchId, statsContext.get(matchId));
          rawStatsMap.set(matchId, stats.payload);
        } catch (err) {
          console.warn(`[fetchMatchesJob] Stats fetch failed for ${matchId}:`, err instanceof Error ? err.message : err);
        }
      }),
      5,
    );
  }

  if (liveRows.length > 0) {
    let enrichedLive = 0;
    for (const row of rows) {
      const stats = rawStatsMap.get(row.match_id);
      if (!stats) continue;
      row.home_reds = statCount(stats, 0, 'Red Cards');
      row.away_reds = statCount(stats, 1, 'Red Cards');
      row.home_yellows = statCount(stats, 0, 'Yellow Cards');
      row.away_yellows = statCount(stats, 1, 'Yellow Cards');
      enrichedLive++;
    }
    console.log(`[fetchMatchesJob] Enriched card stats for ${enrichedLive}/${liveRows.length} live matches`);
  }

  const finishedStatsMap = new Map<string, ReturnType<typeof mergeApiFixtureStatistics>>();
  const statsFetchedAt = new Date().toISOString();
  const fetchedMatchIds = new Set(playableFinished.map((fixture) => String(fixture.fixture.id)));
  for (const fixture of playableFinished) {
    const matchId = String(fixture.fixture.id);
    const merged = mergeApiFixtureStatistics(rawStatsMap.get(matchId) ?? []);
    if (merged.length > 0) finishedStatsMap.set(matchId, merged);
  }
  if (playableFinished.length > 0) {
    console.log(
      `[fetchMatchesJob] Fetched settlement stats for ${finishedStatsMap.size}/${playableFinished.length} finished matches`,
    );
  }

  await reportJobProgress(jobName, 'archive', 'Archiving finished matches...', 65);
  const freshFinished = freshFinishedFixtures.map(fixtureToMatchRow);
  const allCurrentMatches = await matchRepo.getAllMatches();
  const archiveByMatchId = new Map<string, MatchHistoryArchiveInput | matchRepo.MatchRow>();
  for (const row of allCurrentMatches) archiveByMatchId.set(row.match_id, row);
  for (const fixture of freshFinishedFixtures) {
    const matchId = String(fixture.fixture.id);
    archiveByMatchId.set(
      matchId,
      buildArchiveRowFromFixture(
        fixture,
        finishedStatsMap.get(matchId) ?? [],
        fetchedMatchIds.has(matchId) ? statsFetchedAt : null,
      ),
    );
  }
  const archivedCount = await archiveFinishedMatches([...archiveByMatchId.values()]);
  if (archivedCount > 0) {
    console.log(
      `[fetchMatchesJob] Archived ${archivedCount} FT matches to history (${freshFinished.length} from fresh payload)`,
    );
  }

  const newMatchIds = new Set(rows.map((row) => row.match_id));
  let mergedRows = rows;
  if (partialFailure && allCurrentMatches.length > 0) {
    const failedDate = !todayOk ? dateFrom : dateTo;
    const preserved = allCurrentMatches.filter((match) => match.date === failedDate && !newMatchIds.has(match.match_id));
    if (preserved.length > 0) {
      mergedRows = rows.concat(preserved);
      console.log(`[fetchMatchesJob] Partial failure - preserved ${preserved.length} existing rows for ${failedDate}`);
    }
  }

  await reportJobProgress(jobName, 'save', `Saving ${mergedRows.length} matches...`, 78);
  const saved = await matchRepo.replaceAllMatches(mergedRows);
  const uniqueLeagues = new Set(mergedRows.map((row) => row.league_id)).size;
  console.log(`[fetchMatchesJob] Saved ${saved} matches from ${uniqueLeagues} leagues`);

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
    // Non-critical.
  }

  return { saved, leagues: uniqueLeagues };
}

function buildArchiveRowFromFixture(
  fixture: ApiFixture,
  settlementStats: ReturnType<typeof mergeApiFixtureStatistics>,
  settlementStatsFetchedAt: string | null = null,
): MatchHistoryArchiveInput {
  const regularTimeScore = extractRegularTimeScoreFromFixture(fixture);
  return {
    match_id: String(fixture.fixture.id),
    date: fixture.fixture.date.substring(0, 10),
    kickoff: fixture.fixture.date.substring(11, 16),
    kickoff_at_utc: kickoffAtUtcFromFixtureDate(String(fixture.fixture.date)),
    league_id: fixture.league.id,
    league_name: fixture.league.name,
    home_team: fixture.teams.home.name,
    away_team: fixture.teams.away.name,
    venue: fixture.fixture.venue?.name || 'TBD',
    final_status: fixture.fixture.status.short,
    home_score: fixture.goals.home ?? 0,
    away_score: fixture.goals.away ?? 0,
    regular_home_score: regularTimeScore?.home ?? null,
    regular_away_score: regularTimeScore?.away ?? null,
    result_provider: 'api-football',
    settlement_stats: settlementStats,
    settlement_stats_provider: settlementStats.length > 0 ? 'api-football' : '',
    settlement_stats_fetched_at: settlementStatsFetchedAt,
  };
}
