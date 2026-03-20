import { beforeEach, describe, expect, test, vi } from 'vitest';

vi.mock('../db/pool.js', () => ({
  query: vi.fn(),
}));

import { query } from '../db/pool.js';
import { getHistoricalPerformanceContext } from '../repos/ai-performance.repo.js';

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
});
