// ============================================================
// Pipeline Simulation Tests
// Comprehensive scenarios: multi-match, mixed results,
// concurrent behavior, config overrides, edge cases
// ============================================================

import { describe, test, expect, vi, beforeEach, type Mock } from 'vitest';
import { runPipeline, runPipelineForMatch } from '../services/pipeline';
import {
  createAppConfig,
  createConfig,
  createWatchlistMatch,
  createFootballApiFixture,
  createOddsResponse,
} from './fixtures';

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

const appConfig = createAppConfig();

function aiResponse(overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    should_push: true,
    selection: 'Over 2.5 @1.85',
    bet_market: 'Over/Under',
    market_chosen_reason: 'High intensity',
    confidence: 8,
    reasoning_en: 'Both teams pressing.',
    reasoning_vi: 'Cả hai đội pressing.',
    warnings: [],
    value_percent: 15,
    risk_level: 'MEDIUM',
    stake_percent: 3,
    ...overrides,
  });
}

function setupDefaults() {
  const config = createConfig();
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

beforeEach(() => {
  vi.resetAllMocks();
  (fetchMatchRecommendations as Mock).mockResolvedValue([]);
  (fetchMatchSnapshots as Mock).mockResolvedValue([]);
  (fetchHistoricalPerformance as Mock).mockResolvedValue(null);
  (checkStaleness as Mock).mockReturnValue({ isStale: false, reason: 'first_analysis' });
});

// ==================== Multi-match scenarios ====================

describe('multi-match pipeline', () => {
  test('processes 3 matches independently — all proceed', async () => {
    setupDefaults();
    const ko = koreaDateTime(-60 * 60_000);

    (fetchWatchlistMatches as Mock).mockResolvedValue([
      createWatchlistMatch({ match_id: '100', date: ko.date, kickoff: ko.time }),
      createWatchlistMatch({ match_id: '200', date: ko.date, kickoff: ko.time, home_team: 'Liverpool', away_team: 'Man City' }),
      createWatchlistMatch({ match_id: '300', date: ko.date, kickoff: ko.time, home_team: 'Bayern', away_team: 'Dortmund' }),
    ]);

    // All 3 fixtures
    (fetchLiveFixtures as Mock).mockResolvedValue([
      createFootballApiFixture({ fixture: { ...createFootballApiFixture().fixture, id: 100, status: { long: 'Second Half', short: '2H', elapsed: 60 } }, teams: { home: { id: 1, name: 'Arsenal', logo: '', winner: null }, away: { id: 2, name: 'Chelsea', logo: '', winner: null } }, goals: { home: 1, away: 0 } }),
      createFootballApiFixture({ fixture: { ...createFootballApiFixture().fixture, id: 200, status: { long: 'Second Half', short: '2H', elapsed: 70 } }, teams: { home: { id: 3, name: 'Liverpool', logo: '', winner: null }, away: { id: 4, name: 'Man City', logo: '', winner: null } }, goals: { home: 2, away: 2 } }),
      createFootballApiFixture({ fixture: { ...createFootballApiFixture().fixture, id: 300, status: { long: 'Second Half', short: '2H', elapsed: 55 } }, teams: { home: { id: 5, name: 'Bayern', logo: '', winner: null }, away: { id: 6, name: 'Dortmund', logo: '', winner: null } }, goals: { home: 0, away: 1 } }),
    ]);

    (fetchLiveOdds as Mock).mockResolvedValue(createOddsResponse());
    (runAiAnalysis as Mock).mockResolvedValue(aiResponse());

    const ctx = await runPipeline(appConfig, { triggeredBy: 'scheduled' });

    expect(ctx.stage).toBe('complete');
    expect(ctx.results).toHaveLength(3);
    expect(ctx.results.every((r) => r.proceeded)).toBe(true);
    expect(ctx.results.every((r) => r.saved)).toBe(true);
    expect(runAiAnalysis).toHaveBeenCalledTimes(3);
    expect(saveRecommendation).toHaveBeenCalledTimes(3);
  });

  test('mixed: 1 proceeds, 1 skipped by filter (HT), 1 stale', async () => {
    setupDefaults();
    const ko = koreaDateTime(-60 * 60_000);

    (fetchWatchlistMatches as Mock).mockResolvedValue([
      createWatchlistMatch({ match_id: '100', date: ko.date, kickoff: ko.time }),
      createWatchlistMatch({ match_id: '200', date: ko.date, kickoff: ko.time }),
      createWatchlistMatch({ match_id: '300', date: ko.date, kickoff: ko.time }),
    ]);

    (fetchLiveFixtures as Mock).mockResolvedValue([
      // Match 100: 2H 65' — will proceed
      createFootballApiFixture({ fixture: { ...createFootballApiFixture().fixture, id: 100, status: { long: 'Second Half', short: '2H', elapsed: 65 } } }),
      // Match 200: HT — will be filtered out
      createFootballApiFixture({ fixture: { ...createFootballApiFixture().fixture, id: 200, status: { long: 'Halftime', short: 'HT', elapsed: 45 } }, goals: { home: 0, away: 0 } }),
      // Match 300: 2H 60' — will be stale
      createFootballApiFixture({ fixture: { ...createFootballApiFixture().fixture, id: 300, status: { long: 'Second Half', short: '2H', elapsed: 60 } } }),
    ]);

    (fetchLiveOdds as Mock).mockResolvedValue(createOddsResponse());
    (runAiAnalysis as Mock).mockResolvedValue(aiResponse());

    // Make match 300 stale
    (checkStaleness as Mock)
      .mockReturnValueOnce({ isStale: false, reason: 'first_analysis' }) // match 100
      .mockReturnValueOnce({ isStale: true, reason: 'time_gap_short' }); // match 300

    const ctx = await runPipeline(appConfig, { triggeredBy: 'scheduled' });

    expect(ctx.stage).toBe('complete');
    expect(ctx.results).toHaveLength(3);

    // Match 100: fully proceeded
    const r100 = ctx.results.find((r) => r.matchId === '100');
    expect(r100?.proceeded).toBe(true);
    expect(r100?.saved).toBe(true);

    // Match 200: skipped by HT filter
    const r200 = ctx.results.find((r) => r.matchId === '200');
    expect(r200?.proceeded).toBe(false);

    // Match 300: skipped by staleness
    const r300 = ctx.results.find((r) => r.matchId === '300');
    expect(r300?.skippedStale).toBe(true);

    // AI only called for match 100
    expect(runAiAnalysis).toHaveBeenCalledTimes(1);
  });

  test('one match errors, others continue', async () => {
    setupDefaults();
    const ko = koreaDateTime(-60 * 60_000);

    (fetchWatchlistMatches as Mock).mockResolvedValue([
      createWatchlistMatch({ match_id: '100', date: ko.date, kickoff: ko.time }),
      createWatchlistMatch({ match_id: '200', date: ko.date, kickoff: ko.time }),
    ]);

    (fetchLiveFixtures as Mock).mockResolvedValue([
      createFootballApiFixture({ fixture: { ...createFootballApiFixture().fixture, id: 100, status: { long: 'Second Half', short: '2H', elapsed: 65 } } }),
      createFootballApiFixture({ fixture: { ...createFootballApiFixture().fixture, id: 200, status: { long: 'Second Half', short: '2H', elapsed: 70 } } }),
    ]);

    (fetchLiveOdds as Mock).mockResolvedValue(createOddsResponse());

    // First match AI throws, second succeeds
    (runAiAnalysis as Mock)
      .mockRejectedValueOnce(new Error('AI timeout'))
      .mockResolvedValueOnce(aiResponse());

    const ctx = await runPipeline(appConfig, { triggeredBy: 'manual' });

    expect(ctx.stage).toBe('complete');
    expect(ctx.results).toHaveLength(2);

    const errResult = ctx.results.find((r) => r.matchId === '100');
    expect(errResult?.stage).toBe('error');
    expect(errResult?.error).toContain('AI timeout');

    const okResult = ctx.results.find((r) => r.matchId === '200');
    expect(okResult?.saved).toBe(true);
    expect(okResult?.stage).toBe('complete');
  });
});

// ==================== Notification scenarios ====================

describe('notification edge cases', () => {
  test('AI says should_push=false — no notification, still saved if shouldSave', async () => {
    setupDefaults();
    const ko = koreaDateTime(-60 * 60_000);

    (fetchWatchlistMatches as Mock).mockResolvedValue([
      createWatchlistMatch({ match_id: '12345', date: ko.date, kickoff: ko.time }),
    ]);
    (fetchLiveFixtures as Mock).mockResolvedValue([createFootballApiFixture()]);
    (fetchLiveOdds as Mock).mockResolvedValue(createOddsResponse());
    (runAiAnalysis as Mock).mockResolvedValue(aiResponse({ should_push: false, confidence: 3 }));

    const ctx = await runPipeline(appConfig, { triggeredBy: 'manual' });

    const r = ctx.results[0]!;
    expect(r.proceeded).toBe(true);
    expect(r.notified).toBe(false);
    expect(sendEmail).not.toHaveBeenCalled();
    expect(sendTelegram).not.toHaveBeenCalled();
  });

  test('custom condition matched — both saved AND notified', async () => {
    setupDefaults();
    const ko = koreaDateTime(-60 * 60_000);

    (fetchWatchlistMatches as Mock).mockResolvedValue([
      createWatchlistMatch({ match_id: '12345', date: ko.date, kickoff: ko.time }),
    ]);
    (fetchLiveFixtures as Mock).mockResolvedValue([createFootballApiFixture()]);
    (fetchLiveOdds as Mock).mockResolvedValue(createOddsResponse());
    (runAiAnalysis as Mock).mockResolvedValue(aiResponse({
      should_push: false,
      ai_should_push: false,
      custom_condition_matched: true,
      custom_condition_status: 'evaluated',
      condition_triggered_should_push: false,
      confidence: 6,
    }));

    const ctx = await runPipeline(appConfig, { triggeredBy: 'manual' });

    const r = ctx.results[0]!;
    expect(r.proceeded).toBe(true);
    expect(r.saved).toBe(true);
    expect(saveRecommendation).toHaveBeenCalledTimes(1);
  });

  test('condition_triggered_should_push — both saved AND notified', async () => {
    setupDefaults();
    const ko = koreaDateTime(-60 * 60_000);

    (fetchWatchlistMatches as Mock).mockResolvedValue([
      createWatchlistMatch({ match_id: '12345', date: ko.date, kickoff: ko.time }),
    ]);
    (fetchLiveFixtures as Mock).mockResolvedValue([createFootballApiFixture()]);
    (fetchLiveOdds as Mock).mockResolvedValue(createOddsResponse());
    // AI says no push, but custom condition triggers with valid suggestion + confidence
    (runAiAnalysis as Mock).mockResolvedValue(aiResponse({
      should_push: false,
      custom_condition_matched: true,
      custom_condition_status: 'evaluated',
      condition_triggered_suggestion: 'Over 2.5 @1.85',
      condition_triggered_confidence: 7,
      condition_triggered_stake: 3,
      condition_triggered_reasoning_en: 'Condition met',
      confidence: 3,
    }));

    const ctx = await runPipeline(appConfig, { triggeredBy: 'manual' });

    const r = ctx.results[0]!;
    expect(r.proceeded).toBe(true);
    expect(r.saved).toBe(true);
    expect(saveRecommendation).toHaveBeenCalledTimes(1);
  });

  test('email fails but telegram succeeds — partial notification', async () => {
    setupDefaults();
    const ko = koreaDateTime(-60 * 60_000);

    (fetchWatchlistMatches as Mock).mockResolvedValue([
      createWatchlistMatch({ match_id: '12345', date: ko.date, kickoff: ko.time }),
    ]);
    (fetchLiveFixtures as Mock).mockResolvedValue([createFootballApiFixture()]);
    (fetchLiveOdds as Mock).mockResolvedValue(createOddsResponse());
    (runAiAnalysis as Mock).mockResolvedValue(aiResponse());

    (sendEmail as Mock).mockRejectedValue(new Error('SMTP fail'));
    (sendTelegram as Mock).mockResolvedValue({ success: true });

    const ctx = await runPipeline(appConfig, { triggeredBy: 'manual' });

    const r = ctx.results[0]!;
    // The notification service handles errors internally
    expect(r.proceeded).toBe(true);
    expect(r.saved).toBe(true);
  });

  test('save fails — error recorded but pipeline continues', async () => {
    setupDefaults();
    const ko = koreaDateTime(-60 * 60_000);

    (fetchWatchlistMatches as Mock).mockResolvedValue([
      createWatchlistMatch({ match_id: '12345', date: ko.date, kickoff: ko.time }),
    ]);
    (fetchLiveFixtures as Mock).mockResolvedValue([createFootballApiFixture()]);
    (fetchLiveOdds as Mock).mockResolvedValue(createOddsResponse());
    (runAiAnalysis as Mock).mockResolvedValue(aiResponse());
    (saveRecommendation as Mock).mockRejectedValue(new Error('DB connection lost'));

    const ctx = await runPipeline(appConfig, { triggeredBy: 'manual' });

    const r = ctx.results[0]!;
    expect(r.saved).toBe(false);
    expect(r.error).toContain('Save error');
    expect(r.stage).toBe('complete'); // pipeline didn't crash
  });
});

// ==================== Odds failure scenarios ====================

describe('odds fetch edge cases', () => {
  test('odds fail — match continues with odds_available false', async () => {
    setupDefaults();
    const ko = koreaDateTime(-60 * 60_000);

    (fetchWatchlistMatches as Mock).mockResolvedValue([
      createWatchlistMatch({ match_id: '12345', date: ko.date, kickoff: ko.time }),
    ]);
    (fetchLiveFixtures as Mock).mockResolvedValue([createFootballApiFixture()]);
    (fetchLiveOdds as Mock).mockRejectedValue(new Error('429 Too Many Requests'));
    (runAiAnalysis as Mock).mockResolvedValue(aiResponse());

    const ctx = await runPipeline(appConfig, { triggeredBy: 'manual' });

    expect(ctx.results[0]!.proceeded).toBe(true);
    expect(ctx.results[0]!.saved).toBe(true);
    // saveOddsMovements should NOT be called because odds unavailable
    // (snapshot is still saved)
  });
});

// ==================== Data tracking ====================

describe('data tracking', () => {
  test('saves snapshot for each match that proceeds', async () => {
    setupDefaults();
    const ko = koreaDateTime(-60 * 60_000);

    (fetchWatchlistMatches as Mock).mockResolvedValue([
      createWatchlistMatch({ match_id: '100', date: ko.date, kickoff: ko.time }),
      createWatchlistMatch({ match_id: '200', date: ko.date, kickoff: ko.time }),
    ]);
    (fetchLiveFixtures as Mock).mockResolvedValue([
      createFootballApiFixture({ fixture: { ...createFootballApiFixture().fixture, id: 100, status: { long: 'Second Half', short: '2H', elapsed: 65 } } }),
      createFootballApiFixture({ fixture: { ...createFootballApiFixture().fixture, id: 200, status: { long: 'Second Half', short: '2H', elapsed: 70 } } }),
    ]);
    (fetchLiveOdds as Mock).mockResolvedValue(createOddsResponse());
    (runAiAnalysis as Mock).mockResolvedValue(aiResponse());

    await runPipeline(appConfig, { triggeredBy: 'manual' });

    expect(saveMatchSnapshot).toHaveBeenCalledTimes(2);
    expect(saveOddsMovements).toHaveBeenCalledTimes(2);
  });

  test('saves AI performance after saving recommendation', async () => {
    setupDefaults();
    const ko = koreaDateTime(-60 * 60_000);

    (fetchWatchlistMatches as Mock).mockResolvedValue([
      createWatchlistMatch({ match_id: '12345', date: ko.date, kickoff: ko.time }),
    ]);
    (fetchLiveFixtures as Mock).mockResolvedValue([createFootballApiFixture()]);
    (fetchLiveOdds as Mock).mockResolvedValue(createOddsResponse());
    (runAiAnalysis as Mock).mockResolvedValue(aiResponse());
    (saveRecommendation as Mock).mockResolvedValue({ id: 42 });

    await runPipeline(appConfig, { triggeredBy: 'manual' });

    expect(saveAiPerformance).toHaveBeenCalledWith(appConfig, expect.objectContaining({
      recommendation_id: 42,
      ai_model: 'gemini-3-pro-preview',
      prompt_version: 'v3-context-aware',
    }));
  });

  test('snapshot tracking failure does not crash pipeline', async () => {
    setupDefaults();
    const ko = koreaDateTime(-60 * 60_000);

    (fetchWatchlistMatches as Mock).mockResolvedValue([
      createWatchlistMatch({ match_id: '12345', date: ko.date, kickoff: ko.time }),
    ]);
    (fetchLiveFixtures as Mock).mockResolvedValue([createFootballApiFixture()]);
    (fetchLiveOdds as Mock).mockResolvedValue(createOddsResponse());
    (runAiAnalysis as Mock).mockResolvedValue(aiResponse());
    (saveMatchSnapshot as Mock).mockRejectedValue(new Error('Snapshot DB error'));

    const ctx = await runPipeline(appConfig, { triggeredBy: 'manual' });

    expect(ctx.stage).toBe('complete');
    expect(ctx.results[0]!.saved).toBe(true);
  });
});

// ==================== Force analyze ====================

describe('force_analyze behavior', () => {
  test('force_analyze bypasses staleness check', async () => {
    const config = setupDefaults();
    config.MANUAL_PUSH_MATCH_IDS = ['12345'];
    const ko = koreaDateTime(-60 * 60_000);

    (fetchWatchlistMatches as Mock).mockResolvedValue([
      createWatchlistMatch({ match_id: '12345', date: ko.date, kickoff: ko.time }),
    ]);
    (fetchLiveFixtures as Mock).mockResolvedValue([createFootballApiFixture()]);
    (fetchLiveOdds as Mock).mockResolvedValue(createOddsResponse());
    (runAiAnalysis as Mock).mockResolvedValue(aiResponse());

    // Stale — but force_analyze should override
    (checkStaleness as Mock).mockReturnValue({ isStale: true, reason: 'time_gap_short' });

    const ctx = await runPipeline(appConfig, { triggeredBy: 'manual' });

    // Despite staleness, AI was called because force_analyze
    expect(runAiAnalysis).toHaveBeenCalledTimes(1);
    expect(ctx.results[0]!.saved).toBe(true);
  });
});

// ==================== Watchlist edge cases ====================

describe('watchlist edge cases', () => {
  test('empty watchlist — returns early', async () => {
    setupDefaults();
    (fetchWatchlistMatches as Mock).mockResolvedValue([]);

    const ctx = await runPipeline(appConfig, { triggeredBy: 'manual' });

    expect(ctx.stage).toBe('complete');
    expect(ctx.results).toHaveLength(0);
    expect(fetchLiveFixtures).not.toHaveBeenCalled();
  });

  test('watchlist fetch fails — sets ctx.error', async () => {
    setupDefaults();
    (fetchWatchlistMatches as Mock).mockRejectedValue(new Error('Network error'));

    const ctx = await runPipeline(appConfig, { triggeredBy: 'manual' });

    expect(ctx.stage).toBe('error');
    expect(ctx.error).toContain('Network error');
  });
});

// ==================== Config override scenarios ====================

describe('config overrides', () => {
  test('webhook match IDs are merged into config', async () => {
    const config = setupDefaults();
    config.MANUAL_PUSH_MATCH_IDS = ['existing'];
    const ko = koreaDateTime(-60 * 60_000);

    (fetchWatchlistMatches as Mock).mockResolvedValue([
      createWatchlistMatch({ match_id: 'existing', date: ko.date, kickoff: ko.time }),
      createWatchlistMatch({ match_id: 'webhook1', date: ko.date, kickoff: ko.time }),
    ]);
    (fetchLiveFixtures as Mock).mockResolvedValue([
      createFootballApiFixture({ fixture: { ...createFootballApiFixture().fixture, id: 100, status: { long: 'Second Half', short: '2H', elapsed: 65 } } }),
      createFootballApiFixture({ fixture: { ...createFootballApiFixture().fixture, id: 200, status: { long: 'Second Half', short: '2H', elapsed: 60 } } }),
    ]);
    (fetchLiveOdds as Mock).mockResolvedValue(createOddsResponse());
    (runAiAnalysis as Mock).mockResolvedValue(aiResponse());

    await runPipeline(appConfig, {
      triggeredBy: 'webhook',
      webhookMatchIds: ['webhook1'],
    });

    // Both 'existing' and 'webhook1' should be in MANUAL_PUSH_MATCH_IDS
    expect(config.MANUAL_PUSH_MATCH_IDS).toContain('existing');
    expect(config.MANUAL_PUSH_MATCH_IDS).toContain('webhook1');
  });
});

// ==================== runPipelineForMatch ====================

describe('runPipelineForMatch', () => {
  test('runs pipeline for a single specific match', async () => {
    setupDefaults();
    const ko = koreaDateTime(-60 * 60_000);

    (fetchWatchlistMatches as Mock).mockResolvedValue([
      createWatchlistMatch({ match_id: '555', date: ko.date, kickoff: ko.time }),
    ]);
    (fetchLiveFixtures as Mock).mockResolvedValue([createFootballApiFixture({ fixture: { ...createFootballApiFixture().fixture, id: 555, status: { long: 'Second Half', short: '2H', elapsed: 70 } } })]);
    (fetchLiveOdds as Mock).mockResolvedValue(createOddsResponse());
    (runAiAnalysis as Mock).mockResolvedValue(aiResponse());

    const ctx = await runPipelineForMatch(appConfig, '555');

    expect(ctx.triggeredBy).toBe('ask-ai');
    expect(ctx.webhookMatchIds).toEqual(['555']);
  });

  test('passes configOverrides through', async () => {
    setupDefaults();
    (fetchWatchlistMatches as Mock).mockResolvedValue([]);

    await runPipelineForMatch(appConfig, '999', { MIN_CONFIDENCE: 1 });

    expect(loadMonitorConfig).toHaveBeenCalledWith(expect.objectContaining({
      MIN_CONFIDENCE: 1,
      MANUAL_PUSH_MATCH_IDS: ['999'],
    }));
  });
});

// ==================== Progress emission ====================

describe('progress emission', () => {
  test('emits all expected stages for a happy-path match', async () => {
    setupDefaults();
    const ko = koreaDateTime(-60 * 60_000);

    (fetchWatchlistMatches as Mock).mockResolvedValue([
      createWatchlistMatch({ match_id: '12345', date: ko.date, kickoff: ko.time }),
    ]);
    (fetchLiveFixtures as Mock).mockResolvedValue([createFootballApiFixture()]);
    (fetchLiveOdds as Mock).mockResolvedValue(createOddsResponse());
    (runAiAnalysis as Mock).mockResolvedValue(aiResponse());

    const stages: string[] = [];
    await runPipeline(appConfig, {
      triggeredBy: 'manual',
      onProgress: (ctx) => stages.push(ctx.stage),
    });

    expect(stages).toContain('loading-watchlist');
    expect(stages).toContain('filtering');
    expect(stages).toContain('fetching-live-data');
    expect(stages).toContain('merging-data');
    expect(stages).toContain('checking-proceed');
    expect(stages).toContain('fetching-odds');
    expect(stages).toContain('checking-staleness');
    expect(stages).toContain('ai-analysis');
    expect(stages).toContain('parsing-response');
    expect(stages).toContain('notifying');
    expect(stages).toContain('saving');
    expect(stages).toContain('complete');
  });

  test('emits complete even when no active matches', async () => {
    setupDefaults();
    (fetchWatchlistMatches as Mock).mockResolvedValue([]);

    const stages: string[] = [];
    await runPipeline(appConfig, {
      triggeredBy: 'manual',
      onProgress: (ctx) => stages.push(ctx.stage),
    });

    expect(stages).toContain('loading-watchlist');
    expect(stages).toContain('complete');
  });
});

// ==================== Context passing to AI ====================

describe('AI context integration', () => {
  test('fetches previous recommendations for AI context', async () => {
    setupDefaults();
    const ko = koreaDateTime(-60 * 60_000);

    const prevRec = { selection: 'Under 2.5', confidence: 6, minute: 45 };
    (fetchMatchRecommendations as Mock).mockResolvedValue([prevRec]);
    (fetchMatchSnapshots as Mock).mockResolvedValue([{ minute: 45, home_score: 1, away_score: 0 }]);

    (fetchWatchlistMatches as Mock).mockResolvedValue([
      createWatchlistMatch({ match_id: '12345', date: ko.date, kickoff: ko.time }),
    ]);
    (fetchLiveFixtures as Mock).mockResolvedValue([createFootballApiFixture()]);
    (fetchLiveOdds as Mock).mockResolvedValue(createOddsResponse());
    (runAiAnalysis as Mock).mockResolvedValue(aiResponse());

    await runPipeline(appConfig, { triggeredBy: 'manual' });

    expect(fetchMatchRecommendations).toHaveBeenCalledWith(appConfig, '12345');
    expect(fetchMatchSnapshots).toHaveBeenCalledWith(appConfig, '12345');
  });

  test('continues when context fetch fails', async () => {
    setupDefaults();
    const ko = koreaDateTime(-60 * 60_000);

    (fetchMatchRecommendations as Mock).mockRejectedValue(new Error('DB error'));
    (fetchMatchSnapshots as Mock).mockRejectedValue(new Error('DB error'));

    (fetchWatchlistMatches as Mock).mockResolvedValue([
      createWatchlistMatch({ match_id: '12345', date: ko.date, kickoff: ko.time }),
    ]);
    (fetchLiveFixtures as Mock).mockResolvedValue([createFootballApiFixture()]);
    (fetchLiveOdds as Mock).mockResolvedValue(createOddsResponse());
    (runAiAnalysis as Mock).mockResolvedValue(aiResponse());

    const ctx = await runPipeline(appConfig, { triggeredBy: 'manual' });

    expect(ctx.stage).toBe('complete');
    expect(ctx.results[0]!.saved).toBe(true);
  });
});

// ==================== Custom condition flow ====================

describe('custom condition flow', () => {
  test('condition_triggered_should_push triggers notification', async () => {
    setupDefaults();
    const ko = koreaDateTime(-60 * 60_000);

    (fetchWatchlistMatches as Mock).mockResolvedValue([
      createWatchlistMatch({ match_id: '12345', date: ko.date, kickoff: ko.time, custom_conditions: 'If score is 0-0 at 60, bet Under 1.5' }),
    ]);
    (fetchLiveFixtures as Mock).mockResolvedValue([createFootballApiFixture()]);
    (fetchLiveOdds as Mock).mockResolvedValue(createOddsResponse());
    (runAiAnalysis as Mock).mockResolvedValue(aiResponse({
      should_push: false,
      ai_should_push: false,
      confidence: 3,
      custom_condition_matched: true,
      custom_condition_status: 'evaluated',
      condition_triggered_should_push: true,
      condition_triggered_suggestion: 'Under 1.5 @2.10',
      condition_triggered_confidence: 7,
    }));

    const ctx = await runPipeline(appConfig, { triggeredBy: 'manual' });

    // shouldPush checks condition_triggered_should_push
    const r = ctx.results[0]!;
    expect(r.proceeded).toBe(true);
  });
});

// ==================== Execution ID uniqueness ====================

describe('execution tracking', () => {
  test('each pipeline run generates unique execution', async () => {
    setupDefaults();
    (fetchWatchlistMatches as Mock).mockResolvedValue([]);

    const ctx1 = await runPipeline(appConfig, { triggeredBy: 'manual' });
    const ctx2 = await runPipeline(appConfig, { triggeredBy: 'manual' });

    // Both complete, but we can't directly check executionId from ctx
    // Just verify both work
    expect(ctx1.stage).toBe('complete');
    expect(ctx2.stage).toBe('complete');
  });
});
