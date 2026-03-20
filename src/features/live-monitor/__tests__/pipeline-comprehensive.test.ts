// ============================================================
// Comprehensive Pipeline Tests — Categories A → F
// Systematically tests ALL Live Monitor scenarios with ≥5
// test cases per scenario, verifying n8n→migration correctness.
//
// A: Football API data simulation (statuses, stats, events)
// B: Auto-trigger scheduled pipeline flow
// C: Manual / Ask-AI pipeline flow
// D: Push notification decisions & channel failures
// E: Database save decisions & data integrity
// F: Custom condition logic
// ============================================================

import { describe, test, expect, vi, beforeEach, type Mock } from 'vitest';
import { runPipeline, runPipelineForMatch } from '../services/pipeline';
import {
  createAppConfig,
  createConfig,
  createWatchlistMatch,
  createFootballApiFixture,
} from './fixtures';
import {
  fixtureNormal2H,
  fixtureNormal1H,
  fixtureHalfTime,
  fixtureFullTime,
  fixtureNotStarted,
  fixtureAbandoned,
  fixtureNoStats,
  fixturePartialStats,
  fixtureEarlyGame,
  fixtureWithRedCard,
  fixtureHighScoring,
  fixtureEndgame,
  fixture2HEarly,
  aiResponsePush,
  aiResponseNoPush,
  aiResponseNoBet,
  aiResponseConditionTriggered,
  aiResponseConditionMatchedNoBet,
  aiResponseBothPushAndCondition,
  aiResponseMarkdownWrapped,
  aiResponseHighConfidence,
  aiResponseLowConfidence,
  oddsResponseEmpty,
  oddsResponseNormal,
} from './simulation-fixtures';

// ==================== Timezone helper ====================

function koreaDateTime(offsetMs = 0) {
  const target = new Date(Date.now() + offsetMs);
  const dateFmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit',
  });
  const timeFmt = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit', hour12: false,
  });
  return { date: dateFmt.format(target), time: timeFmt.format(target) };
}

// ==================== Module Mocks ====================

vi.mock('../services/proxy.service', () => ({
  fetchLiveFixtures: vi.fn(),
  fetchLiveOdds: vi.fn(),
  fetchWatchlistMatches: vi.fn(),
  runAiAnalysis: vi.fn(),
  sendEmail: vi.fn(),
  sendTelegram: vi.fn(),
  saveRecommendation: vi.fn(),
  saveMatchSnapshot: vi.fn(),
  saveOddsMovements: vi.fn(),
  saveAiPerformance: vi.fn(),
  fetchMatchRecommendations: vi.fn(),
  fetchMatchSnapshots: vi.fn(),
  fetchHistoricalPerformance: vi.fn().mockResolvedValue(null),
}));

vi.mock('../services/staleness.service', () => ({
  checkStaleness: vi.fn(),
}));

vi.mock('../config', () => ({
  loadMonitorConfig: vi.fn(),
  createDefaultConfig: vi.fn(),
  saveMonitorConfig: vi.fn(),
}));

import {
  fetchLiveFixtures,
  fetchLiveOdds,
  fetchWatchlistMatches,
  runAiAnalysis,
  sendEmail,
  sendTelegram,
  saveRecommendation,
  saveMatchSnapshot,
  saveOddsMovements,
  saveAiPerformance,
  fetchMatchRecommendations,
  fetchMatchSnapshots,
  fetchHistoricalPerformance,
} from '../services/proxy.service';

import { loadMonitorConfig } from '../config';
import { checkStaleness } from '../services/staleness.service';

// ==================== Shared Helpers ====================

const appConfig = createAppConfig();
const ko = () => koreaDateTime(-60 * 60_000); // 1 hour ago → match started

function defaults(configOverrides?: Record<string, unknown>) {
  const config = createConfig(configOverrides);
  (loadMonitorConfig as Mock).mockReturnValue(config);
  (sendEmail as Mock).mockResolvedValue({ success: true });
  (sendTelegram as Mock).mockResolvedValue({ success: true });
  (saveRecommendation as Mock).mockResolvedValue({ id: 1 });
  (saveMatchSnapshot as Mock).mockResolvedValue(undefined);
  (saveOddsMovements as Mock).mockResolvedValue(undefined);
  (saveAiPerformance as Mock).mockResolvedValue(undefined);
  (fetchMatchRecommendations as Mock).mockResolvedValue([]);
  (fetchMatchSnapshots as Mock).mockResolvedValue([]);
  (checkStaleness as Mock).mockReturnValue({ isStale: false, reason: 'first_analysis' });
  return config;
}

/** Set up a single-match pipeline with the given fixture + AI response */
function singleMatch(
  fixture: ReturnType<typeof createFootballApiFixture>,
  aiResp: string,
  watchlistOverrides?: Record<string, unknown>,
) {
  const k = ko();
  (fetchWatchlistMatches as Mock).mockResolvedValue([
    createWatchlistMatch({ match_id: String(fixture.fixture.id), date: k.date, kickoff: k.time, ...watchlistOverrides }),
  ]);
  (fetchLiveFixtures as Mock).mockResolvedValue([fixture]);
  (fetchLiveOdds as Mock).mockResolvedValue(oddsResponseNormal());
  (runAiAnalysis as Mock).mockResolvedValue(aiResp);
}

beforeEach(() => {
  vi.resetAllMocks();
  (fetchMatchRecommendations as Mock).mockResolvedValue([]);
  (fetchMatchSnapshots as Mock).mockResolvedValue([]);
  (fetchHistoricalPerformance as Mock).mockResolvedValue(null);
  (checkStaleness as Mock).mockReturnValue({ isStale: false, reason: 'first_analysis' });
});

// ================================================================
// ==================== CATEGORY A: Football API Data ==============
// ================================================================

describe('Cat-A: Football API Data Simulation', () => {

  // ── A1: Normal live match statuses ──
  describe('A1: Normal live match (1H / 2H)', () => {
    test('2H minute 65 — proceeds, AI called, save+notify', async () => {
      defaults();
      singleMatch(fixtureNormal2H(), aiResponsePush());

      const ctx = await runPipeline(appConfig, { triggeredBy: 'scheduled' });

      expect(ctx.results).toHaveLength(1);
      expect(ctx.results[0]!.proceeded).toBe(true);
      expect(runAiAnalysis).toHaveBeenCalledTimes(1);
      expect(ctx.results[0]!.saved).toBe(true);
      expect(ctx.results[0]!.notified).toBe(true);
    });

    test('1H minute 25 — proceeds normally', async () => {
      defaults();
      singleMatch(fixtureNormal1H(), aiResponsePush());

      const ctx = await runPipeline(appConfig, { triggeredBy: 'scheduled' });

      expect(ctx.results[0]!.proceeded).toBe(true);
      expect(runAiAnalysis).toHaveBeenCalledTimes(1);
    });

    test('2H minute 60, AI says no push — proceeds but no save/notify', async () => {
      defaults();
      singleMatch(fixtureNormal2H(), aiResponseNoPush());

      const ctx = await runPipeline(appConfig, { triggeredBy: 'scheduled' });

      expect(ctx.results[0]!.proceeded).toBe(true);
      expect(ctx.results[0]!.saved).toBe(false);
      expect(ctx.results[0]!.notified).toBe(false);
    });

    test('high-scoring game 3-2 — proceeds, stats from events available', async () => {
      defaults();
      singleMatch(fixtureHighScoring(), aiResponsePush());

      const ctx = await runPipeline(appConfig, { triggeredBy: 'scheduled' });

      expect(ctx.results[0]!.proceeded).toBe(true);
      expect(ctx.results[0]!.saved).toBe(true);
    });

    test('match with red card — proceeds, AI still called', async () => {
      defaults();
      singleMatch(fixtureWithRedCard(), aiResponsePush());

      const ctx = await runPipeline(appConfig, { triggeredBy: 'scheduled' });

      expect(ctx.results[0]!.proceeded).toBe(true);
      expect(runAiAnalysis).toHaveBeenCalledTimes(1);
    });
  });

  // ── A2: Edge statuses that should NOT proceed ──
  describe('A2: Non-live statuses (HT / FT / NS / ABD)', () => {
    test('HT status — does NOT proceed', async () => {
      defaults();
      singleMatch(fixtureHalfTime(), aiResponsePush());

      const ctx = await runPipeline(appConfig, { triggeredBy: 'scheduled' });

      expect(ctx.results[0]!.proceeded).toBe(false);
      expect(runAiAnalysis).not.toHaveBeenCalled();
    });

    test('FT status — does NOT proceed', async () => {
      defaults();
      singleMatch(fixtureFullTime(), aiResponsePush());

      const ctx = await runPipeline(appConfig, { triggeredBy: 'scheduled' });

      expect(ctx.results[0]!.proceeded).toBe(false);
      expect(runAiAnalysis).not.toHaveBeenCalled();
    });

    test('NS status — does NOT proceed', async () => {
      defaults();
      singleMatch(fixtureNotStarted(), aiResponsePush());

      const ctx = await runPipeline(appConfig, { triggeredBy: 'scheduled' });

      expect(ctx.results[0]!.proceeded).toBe(false);
      expect(runAiAnalysis).not.toHaveBeenCalled();
    });

    test('ABD status — does NOT proceed', async () => {
      defaults();
      singleMatch(fixtureAbandoned(), aiResponsePush());

      const ctx = await runPipeline(appConfig, { triggeredBy: 'scheduled' });

      expect(ctx.results[0]!.proceeded).toBe(false);
    });

    test('HT with force_analyze — DOES proceed (filter bypassed)', async () => {
      const config = defaults();
      config.MANUAL_PUSH_MATCH_IDS = ['12345'];
      singleMatch(fixtureHalfTime(), aiResponsePush());

      const ctx = await runPipeline(appConfig, { triggeredBy: 'manual' });

      expect(ctx.results[0]!.proceeded).toBe(true);
      expect(runAiAnalysis).toHaveBeenCalledTimes(1);
    });
  });

  // ── A3: Stats quality edge cases ──
  describe('A3: Stats quality (missing / partial / early game)', () => {
    test('no stats but 2H 55min — proceeds (stats_quality poor but not early)', async () => {
      defaults();
      singleMatch(fixtureNoStats(), aiResponsePush());

      const ctx = await runPipeline(appConfig, { triggeredBy: 'scheduled' });

      // Minute 55 > 15 → "early game with poor stats" filter doesn't apply
      expect(ctx.results[0]!.proceeded).toBe(true);
    });

    test('partial stats (only possession) — proceeds, AI handles partial data', async () => {
      defaults();
      singleMatch(fixturePartialStats(), aiResponsePush());

      const ctx = await runPipeline(appConfig, { triggeredBy: 'scheduled' });

      expect(ctx.results[0]!.proceeded).toBe(true);
      expect(runAiAnalysis).toHaveBeenCalledTimes(1);
    });

    test('early game min 3, no stats — does NOT proceed (filter 4: early + poor)', async () => {
      defaults();
      singleMatch(fixtureEarlyGame(), aiResponsePush());

      const ctx = await runPipeline(appConfig, { triggeredBy: 'scheduled' });

      // Minute 3 < MIN_MINUTE (5) → filter 2 blocks. Also filter 4 would block
      expect(ctx.results[0]!.proceeded).toBe(false);
      expect(runAiAnalysis).not.toHaveBeenCalled();
    });

    test('early game min 3 with force_analyze — DOES proceed', async () => {
      const config = defaults();
      config.MANUAL_PUSH_MATCH_IDS = ['12345'];
      singleMatch(fixtureEarlyGame(), aiResponsePush());

      const ctx = await runPipeline(appConfig, { triggeredBy: 'manual' });

      expect(ctx.results[0]!.proceeded).toBe(true);
      expect(runAiAnalysis).toHaveBeenCalledTimes(1);
    });

    test('empty stats array, minute 60 — proceeds (not early game)', async () => {
      defaults();
      const fx = fixtureNoStats();
      fx.fixture.status.elapsed = 60;
      singleMatch(fx, aiResponsePush());

      const ctx = await runPipeline(appConfig, { triggeredBy: 'scheduled' });

      expect(ctx.results[0]!.proceeded).toBe(true);
    });
  });

  // ── A4: Odds scenarios ──
  describe('A4: Odds scenarios', () => {
    test('no odds returned — continues with odds_available=false', async () => {
      defaults();
      singleMatch(fixtureNormal2H(), aiResponsePush());
      (fetchLiveOdds as Mock).mockRejectedValue(new Error('429'));

      const ctx = await runPipeline(appConfig, { triggeredBy: 'scheduled' });

      expect(ctx.results[0]!.proceeded).toBe(true);
      expect(runAiAnalysis).toHaveBeenCalledTimes(1);
      expect(saveOddsMovements).not.toHaveBeenCalled();
    });

    test('empty odds response — AI still called', async () => {
      defaults();
      singleMatch(fixtureNormal2H(), aiResponsePush());
      (fetchLiveOdds as Mock).mockResolvedValue(oddsResponseEmpty());

      const ctx = await runPipeline(appConfig, { triggeredBy: 'scheduled' });

      expect(ctx.results[0]!.proceeded).toBe(true);
      expect(runAiAnalysis).toHaveBeenCalledTimes(1);
    });

    test('normal odds — saveOddsMovements called with multiple markets', async () => {
      defaults();
      singleMatch(fixtureNormal2H(), aiResponsePush());

      const ctx = await runPipeline(appConfig, { triggeredBy: 'scheduled' });

      expect(ctx.results[0]!.saved).toBe(true);
      expect(saveOddsMovements).toHaveBeenCalledTimes(1);
      const movements = (saveOddsMovements as Mock).mock.calls[0]![1];
      expect(movements.length).toBeGreaterThan(0);
    });

    test('odds fetch timeout — match still saves if AI pushes', async () => {
      defaults();
      singleMatch(fixtureNormal2H(), aiResponsePush());
      (fetchLiveOdds as Mock).mockRejectedValue(new Error('Timeout'));

      const ctx = await runPipeline(appConfig, { triggeredBy: 'scheduled' });

      expect(ctx.results[0]!.saved).toBe(true);
    });

    test('multiple odds fetch calls for multi-match — each independent', async () => {
      defaults();
      const k = ko();
      (fetchWatchlistMatches as Mock).mockResolvedValue([
        createWatchlistMatch({ match_id: '100', date: k.date, kickoff: k.time }),
        createWatchlistMatch({ match_id: '200', date: k.date, kickoff: k.time }),
      ]);
      (fetchLiveFixtures as Mock).mockResolvedValue([
        fixtureNormal2H(100),
        fixtureNormal2H(200),
      ]);
      // First odds succeeds, second fails
      (fetchLiveOdds as Mock)
        .mockResolvedValueOnce(oddsResponseNormal())
        .mockRejectedValueOnce(new Error('Rate limited'));
      (runAiAnalysis as Mock).mockResolvedValue(aiResponsePush());

      const ctx = await runPipeline(appConfig, { triggeredBy: 'scheduled' });

      expect(ctx.results).toHaveLength(2);
      // Both proceeded — odds failure doesn't block
      expect(ctx.results[0]!.proceeded).toBe(true);
      expect(ctx.results[1]!.proceeded).toBe(true);
    });
  });

  // ── A5: Minute window boundaries ──
  describe('A5: Minute window boundary checks', () => {
    test('minute 5 (=MIN_MINUTE) — proceeds', async () => {
      defaults();
      const fx = createFootballApiFixture({
        fixture: { ...createFootballApiFixture().fixture, status: { long: 'First Half', short: '1H', elapsed: 5 } },
      });
      singleMatch(fx, aiResponsePush());

      const ctx = await runPipeline(appConfig, { triggeredBy: 'scheduled' });

      expect(ctx.results[0]!.proceeded).toBe(true);
    });

    test('minute 4 (< MIN_MINUTE) — does NOT proceed', async () => {
      defaults();
      const fx = createFootballApiFixture({
        fixture: { ...createFootballApiFixture().fixture, status: { long: 'First Half', short: '1H', elapsed: 4 } },
      });
      singleMatch(fx, aiResponsePush());

      const ctx = await runPipeline(appConfig, { triggeredBy: 'scheduled' });

      expect(ctx.results[0]!.proceeded).toBe(false);
    });

    test('minute 85 (=MAX_MINUTE) — proceeds', async () => {
      defaults();
      const fx = createFootballApiFixture({
        fixture: { ...createFootballApiFixture().fixture, status: { long: 'Second Half', short: '2H', elapsed: 85 } },
      });
      singleMatch(fx, aiResponsePush());

      const ctx = await runPipeline(appConfig, { triggeredBy: 'scheduled' });

      expect(ctx.results[0]!.proceeded).toBe(true);
    });

    test('minute 86 (> MAX_MINUTE) — does NOT proceed', async () => {
      defaults();
      const fx = createFootballApiFixture({
        fixture: { ...createFootballApiFixture().fixture, status: { long: 'Second Half', short: '2H', elapsed: 86 } },
      });
      singleMatch(fx, aiResponsePush());

      const ctx = await runPipeline(appConfig, { triggeredBy: 'scheduled' });

      expect(ctx.results[0]!.proceeded).toBe(false);
    });

    test('2H minute 48 — does NOT proceed (2H threshold = 45+5=50)', async () => {
      defaults();
      singleMatch(fixture2HEarly(), aiResponsePush());

      const ctx = await runPipeline(appConfig, { triggeredBy: 'scheduled' });

      expect(ctx.results[0]!.proceeded).toBe(false);
    });

    test('2H minute 50 — proceeds (= 2H threshold)', async () => {
      defaults();
      const fx = createFootballApiFixture({
        fixture: { ...createFootballApiFixture().fixture, status: { long: 'Second Half', short: '2H', elapsed: 50 } },
      });
      singleMatch(fx, aiResponsePush());

      const ctx = await runPipeline(appConfig, { triggeredBy: 'scheduled' });

      expect(ctx.results[0]!.proceeded).toBe(true);
    });
  });
});

// ================================================================
// ==================== CATEGORY B: Auto-Trigger Scheduled =========
// ================================================================

describe('Cat-B: Auto-Trigger (scheduled) Pipeline', () => {

  // ── B1: Normal scheduled run ──
  describe('B1: Normal scheduled run', () => {
    test('scheduled trigger — full pipeline executes', async () => {
      defaults();
      singleMatch(fixtureNormal2H(), aiResponsePush());

      const ctx = await runPipeline(appConfig, { triggeredBy: 'scheduled' });

      expect(ctx.triggeredBy).toBe('scheduled');
      expect(ctx.stage).toBe('complete');
      expect(ctx.results[0]!.saved).toBe(true);
    });

    test('scheduled trigger calls all services in sequence', async () => {
      defaults();
      singleMatch(fixtureNormal2H(), aiResponsePush());

      await runPipeline(appConfig, { triggeredBy: 'scheduled' });

      expect(fetchWatchlistMatches).toHaveBeenCalledTimes(1);
      expect(fetchLiveFixtures).toHaveBeenCalledTimes(1);
      expect(fetchLiveOdds).toHaveBeenCalledTimes(1);
      expect(runAiAnalysis).toHaveBeenCalledTimes(1);
      expect(saveRecommendation).toHaveBeenCalledTimes(1);
      expect(sendEmail).toHaveBeenCalledTimes(1);
      expect(sendTelegram).toHaveBeenCalledTimes(1);
    });

    test('snapshot is saved even for scheduled trigger', async () => {
      defaults();
      singleMatch(fixtureNormal2H(), aiResponsePush());

      await runPipeline(appConfig, { triggeredBy: 'scheduled' });

      expect(saveMatchSnapshot).toHaveBeenCalledTimes(1);
    });

    test('scheduled with empty watchlist — short-circuits', async () => {
      defaults();
      (fetchWatchlistMatches as Mock).mockResolvedValue([]);

      const ctx = await runPipeline(appConfig, { triggeredBy: 'scheduled' });

      expect(ctx.stage).toBe('complete');
      expect(ctx.results).toHaveLength(0);
      expect(fetchLiveFixtures).not.toHaveBeenCalled();
    });

    test('scheduled with multiple matches — processes all', async () => {
      defaults();
      const k = ko();
      (fetchWatchlistMatches as Mock).mockResolvedValue([
        createWatchlistMatch({ match_id: '100', date: k.date, kickoff: k.time }),
        createWatchlistMatch({ match_id: '200', date: k.date, kickoff: k.time }),
        createWatchlistMatch({ match_id: '300', date: k.date, kickoff: k.time }),
      ]);
      (fetchLiveFixtures as Mock).mockResolvedValue([
        fixtureNormal2H(100),
        fixtureNormal2H(200),
        fixtureNormal2H(300),
      ]);
      (fetchLiveOdds as Mock).mockResolvedValue(oddsResponseNormal());
      (runAiAnalysis as Mock).mockResolvedValue(aiResponsePush());

      const ctx = await runPipeline(appConfig, { triggeredBy: 'scheduled' });

      expect(ctx.results).toHaveLength(3);
      expect(ctx.results.every(r => r.proceeded)).toBe(true);
      expect(runAiAnalysis).toHaveBeenCalledTimes(3);
    });
  });

  // ── B2: Filter rejections during scheduled run ──
  describe('B2: Filter rejections during scheduled run', () => {
    test('all matches at HT — none proceed', async () => {
      defaults();
      const k = ko();
      (fetchWatchlistMatches as Mock).mockResolvedValue([
        createWatchlistMatch({ match_id: '100', date: k.date, kickoff: k.time }),
        createWatchlistMatch({ match_id: '200', date: k.date, kickoff: k.time }),
      ]);
      (fetchLiveFixtures as Mock).mockResolvedValue([
        fixtureHalfTime(100),
        fixtureHalfTime(200),
      ]);

      const ctx = await runPipeline(appConfig, { triggeredBy: 'scheduled' });

      expect(ctx.results.every(r => !r.proceeded)).toBe(true);
      expect(runAiAnalysis).not.toHaveBeenCalled();
    });

    test('one live, one HT — only live proceeds', async () => {
      defaults();
      const k = ko();
      (fetchWatchlistMatches as Mock).mockResolvedValue([
        createWatchlistMatch({ match_id: '100', date: k.date, kickoff: k.time }),
        createWatchlistMatch({ match_id: '200', date: k.date, kickoff: k.time }),
      ]);
      (fetchLiveFixtures as Mock).mockResolvedValue([
        fixtureNormal2H(100),
        fixtureHalfTime(200),
      ]);
      (fetchLiveOdds as Mock).mockResolvedValue(oddsResponseNormal());
      (runAiAnalysis as Mock).mockResolvedValue(aiResponsePush());

      const ctx = await runPipeline(appConfig, { triggeredBy: 'scheduled' });

      const r100 = ctx.results.find(r => r.matchId === '100');
      const r200 = ctx.results.find(r => r.matchId === '200');
      expect(r100?.proceeded).toBe(true);
      expect(r200?.proceeded).toBe(false);
      expect(runAiAnalysis).toHaveBeenCalledTimes(1);
    });

    test('late minute 89 — does NOT proceed (> MAX_MINUTE)', async () => {
      defaults();
      singleMatch(fixtureEndgame(), aiResponsePush());

      const ctx = await runPipeline(appConfig, { triggeredBy: 'scheduled' });

      expect(ctx.results[0]!.proceeded).toBe(false);
    });

    test('FT match — does NOT proceed', async () => {
      defaults();
      singleMatch(fixtureFullTime(), aiResponsePush());

      const ctx = await runPipeline(appConfig, { triggeredBy: 'scheduled' });

      expect(ctx.results[0]!.proceeded).toBe(false);
    });

    test('2H early minute 48 — blocked by 2H offset threshold', async () => {
      defaults();
      singleMatch(fixture2HEarly(), aiResponsePush());

      const ctx = await runPipeline(appConfig, { triggeredBy: 'scheduled' });

      expect(ctx.results[0]!.proceeded).toBe(false);
    });
  });

  // ── B3: Staleness during scheduled run ──
  describe('B3: Staleness check during scheduled run', () => {
    test('stale match — skips AI completely', async () => {
      defaults();
      singleMatch(fixtureNormal2H(), aiResponsePush());
      (checkStaleness as Mock).mockReturnValue({ isStale: true, reason: 'no_significant_change' });

      const ctx = await runPipeline(appConfig, { triggeredBy: 'scheduled' });

      expect(ctx.results[0]!.skippedStale).toBe(true);
      expect(runAiAnalysis).not.toHaveBeenCalled();
      expect(saveRecommendation).not.toHaveBeenCalled();
    });

    test('not stale (first_analysis) — AI called', async () => {
      defaults();
      singleMatch(fixtureNormal2H(), aiResponsePush());
      (checkStaleness as Mock).mockReturnValue({ isStale: false, reason: 'first_analysis' });

      const ctx = await runPipeline(appConfig, { triggeredBy: 'scheduled' });

      expect(ctx.results[0]!.skippedStale).toBeUndefined();
      expect(runAiAnalysis).toHaveBeenCalledTimes(1);
    });

    test('stale but force_analyze — AI still called', async () => {
      const config = defaults();
      config.MANUAL_PUSH_MATCH_IDS = ['12345'];
      singleMatch(fixtureNormal2H(), aiResponsePush());
      (checkStaleness as Mock).mockReturnValue({ isStale: true, reason: 'time_gap_short' });

      const ctx = await runPipeline(appConfig, { triggeredBy: 'scheduled' });

      expect(runAiAnalysis).toHaveBeenCalledTimes(1);
      expect(ctx.results[0]!.saved).toBe(true);
    });

    test('mixed: 1 stale + 1 fresh — only fresh gets AI call', async () => {
      defaults();
      const k = ko();
      (fetchWatchlistMatches as Mock).mockResolvedValue([
        createWatchlistMatch({ match_id: '100', date: k.date, kickoff: k.time }),
        createWatchlistMatch({ match_id: '200', date: k.date, kickoff: k.time }),
      ]);
      (fetchLiveFixtures as Mock).mockResolvedValue([
        fixtureNormal2H(100),
        fixtureNormal2H(200),
      ]);
      (fetchLiveOdds as Mock).mockResolvedValue(oddsResponseNormal());
      (runAiAnalysis as Mock).mockResolvedValue(aiResponsePush());
      (checkStaleness as Mock)
        .mockReturnValueOnce({ isStale: true, reason: 'time_gap_short' })
        .mockReturnValueOnce({ isStale: false, reason: 'first_analysis' });

      const ctx = await runPipeline(appConfig, { triggeredBy: 'scheduled' });

      expect(runAiAnalysis).toHaveBeenCalledTimes(1);
      expect(ctx.results.find(r => r.matchId === '100')?.skippedStale).toBe(true);
      expect(ctx.results.find(r => r.matchId === '200')?.saved).toBe(true);
    });

    test('snapshot still saved even for stale match', async () => {
      defaults();
      singleMatch(fixtureNormal2H(), aiResponsePush());
      (checkStaleness as Mock).mockReturnValue({ isStale: true, reason: 'no_change' });

      await runPipeline(appConfig, { triggeredBy: 'scheduled' });

      // Snapshot is saved before staleness check (it's in the data tracking block)
      expect(saveMatchSnapshot).toHaveBeenCalledTimes(1);
    });
  });

  // ── B4: AI response handling ──
  describe('B4: AI response parsing edge cases', () => {
    test('AI response wrapped in markdown — parsed correctly', async () => {
      defaults();
      singleMatch(fixtureNormal2H(), aiResponseMarkdownWrapped());

      const ctx = await runPipeline(appConfig, { triggeredBy: 'scheduled' });

      expect(ctx.results[0]!.proceeded).toBe(true);
      expect(ctx.results[0]!.saved).toBe(true);
    });

    test('AI confidence > 10 — normalized to 0-10 scale', async () => {
      defaults();
      singleMatch(fixtureNormal2H(), aiResponseHighConfidence());

      const ctx = await runPipeline(appConfig, { triggeredBy: 'scheduled' });

      expect(ctx.results[0]!.proceeded).toBe(true);
      const parsed = ctx.results[0]!.parsedAi;
      expect(parsed?.ai_confidence).toBeLessThanOrEqual(10);
    });

    test('AI returns garbage — results in parse error, no save', async () => {
      defaults();
      singleMatch(fixtureNormal2H(), 'This is not JSON at all!!!');

      const ctx = await runPipeline(appConfig, { triggeredBy: 'scheduled' });

      expect(ctx.results[0]!.proceeded).toBe(true);
      expect(ctx.results[0]!.saved).toBe(false);
    });

    test('AI returns empty string — no save, no notify', async () => {
      defaults();
      singleMatch(fixtureNormal2H(), '');

      const ctx = await runPipeline(appConfig, { triggeredBy: 'scheduled' });

      expect(ctx.results[0]!.proceeded).toBe(true);
      expect(ctx.results[0]!.saved).toBe(false);
      expect(ctx.results[0]!.notified).toBe(false);
    });

    test('AI response with low confidence (below MIN_CONFIDENCE) — system_should_bet=false', async () => {
      defaults();
      singleMatch(fixtureNormal2H(), aiResponseLowConfidence());

      const ctx = await runPipeline(appConfig, { triggeredBy: 'scheduled' });

      const parsed = ctx.results[0]!.parsedAi;
      // Confidence 3 < MIN_CONFIDENCE (5) → CONFIDENCE_BELOW_MIN warning → blocks system_should_bet
      expect(parsed?.ai_warnings).toContain('CONFIDENCE_BELOW_MIN');
      expect(parsed?.system_should_bet).toBe(false);
    });
  });

  // ── B5: Error recovery ──
  describe('B5: Error recovery during scheduled run', () => {
    test('fixture fetch fails — pipeline errors', async () => {
      defaults();
      const k = ko();
      (fetchWatchlistMatches as Mock).mockResolvedValue([
        createWatchlistMatch({ match_id: '12345', date: k.date, kickoff: k.time }),
      ]);
      (fetchLiveFixtures as Mock).mockRejectedValue(new Error('API 500'));

      const ctx = await runPipeline(appConfig, { triggeredBy: 'scheduled' });

      expect(ctx.stage).toBe('error');
    });

    test('AI service throws — match has error, pipeline completes', async () => {
      defaults();
      singleMatch(fixtureNormal2H(), '');
      (runAiAnalysis as Mock).mockRejectedValue(new Error('503 Service Unavailable'));

      const ctx = await runPipeline(appConfig, { triggeredBy: 'scheduled' });

      expect(ctx.stage).toBe('complete');
      expect(ctx.results[0]!.stage).toBe('error');
      expect(ctx.results[0]!.error).toContain('503');
    });

    test('save DB fails — error recorded, match continues to notify', async () => {
      defaults();
      singleMatch(fixtureNormal2H(), aiResponsePush());
      (saveRecommendation as Mock).mockRejectedValue(new Error('DB write fail'));

      const ctx = await runPipeline(appConfig, { triggeredBy: 'scheduled' });

      expect(ctx.results[0]!.saved).toBe(false);
      expect(ctx.results[0]!.error).toContain('Save error');
      expect(ctx.results[0]!.stage).toBe('complete');
    });

    test('snapshot tracking failure — no crash', async () => {
      defaults();
      singleMatch(fixtureNormal2H(), aiResponsePush());
      (saveMatchSnapshot as Mock).mockRejectedValue(new Error('Snapshot DB error'));

      const ctx = await runPipeline(appConfig, { triggeredBy: 'scheduled' });

      expect(ctx.stage).toBe('complete');
      expect(ctx.results[0]!.saved).toBe(true);
    });

    test('context fetch failure — AI called anyway (without context)', async () => {
      defaults();
      singleMatch(fixtureNormal2H(), aiResponsePush());
      (fetchMatchRecommendations as Mock).mockRejectedValue(new Error('DB read fail'));
      (fetchMatchSnapshots as Mock).mockRejectedValue(new Error('DB read fail'));

      const ctx = await runPipeline(appConfig, { triggeredBy: 'scheduled' });

      expect(runAiAnalysis).toHaveBeenCalledTimes(1);
      expect(ctx.results[0]!.saved).toBe(true);
    });
  });
});

// ================================================================
// ==================== CATEGORY C: Manual / Ask-AI ================
// ================================================================

describe('Cat-C: Manual / Ask-AI Pipeline', () => {

  // ── C1: Ask-AI with real selection → always save + notify ──
  describe('C1: Ask-AI with real selection', () => {
    test('ask-ai with push selection — save + notify with forceNotify', async () => {
      defaults();
      singleMatch(fixtureNormal2H(), aiResponsePush());

      const ctx = await runPipelineForMatch(appConfig, '12345');

      expect(ctx.triggeredBy).toBe('ask-ai');
      expect(ctx.results[0]!.saved).toBe(true);
      expect(ctx.results[0]!.notified).toBe(true);
    });

    test('ask-ai with no-push AI but real selection — still saves (isAskAi + hasSelection)', async () => {
      defaults();
      // AI says should_push=false but provides a selection
      singleMatch(fixtureNormal2H(), aiResponseNoPush({
        selection: 'Over 2.5 @1.85',
      }));

      const ctx = await runPipelineForMatch(appConfig, '12345');

      // For ask-ai: save if hasSelection, notify always (forceNotify)
      expect(ctx.results[0]!.saved).toBe(true);
      expect(ctx.results[0]!.notified).toBe(true);
    });

    test('ask-ai sets MANUAL_PUSH_MATCH_IDS', async () => {
      defaults();
      singleMatch(fixtureNormal2H(), aiResponsePush());

      await runPipelineForMatch(appConfig, '42');

      expect(loadMonitorConfig).toHaveBeenCalledWith(
        expect.objectContaining({ MANUAL_PUSH_MATCH_IDS: ['42'] }),
      );
    });

    test('ask-ai with configOverrides — passes through', async () => {
      defaults();
      singleMatch(fixtureNormal2H(), aiResponsePush());

      const ctx = await runPipelineForMatch(appConfig, '12345', { AI_PROVIDER: 'claude' });

      expect(loadMonitorConfig).toHaveBeenCalledWith(
        expect.objectContaining({ AI_PROVIDER: 'claude' }),
      );
      expect(ctx.stage).toBe('complete');
    });

    test('ask-ai bypasses staleness', async () => {
      defaults();
      singleMatch(fixtureNormal2H(), aiResponsePush());
      (checkStaleness as Mock).mockReturnValue({ isStale: true, reason: 'recent' });

      // runPipelineForMatch sets MANUAL_PUSH_MATCH_IDS=[matchId] → force_analyze=true
      const ctx = await runPipelineForMatch(appConfig, '12345');

      expect(runAiAnalysis).toHaveBeenCalledTimes(1);
      expect(ctx.results[0]!.saved).toBe(true);
    });
  });

  // ── C2: Ask-AI with "No Bet" or empty selection ──
  describe('C2: Ask-AI with "No Bet" / empty selection', () => {
    test('ask-ai "No Bet" — still notifies (forceNotify) but does NOT save via hasSelection', async () => {
      defaults();
      singleMatch(fixtureNormal2H(), aiResponseNoBet());

      const ctx = await runPipelineForMatch(appConfig, '12345');

      // "No Bet" → hasSelection=false AND shouldSave(parsed)=false → not saved
      // But isAskAi → still notified
      expect(ctx.results[0]!.notified).toBe(true);
      expect(ctx.results[0]!.saved).toBe(false);
    });

    test('ask-ai empty selection — not saved but notified', async () => {
      defaults();
      singleMatch(fixtureNormal2H(), aiResponseNoPush({ selection: '' }));

      const ctx = await runPipelineForMatch(appConfig, '12345');

      expect(ctx.results[0]!.notified).toBe(true);
      expect(ctx.results[0]!.saved).toBe(false);
    });

    test('ask-ai selection="-" — not saved but notified', async () => {
      defaults();
      singleMatch(fixtureNormal2H(), aiResponseNoPush({ selection: '-' }));

      const ctx = await runPipelineForMatch(appConfig, '12345');

      expect(ctx.results[0]!.notified).toBe(true);
      expect(ctx.results[0]!.saved).toBe(false);
    });

    test('ask-ai "no bet" (lowercase) — not saved', async () => {
      defaults();
      singleMatch(fixtureNormal2H(), aiResponseNoPush({ selection: 'no bet' }));

      const ctx = await runPipelineForMatch(appConfig, '12345');

      expect(ctx.results[0]!.saved).toBe(false);
    });

    test('ask-ai with whitespace-only selection — not saved', async () => {
      defaults();
      singleMatch(fixtureNormal2H(), aiResponseNoPush({ selection: '   ' }));

      const ctx = await runPipelineForMatch(appConfig, '12345');

      expect(ctx.results[0]!.saved).toBe(false);
    });
  });

  // ── C3: Ask-AI bypasses filters ──
  describe('C3: Ask-AI force_analyze bypass', () => {
    test('ask-ai on HT match — force_analyze bypasses status filter', async () => {
      defaults();
      singleMatch(fixtureHalfTime(), aiResponsePush());

      const ctx = await runPipelineForMatch(appConfig, '12345');

      expect(ctx.results[0]!.proceeded).toBe(true);
      expect(runAiAnalysis).toHaveBeenCalledTimes(1);
    });

    test('ask-ai on FT match — force_analyze bypasses', async () => {
      defaults();
      singleMatch(fixtureFullTime(), aiResponsePush());

      const ctx = await runPipelineForMatch(appConfig, '12345');

      expect(ctx.results[0]!.proceeded).toBe(true);
    });

    test('ask-ai on early game — force_analyze bypasses minute filter', async () => {
      defaults();
      singleMatch(fixtureEarlyGame(), aiResponsePush());

      const ctx = await runPipelineForMatch(appConfig, '12345');

      expect(ctx.results[0]!.proceeded).toBe(true);
    });

    test('ask-ai on endgame — force_analyze bypasses max minute filter', async () => {
      defaults();
      singleMatch(fixtureEndgame(), aiResponsePush());

      const ctx = await runPipelineForMatch(appConfig, '12345');

      expect(ctx.results[0]!.proceeded).toBe(true);
    });

    test('ask-ai bypasses all 4 filters simultaneously', async () => {
      defaults();
      // NS status + minute 0 + no stats → all filters would reject
      singleMatch(fixtureNotStarted(), aiResponsePush());

      const ctx = await runPipelineForMatch(appConfig, '12345');

      // force_analyze makes all filters log "BYPASSED" but still proceed
      expect(ctx.results[0]!.proceeded).toBe(true);
      expect(runAiAnalysis).toHaveBeenCalledTimes(1);
    });
  });

  // ── C4: Manual (non-ask-ai) trigger ──
  describe('C4: Manual trigger (not ask-ai)', () => {
    test('manual trigger — does NOT forceNotify', async () => {
      defaults();
      singleMatch(fixtureNormal2H(), aiResponseNoPush());

      const ctx = await runPipeline(appConfig, { triggeredBy: 'manual' });

      // should_push=false + non-ask-ai → no notification
      expect(ctx.results[0]!.notified).toBe(false);
    });

    test('manual trigger with push — saves and notifies', async () => {
      defaults();
      singleMatch(fixtureNormal2H(), aiResponsePush());

      const ctx = await runPipeline(appConfig, { triggeredBy: 'manual' });

      expect(ctx.results[0]!.saved).toBe(true);
      expect(ctx.results[0]!.notified).toBe(true);
    });

    test('manual trigger does NOT set force_analyze (no MANUAL_PUSH_MATCH_IDS)', async () => {
      defaults();
      singleMatch(fixtureHalfTime(), aiResponsePush());

      const ctx = await runPipeline(appConfig, { triggeredBy: 'manual' });

      // HT → not proceeded (no force_analyze)
      expect(ctx.results[0]!.proceeded).toBe(false);
    });

    test('manual with webhook match IDs — sets force_analyze', async () => {
      defaults();
      singleMatch(fixtureNormal2H(), aiResponsePush());

      const ctx = await runPipeline(appConfig, { triggeredBy: 'manual', webhookMatchIds: ['12345'] });

      expect(ctx.results[0]!.proceeded).toBe(true);
    });

    test('webhook trigger merges match IDs', async () => {
      const config = defaults();
      config.MANUAL_PUSH_MATCH_IDS = ['existing'];
      singleMatch(fixtureNormal2H(), aiResponsePush());

      await runPipeline(appConfig, { triggeredBy: 'webhook', webhookMatchIds: ['12345'] });

      expect(config.MANUAL_PUSH_MATCH_IDS).toContain('existing');
      expect(config.MANUAL_PUSH_MATCH_IDS).toContain('12345');
    });
  });
});

// ================================================================
// ==================== CATEGORY D: Push Notification ==============
// ================================================================

describe('Cat-D: Push Notification Decisions', () => {

  // ── D1: AI recommendation push ──
  describe('D1: AI recommendation → push notification', () => {
    test('ai_should_push=true — email + telegram sent', async () => {
      defaults();
      singleMatch(fixtureNormal2H(), aiResponsePush());

      await runPipeline(appConfig, { triggeredBy: 'scheduled' });

      expect(sendEmail).toHaveBeenCalledTimes(1);
      expect(sendTelegram).toHaveBeenCalledTimes(1);
    });

    test('ai_should_push=false, condition not matched — NO notification', async () => {
      defaults();
      singleMatch(fixtureNormal2H(), aiResponseNoPush());

      await runPipeline(appConfig, { triggeredBy: 'scheduled' });

      expect(sendEmail).not.toHaveBeenCalled();
      expect(sendTelegram).not.toHaveBeenCalled();
    });

    test('ai_should_push=true but system_should_bet=false (low confidence) — enters notify but determineSection=no_actionable', async () => {
      defaults();
      // should_push=true from AI → ai_should_push=true
      // But confidence=3 < MIN(5) → CONFIDENCE_BELOW_MIN → systemShouldBet=false → finalShouldBet=false
      // shouldPush(parsed) = ai_should_push=true → pipeline ENTERS notifyRecommendation
      // BUT determineSection: ai_should_push=true && should_push(=finalShouldBet)=false → NOT ai_recommendation
      // → no_actionable → shouldNotify=false → no email/telegram sent
      singleMatch(fixtureNormal2H(), aiResponseLowConfidence());

      const ctx = await runPipeline(appConfig, { triggeredBy: 'scheduled' });

      expect(sendEmail).not.toHaveBeenCalled();
      expect(sendTelegram).not.toHaveBeenCalled();
      expect(ctx.results[0]!.notified).toBe(false);
    });

    test('both AI push and condition triggered — both sections in notification', async () => {
      defaults();
      singleMatch(fixtureNormal2H(), aiResponseBothPushAndCondition());

      await runPipeline(appConfig, { triggeredBy: 'scheduled' });

      expect(sendEmail).toHaveBeenCalledTimes(1);
      expect(sendTelegram).toHaveBeenCalledTimes(1);
    });

    test('ask-ai with no push — still notified (forceNotify)', async () => {
      defaults();
      singleMatch(fixtureNormal2H(), aiResponseNoPush());

      const ctx = await runPipelineForMatch(appConfig, '12345');

      expect(ctx.results[0]!.notified).toBe(true);
    });
  });

  // ── D2: Condition-triggered push ──
  describe('D2: Condition-triggered → push notification', () => {
    test('condition_triggered_should_push=true — sends notifications', async () => {
      defaults();
      singleMatch(fixtureNormal2H(), aiResponseConditionTriggered());

      await runPipeline(appConfig, { triggeredBy: 'scheduled' });

      // shouldPush: condition_triggered_should_push=true → notifies
      expect(sendEmail).toHaveBeenCalledTimes(1);
      expect(sendTelegram).toHaveBeenCalledTimes(1);
    });

    test('condition matched but "No bet" suggestion — no save, no notify', async () => {
      defaults();
      singleMatch(fixtureNormal2H(), aiResponseConditionMatchedNoBet());

      const ctx = await runPipeline(appConfig, { triggeredBy: 'scheduled' });

      // condition_triggered_should_push=false (starts with "no bet")
      // shouldPush/shouldSave: only ai_should_push || condition_triggered_should_push
      // Both false → no save, no notify
      expect(sendEmail).not.toHaveBeenCalled();
      expect(ctx.results[0]!.saved).toBe(false);
      expect(ctx.results[0]!.notified).toBe(false);
    });

    test('condition matched with valid suggestion — saves AND notifies', async () => {
      defaults();
      singleMatch(fixtureNormal2H(), aiResponseConditionTriggered());

      const ctx = await runPipeline(appConfig, { triggeredBy: 'scheduled' });

      expect(ctx.results[0]!.saved).toBe(true);
      expect(ctx.results[0]!.notified).toBe(true);
    });

    test('condition not matched + AI no push — no notification', async () => {
      defaults();
      singleMatch(fixtureNormal2H(), aiResponseNoPush({
        custom_condition_matched: false,
        custom_condition_status: 'none',
      }));

      await runPipeline(appConfig, { triggeredBy: 'scheduled' });

      expect(sendEmail).not.toHaveBeenCalled();
      expect(sendTelegram).not.toHaveBeenCalled();
    });

    test('condition status=parse_error — treated as not matched for push decision', async () => {
      defaults();
      singleMatch(fixtureNormal2H(), aiResponseNoPush({
        custom_condition_matched: false,
        custom_condition_status: 'parse_error',
      }));

      await runPipeline(appConfig, { triggeredBy: 'scheduled' });

      expect(sendEmail).not.toHaveBeenCalled();
    });
  });

  // ── D3: Channel failures ──
  describe('D3: Notification channel failures', () => {
    test('email fails, telegram succeeds — partial success', async () => {
      defaults();
      singleMatch(fixtureNormal2H(), aiResponsePush());
      (sendEmail as Mock).mockRejectedValue(new Error('SMTP error'));

      const ctx = await runPipeline(appConfig, { triggeredBy: 'scheduled' });

      // Pipeline doesn't crash, notification partially successful
      expect(ctx.results[0]!.stage).toBe('complete');
      expect(ctx.results[0]!.saved).toBe(true);
    });

    test('telegram fails, email succeeds — partial success', async () => {
      defaults();
      singleMatch(fixtureNormal2H(), aiResponsePush());
      (sendTelegram as Mock).mockRejectedValue(new Error('Telegram API error'));

      const ctx = await runPipeline(appConfig, { triggeredBy: 'scheduled' });

      expect(ctx.results[0]!.stage).toBe('complete');
    });

    test('both email and telegram fail — errors recorded', async () => {
      defaults();
      singleMatch(fixtureNormal2H(), aiResponsePush());
      (sendEmail as Mock).mockRejectedValue(new Error('SMTP error'));
      (sendTelegram as Mock).mockRejectedValue(new Error('Telegram error'));

      const ctx = await runPipeline(appConfig, { triggeredBy: 'scheduled' });

      expect(ctx.results[0]!.stage).toBe('complete');
      expect(ctx.results[0]!.error).toBeDefined();
    });

    test('notification fails but save succeeds — data is preserved', async () => {
      defaults();
      singleMatch(fixtureNormal2H(), aiResponsePush());
      (sendEmail as Mock).mockRejectedValue(new Error('SMTP fail'));
      (sendTelegram as Mock).mockRejectedValue(new Error('Telegram fail'));

      const ctx = await runPipeline(appConfig, { triggeredBy: 'scheduled' });

      // Save happens BEFORE notify, so data is safe
      expect(ctx.results[0]!.saved).toBe(true);
    });

    test('save-before-notify order — confirmed via stage emission', async () => {
      defaults();
      singleMatch(fixtureNormal2H(), aiResponsePush());

      const stages: string[] = [];
      await runPipeline(appConfig, {
        triggeredBy: 'scheduled',
        onProgress: (ctx) => stages.push(ctx.stage),
      });

      const idxSave = stages.indexOf('saving');
      const idxNotify = stages.indexOf('notifying');
      expect(idxSave).toBeLessThan(idxNotify);
    });
  });
});

// ================================================================
// ==================== CATEGORY E: Database Save ==================
// ================================================================

describe('Cat-E: Database Save Decisions & Data Integrity', () => {

  // ── E1: shouldSave conditions ──
  describe('E1: shouldSave trigger conditions', () => {
    test('ai_should_push=true — saves', async () => {
      defaults();
      singleMatch(fixtureNormal2H(), aiResponsePush());

      const ctx = await runPipeline(appConfig, { triggeredBy: 'scheduled' });

      expect(ctx.results[0]!.saved).toBe(true);
      expect(saveRecommendation).toHaveBeenCalledTimes(1);
    });

    test('condition_matched + evaluated (no triggered push) — does NOT save', async () => {
      defaults();
      singleMatch(fixtureNormal2H(), aiResponseNoPush({
        should_push: false,
        custom_condition_matched: true,
        custom_condition_status: 'evaluated',
      }));

      const ctx = await runPipeline(appConfig, { triggeredBy: 'scheduled' });

      // condition_matched + evaluated but condition_triggered_should_push=false
      // → No Bet results are NOT saved
      expect(ctx.results[0]!.saved).toBe(false);
    });

    test('condition_triggered_should_push=true — saves', async () => {
      defaults();
      singleMatch(fixtureNormal2H(), aiResponseConditionTriggered());

      const ctx = await runPipeline(appConfig, { triggeredBy: 'scheduled' });

      expect(ctx.results[0]!.saved).toBe(true);
    });

    test('all false: no ai push, no condition, no triggered — NO save', async () => {
      defaults();
      singleMatch(fixtureNormal2H(), aiResponseNoPush());

      const ctx = await runPipeline(appConfig, { triggeredBy: 'scheduled' });

      expect(ctx.results[0]!.saved).toBe(false);
      expect(saveRecommendation).not.toHaveBeenCalled();
    });

    test('shouldSave consistent with shouldPush (both use same 2 conditions)', async () => {
      defaults();
      singleMatch(fixtureNormal2H(), aiResponsePush());

      const ctx = await runPipeline(appConfig, { triggeredBy: 'scheduled' });

      // If saved, must also be notified (ai_should_push || condition_triggered_should_push)
      const r = ctx.results[0]!;
      if (r.saved) expect(r.notified).toBe(true);
    });
  });

  // ── E2: Ask-AI save special cases ──
  describe('E2: Ask-AI save (isAskAi && hasSelection)', () => {
    test('ask-ai with real selection + AI no-push — saves via isAskAi path', async () => {
      defaults();
      singleMatch(fixtureNormal2H(), aiResponseNoPush({
        selection: 'Under 2.5 @2.00',
      }));

      const ctx = await runPipelineForMatch(appConfig, '12345');

      expect(ctx.results[0]!.saved).toBe(true);
    });

    test('ask-ai with "No Bet" — does NOT save', async () => {
      defaults();
      singleMatch(fixtureNormal2H(), aiResponseNoBet());

      const ctx = await runPipelineForMatch(appConfig, '12345');

      expect(ctx.results[0]!.saved).toBe(false);
    });

    test('ask-ai with "-" selection — does NOT save', async () => {
      defaults();
      singleMatch(fixtureNormal2H(), aiResponseNoPush({ selection: '-' }));

      const ctx = await runPipelineForMatch(appConfig, '12345');

      expect(ctx.results[0]!.saved).toBe(false);
    });

    test('ask-ai with empty selection — does NOT save', async () => {
      defaults();
      singleMatch(fixtureNormal2H(), aiResponseNoPush({ selection: '' }));

      const ctx = await runPipelineForMatch(appConfig, '12345');

      expect(ctx.results[0]!.saved).toBe(false);
    });

    test('ask-ai with "No Bet" case-insensitive — does NOT save', async () => {
      defaults();
      singleMatch(fixtureNormal2H(), aiResponseNoPush({ selection: 'NO BET' }));

      const ctx = await runPipelineForMatch(appConfig, '12345');

      expect(ctx.results[0]!.saved).toBe(false);
    });
  });

  // ── E3: Data integrity ──
  describe('E3: Save data integrity', () => {
    test('recommendation includes execution_id', async () => {
      defaults();
      singleMatch(fixtureNormal2H(), aiResponsePush());

      await runPipeline(appConfig, { triggeredBy: 'scheduled' });

      expect(saveRecommendation).toHaveBeenCalledTimes(1);
      const recData = (saveRecommendation as Mock).mock.calls[0]![1];
      expect(recData.execution_id).toBeDefined();
      expect(recData.execution_id).toMatch(/^tfi_/);
    });

    test('recommendation includes match metadata', async () => {
      defaults();
      singleMatch(fixtureNormal2H(), aiResponsePush());

      await runPipeline(appConfig, { triggeredBy: 'scheduled' });

      const recData = (saveRecommendation as Mock).mock.calls[0]![1];
      expect(recData.match_id).toBe('12345');
      expect(recData.match_display).toContain('Arsenal');
      expect(recData.match_display).toContain('Chelsea');
    });

    test('recommendation includes AI model info', async () => {
      defaults();
      singleMatch(fixtureNormal2H(), aiResponsePush());

      await runPipeline(appConfig, { triggeredBy: 'scheduled' });

      const recData = (saveRecommendation as Mock).mock.calls[0]![1];
      expect(recData.ai_model).toBeDefined();
    });

    test('saveAiPerformance called with correct recommendation_id', async () => {
      defaults();
      singleMatch(fixtureNormal2H(), aiResponsePush());
      (saveRecommendation as Mock).mockResolvedValue({ id: 777 });

      await runPipeline(appConfig, { triggeredBy: 'scheduled' });

      expect(saveAiPerformance).toHaveBeenCalledWith(
        appConfig,
        expect.objectContaining({ recommendation_id: 777 }),
      );
    });

    test('no save → no saveAiPerformance', async () => {
      defaults();
      singleMatch(fixtureNormal2H(), aiResponseNoPush());

      await runPipeline(appConfig, { triggeredBy: 'scheduled' });

      expect(saveRecommendation).not.toHaveBeenCalled();
      expect(saveAiPerformance).not.toHaveBeenCalled();
    });
  });

  // ── E4: Snapshot + odds movement tracking ──
  describe('E4: Snapshot and odds movement tracking', () => {
    test('saveMatchSnapshot called with correct data', async () => {
      defaults();
      singleMatch(fixtureNormal2H(), aiResponsePush());

      await runPipeline(appConfig, { triggeredBy: 'scheduled' });

      expect(saveMatchSnapshot).toHaveBeenCalledWith(
        appConfig,
        expect.objectContaining({
          match_id: '12345',
          minute: expect.any(Number),
          status: expect.any(String),
        }),
      );
    });

    test('odds movements saved for each market', async () => {
      defaults();
      singleMatch(fixtureNormal2H(), aiResponsePush());

      await runPipeline(appConfig, { triggeredBy: 'scheduled' });

      expect(saveOddsMovements).toHaveBeenCalledTimes(1);
      const movements = (saveOddsMovements as Mock).mock.calls[0]![1];
      // Should have entries for 1x2, ou, btts at minimum
      const markets = movements.map((m: { market: string }) => m.market);
      expect(markets).toContain('1x2');
      expect(markets).toContain('ou');
    });

    test('odds unavailable — no odds movements saved', async () => {
      defaults();
      singleMatch(fixtureNormal2H(), aiResponsePush());
      (fetchLiveOdds as Mock).mockRejectedValue(new Error('429'));

      await runPipeline(appConfig, { triggeredBy: 'scheduled' });

      expect(saveOddsMovements).not.toHaveBeenCalled();
      // But snapshot still saved
      expect(saveMatchSnapshot).toHaveBeenCalledTimes(1);
    });

    test('tracking failures are non-fatal', async () => {
      defaults();
      singleMatch(fixtureNormal2H(), aiResponsePush());
      (saveMatchSnapshot as Mock).mockRejectedValue(new Error('DB error'));
      (saveOddsMovements as Mock).mockRejectedValue(new Error('DB error'));
      (saveAiPerformance as Mock).mockRejectedValue(new Error('DB error'));

      const ctx = await runPipeline(appConfig, { triggeredBy: 'scheduled' });

      expect(ctx.stage).toBe('complete');
      expect(ctx.results[0]!.saved).toBe(true);
    });

    test('snapshot saved per match in multi-match pipeline', async () => {
      defaults();
      const k = ko();
      (fetchWatchlistMatches as Mock).mockResolvedValue([
        createWatchlistMatch({ match_id: '100', date: k.date, kickoff: k.time }),
        createWatchlistMatch({ match_id: '200', date: k.date, kickoff: k.time }),
      ]);
      (fetchLiveFixtures as Mock).mockResolvedValue([
        fixtureNormal2H(100),
        fixtureNormal2H(200),
      ]);
      (fetchLiveOdds as Mock).mockResolvedValue(oddsResponseNormal());
      (runAiAnalysis as Mock).mockResolvedValue(aiResponsePush());

      await runPipeline(appConfig, { triggeredBy: 'scheduled' });

      expect(saveMatchSnapshot).toHaveBeenCalledTimes(2);
    });
  });
});

// ================================================================
// ==================== CATEGORY F: Custom Condition Logic =========
// ================================================================

describe('Cat-F: Custom Condition Logic', () => {

  // ── F1: Condition matched with valid suggestion ──
  describe('F1: Condition matched + valid suggestion', () => {
    test('condition_triggered_should_push → saves + notifies', async () => {
      defaults();
      singleMatch(fixtureNormal2H(), aiResponseConditionTriggered());

      const ctx = await runPipeline(appConfig, { triggeredBy: 'scheduled' });

      expect(ctx.results[0]!.saved).toBe(true);
      expect(ctx.results[0]!.notified).toBe(true);
    });

    test('condition triggered confidence >= MIN_CONFIDENCE — push', async () => {
      defaults();
      singleMatch(fixtureNormal2H(), aiResponseConditionTriggered({
        condition_triggered_confidence: 7,
      }));

      const ctx = await runPipeline(appConfig, { triggeredBy: 'scheduled' });

      expect(ctx.results[0]!.notified).toBe(true);
    });

    test('condition triggered confidence < MIN_CONFIDENCE — no save, no push', async () => {
      defaults();
      singleMatch(fixtureNormal2H(), aiResponseConditionTriggered({
        condition_triggered_confidence: 3, // Below MIN of 5
      }));

      const ctx = await runPipeline(appConfig, { triggeredBy: 'scheduled' });

      // condition_triggered_should_push = false (confidence < MIN)
      // ai_should_push = false → shouldSave/shouldPush = false
      expect(ctx.results[0]!.saved).toBe(false);
      expect(ctx.results[0]!.notified).toBe(false);
    });

    test('condition triggered with empty suggestion — no save, no push', async () => {
      defaults();
      singleMatch(fixtureNormal2H(), aiResponseConditionTriggered({
        condition_triggered_suggestion: '',
        condition_triggered_confidence: 8,
      }));

      const ctx = await runPipeline(appConfig, { triggeredBy: 'scheduled' });

      // condition_triggered_should_push=false (empty suggestion)
      // ai_should_push=false → shouldSave/shouldPush = false
      expect(ctx.results[0]!.saved).toBe(false);
      expect(ctx.results[0]!.notified).toBe(false);
    });

    test('condition matched + AI also pushes — both paths trigger', async () => {
      defaults();
      singleMatch(fixtureNormal2H(), aiResponseBothPushAndCondition());

      const ctx = await runPipeline(appConfig, { triggeredBy: 'scheduled' });

      expect(ctx.results[0]!.saved).toBe(true);
      expect(ctx.results[0]!.notified).toBe(true);
    });
  });

  // ── F2: Condition matched but "No bet" suggestion ──
  describe('F2: Condition matched + "No bet" suggestion', () => {
    test('"No bet" condition suggestion — condition_triggered_should_push=false', async () => {
      defaults();
      singleMatch(fixtureNormal2H(), aiResponseConditionMatchedNoBet());

      const ctx = await runPipeline(appConfig, { triggeredBy: 'scheduled' });

      const parsed = ctx.results[0]!.parsedAi;
      expect(parsed?.condition_triggered_should_push).toBe(false);
    });

    test('"No bet" but condition matched + evaluated → NOT saved, NOT notified', async () => {
      defaults();
      singleMatch(fixtureNormal2H(), aiResponseConditionMatchedNoBet());

      const ctx = await runPipeline(appConfig, { triggeredBy: 'scheduled' });

      // condition_triggered_should_push=false ("no bet"), ai_should_push=false
      // → shouldSave=false, shouldPush=false
      expect(ctx.results[0]!.saved).toBe(false);
      expect(sendEmail).not.toHaveBeenCalled();
      expect(ctx.results[0]!.notified).toBe(false);
    });

    test('"no bet - insufficient value" starts with "no bet" — triggered_should_push=false', async () => {
      defaults();
      singleMatch(fixtureNormal2H(), aiResponseNoPush({
        custom_condition_matched: true,
        custom_condition_status: 'evaluated',
        condition_triggered_suggestion: 'no bet - insufficient value',
        condition_triggered_confidence: 8,
      }));

      const ctx = await runPipeline(appConfig, { triggeredBy: 'scheduled' });

      const parsed = ctx.results[0]!.parsedAi;
      expect(parsed?.condition_triggered_should_push).toBe(false);
    });

    test('"No Bet" case-insensitive — triggered_should_push=false', async () => {
      defaults();
      singleMatch(fixtureNormal2H(), aiResponseNoPush({
        custom_condition_matched: true,
        custom_condition_status: 'evaluated',
        condition_triggered_suggestion: 'No Bet',
        condition_triggered_confidence: 7,
      }));

      const ctx = await runPipeline(appConfig, { triggeredBy: 'scheduled' });

      const parsed = ctx.results[0]!.parsedAi;
      expect(parsed?.condition_triggered_should_push).toBe(false);
    });

    test('"No bet" but low confidence anyway — no triggered push', async () => {
      defaults();
      singleMatch(fixtureNormal2H(), aiResponseNoPush({
        custom_condition_matched: true,
        custom_condition_status: 'evaluated',
        condition_triggered_suggestion: 'No Bet',
        condition_triggered_confidence: 2,
      }));

      const ctx = await runPipeline(appConfig, { triggeredBy: 'scheduled' });

      const parsed = ctx.results[0]!.parsedAi;
      expect(parsed?.condition_triggered_should_push).toBe(false);
    });
  });

  // ── F3: No custom condition (status=none) ──
  describe('F3: No custom condition', () => {
    test('condition_status=none, AI pushes — normal AI push flow', async () => {
      defaults();
      singleMatch(fixtureNormal2H(), aiResponsePush({
        custom_condition_matched: false,
        custom_condition_status: 'none',
      }));

      const ctx = await runPipeline(appConfig, { triggeredBy: 'scheduled' });

      expect(ctx.results[0]!.saved).toBe(true);
      expect(ctx.results[0]!.notified).toBe(true);
    });

    test('condition_status=none, AI no push — no save/notify', async () => {
      defaults();
      singleMatch(fixtureNormal2H(), aiResponseNoPush({
        custom_condition_matched: false,
        custom_condition_status: 'none',
      }));

      const ctx = await runPipeline(appConfig, { triggeredBy: 'scheduled' });

      expect(ctx.results[0]!.saved).toBe(false);
      expect(ctx.results[0]!.notified).toBe(false);
    });

    test('condition_status=none, no triggered suggestion — clean result', async () => {
      defaults();
      singleMatch(fixtureNormal2H(), aiResponseNoPush());

      const ctx = await runPipeline(appConfig, { triggeredBy: 'scheduled' });

      const parsed = ctx.results[0]!.parsedAi;
      expect(parsed?.condition_triggered_should_push).toBe(false);
      expect(parsed?.custom_condition_matched).toBe(false);
    });

    test('no conditions in watchlist — AI skips condition evaluation', async () => {
      defaults();
      singleMatch(fixtureNormal2H(), aiResponsePush(), { custom_conditions: '' });

      const ctx = await runPipeline(appConfig, { triggeredBy: 'scheduled' });

      expect(ctx.results[0]!.saved).toBe(true);
    });

    test('watchlist has conditions but AI says not matched — no condition push', async () => {
      defaults();
      singleMatch(fixtureNormal2H(), aiResponseNoPush({
        custom_condition_matched: false,
        custom_condition_status: 'evaluated',
      }), { custom_conditions: '(Minute >= 70) AND (Total goals <= 0)' });

      const ctx = await runPipeline(appConfig, { triggeredBy: 'scheduled' });

      expect(ctx.results[0]!.notified).toBe(false);
    });
  });

  // ── F4: Condition parse_error ──
  describe('F4: Condition parse_error', () => {
    test('condition_status=parse_error — no condition push', async () => {
      defaults();
      singleMatch(fixtureNormal2H(), aiResponseNoPush({
        custom_condition_matched: false,
        custom_condition_status: 'parse_error',
        condition_triggered_suggestion: 'Some suggestion',
        condition_triggered_confidence: 8,
      }));

      const ctx = await runPipeline(appConfig, { triggeredBy: 'scheduled' });

      // parse_error → condition_matched=false → shouldPush=false (no ai push either)
      expect(ctx.results[0]!.notified).toBe(false);
    });

    test('parse_error with AI push — still notified via AI path', async () => {
      defaults();
      singleMatch(fixtureNormal2H(), aiResponsePush({
        custom_condition_matched: false,
        custom_condition_status: 'parse_error',
      }));

      const ctx = await runPipeline(appConfig, { triggeredBy: 'scheduled' });

      // AI push → shouldPush=true regardless of condition
      expect(ctx.results[0]!.notified).toBe(true);
    });

    test('parse_error does not set condition_triggered_should_push', async () => {
      defaults();
      singleMatch(fixtureNormal2H(), aiResponseNoPush({
        custom_condition_matched: false,
        custom_condition_status: 'parse_error',
        condition_triggered_suggestion: 'Over 2.5',
        condition_triggered_confidence: 8,
      }));

      const ctx = await runPipeline(appConfig, { triggeredBy: 'scheduled' });

      const parsed = ctx.results[0]!.parsedAi;
      // condition_triggered_should_push requires: custom_condition_matched=true
      expect(parsed?.condition_triggered_should_push).toBe(false);
    });

    test('parse_error + no AI push — no save', async () => {
      defaults();
      singleMatch(fixtureNormal2H(), aiResponseNoPush({
        custom_condition_matched: false,
        custom_condition_status: 'parse_error',
      }));

      const ctx = await runPipeline(appConfig, { triggeredBy: 'scheduled' });

      expect(ctx.results[0]!.saved).toBe(false);
    });

    test('parse_error + ask-ai with selection — saves via ask-ai path', async () => {
      defaults();
      singleMatch(fixtureNormal2H(), aiResponseNoPush({
        selection: 'Over 2.5 @1.85',
        custom_condition_matched: false,
        custom_condition_status: 'parse_error',
      }));

      const ctx = await runPipelineForMatch(appConfig, '12345');

      // isAskAi + hasSelection → saves
      expect(ctx.results[0]!.saved).toBe(true);
    });
  });

  // ── F5: Complex multi-condition interactions ──
  describe('F5: Complex condition interaction scenarios', () => {
    test('AI push + condition matched + triggered — all 3 conditions true = saves + notifies', async () => {
      defaults();
      singleMatch(fixtureNormal2H(), aiResponseBothPushAndCondition());

      const ctx = await runPipeline(appConfig, { triggeredBy: 'scheduled' });

      expect(ctx.results[0]!.saved).toBe(true);
      expect(ctx.results[0]!.notified).toBe(true);
    });

    test('condition matched=true, status=evaluated but NO triggered suggestion — does NOT save', async () => {
      defaults();
      singleMatch(fixtureNormal2H(), aiResponseNoPush({
        custom_condition_matched: true,
        custom_condition_status: 'evaluated',
        condition_triggered_suggestion: '',
        condition_triggered_confidence: 0,
      }));

      const ctx = await runPipeline(appConfig, { triggeredBy: 'scheduled' });

      // condition_triggered_should_push=false (empty suggestion), ai_should_push=false
      // → No Bet / empty results NOT saved
      expect(ctx.results[0]!.saved).toBe(false);
    });

    test('only condition_triggered (no matched, no ai push) — should NOT save', async () => {
      defaults();
      // This is technically an impossible state (triggered requires matched=true),
      // but test it defensively
      singleMatch(fixtureNormal2H(), aiResponseNoPush({
        custom_condition_matched: false,
        custom_condition_status: 'none',
        condition_triggered_suggestion: 'Over 2.5',
        condition_triggered_confidence: 8,
      }));

      const ctx = await runPipeline(appConfig, { triggeredBy: 'scheduled' });

      // condition_triggered_should_push=false (matched=false)
      expect(ctx.results[0]!.saved).toBe(false);
    });

    test('ask-ai + condition triggered — both paths contribute to save', async () => {
      defaults();
      singleMatch(fixtureNormal2H(), aiResponseConditionTriggered());

      const ctx = await runPipelineForMatch(appConfig, '12345');

      // condition_triggered_should_push=true → shouldSave=true
      // AND isAskAi path (but would need hasSelection which depends on ai_selection)
      expect(ctx.results[0]!.saved).toBe(true);
      expect(ctx.results[0]!.notified).toBe(true);
    });

    test('multiple matches: one with condition, one without — independent processing', async () => {
      defaults();
      const k = ko();
      (fetchWatchlistMatches as Mock).mockResolvedValue([
        createWatchlistMatch({ match_id: '100', date: k.date, kickoff: k.time, custom_conditions: '(Minute >= 60)' }),
        createWatchlistMatch({ match_id: '200', date: k.date, kickoff: k.time, custom_conditions: '' }),
      ]);
      (fetchLiveFixtures as Mock).mockResolvedValue([
        fixtureNormal2H(100),
        fixtureNormal2H(200),
      ]);
      (fetchLiveOdds as Mock).mockResolvedValue(oddsResponseNormal());
      // Match 100: condition triggered. Match 200: pure AI push
      (runAiAnalysis as Mock)
        .mockResolvedValueOnce(aiResponseConditionTriggered())
        .mockResolvedValueOnce(aiResponsePush());

      const ctx = await runPipeline(appConfig, { triggeredBy: 'scheduled' });

      expect(ctx.results).toHaveLength(2);
      expect(ctx.results[0]!.saved).toBe(true);
      expect(ctx.results[1]!.saved).toBe(true);
    });
  });
});
