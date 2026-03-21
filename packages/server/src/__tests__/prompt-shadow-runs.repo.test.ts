import { beforeEach, describe, expect, test, vi } from 'vitest';

const query = vi.fn();

vi.mock('../db/pool.js', () => ({
  query,
}));

const {
  createPromptShadowRun,
  purgePromptShadowRuns,
} = await import('../repos/prompt-shadow-runs.repo.js');

describe('prompt-shadow-runs repo', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('createPromptShadowRun inserts structured shadow output', async () => {
    query.mockResolvedValueOnce({
      rows: [{
        id: 1,
        analysis_run_id: 'run-1',
        execution_role: 'shadow',
        prompt_version: 'v5-compact-a',
      }],
    });

    await createPromptShadowRun({
      analysis_run_id: 'run-1',
      match_id: '100',
      execution_role: 'shadow',
      active_prompt_version: 'v4-evidence-hardened',
      prompt_version: 'v5-compact-a',
      analysis_mode: 'auto',
      evidence_mode: 'full_live_data',
      should_push: true,
      ai_should_push: true,
      selection: 'Over 2.5 Goals @1.85',
      bet_market: 'over_2.5',
      confidence: 8,
      warnings: ['LOW_SAMPLE'],
      odds_source: 'live',
      stats_source: 'api-football',
      prompt_estimated_tokens: 2038,
      response_estimated_tokens: 384,
      llm_latency_ms: 15900,
      total_latency_ms: 16100,
    });

    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO prompt_shadow_runs'),
      expect.arrayContaining([
        'run-1',
        '100',
        'shadow',
        'v4-evidence-hardened',
        'v5-compact-a',
        'auto',
        'full_live_data',
        true,
        '',
        true,
        true,
        'Over 2.5 Goals @1.85',
        'over_2.5',
        8,
        '["LOW_SAMPLE"]',
        'live',
        'api-football',
        2038,
        384,
        15900,
        16100,
      ]),
    );
  });

  test('purgePromptShadowRuns deletes old rows', async () => {
    query.mockResolvedValueOnce({ rowCount: 7 });

    const deleted = await purgePromptShadowRuns(14);

    expect(deleted).toBe(7);
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('DELETE FROM prompt_shadow_runs'),
      [14],
    );
  });
});
