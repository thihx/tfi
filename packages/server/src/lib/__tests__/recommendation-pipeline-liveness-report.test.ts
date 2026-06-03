import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../db/pool.js', () => ({
  query: vi.fn(),
}));

import { query } from '../../db/pool.js';
import {
  buildRecommendationPipelineLivenessReport,
  formatRecommendationPipelineLivenessMarkdown,
} from '../recommendation-pipeline-liveness-report.js';

const mockQuery = vi.mocked(query);

describe('recommendation pipeline liveness report', () => {
  beforeEach(() => {
    mockQuery.mockReset();
  });

  it('summarizes job history, pipeline audit activity, and recommendation recency', async () => {
    mockQuery
      .mockResolvedValueOnce({
        rows: [{
          total_runs: '12',
          success_runs: '10',
          failure_runs: '1',
          skipped_runs: '1',
          degraded_runs: '2',
          latest_started_at: '2026-06-03T11:58:00.000Z',
          latest_completed_at: '2026-06-03T12:00:00.000Z',
          latest_completed_age_hours: '0.5',
          latest_status: 'success',
          latest_error: null,
        }],
      } as never)
      .mockResolvedValueOnce({
        rows: [{
          id: '99',
          job_name: 'check-live-trigger',
          started_at: '2026-06-03T11:58:00.000Z',
          completed_at: '2026-06-03T12:00:00.000Z',
          status: 'success',
          skip_reason: null,
          degraded_locking: false,
          duration_ms: 120000,
          error: null,
          summary: { liveCount: 2, candidateCount: 1, savedRecommendations: 1 },
        }],
      } as never)
      .mockResolvedValueOnce({
        rows: [{
          total_events: '20',
          complete_events: '4',
          latest_complete_at: '2026-06-03T12:00:01.000Z',
          latest_complete_age_hours: '0.49',
          analyzed_events: '9',
          skipped_events: '6',
          error_events: '1',
          saved_from_analyzed_events: '2',
          latest_complete_metadata: { totalSavedRecommendations: 1 },
        }],
      } as never)
      .mockResolvedValueOnce({
        rows: [
          { action: 'PIPELINE_MATCH_ANALYZED', outcome: 'SUCCESS', count: '9', latest_at: '2026-06-03T12:00:01.000Z' },
          { action: 'PIPELINE_COMPLETE', outcome: 'SUCCESS', count: '4', latest_at: '2026-06-03T12:00:01.000Z' },
        ],
      } as never)
      .mockResolvedValueOnce({
        rows: [
          { action: 'LLM_CALL_STARTED', prompt_version: 'v10-hybrid-legacy-g', count: '8', latest_at: '2026-06-03T12:00:01.000Z' },
          { action: 'PIPELINE_MATCH_ANALYZED', prompt_version: 'v10-hybrid-legacy-g', count: '7', latest_at: '2026-06-03T12:00:01.000Z' },
        ],
      } as never)
      .mockResolvedValueOnce({
        rows: [{
          total_rows: '3',
          latest_row_at: '2026-06-03T12:00:02.000Z',
          latest_row_age_hours: '0.48',
          official_prompt_rows: '2',
          latest_official_prompt_row_at: '2026-06-03T12:00:02.000Z',
          latest_official_prompt_row_age_hours: '0.48',
          non_official_prompt_rows: '1',
        }],
      } as never);

    const report = await buildRecommendationPipelineLivenessReport({
      lookbackHours: 336,
      maxRecentRows: 25,
    });

    expect(mockQuery).toHaveBeenCalledTimes(6);
    expect(mockQuery.mock.calls[0]?.[1]).toEqual([336, 'check-live-trigger']);
    expect(mockQuery.mock.calls[1]?.[1]).toEqual([336, 'check-live-trigger', 25]);
    expect(report.job).toMatchObject({
      totalRuns: 12,
      successRuns: 10,
      latestCompletedAgeHours: 0.5,
      latestStatus: 'success',
    });
    expect(report.pipelineAudit).toMatchObject({
      completeEvents: 4,
      matchAnalyzedEvents: 9,
      savedFromMatchAnalyzedEvents: 2,
      latestCompleteAgeHours: 0.49,
    });
    expect(report.recommendations).toMatchObject({
      totalRows: 3,
      officialPromptRows: 2,
      latestOfficialPromptRowAgeHours: 0.48,
    });
    expect(report.auditPromptVersions).toEqual([
      {
        action: 'LLM_CALL_STARTED',
        promptVersion: 'v10-hybrid-legacy-g',
        count: 8,
        latestAt: '2026-06-03T12:00:01.000Z',
      },
      {
        action: 'PIPELINE_MATCH_ANALYZED',
        promptVersion: 'v10-hybrid-legacy-g',
        count: 7,
        latestAt: '2026-06-03T12:00:01.000Z',
      },
    ]);
    expect(report.diagnosis).toEqual({
      jobHasRecentRuns: true,
      pipelineHasRecentComplete: true,
      recommendationsHaveRecentRows: true,
      officialPromptObserved: true,
    });

    const markdown = formatRecommendationPipelineLivenessMarkdown(report);
    expect(markdown).toContain('# Recommendation Pipeline Liveness Report');
    expect(markdown).toContain('- Job has recent runs: yes');
    expect(markdown).toContain('| PIPELINE_MATCH_ANALYZED | SUCCESS | 9 | 2026-06-03T12:00:01.000Z |');
    expect(markdown).toContain('| LLM_CALL_STARTED | v10-hybrid-legacy-g | 8 | 2026-06-03T12:00:01.000Z |');
  });

  it('handles missing recent activity', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] } as never)
      .mockResolvedValueOnce({ rows: [] } as never)
      .mockResolvedValueOnce({ rows: [] } as never)
      .mockResolvedValueOnce({ rows: [] } as never)
      .mockResolvedValueOnce({ rows: [] } as never)
      .mockResolvedValueOnce({ rows: [] } as never);

    const report = await buildRecommendationPipelineLivenessReport({
      lookbackHours: 24,
      maxRecentRows: 10,
    });

    expect(report.job.totalRuns).toBe(0);
    expect(report.pipelineAudit.completeEvents).toBe(0);
    expect(report.recommendations.latestRowAt).toBeNull();
    expect(report.diagnosis).toEqual({
      jobHasRecentRuns: false,
      pipelineHasRecentComplete: false,
      recommendationsHaveRecentRows: false,
      officialPromptObserved: false,
    });
    expect(formatRecommendationPipelineLivenessMarkdown(report)).toContain('| (none) |  | 0 |  |');
  });
});
