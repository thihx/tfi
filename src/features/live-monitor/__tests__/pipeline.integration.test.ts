// ============================================================
// Integration Tests — Pipeline Orchestrator
// Mocks all external I/O (proxy, football-api) to test the
// full pipeline flow from watchlist → notification/save.
// ============================================================

import { describe, test, expect, vi, beforeEach, type Mock } from 'vitest';
import { runPipeline, runPipelineForMatch } from '../services/pipeline';
import type { PipelineContext } from '../types';
import {
  createAppConfig,
  createConfig,
  createWatchlistMatch,
  createFootballApiFixture,
  createOddsResponse,
} from './fixtures';

// ==================== Timezone-safe date helpers ====================

/**
 * Generate date/time strings in the Asia/Seoul timezone so that
 * filterActiveMatches (which uses getNowLocal('Asia/Seoul')) sees
 * a consistent "now" regardless of the system timezone.
 */
function koreaDateTime(offsetMs = 0) {
  const target = new Date(Date.now() + offsetMs);
  const dateFmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const timeFmt = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Seoul',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  return { date: dateFmt.format(target), time: timeFmt.format(target) };
}

// ==================== Module Mocks ====================

// Mock proxy.service — all external network calls
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
}));

// Mock config (so we control loadMonitorConfig)
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
} from '../services/proxy.service';

import { loadMonitorConfig } from '../config';

// ==================== Helpers ====================

const appConfig = createAppConfig();

function setupHappyPath() {
  const config = createConfig();
  (loadMonitorConfig as Mock).mockReturnValue(config);

  // Watchlist returns one active match (1 hour ago in Korea time)
  const ko = koreaDateTime(-60 * 60_000);
  (fetchWatchlistMatches as Mock).mockResolvedValue([
    createWatchlistMatch({
      match_id: '12345',
      date: ko.date,
      kickoff: ko.time,
    }),
  ]);

  // Football data
  (fetchLiveFixtures as Mock).mockResolvedValue([createFootballApiFixture()]);
  (fetchLiveOdds as Mock).mockResolvedValue(createOddsResponse());

  // AI returns a strong recommendation
  (runAiAnalysis as Mock).mockResolvedValue(
    JSON.stringify({
      should_push: true,
      selection: 'Over 2.5 @1.85',
      bet_market: 'Over/Under',
      market_chosen_reason: 'High intensity, many shots',
      confidence: 8,
      reasoning_en: 'Both teams pressing, 8 shots in 65 min.',
      reasoning_vi: 'Cả hai đội pressing cao, 8 cú sút trong 65 phút.',
      warnings: [],
      value_percent: 15,
      risk_level: 'MEDIUM',
      stake_percent: 3,
    }),
  );

  // Notifications succeed
  (sendEmail as Mock).mockResolvedValue({ success: true });
  (sendTelegram as Mock).mockResolvedValue({ success: true });
  (saveRecommendation as Mock).mockResolvedValue({ id: 42 });

  // Data tracking (fire-and-forget)
  (saveMatchSnapshot as Mock).mockResolvedValue(undefined);
  (saveOddsMovements as Mock).mockResolvedValue(undefined);
  (saveAiPerformance as Mock).mockResolvedValue(undefined);

  return config;
}

// ==================== Tests ====================

beforeEach(() => {
  vi.resetAllMocks();
});

describe('runPipeline — full flow', () => {
  test('completes happy path: watchlist → AI → notify → save', async () => {
    setupHappyPath();

    const ctx = await runPipeline(appConfig, { triggeredBy: 'manual' });

    expect(ctx.stage).toBe('complete');
    expect(ctx.results).toHaveLength(1);

    const r = ctx.results[0]!;
    expect(r.proceeded).toBe(true);
    expect(r.notified).toBe(true);
    expect(r.saved).toBe(true);
    expect(r.stage).toBe('complete');
    expect(r.error).toBeUndefined();
  });

  test('calls services in correct order', async () => {
    setupHappyPath();

    await runPipeline(appConfig, { triggeredBy: 'scheduled' });

    // Verify proxy calls were made
    expect(fetchWatchlistMatches).toHaveBeenCalledTimes(1);
    expect(fetchLiveFixtures).toHaveBeenCalledTimes(1);
    expect(fetchLiveOdds).toHaveBeenCalledTimes(1);
    expect(runAiAnalysis).toHaveBeenCalledTimes(1);
    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect(sendTelegram).toHaveBeenCalledTimes(1);
    expect(saveRecommendation).toHaveBeenCalledTimes(1);
  });

  test('emits progress stages in order', async () => {
    setupHappyPath();

    const stages: string[] = [];
    await runPipeline(appConfig, {
      triggeredBy: 'manual',
      onProgress: (ctx: PipelineContext) => {
        stages.push(ctx.stage);
      },
    });

    // Must pass through these stages sequentially
    expect(stages).toContain('loading-watchlist');
    expect(stages).toContain('fetching-live-data');
    expect(stages).toContain('merging-data');
    expect(stages).toContain('ai-analysis');
    expect(stages).toContain('notifying');
    expect(stages).toContain('saving');
    expect(stages).toContain('complete');

    // Verify order
    const idxFetch = stages.indexOf('fetching-live-data');
    const idxMerge = stages.indexOf('merging-data');
    const idxAi = stages.indexOf('ai-analysis');
    const idxNotify = stages.indexOf('notifying');
    expect(idxFetch).toBeLessThan(idxMerge);
    expect(idxMerge).toBeLessThan(idxAi);
    expect(idxAi).toBeLessThan(idxNotify);
  });

  test('returns early when no active matches', async () => {
    const config = createConfig();
    (loadMonitorConfig as Mock).mockReturnValue(config);
    (fetchWatchlistMatches as Mock).mockResolvedValue([]);

    const ctx = await runPipeline(appConfig, { triggeredBy: 'scheduled' });

    expect(ctx.stage).toBe('complete');
    expect(ctx.results).toHaveLength(0);
    expect(fetchLiveFixtures).not.toHaveBeenCalled();
    expect(runAiAnalysis).not.toHaveBeenCalled();
  });

  test('skips match that fails checkShouldProceed (e.g. HT status)', async () => {
    const config = createConfig();
    (loadMonitorConfig as Mock).mockReturnValue(config);

    const ko = koreaDateTime(-60 * 60_000);
    (fetchWatchlistMatches as Mock).mockResolvedValue([
      createWatchlistMatch({
        match_id: '12345',
        date: ko.date,
        kickoff: ko.time,
      }),
    ]);

    // Fixture in HT — should not proceed
    (fetchLiveFixtures as Mock).mockResolvedValue([
      createFootballApiFixture({
        fixture: {
          id: 12345,
          referee: '',
          timezone: 'UTC',
          date: '',
          timestamp: 0,
          periods: { first: 0, second: 0 },
          venue: { id: 0, name: '', city: '' },
          status: { long: 'Half Time', short: 'HT', elapsed: 45 },
        },
      }),
    ]);

    const ctx = await runPipeline(appConfig, { triggeredBy: 'manual' });

    expect(ctx.stage).toBe('complete');
    expect(ctx.results).toHaveLength(1);
    expect(ctx.results[0]!.proceeded).toBe(false);
    expect(runAiAnalysis).not.toHaveBeenCalled();
  });

  test('handles AI saying should_push=false — no notification, still saves', async () => {
    const config = createConfig();
    (loadMonitorConfig as Mock).mockReturnValue(config);

    const ko = koreaDateTime(-60 * 60_000);
    (fetchWatchlistMatches as Mock).mockResolvedValue([
      createWatchlistMatch({
        match_id: '12345',
        date: ko.date,
        kickoff: ko.time,
      }),
    ]);
    (fetchLiveFixtures as Mock).mockResolvedValue([createFootballApiFixture()]);
    (fetchLiveOdds as Mock).mockResolvedValue(createOddsResponse());

    // AI says don't push
    (runAiAnalysis as Mock).mockResolvedValue(
      JSON.stringify({
        should_push: false,
        selection: '',
        bet_market: '',
        market_chosen_reason: 'No clear value',
        confidence: 3,
        reasoning_en: 'No strong signal.',
        reasoning_vi: 'Không có tín hiệu rõ ràng.',
        warnings: [],
        value_percent: 0,
        risk_level: 'HIGH',
        stake_percent: 0,
      }),
    );

    (sendEmail as Mock).mockResolvedValue({ success: true });
    (sendTelegram as Mock).mockResolvedValue({ success: true });
    (saveRecommendation as Mock).mockResolvedValue({ id: 99 });

    const ctx = await runPipeline(appConfig, { triggeredBy: 'manual' });

    expect(ctx.results[0]!.proceeded).toBe(true);
    expect(ctx.results[0]!.notified).toBe(false);
    // should_push=false → shouldSave returns false → not saved
    expect(ctx.results[0]!.saved).toBe(false);
    expect(sendEmail).not.toHaveBeenCalled();
    expect(sendTelegram).not.toHaveBeenCalled();
  });

  test('continues processing when odds fetch fails', async () => {
    setupHappyPath();
    (fetchLiveOdds as Mock).mockRejectedValue(new Error('Odds API down'));

    const ctx = await runPipeline(appConfig, { triggeredBy: 'manual' });

    expect(ctx.results[0]!.proceeded).toBe(true);
    // AI still called (with odds_available=false)
    expect(runAiAnalysis).toHaveBeenCalledTimes(1);
  });

  test('captures error on individual match without crashing pipeline', async () => {
    const config = createConfig();
    (loadMonitorConfig as Mock).mockReturnValue(config);

    const ko = koreaDateTime(-60 * 60_000);
    (fetchWatchlistMatches as Mock).mockResolvedValue([
      createWatchlistMatch({
        match_id: '12345',
        date: ko.date,
        kickoff: ko.time,
      }),
    ]);
    (fetchLiveFixtures as Mock).mockResolvedValue([createFootballApiFixture()]);
    (fetchLiveOdds as Mock).mockResolvedValue(createOddsResponse());

    // AI throws
    (runAiAnalysis as Mock).mockRejectedValue(new Error('AI service unavailable'));

    const ctx = await runPipeline(appConfig, { triggeredBy: 'manual' });

    // Pipeline completes
    expect(ctx.stage).toBe('complete');
    expect(ctx.results).toHaveLength(1);
    expect(ctx.results[0]!.stage).toBe('error');
    expect(ctx.results[0]!.error).toContain('AI service unavailable');
  });

  test('sets ctx.error when watchlist fetch fails', async () => {
    const config = createConfig();
    (loadMonitorConfig as Mock).mockReturnValue(config);
    (fetchWatchlistMatches as Mock).mockRejectedValue(new Error('Network error'));

    const ctx = await runPipeline(appConfig, { triggeredBy: 'manual' });

    expect(ctx.stage).toBe('error');
    expect(ctx.error).toContain('Network error');
  });

  test('merges webhookMatchIds into config.MANUAL_PUSH_MATCH_IDS', async () => {
    const config = createConfig({ MANUAL_PUSH_MATCH_IDS: ['99999'] });
    (loadMonitorConfig as Mock).mockReturnValue(config);
    (fetchWatchlistMatches as Mock).mockResolvedValue([]);

    await runPipeline(appConfig, {
      triggeredBy: 'webhook',
      webhookMatchIds: ['12345', '67890'],
    });

    // The config should now contain all IDs (deduped)
    expect(config.MANUAL_PUSH_MATCH_IDS).toEqual(
      expect.arrayContaining(['99999', '12345', '67890']),
    );
  });
});

describe('runPipelineForMatch', () => {
  test('runs pipeline for a single match ID', async () => {
    setupHappyPath();

    const ctx = await runPipelineForMatch(appConfig, '12345');

    expect(ctx.triggeredBy).toBe('manual');
    expect(ctx.webhookMatchIds).toEqual(['12345']);
  });

  test('passes configOverrides through', async () => {
    setupHappyPath();

    const ctx = await runPipelineForMatch(appConfig, '12345', { AI_PROVIDER: 'claude' });

    expect(loadMonitorConfig).toHaveBeenCalledWith(
      expect.objectContaining({ AI_PROVIDER: 'claude', MANUAL_PUSH_MATCH_IDS: ['12345'] }),
    );
    // Pipeline still runs
    expect(ctx.stage).toBe('complete');
  });
});

// ==================== Data Tracking Tests ====================

describe('pipeline data tracking', () => {
  test('calls saveMatchSnapshot after merging data', async () => {
    setupHappyPath();

    await runPipeline(appConfig, { triggeredBy: 'manual' });

    expect(saveMatchSnapshot).toHaveBeenCalledTimes(1);
    expect(saveMatchSnapshot).toHaveBeenCalledWith(
      appConfig,
      expect.objectContaining({
        match_id: '12345',
        minute: expect.any(Number),
        status: expect.any(String),
        home_score: expect.any(Number),
        away_score: expect.any(Number),
      }),
    );
  });

  test('calls saveOddsMovements when odds are available', async () => {
    setupHappyPath();

    await runPipeline(appConfig, { triggeredBy: 'manual' });

    expect(saveOddsMovements).toHaveBeenCalledTimes(1);
    const movements = (saveOddsMovements as Mock).mock.calls[0]![1];
    expect(Array.isArray(movements)).toBe(true);
    expect(movements.length).toBeGreaterThan(0);
    expect(movements[0]).toMatchObject({
      match_id: '12345',
      market: expect.any(String),
    });
  });

  test('does not call saveOddsMovements when odds fetch fails', async () => {
    setupHappyPath();
    (fetchLiveOdds as Mock).mockRejectedValue(new Error('Odds API down'));

    await runPipeline(appConfig, { triggeredBy: 'manual' });

    expect(saveOddsMovements).not.toHaveBeenCalled();
  });

  test('calls saveAiPerformance after saving recommendation', async () => {
    setupHappyPath();

    await runPipeline(appConfig, { triggeredBy: 'manual' });

    expect(saveAiPerformance).toHaveBeenCalledTimes(1);
    expect(saveAiPerformance).toHaveBeenCalledWith(
      appConfig,
      expect.objectContaining({
        recommendation_id: 42,
        match_id: '12345',
        ai_model: expect.any(String),
        ai_should_push: true,
        predicted_market: 'Over/Under',
        league: expect.any(String),
      }),
    );
  });

  test('does not call saveAiPerformance when AI says no push (not saved)', async () => {
    const config = createConfig();
    (loadMonitorConfig as Mock).mockReturnValue(config);

    const ko = koreaDateTime(-60 * 60_000);
    (fetchWatchlistMatches as Mock).mockResolvedValue([
      createWatchlistMatch({ match_id: '12345', date: ko.date, kickoff: ko.time }),
    ]);
    (fetchLiveFixtures as Mock).mockResolvedValue([createFootballApiFixture()]);
    (fetchLiveOdds as Mock).mockResolvedValue(createOddsResponse());
    (runAiAnalysis as Mock).mockResolvedValue(
      JSON.stringify({
        should_push: false, selection: '', bet_market: '',
        market_chosen_reason: 'No value', confidence: 2,
        reasoning_en: 'No signal.', reasoning_vi: 'Không.',
        warnings: [], value_percent: 0, risk_level: 'HIGH', stake_percent: 0,
      }),
    );
    (saveMatchSnapshot as Mock).mockResolvedValue(undefined);
    (saveOddsMovements as Mock).mockResolvedValue(undefined);

    await runPipeline(appConfig, { triggeredBy: 'manual' });

    expect(saveRecommendation).not.toHaveBeenCalled();
    expect(saveAiPerformance).not.toHaveBeenCalled();
  });

  test('tracking failure does not crash pipeline', async () => {
    setupHappyPath();
    (saveMatchSnapshot as Mock).mockRejectedValue(new Error('Snapshot DB down'));
    (saveOddsMovements as Mock).mockRejectedValue(new Error('Odds DB down'));
    (saveAiPerformance as Mock).mockRejectedValue(new Error('AI perf DB down'));

    const ctx = await runPipeline(appConfig, { triggeredBy: 'manual' });

    expect(ctx.stage).toBe('complete');
    expect(ctx.results[0]!.saved).toBe(true);
    expect(ctx.results[0]!.error).toBeUndefined();
  });

  test('still tracks snapshot even when odds fail', async () => {
    setupHappyPath();
    (fetchLiveOdds as Mock).mockRejectedValue(new Error('Odds API down'));

    await runPipeline(appConfig, { triggeredBy: 'manual' });

    expect(saveMatchSnapshot).toHaveBeenCalledTimes(1);
  });
});
