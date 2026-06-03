import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../db/pool.js', () => ({
  query: vi.fn(),
}));

import { query } from '../../db/pool.js';
import {
  buildRecommendationPromptAdoptionReport,
  formatRecommendationPromptAdoptionMarkdown,
} from '../recommendation-prompt-adoption-report.js';

const mockQuery = vi.mocked(query);

describe('recommendation prompt adoption report', () => {
  beforeEach(() => {
    mockQuery.mockReset();
  });

  it('summarizes recent prompt-version adoption before rows settle', async () => {
    mockQuery
      .mockResolvedValueOnce({
        rows: [{
          total_rows: '10',
          actionable_rows: '8',
          official_prompt_rows: '6',
          official_with_dc: '5',
          official_missing_dc: '1',
          non_official_prompt_rows: '3',
          empty_prompt_rows: '1',
          empty_dc_rows: '2',
          first_row_at: '2026-06-01T12:00:00.000Z',
          latest_row_at: '2026-06-03T12:00:00.000Z',
          latest_row_age_hours: '1.25',
          latest_actionable_row_at: '2026-06-03T12:00:00.000Z',
          latest_actionable_row_age_hours: '1.25',
          latest_official_prompt_row_at: '2026-06-03T12:00:00.000Z',
          latest_official_prompt_row_age_hours: '1.25',
          latest_non_official_prompt_row_at: '2026-06-02T12:00:00.000Z',
          latest_non_official_prompt_row_age_hours: '25.5',
        }],
      } as never)
      .mockResolvedValueOnce({
        rows: [
          {
            prompt_version: 'v10-hybrid-legacy-g',
            count: '6',
            actionable: '5',
            with_decision_context: '5',
            settled: '1',
            pending: '5',
          },
          {
            prompt_version: 'v10-hybrid-legacy-b',
            count: '3',
            actionable: '3',
            with_decision_context: '2',
            settled: '3',
            pending: '0',
          },
          {
            prompt_version: '(empty)',
            count: '1',
            actionable: '0',
            with_decision_context: '0',
            settled: '0',
            pending: '1',
          },
        ],
      } as never)
      .mockResolvedValueOnce({
        rows: [
          {
            id: 42,
            timestamp: '2026-06-03T12:00:00.000Z',
            match_id: 'm-1',
            home_team: 'Home',
            away_team: 'Away',
            prompt_version: 'v10-hybrid-legacy-g',
            ai_model: 'gemini-3.5-flash',
            bet_market: 'over_1.5',
            result: '',
            has_decision_context: true,
            decision_kind: 'recommendation',
          },
        ],
      } as never);

    const report = await buildRecommendationPromptAdoptionReport({
      lookbackDays: 14,
      maxRecentRows: 50,
    });

    expect(mockQuery).toHaveBeenCalledTimes(3);
    expect(mockQuery.mock.calls[0]?.[1]).toEqual([14, 'v10-hybrid-legacy-g']);
    expect(mockQuery.mock.calls[2]?.[1]).toEqual([14, 50]);
    expect(report.totals).toMatchObject({
      totalRows: 10,
      actionableRows: 8,
      officialPromptRows: 6,
      officialPromptWithDecisionContext: 5,
      officialPromptMissingDecisionContext: 1,
      nonOfficialPromptRows: 3,
      emptyPromptVersionRows: 1,
      emptyDecisionContextRows: 2,
      officialPromptRate: 60,
      officialPromptWithDecisionContextRate: 50,
    });
    expect(report.activity).toMatchObject({
      firstRowAt: '2026-06-01T12:00:00.000Z',
      latestRowAt: '2026-06-03T12:00:00.000Z',
      latestRowAgeHours: 1.25,
      latestOfficialPromptRowAt: '2026-06-03T12:00:00.000Z',
      latestOfficialPromptRowAgeHours: 1.25,
      latestNonOfficialPromptRowAt: '2026-06-02T12:00:00.000Z',
      latestNonOfficialPromptRowAgeHours: 25.5,
    });
    expect(report.byPromptVersion).toHaveLength(3);
    expect(report.recent[0]).toMatchObject({
      id: 42,
      matchId: 'm-1',
      matchDisplay: 'Home vs Away',
      promptVersion: 'v10-hybrid-legacy-g',
      hasDecisionContext: true,
      decisionKind: 'recommendation',
    });

    const markdown = formatRecommendationPromptAdoptionMarkdown(report);
    expect(markdown).toContain('# Recommendation Prompt Adoption Report');
    expect(markdown).toContain('- Latest row age hours: 1.25');
    expect(markdown).toContain('| v10-hybrid-legacy-g | 6 | 5 | 5 | 1 | 5 |');
    expect(markdown).toContain('| 42 | 2026-06-03T12:00:00.000Z | Home vs Away | v10-hybrid-legacy-g |');
  });

  it('handles empty adoption reports', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] } as never)
      .mockResolvedValueOnce({ rows: [] } as never)
      .mockResolvedValueOnce({ rows: [] } as never);

    const report = await buildRecommendationPromptAdoptionReport({
      lookbackDays: 14,
      maxRecentRows: 50,
    });

    expect(report.totals.totalRows).toBe(0);
    expect(report.activity.latestRowAt).toBeNull();
    expect(report.activity.latestOfficialPromptRowAgeHours).toBeNull();
    expect(report.byPromptVersion).toEqual([]);
    expect(report.recent).toEqual([]);
    expect(formatRecommendationPromptAdoptionMarkdown(report)).toContain('| (none) | 0 | 0 | 0 | 0 | 0 |');
  });
});
