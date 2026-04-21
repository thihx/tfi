import { beforeEach, describe, expect, test, vi } from 'vitest';

const { queryMock, transactionMock } = vi.hoisted(() => ({
  queryMock: vi.fn(),
  transactionMock: vi.fn(),
}));

vi.mock('../db/pool.js', () => ({
  query: queryMock,
  transaction: transactionMock,
}));

import { completeRecommendationReplayRun, cancelRecommendationReplayRun } from '../repos/recommendation-studio.repo.js';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('recommendation studio repository', () => {
  test('completeRecommendationReplayRun preserves canceled runs and marks partial failures explicitly', async () => {
    queryMock.mockResolvedValue({ rows: [] } as never);

    await completeRecommendationReplayRun(77, { summary: { pushRate: 0.5 } }, { failedItems: 2 });

    expect(queryMock).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining("status <> 'canceled'"),
      [77, JSON.stringify({ summary: { pushRate: 0.5 } }), 'completed_with_errors'],
    );
    expect(queryMock).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining("status <> 'canceled'"),
      [77],
    );
  });

  test('cancelRecommendationReplayRun resets release replay validation status', async () => {
    const clientQuery = vi.fn();
    transactionMock.mockImplementation(async (fn: (client: { query: typeof clientQuery }) => Promise<unknown>) => fn({ query: clientQuery } as never));
    clientQuery
      .mockResolvedValueOnce({
        rows: [{
          id: '91',
          run_key: 'replay-91',
          name: 'Replay 91',
          release_id: '12',
          prompt_template_id: '3',
          rule_set_id: '4',
          status: 'running',
          source_filters: {},
          release_snapshot_json: {},
          summary_json: {},
          total_items: 2,
          completed_items: 1,
          error_message: null,
          llm_mode: 'real',
          llm_model: 'gemini-2.5-flash',
          created_by: 'admin-1',
          created_at: '2026-04-21T00:00:00.000Z',
          started_at: '2026-04-21T00:00:10.000Z',
          completed_at: null,
        }],
      } as never)
      .mockResolvedValueOnce({
        rows: [{
          id: '91',
          run_key: 'replay-91',
          name: 'Replay 91',
          release_id: '12',
          prompt_template_id: '3',
          rule_set_id: '4',
          status: 'canceled',
          source_filters: {},
          release_snapshot_json: {},
          summary_json: {},
          total_items: 2,
          completed_items: 1,
          error_message: 'Canceled by admin',
          llm_mode: 'real',
          llm_model: 'gemini-2.5-flash',
          created_by: 'admin-1',
          created_at: '2026-04-21T00:00:00.000Z',
          started_at: '2026-04-21T00:00:10.000Z',
          completed_at: '2026-04-21T00:00:30.000Z',
        }],
      } as never)
      .mockResolvedValueOnce({ rows: [] } as never)
      .mockResolvedValueOnce({ rows: [] } as never);

    const canceled = await cancelRecommendationReplayRun(91, 'admin-1');

    expect(canceled?.status).toBe('canceled');
    expect(clientQuery).toHaveBeenCalledWith(
      expect.stringContaining("SET replay_validation_status = 'not_validated'"),
      [91],
    );
  });
});
