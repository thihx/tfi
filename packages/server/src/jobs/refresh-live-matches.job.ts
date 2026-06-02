import type { ApiFixture, ApiFixtureStat } from '../lib/football-api.js';
import { config } from '../config.js';
import { skipIfFootballApiCircuitOpen } from '../lib/football-api-circuit.js';
import { kickoffAtUtcFromFixtureDate } from '../lib/kickoff-time.js';
import { ensureFixtureStatistics, ensureFixturesForMatchIds } from '../lib/provider-insight-cache.js';
import { archiveFinishedMatches, type MatchHistoryArchiveInput } from '../repos/matches-history.repo.js';
import * as matchRepo from '../repos/matches.repo.js';
import * as watchlistRepo from '../repos/watchlist.repo.js';
import { reportJobProgress } from './job-progress.js';

const LIVE_STATUSES = new Set(['1H', 'HT', '2H', 'ET', 'BT', 'P', 'LIVE', 'INT']);
const TERMINAL_STATUSES = new Set(['FT', 'AET', 'PEN', 'AWD', 'WO']);
const TRACK_NS_BEFORE_KICKOFF_MIN = 10;
const TRACK_NS_AFTER_KICKOFF_MIN = 10;
const STAT_CONCURRENCY = 4;
const DEFAULT_MAX_PUBLIC_MATCHES = 40;

function shouldTrackMatch(row: matchRepo.MatchRow, now = Date.now()): boolean {
  const status = String(row.status || '').trim().toUpperCase();
  if (LIVE_STATUSES.has(status)) return true;
  if (status !== 'NS') return false;

  const kickoff = row.kickoff_at_utc
    ? new Date(row.kickoff_at_utc)
    : kickoffAtUtcFromFixtureDate(`${row.date}T${row.kickoff}:00`);
  const kickoffDate = kickoff instanceof Date ? kickoff : new Date(kickoff ?? '');
  if (Number.isNaN(kickoffDate.getTime())) return false;

  const elapsedMin = (now - kickoffDate.getTime()) / 60_000;
  return elapsedMin >= -TRACK_NS_BEFORE_KICKOFF_MIN && elapsedMin < TRACK_NS_AFTER_KICKOFF_MIN;
}

function statCount(stats: ApiFixtureStat[], teamIdx: 0 | 1, name: string): number {
  const value = stats[teamIdx]?.statistics.find((entry) => entry.type === name)?.value;
  if (value == null) return 0;
  const parsed = typeof value === 'number' ? value : parseInt(String(value), 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

function publicRefreshLimit(): number {
  const configured = Number(config.jobRefreshLiveMatchesMaxPublicMatches);
  if (!Number.isFinite(configured)) return DEFAULT_MAX_PUBLIC_MATCHES;
  return Math.max(0, Math.floor(configured));
}

function prioritizePublicCandidates(
  rows: matchRepo.MatchRow[],
  watchedMatchIds: Set<string>,
  limit = publicRefreshLimit(),
): matchRepo.MatchRow[] {
  if (limit <= 0) return [];
  return [...rows]
    .sort((left, right) => {
      const leftWatched = watchedMatchIds.has(String(left.match_id)) ? 0 : 1;
      const rightWatched = watchedMatchIds.has(String(right.match_id)) ? 0 : 1;
      if (leftWatched !== rightWatched) return leftWatched - rightWatched;
      const leftKickoff = left.kickoff_at_utc ? Date.parse(left.kickoff_at_utc) : Number.POSITIVE_INFINITY;
      const rightKickoff = right.kickoff_at_utc ? Date.parse(right.kickoff_at_utc) : Number.POSITIVE_INFINITY;
      return leftKickoff - rightKickoff;
    })
    .slice(0, limit);
}

function buildArchiveRowFromFixture(fixture: ApiFixture): MatchHistoryArchiveInput {
  const halftime = fixture.score?.halftime;
  return {
    match_id: String(fixture.fixture.id),
    date: String(fixture.fixture.date).substring(0, 10),
    kickoff: String(fixture.fixture.date).substring(11, 16),
    kickoff_at_utc: kickoffAtUtcFromFixtureDate(String(fixture.fixture.date)),
    league_id: fixture.league.id,
    league_name: fixture.league.name,
    home_team_id: fixture.teams.home.id,
    home_team: fixture.teams.home.name,
    away_team_id: fixture.teams.away.id,
    away_team: fixture.teams.away.name,
    venue: fixture.fixture.venue?.name || 'TBD',
    final_status: fixture.fixture.status.short,
    home_score: fixture.goals.home ?? 0,
    away_score: fixture.goals.away ?? 0,
    regular_home_score: fixture.goals.home ?? null,
    regular_away_score: fixture.goals.away ?? null,
    halftime_home: halftime?.home ?? null,
    halftime_away: halftime?.away ?? null,
    result_provider: 'api-football',
    settlement_stats: [],
    settlement_stats_provider: '',
    settlement_stats_fetched_at: null,
  };
}

async function batchRun<T>(tasks: Array<() => Promise<T>>, concurrency: number): Promise<T[]> {
  const results: T[] = [];
  for (let index = 0; index < tasks.length; index += concurrency) {
    const chunk = tasks.slice(index, index + concurrency);
    results.push(...await Promise.all(chunk.map((task) => task())));
  }
  return results;
}

export async function refreshLiveMatchesJob(): Promise<{
  tracked: number;
  refreshed: number;
  live: number;
  statsRefreshed: number;
  skipped?: boolean;
  skipReason?: string;
  openUntil?: string;
}> {
  const JOB = 'refresh-live-matches';
  const circuitSkip = await skipIfFootballApiCircuitOpen();
  if (circuitSkip) {
    return {
      tracked: 0,
      refreshed: 0,
      live: 0,
      statsRefreshed: 0,
      ...circuitSkip,
    };
  }

  await reportJobProgress(JOB, 'load', 'Loading live and near-live matches...', 10);

  const activeWatchlist = await watchlistRepo.getActiveOperationalWatchlist();
  const watchedMatchIds = new Set(activeWatchlist.map((row) => String(row.match_id)));

  const now = Date.now();
  const kickoffWindowStart = new Date(now - (TRACK_NS_AFTER_KICKOFF_MIN * 60_000)).toISOString();
  const kickoffWindowEnd = new Date(now + (TRACK_NS_BEFORE_KICKOFF_MIN * 60_000)).toISOString();
  const candidateMatches = await matchRepo.getLiveRefreshCandidates(
    [...LIVE_STATUSES],
    kickoffWindowStart,
    kickoffWindowEnd,
  );
  const publicCandidates = prioritizePublicCandidates(
    candidateMatches.filter((row) => shouldTrackMatch(row, now)),
    watchedMatchIds,
  );
  const watchedTracked = publicCandidates.filter((row) => watchedMatchIds.has(String(row.match_id)));
  const tracked = publicCandidates;
  if (tracked.length === 0) {
    return { tracked: 0, refreshed: 0, live: 0, statsRefreshed: 0 };
  }

  const fixtureIds = tracked.map((row) => row.match_id);
  const transitionSensitiveFixtureIds = tracked
    .filter((row) => String(row.status || '').trim().toUpperCase() === 'NS')
    .map((row) => String(row.match_id));
  const liveCount = tracked.filter((row) => LIVE_STATUSES.has(String(row.status || '').trim().toUpperCase())).length;

  await reportJobProgress(JOB, 'fixtures', `Refreshing ${fixtureIds.length} tracked fixtures...`, 35);
  // This job exists to keep the live scoreboard fresh enough for UI and coarse
  // candidate detection. Using stale_safe here reuses the provider cache TTL
  // instead of forcing an upstream refresh every scheduler tick.
  const fixtures = await ensureFixturesForMatchIds(fixtureIds, {
    freshnessMode: 'stale_safe',
    forceRefreshIds: transitionSensitiveFixtureIds,
  });
  if (fixtures.length === 0) {
    return { tracked: tracked.length, refreshed: 0, live: liveCount, statsRefreshed: 0 };
  }

  const terminalFixtures = fixtures.filter((fixture) => TERMINAL_STATUSES.has(String(fixture.fixture.status.short || '').trim().toUpperCase()));
  let terminalRemoved = 0;
  if (terminalFixtures.length > 0) {
    await reportJobProgress(JOB, 'archive', `Archiving ${terminalFixtures.length} completed fixtures...`, 65);
    await archiveFinishedMatches(terminalFixtures.map(buildArchiveRowFromFixture));
    terminalRemoved = await matchRepo.deleteMatchesByIds(terminalFixtures.map((fixture) => String(fixture.fixture.id)));
  }

  const activeFixtures = fixtures.filter((fixture) => !TERMINAL_STATUSES.has(String(fixture.fixture.status.short || '').trim().toUpperCase()));
  const statsMap = new Map<string, { home_reds: number; away_reds: number; home_yellows: number; away_yellows: number }>();
  const liveFixtures = activeFixtures.filter((fixture) => LIVE_STATUSES.has(String(fixture.fixture.status.short || '').trim().toUpperCase()));
  const watchedLiveFixtureIds = new Set(watchedTracked.map((row) => String(row.match_id)));
  const liveFixturesForStats = liveFixtures.filter((fixture) => watchedLiveFixtureIds.has(String(fixture.fixture.id)));
  let statsRefreshed = 0;
  if (liveFixturesForStats.length > 0) {
    await reportJobProgress(JOB, 'stats', `Refreshing live stats for ${liveFixturesForStats.length} watched fixtures...`, 55);
    await batchRun(liveFixturesForStats.map((fixture) => async () => {
      const matchId = String(fixture.fixture.id);
      try {
        const stats = await ensureFixtureStatistics(matchId, {
          status: fixture.fixture.status.short,
          matchMinute: fixture.fixture.status.elapsed,
          freshnessMode: 'stale_safe',
        });
        if (stats.cacheStatus === 'refreshed') {
          statsRefreshed += 1;
        }
        if (stats.payload.length > 0) {
          statsMap.set(matchId, {
            home_reds: statCount(stats.payload, 0, 'Red Cards'),
            away_reds: statCount(stats.payload, 1, 'Red Cards'),
            home_yellows: statCount(stats.payload, 0, 'Yellow Cards'),
            away_yellows: statCount(stats.payload, 1, 'Yellow Cards'),
          });
        }
      } catch {
        // Freshness-first path: if real-time cards are unavailable, keep score update and omit stale card data.
      }
    }), STAT_CONCURRENCY);
  }

  await reportJobProgress(JOB, 'save', `Saving ${activeFixtures.length} live fixture updates...`, 80);
  const updates = activeFixtures.map((fixture) => {
    const key = String(fixture.fixture.id);
    const stats = statsMap.get(key);
    return {
      match_id: key,
      date: String(fixture.fixture.date).substring(0, 10),
      kickoff: String(fixture.fixture.date).substring(11, 16),
      kickoff_at_utc: kickoffAtUtcFromFixtureDate(String(fixture.fixture.date)),
      status: fixture.fixture.status.short,
      home_score: fixture.goals.home,
      away_score: fixture.goals.away,
      current_minute: fixture.fixture.status.elapsed,
      home_reds: stats?.home_reds,
      away_reds: stats?.away_reds,
      home_yellows: stats?.home_yellows,
      away_yellows: stats?.away_yellows,
    } satisfies Partial<matchRepo.MatchRow>;
  });
  const refreshed = updates.length > 0 ? await matchRepo.updateMatches(updates) : 0;
  const changed = refreshed + terminalRemoved;

  await reportJobProgress(JOB, 'done', `Refreshed ${changed} tracked live rows`, 100);
  return { tracked: tracked.length, refreshed: changed, live: liveFixtures.length, statsRefreshed };
}
