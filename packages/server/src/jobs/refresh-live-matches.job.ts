import type { ApiFixtureStat } from '../lib/football-api.js';
import { kickoffAtUtcFromFixtureDate } from '../lib/kickoff-time.js';
import { ensureFixtureStatistics, ensureFixturesForMatchIds } from '../lib/provider-insight-cache.js';
import * as matchRepo from '../repos/matches.repo.js';
import { reportJobProgress } from './job-progress.js';

const LIVE_STATUSES = new Set(['1H', 'HT', '2H', 'ET', 'BT', 'P', 'LIVE', 'INT']);
const TRACK_NS_BEFORE_KICKOFF_MIN = 10;
const TRACK_NS_AFTER_KICKOFF_MIN = 10;
const STAT_CONCURRENCY = 4;

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
}> {
  const JOB = 'refresh-live-matches';
  await reportJobProgress(JOB, 'load', 'Loading live and near-live matches...', 10);

  const now = Date.now();
  const kickoffWindowStart = new Date(now - (TRACK_NS_AFTER_KICKOFF_MIN * 60_000)).toISOString();
  const kickoffWindowEnd = new Date(now + (TRACK_NS_BEFORE_KICKOFF_MIN * 60_000)).toISOString();
  const candidateMatches = await matchRepo.getLiveRefreshCandidates(
    [...LIVE_STATUSES],
    kickoffWindowStart,
    kickoffWindowEnd,
  );
  const tracked = candidateMatches.filter((row) => shouldTrackMatch(row, now));
  if (tracked.length === 0) {
    return { tracked: 0, refreshed: 0, live: 0, statsRefreshed: 0 };
  }

  const fixtureIds = tracked.map((row) => row.match_id);
  const liveCount = tracked.filter((row) => LIVE_STATUSES.has(String(row.status || '').trim().toUpperCase())).length;

  await reportJobProgress(JOB, 'fixtures', `Refreshing ${fixtureIds.length} tracked fixtures...`, 35);
  // This job exists to keep the live scoreboard fresh enough for UI and coarse
  // candidate detection. Using stale_safe here reuses the provider cache TTL
  // instead of forcing an upstream refresh every scheduler tick.
  const fixtures = await ensureFixturesForMatchIds(fixtureIds, { freshnessMode: 'stale_safe' });
  if (fixtures.length === 0) {
    return { tracked: tracked.length, refreshed: 0, live: liveCount, statsRefreshed: 0 };
  }

  const statsMap = new Map<string, { home_reds: number; away_reds: number; home_yellows: number; away_yellows: number }>();
  const liveFixtures = fixtures.filter((fixture) => LIVE_STATUSES.has(String(fixture.fixture.status.short || '').trim().toUpperCase()));
  let statsRefreshed = 0;
  if (liveFixtures.length > 0) {
    await reportJobProgress(JOB, 'stats', `Refreshing live stats for ${liveFixtures.length} fixtures...`, 55);
    await batchRun(liveFixtures.map((fixture) => async () => {
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

  await reportJobProgress(JOB, 'save', `Saving ${fixtures.length} live fixture updates...`, 80);
  const updates = fixtures.map((fixture) => {
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
  const refreshed = await matchRepo.updateMatches(updates);

  await reportJobProgress(JOB, 'done', `Refreshed ${refreshed} tracked live rows`, 100);
  return { tracked: tracked.length, refreshed, live: liveFixtures.length, statsRefreshed };
}
