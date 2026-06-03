import { beforeEach, describe, expect, test, vi } from 'vitest';

vi.mock('../db/pool.js', () => ({
  query: vi.fn(),
}));

import { query } from '../db/pool.js';
import { LIVE_ANALYSIS_PROMPT_VERSION } from '../lib/live-analysis-prompt.js';
import { buildRecommendationSnapshotCoverageReport } from '../lib/recommendation-snapshot-coverage.js';

const mockQuery = vi.mocked(query);

describe('recommendation snapshot coverage', () => {
  beforeEach(() => {
    mockQuery.mockReset();
  });

  test('separates official current-runtime export coverage from legacy and incomplete cohorts', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ c: '120' }] } as never)
      .mockResolvedValueOnce({ rows: [{ c: '80' }] } as never)
      .mockResolvedValueOnce({ rows: [{ c: '70' }] } as never)
      .mockResolvedValueOnce({ rows: [{ c: '50' }] } as never)
      .mockResolvedValueOnce({ rows: [{ c: '5' }] } as never)
      .mockResolvedValueOnce({
        rows: [{ total: '50', empty_odds: '0', empty_stats: '0', empty_dc: '8' }],
      } as never)
      .mockResolvedValueOnce({
        rows: [{ total: '70', empty_odds: '2', empty_stats: '3', empty_dc: '12', replay_ready: '50' }],
      } as never)
      .mockResolvedValueOnce({
        rows: [
          { slim: true, c: '15' },
          { slim: false, c: '105' },
        ],
      } as never)
      .mockResolvedValueOnce({
        rows: [
          { pv: LIVE_ANALYSIS_PROMPT_VERSION, n: '33', empty_odds: '0', empty_stats: '0', empty_dc: '3' },
          { pv: 'v10-legacy', n: '12', empty_odds: '0', empty_stats: '0', empty_dc: '2' },
          { pv: '(empty)', n: '5', empty_odds: '0', empty_stats: '0', empty_dc: '3' },
        ],
      } as never)
      .mockResolvedValueOnce({
        rows: [{ model: 'gemini-2.5-flash', n: '50', empty_odds: '0', empty_stats: '0' }],
      } as never)
      .mockResolvedValueOnce({
        rows: [
          { cohort: 'official_current_runtime', n: '30', empty_dc: '0' },
          { cohort: 'non_official_prompt_version', n: '12', empty_dc: '2' },
          { cohort: 'empty_prompt_version', n: '5', empty_dc: '3' },
          { cohort: 'official_current_missing_decision_context', n: '3', empty_dc: '3' },
        ],
      } as never);

    const report = await buildRecommendationSnapshotCoverageReport(90);

    expect(report.totals.exportEligible).toBe(50);
    expect(report.currentRuntime.officialPromptVersion).toBe(LIVE_ANALYSIS_PROMPT_VERSION);
    expect(report.currentRuntime.amongExportEligible).toEqual({
      total: 50,
      officialPrompt: 33,
      officialPromptWithDecisionContext: 30,
      officialPromptMissingDecisionContext: 3,
      nonOfficialPrompt: 12,
      emptyPromptVersion: 5,
      emptyDecisionContext: 8,
      currentRuntimeReady: 30,
      currentRuntimeReadyPct: 60,
    });
    expect(report.currentRuntime.cohorts).toContainEqual({
      cohort: 'official_current_runtime',
      count: 30,
      emptyDecisionContext: 0,
    });

    const currentRuntimeQuery = mockQuery.mock.calls[10];
    expect(currentRuntimeQuery?.[1]).toEqual([90, LIVE_ANALYSIS_PROMPT_VERSION]);
  });
});
