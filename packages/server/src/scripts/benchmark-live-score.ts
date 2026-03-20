import { fetchFixturesByIds } from '../lib/football-api.js';
import { fetchLiveScoreBenchmarkTrace } from '../lib/live-score-api.js';
import { recordProviderStatsSampleSafe } from '../lib/provider-sampling.js';

function parseArgs(argv: string[]): { fixtureId: string; record: boolean } {
  let fixtureId = '';
  let record = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = argv[i + 1];
    if (arg === '--fixture' && next) {
      fixtureId = next;
      i++;
      continue;
    }
    if (arg === '--record') {
      record = true;
    }
  }

  if (!fixtureId) {
    throw new Error('Usage: tsx src/scripts/benchmark-live-score.ts --fixture <api-sports-fixture-id> [--record]');
  }

  return { fixtureId, record };
}

async function main(): Promise<void> {
  const { fixtureId, record } = parseArgs(process.argv.slice(2));
  const fixtures = await fetchFixturesByIds([fixtureId]);
  const fixture = fixtures[0];
  if (!fixture) throw new Error(`Fixture ${fixtureId} not found via API-Sports`);

  const trace = await fetchLiveScoreBenchmarkTrace(fixture);
  const minute = fixture.fixture?.status?.elapsed ?? null;
  const status = fixture.fixture?.status?.short || '';

  if (record) {
    await recordProviderStatsSampleSafe({
      match_id: fixtureId,
      match_minute: minute,
      match_status: status,
      provider: 'live-score-api',
      consumer: 'manual-benchmark',
      success: trace.error == null && trace.matched,
      latency_ms: trace.latencyMs,
      status_code: trace.statusCode,
      error: trace.error ?? '',
      raw_payload: {
        matched_match: trace.matchedMatch,
        stats: trace.rawStats,
        events: trace.rawEvents,
        candidate_count: trace.rawLiveMatches.length,
      },
      normalized_payload: trace.statsCompact,
      coverage_flags: trace.coverageFlags,
    });
  }

  console.log(JSON.stringify({
    fixtureId,
    match: `${fixture.teams?.home?.name || '?'} vs ${fixture.teams?.away?.name || '?'}`,
    league: fixture.league?.name || '',
    status,
    minute,
    recorded: record,
    trace: {
      matched: trace.matched,
      providerMatchId: trace.providerMatchId,
      providerFixtureId: trace.providerFixtureId,
      error: trace.error,
      latencyMs: trace.latencyMs,
      coverageFlags: trace.coverageFlags,
      matchedMatch: trace.matchedMatch ? {
        id: trace.matchedMatch.id,
        fixture_id: trace.matchedMatch.fixture_id,
        home: trace.matchedMatch.home?.name,
        away: trace.matchedMatch.away?.name,
        competition: trace.matchedMatch.competition?.name,
        time: trace.matchedMatch.time,
        scheduled: trace.matchedMatch.scheduled,
      } : null,
    },
  }, null, 2));
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
