import { config } from '../config.js';
import { getMatchesByStatus } from '../repos/matches.repo.js';
import { getActiveOperationalWatchlist } from '../repos/watchlist.repo.js';
import { ensureFixturesForMatchIds, ensureScoutInsight } from '../lib/provider-insight-cache.js';
import { reportJobProgress } from './job-progress.js';

const LIVE_STATUSES = ['1H', '2H', 'HT', 'ET', 'BT', 'P', 'LIVE', 'INT'];
const INSIGHT_CONCURRENCY = 4;

async function batchRun<T>(tasks: Array<() => Promise<T>>, concurrency = INSIGHT_CONCURRENCY): Promise<T[]> {
  const results: T[] = [];
  for (let index = 0; index < tasks.length; index += concurrency) {
    const chunk = tasks.slice(index, index + concurrency);
    results.push(...await Promise.all(chunk.map((task) => task())));
  }
  return results;
}

export async function refreshProviderInsightsJob(): Promise<{
  candidates: number;
  skippedLiveCandidates: number;
  fixturesAvailable: number;
  fixtureRefreshed: number;
  eventRefreshed: number;
  statisticsRefreshed: number;
  lineupsRefreshed: number;
  predictionsRefreshed: number;
  standingsRefreshed: number;
}> {
  const job = 'refresh-provider-insights';
  await reportJobProgress(job, 'load', 'Loading live and watched matches...', 10);

  const [liveMatches, watchlist] = await Promise.all([
    getMatchesByStatus(LIVE_STATUSES),
    getActiveOperationalWatchlist(),
  ]);

  const liveMatchIds = new Set(liveMatches.map((row) => String(row.match_id)));
  const candidateIds = Array.from(new Set(
    watchlist
      .map((row) => String(row.match_id))
      .filter((matchId) => !liveMatchIds.has(matchId)),
  ));
  const skippedLiveCandidates = liveMatchIds.size;

  if (candidateIds.length === 0 || config.jobRefreshProviderInsightsMs === 0) {
    await reportJobProgress(job, 'skip', 'No active insight candidates', 100);
    return {
      candidates: 0,
      skippedLiveCandidates,
      fixturesAvailable: 0,
      fixtureRefreshed: 0,
      eventRefreshed: 0,
      statisticsRefreshed: 0,
      lineupsRefreshed: 0,
      predictionsRefreshed: 0,
      standingsRefreshed: 0,
    };
  }

  await reportJobProgress(job, 'refresh', `Refreshing provider insights for ${candidateIds.length} matches...`, 50);
  const fixtures = await ensureFixturesForMatchIds(candidateIds, { freshnessMode: 'prewarm_only' });
  const fixtureMap = new Map(fixtures.map((fixture) => [String(fixture.fixture.id), fixture]));

  let fixturesAvailable = 0;
  let fixtureRefreshed = 0;
  let eventRefreshed = 0;
  let statisticsRefreshed = 0;
  let lineupsRefreshed = 0;
  let predictionsRefreshed = 0;
  let standingsRefreshed = 0;

  for (const fixture of fixtures) {
    const cacheState = fixtureMap.get(String(fixture.fixture.id));
    if (cacheState) {
      fixturesAvailable += 1;
    }
  }

  await batchRun(candidateIds.map((matchId) => async () => {
    const fixture = fixtureMap.get(matchId) ?? null;
    const status = fixture?.fixture?.status?.short ?? '';
    const started = LIVE_STATUSES.includes(status) || ['FT', 'AET', 'PEN'].includes(status);
    if (started) return null;

    const insight = await ensureScoutInsight(matchId, {
      fixture,
      leagueId: fixture?.league?.id,
      season: fixture?.league?.season,
      status,
      consumer: 'provider-insight-refresh-job',
      sampleProviderData: false,
      freshnessMode: 'prewarm_only',
    });

    if (insight.fixture.cacheStatus === 'refreshed') fixtureRefreshed += 1;
    if (insight.statistics.cacheStatus === 'refreshed') statisticsRefreshed += 1;
    if (insight.events.cacheStatus === 'refreshed') eventRefreshed += 1;
    if (insight.lineups.cacheStatus === 'refreshed') lineupsRefreshed += 1;
    if (insight.prediction.cacheStatus === 'refreshed') predictionsRefreshed += 1;
    if (insight.standings.cacheStatus === 'refreshed') standingsRefreshed += 1;
    return null;
  }));

  const result = {
    candidates: candidateIds.length,
    skippedLiveCandidates,
    fixturesAvailable,
    fixtureRefreshed,
    eventRefreshed,
    statisticsRefreshed,
    lineupsRefreshed,
    predictionsRefreshed,
    standingsRefreshed,
  };
  await reportJobProgress(job, 'complete', 'Provider insights refreshed', 100);
  return result;
}
