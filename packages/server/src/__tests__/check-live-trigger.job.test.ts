// ============================================================
// Unit tests — Check Live Trigger Job
// ============================================================

import { describe, test, expect, vi, beforeEach } from 'vitest';

vi.mock('../lib/redis.js', () => ({
  getRedisClient: () => ({ hget: vi.fn(), hset: vi.fn(), expire: vi.fn(), del: vi.fn() }),
}));

vi.mock('../jobs/job-progress.js', () => ({
  reportJobProgress: vi.fn(),
}));

vi.mock('../config.js', () => ({
  config: {
    liveStatuses: ['1H', '2H', 'HT', 'ET', 'BT', 'LIVE'],
    pipelineEnabled: true,
    pipelineBatchSize: 3,
    pipelineTelegramChatId: '123456',
  },
}));

vi.mock('../lib/audit.js', () => ({
  audit: vi.fn(),
}));

const mockPipelineResult = {
  totalMatches: 2,
  processed: 2,
  errors: 0,
  results: [
    { matchId: '100', success: true, shouldPush: true, selection: 'Over 2.5 @1.85', confidence: 8, saved: true, notified: true },
    { matchId: '300', success: true, shouldPush: false, selection: '', confidence: 3, saved: true, notified: false },
  ],
};

vi.mock('../lib/server-pipeline.js', () => ({
  runPipelineBatch: vi.fn().mockResolvedValue(mockPipelineResult),
}));

const mockWatchlist = [
  { match_id: '100' },
  { match_id: '200' },
  { match_id: '300' },
];

vi.mock('../repos/watchlist.repo.js', () => ({
  getActiveWatchlist: vi.fn().mockResolvedValue(mockWatchlist),
  incrementChecks: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../repos/matches.repo.js', () => ({
  getMatchesByIds: vi.fn().mockResolvedValue([
    { match_id: '100', status: '1H' },  // live
    { match_id: '200', status: 'NS' },  // not started
    { match_id: '300', status: '2H' },  // live
  ]),
}));

const { checkLiveTriggerJob } = await import('../jobs/check-live-trigger.job.js');

beforeEach(() => {
  vi.clearAllMocks();
});

describe('checkLiveTriggerJob', () => {
  test('detects live matches and increments their checks', async () => {
    const result = await checkLiveTriggerJob();
    expect(result.liveCount).toBe(2);

    const watchlistRepo = await import('../repos/watchlist.repo.js');
    expect(watchlistRepo.incrementChecks).toHaveBeenCalledTimes(2);
    expect(watchlistRepo.incrementChecks).toHaveBeenCalledWith('100');
    expect(watchlistRepo.incrementChecks).toHaveBeenCalledWith('300');
  });

  test('does not increment NS (non-live) matches', async () => {
    await checkLiveTriggerJob();
    const watchlistRepo = await import('../repos/watchlist.repo.js');
    const calledWith = vi.mocked(watchlistRepo.incrementChecks).mock.calls.map((c) => c[0]);
    expect(calledWith).not.toContain('200');
  });

  test('returns 0 when watchlist is empty', async () => {
    const watchlistRepo = await import('../repos/watchlist.repo.js');
    vi.mocked(watchlistRepo.getActiveWatchlist).mockResolvedValueOnce([]);

    const result = await checkLiveTriggerJob();
    expect(result).toEqual({ liveCount: 0 });
  });

  test('returns 0 when no matches are live', async () => {
    const matchRepo = await import('../repos/matches.repo.js');
    vi.mocked(matchRepo.getMatchesByIds).mockResolvedValueOnce([
      { match_id: '100', status: 'NS' },
      { match_id: '200', status: 'NS' },
      { match_id: '300', status: 'FT' },
    ] as never);

    const result = await checkLiveTriggerJob();
    expect(result).toEqual({ liveCount: 0 });
  });

  test('reports progress at each step', async () => {
    await checkLiveTriggerJob();
    const { reportJobProgress } = await import('../jobs/job-progress.js');
    expect(reportJobProgress).toHaveBeenCalledWith('check-live-trigger', 'load', expect.any(String), 15);
    expect(reportJobProgress).toHaveBeenCalledWith('check-live-trigger', 'check', expect.any(String), 45);
    expect(reportJobProgress).toHaveBeenCalledWith('check-live-trigger', 'increment', expect.any(String), expect.any(Number));
  });

  test('triggers pipeline when live matches found and pipeline enabled', async () => {
    const result = await checkLiveTriggerJob();
    const { runPipelineBatch } = await import('../lib/server-pipeline.js');
    expect(runPipelineBatch).toHaveBeenCalledWith(['100', '300']);
    expect(result.pipelineResults).toHaveLength(1);
    expect(result.pipelineResults![0].processed).toBe(2);
  });

  test('skips pipeline when pipelineEnabled is false', async () => {
    const { config } = await import('../config.js');
    (config as Record<string, unknown>).pipelineEnabled = false;

    const result = await checkLiveTriggerJob();
    const { runPipelineBatch } = await import('../lib/server-pipeline.js');
    expect(runPipelineBatch).not.toHaveBeenCalled();
    expect(result.liveCount).toBe(2);
    expect(result.pipelineResults).toBeUndefined();

    (config as Record<string, unknown>).pipelineEnabled = true;
  });

  test('splits matches into batches of pipelineBatchSize', async () => {
    const { config } = await import('../config.js');
    (config as Record<string, unknown>).pipelineBatchSize = 1;

    // 2 live matches → 2 batches of 1
    const matchRepo = await import('../repos/matches.repo.js');
    vi.mocked(matchRepo.getMatchesByIds).mockResolvedValueOnce([
      { match_id: '100', status: '1H' },
      { match_id: '200', status: 'NS' },
      { match_id: '300', status: '2H' },
    ] as never);

    await checkLiveTriggerJob();
    const { runPipelineBatch } = await import('../lib/server-pipeline.js');
    expect(runPipelineBatch).toHaveBeenCalledTimes(2);
    expect(runPipelineBatch).toHaveBeenCalledWith(['100']);
    expect(runPipelineBatch).toHaveBeenCalledWith(['300']);

    (config as Record<string, unknown>).pipelineBatchSize = 3;
  });

  test('handles pipeline batch errors gracefully', async () => {
    const { runPipelineBatch } = await import('../lib/server-pipeline.js');
    vi.mocked(runPipelineBatch).mockRejectedValueOnce(new Error('Gemini down'));

    const result = await checkLiveTriggerJob();
    // Should not throw, just log the error
    expect(result.liveCount).toBe(2);
    expect(result.pipelineResults).toHaveLength(0);

    const { audit } = await import('../lib/audit.js');
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({
      action: 'PIPELINE_BATCH_ERROR',
      outcome: 'FAILURE',
    }));
  });
});
