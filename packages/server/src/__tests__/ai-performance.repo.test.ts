import { beforeEach, describe, expect, test, vi } from 'vitest';

vi.mock('../db/pool.js', () => ({
  query: vi.fn(),
}));

import { query } from '../db/pool.js';
import {
  createAiPerformanceRecord,
  backfillFromRecommendations,
  getAccuracyStats,
  getHistoricalPerformanceContext,
  settleAiPerformance,
} from '../repos/ai-performance.repo.js';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('ai-performance repository', () => {
  test('getHistoricalPerformanceContext includes predicted_odds in the base CTE and maps rows', async () => {
    vi.mocked(query).mockResolvedValueOnce({
      rows: [
        { section: 'overall', label: 'all', settled: '10', correct: '6' },
        { section: 'market', label: 'over_2.5', settled: '8', correct: '5' },
        { section: 'odds', label: '1.70-1.99', settled: '7', correct: '4' },
      ],
    } as never);

    const context = await getHistoricalPerformanceContext();

    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('ap.predicted_odds'),
    );
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining("r.bet_type IS DISTINCT FROM 'NO_BET'"),
    );
    expect(context.overall).toEqual({
      settled: 10,
      correct: 6,
      accuracy: 60,
    });
    expect(context.byMarket).toEqual([
      { market: 'over_2.5', label: 'over_2.5', settled: 8, correct: 5, accuracy: 62.5 },
    ]);
    expect(context.byOddsRange).toEqual([
      { range: '1.70-1.99', label: '1.70-1.99', settled: 7, correct: 4, accuracy: 57.14 },
    ]);
  });

  test('getAccuracyStats uses settlement trust instead of treating half outcomes as pending forever', async () => {
    vi.mocked(query).mockResolvedValueOnce({
      rows: [{
        total: '12',
        correct: '5',
        incorrect: '3',
        push: '1',
        void: '1',
        neutral: '2',
        pending: '4',
        pending_result: '1',
        review_required: '3',
      }],
    } as never);

    const stats = await getAccuracyStats();

    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('latest_ai_performance'),
    );
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('ap.settlement_trusted = TRUE'),
    );
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining("NOT IN ('win','loss','push','half_win','half_loss','void')"),
    );
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining("ap.was_correct IS NULL"),
    );
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining("r.bet_type IS DISTINCT FROM 'NO_BET'"),
    );
    expect(stats).toEqual({
      total: 12,
      correct: 5,
      incorrect: 3,
      push: 1,
      void: 1,
      neutral: 2,
      pending: 4,
      pendingResult: 1,
      reviewRequired: 3,
      accuracy: 62.5,
    });
  });

  test('createAiPerformanceRecord upserts by recommendation_id instead of inserting duplicates', async () => {
    vi.mocked(query).mockResolvedValueOnce({
      rows: [{ id: 9, recommendation_id: 11 }],
    } as never);

    await createAiPerformanceRecord({
      recommendation_id: 11,
      match_id: '100',
      ai_model: 'gemini-3-pro-preview',
      prompt_version: 'v4',
      ai_confidence: 8,
      ai_should_push: true,
      predicted_market: 'over_2.5',
      predicted_selection: 'Over 2.5',
      predicted_odds: 1.91,
      match_minute: 65,
      match_score: '1-0',
      league: 'Premier League',
    });

    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('ON CONFLICT (recommendation_id) DO UPDATE SET'),
      expect.any(Array),
    );
  });

  test('backfillFromRecommendations skips legacy NO_BET rows', async () => {
    vi.mocked(query).mockResolvedValueOnce({
      rows: [{ cnt: '7' }],
    } as never);

    const inserted = await backfillFromRecommendations();

    expect(query).toHaveBeenCalledWith(
      expect.stringContaining("r.bet_type IS DISTINCT FROM 'NO_BET'"),
    );
    expect(inserted).toBe(7);
  });

  test('backfillFromRecommendations maps half outcomes to directional correctness', async () => {
    vi.mocked(query).mockResolvedValueOnce({
      rows: [{ cnt: '2' }],
    } as never);

    await backfillFromRecommendations();

    expect(query).toHaveBeenCalledWith(
      expect.stringContaining("WHEN r.result IN ('win', 'half_win') THEN true"),
    );
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining("WHEN r.result IN ('loss', 'half_loss') THEN false"),
    );
  });

  test('settleAiPerformance persists settlement provenance metadata', async () => {
    vi.mocked(query).mockResolvedValueOnce({
      rows: [{ id: 1, settlement_status: 'corrected', settlement_method: 'ai' }],
    } as never);

    await settleAiPerformance(11, 'half_loss', -1.5, null, {
      status: 'corrected',
      method: 'ai',
      trusted: true,
      settlePromptVersion: 'v1-strict-unresolved',
      note: 'Quarter-line correction',
    });

    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('settlement_trusted'),
      expect.arrayContaining(['corrected', 'ai', true, 'v1-strict-unresolved', 'Quarter-line correction']),
    );
  });
});
