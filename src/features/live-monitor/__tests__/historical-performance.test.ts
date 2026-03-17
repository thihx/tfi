// ============================================================
// Historical Performance Feedback Loop — Integration Tests
// Tests: proxy caching, pipeline integration, prompt injection
// ============================================================

import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import type { HistoricalPerformanceSummary } from '../types';
import { createAppConfig } from './fixtures';

// ==================== Proxy Cache Tests ====================

describe('fetchHistoricalPerformance — client-side cache', () => {
  let fetchSpy: ReturnType<typeof vi.fn>;
  let fetchHistoricalPerformance: typeof import('../services/proxy.service').fetchHistoricalPerformance;
  let clearPerformanceCache: typeof import('../services/proxy.service').clearPerformanceCache;

  const mockData: HistoricalPerformanceSummary & { generatedAt: string } = {
    overall: { settled: 50, correct: 30, accuracy: 60 },
    byMarket: [{ market: 'over_2.5', settled: 20, correct: 14, accuracy: 70 }],
    byConfidenceBand: [{ band: '8-10 (high)', settled: 15, correct: 11, accuracy: 73.33 }],
    byMinuteBand: [{ band: '0-29 (early)', settled: 10, correct: 7, accuracy: 70 }],
    byOddsRange: [{ range: '1.50-1.69', settled: 12, correct: 8, accuracy: 66.67 }],
    byLeague: [{ league: 'Premier League', settled: 15, correct: 10, accuracy: 66.67 }],
    generatedAt: '2026-03-17T10:00:00.000Z',
  };

  const config = createAppConfig();

  beforeEach(async () => {
    // Mock global fetch
    fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockData),
    });
    vi.stubGlobal('fetch', fetchSpy);

    // Fresh import to reset module state
    vi.resetModules();
    const mod = await import('../services/proxy.service');
    fetchHistoricalPerformance = mod.fetchHistoricalPerformance;
    clearPerformanceCache = mod.clearPerformanceCache;
    clearPerformanceCache();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  test('fetches data on first call', async () => {
    const result = await fetchHistoricalPerformance(config);

    expect(result).not.toBeNull();
    expect(result!.overall.accuracy).toBe(60);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy).toHaveBeenCalledWith(
      'http://localhost:4000/api/ai-performance/prompt-context',
      expect.objectContaining({ headers: { Accept: 'application/json' } }),
    );
  });

  test('returns cached data on subsequent calls (no extra fetch)', async () => {

    const result1 = await fetchHistoricalPerformance(config);
    const result2 = await fetchHistoricalPerformance(config);
    const result3 = await fetchHistoricalPerformance(config);

    expect(result1).toEqual(result2);
    expect(result2).toEqual(result3);
    // Only 1 fetch call despite 3 invocations — cache works
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  test('returns null on fetch error without crashing', async () => {
    fetchSpy.mockRejectedValueOnce(new Error('Network error'));

    const result = await fetchHistoricalPerformance(config);

    expect(result).toBeNull();
  });

  test('returns null on non-ok response', async () => {
    fetchSpy.mockResolvedValueOnce({ ok: false, status: 500 });

    const result = await fetchHistoricalPerformance(config);

    expect(result).toBeNull();
  });

  test('clearPerformanceCache forces next call to refetch', async () => {

    await fetchHistoricalPerformance(config);
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    clearPerformanceCache();
    await fetchHistoricalPerformance(config);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });
});

// ==================== Prompt Builder Section Tests ====================

describe('buildHistoricalPerformanceSection — edge cases', () => {
  let buildAiPrompt: typeof import('../services/ai-prompt.service').buildAiPrompt;

  beforeEach(async () => {
    vi.resetModules();
    const mod = await import('../services/ai-prompt.service');
    buildAiPrompt = mod.buildAiPrompt;
  });

  // Import fixtures lazily to avoid circular deps
  async function getFixtures() {
    return import('./fixtures');
  }

  test('markets with exactly 45% accuracy get no tag', async () => {
    const { createMergedMatchData } = await getFixtures();
    const data = createMergedMatchData();
    const prompt = buildAiPrompt(data, {
      previousRecommendations: [],
      matchTimeline: [],
      historicalPerformance: {
        overall: { settled: 20, correct: 10, accuracy: 50 },
        byMarket: [{ market: 'btts_yes', settled: 10, correct: 5, accuracy: 50 }],
        byConfidenceBand: [],
        byMinuteBand: [],
        byOddsRange: [],
        byLeague: [],
      },
    });

    // 50% is >= 45 and < 60, so no tag
    expect(prompt).toContain('btts_yes: 50%');
    expect(prompt).not.toContain('(strong)');
    expect(prompt).not.toContain('(WEAK');
  });

  test('exactly 5 settled records still shows section', async () => {
    const { createMergedMatchData } = await getFixtures();
    const data = createMergedMatchData();
    const prompt = buildAiPrompt(data, {
      previousRecommendations: [],
      matchTimeline: [],
      historicalPerformance: {
        overall: { settled: 5, correct: 3, accuracy: 60 },
        byMarket: [],
        byConfidenceBand: [],
        byMinuteBand: [],
        byOddsRange: [],
        byLeague: [],
      },
    });

    expect(prompt).toContain('HISTORICAL TRACK RECORD');
    expect(prompt).toContain('60% accuracy (3/5 settled)');
  });

  test('exactly 4 settled records hides section (minimum threshold)', async () => {
    const { createMergedMatchData } = await getFixtures();
    const data = createMergedMatchData();
    const prompt = buildAiPrompt(data, {
      previousRecommendations: [],
      matchTimeline: [],
      historicalPerformance: {
        overall: { settled: 4, correct: 3, accuracy: 75 },
        byMarket: [],
        byConfidenceBand: [],
        byMinuteBand: [],
        byOddsRange: [],
        byLeague: [],
      },
    });

    expect(prompt).not.toContain('HISTORICAL TRACK RECORD');
  });

  test('league with 65% accuracy gets RELIABLE tag', async () => {
    const { createMergedMatchData } = await getFixtures();
    const data = createMergedMatchData();
    const prompt = buildAiPrompt(data, {
      previousRecommendations: [],
      matchTimeline: [],
      historicalPerformance: {
        overall: { settled: 20, correct: 13, accuracy: 65 },
        byMarket: [],
        byConfidenceBand: [],
        byMinuteBand: [],
        byOddsRange: [],
        byLeague: [{ league: 'Bundesliga', settled: 10, correct: 7, accuracy: 70 }],
      },
    });

    expect(prompt).toContain('Bundesliga: 70%');
    expect(prompt).toContain('(RELIABLE)');
  });

  test('minute band with exactly 44% gets WEAK tag', async () => {
    const { createMergedMatchData } = await getFixtures();
    const data = createMergedMatchData();
    const prompt = buildAiPrompt(data, {
      previousRecommendations: [],
      matchTimeline: [],
      historicalPerformance: {
        overall: { settled: 20, correct: 9, accuracy: 45 },
        byMarket: [],
        byConfidenceBand: [],
        byMinuteBand: [{ band: '75+ (endgame)', settled: 10, correct: 4, accuracy: 40 }],
        byOddsRange: [],
        byLeague: [],
      },
    });

    expect(prompt).toContain('Min 75+ (endgame): 40%');
    expect(prompt).toContain('(WEAK — reduce aggression)');
  });
});
