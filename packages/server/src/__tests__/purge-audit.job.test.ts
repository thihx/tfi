// ============================================================
// Unit tests — Housekeeping Job
// ============================================================

import { describe, test, expect, vi, beforeEach } from 'vitest';

vi.mock('../lib/redis.js', () => ({
  getRedisClient: () => ({ hget: vi.fn(), hset: vi.fn(), expire: vi.fn(), del: vi.fn() }),
}));

vi.mock('../jobs/job-progress.js', () => ({
  reportJobProgress: vi.fn(),
}));

vi.mock('../db/pool.js', () => ({
  query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
  transaction: vi.fn(),
}));

vi.mock('../repos/audit-logs.repo.js', () => ({
  purgeAuditLogs: vi.fn().mockResolvedValue(42),
}));
vi.mock('../repos/matches-history.repo.js', () => ({
  purgeHistoricalMatches: vi.fn().mockResolvedValue(5),
}));
vi.mock('../repos/provider-stats-samples.repo.js', () => ({
  purgeProviderStatsSamples: vi.fn().mockResolvedValue(9),
}));
vi.mock('../repos/provider-odds-samples.repo.js', () => ({
  purgeProviderOddsSamples: vi.fn().mockResolvedValue(7),
}));
vi.mock('../repos/match-snapshots.repo.js', () => ({
  purgeMatchSnapshots: vi.fn().mockResolvedValue(11),
}));
vi.mock('../repos/odds-movements.repo.js', () => ({
  purgeOddsMovements: vi.fn().mockResolvedValue(13),
}));
vi.mock('../repos/prompt-shadow-runs.repo.js', () => ({
  purgePromptShadowRuns: vi.fn().mockResolvedValue(6),
}));
vi.mock('../repos/pipeline-runs.repo.js', () => ({
  purgePipelineRuns: vi.fn().mockResolvedValue(3),
}));
vi.mock('../repos/job-runs.repo.js', () => ({
  purgeJobRuns: vi.fn().mockResolvedValue(4),
}));
vi.mock('../repos/recommendations.repo.js', () => ({
  slimOldRecommendations: vi.fn().mockResolvedValue(20),
}));
vi.mock('../repos/ai-performance.repo.js', () => ({
  aggregateAndPurgeOldAiPerformance: vi.fn().mockResolvedValue({ aggregated: 4, deleted: 8 }),
}));
vi.mock('../repos/recommendation-deliveries.repo.js', () => ({
  purgeOldDeliveries: vi.fn().mockResolvedValue(0),
}));

const { housekeepingJob, purgeAuditJob } = await import('../jobs/purge-audit.job.js');

beforeEach(() => {
  vi.clearAllMocks();
});

describe('housekeepingJob', () => {
  test('purges all high-growth tables using configured keepDays', async () => {
    const result = await housekeepingJob();

    expect(result.auditDeleted).toBe(42);
    expect(result.matchesHistoryDeleted).toBe(5);
    expect(result.providerStatsDeleted).toBe(9);
    expect(result.providerOddsDeleted).toBe(7);
    expect(result.matchSnapshotsDeleted).toBe(11);
    expect(result.oddsMovementsDeleted).toBe(13);
    expect(result.promptShadowDeleted).toBe(6);
    expect(result.pipelineRunsDeleted).toBe(3);
    expect(result.jobRunHistoryDeleted).toBe(4);
    expect(result.recommendationDeliveriesDeleted).toBe(0);
    expect(result.recommendationsSlimmed).toBe(20);
    expect(result.aiPerfAggregated).toBe(4);
    expect(result.aiPerfDeleted).toBe(8);
    // totalDeleted excludes slimmed (UPDATE not DELETE) but includes aiPerfDeleted
    expect(result.totalDeleted).toBe(42 + 5 + 9 + 7 + 11 + 13 + 6 + 3 + 4 + 8);

    expect(result.keepDays).toMatchObject({
      audit: 30,
      matchesHistory: 120,
      matchesHistoryHardDelete: 180,
      providerSamples: 14,
      matchSnapshots: 14,
      oddsMovements: 30,
      promptShadow: 14,
      pipelineRuns: 14,
      jobRunHistory: 30,
      recommendationDeliveries: 0,
      recommendationsSlim: 365,
      aiPerformance: 365,
    });
    expect(result.failedPhases).toEqual([]);

    const historyRepo = await import('../repos/matches-history.repo.js');
    expect(historyRepo.purgeHistoricalMatches).toHaveBeenCalledWith(120, 180);

    const pipelineRepo = await import('../repos/pipeline-runs.repo.js');
    expect(pipelineRepo.purgePipelineRuns).toHaveBeenCalledWith(14);
    const jobRunsRepo = await import('../repos/job-runs.repo.js');
    expect(jobRunsRepo.purgeJobRuns).toHaveBeenCalledWith(30);

    const deliveriesRepo = await import('../repos/recommendation-deliveries.repo.js');
    expect(deliveriesRepo.purgeOldDeliveries).not.toHaveBeenCalled();

    const recsRepo = await import('../repos/recommendations.repo.js');
    expect(recsRepo.slimOldRecommendations).toHaveBeenCalledWith(365);

    const aiRepo = await import('../repos/ai-performance.repo.js');
    expect(aiRepo.aggregateAndPurgeOldAiPerformance).toHaveBeenCalledWith(365);
  });

  test('reports 0 when nothing to purge', async () => {
    const auditRepo = await import('../repos/audit-logs.repo.js');
    const historyRepo = await import('../repos/matches-history.repo.js');
    const providerStatsRepo = await import('../repos/provider-stats-samples.repo.js');
    const providerOddsRepo = await import('../repos/provider-odds-samples.repo.js');
    const snapshotsRepo = await import('../repos/match-snapshots.repo.js');
    const oddsRepo = await import('../repos/odds-movements.repo.js');
    const promptShadowRepo = await import('../repos/prompt-shadow-runs.repo.js');
    const pipelineRepo = await import('../repos/pipeline-runs.repo.js');
    const jobRunsRepo = await import('../repos/job-runs.repo.js');
    const recsRepo = await import('../repos/recommendations.repo.js');
    const aiRepo = await import('../repos/ai-performance.repo.js');
    const deliveriesRepo = await import('../repos/recommendation-deliveries.repo.js');
    vi.mocked(auditRepo.purgeAuditLogs).mockResolvedValueOnce(0);
    vi.mocked(historyRepo.purgeHistoricalMatches).mockResolvedValueOnce(0);
    vi.mocked(providerStatsRepo.purgeProviderStatsSamples).mockResolvedValueOnce(0);
    vi.mocked(providerOddsRepo.purgeProviderOddsSamples).mockResolvedValueOnce(0);
    vi.mocked(snapshotsRepo.purgeMatchSnapshots).mockResolvedValueOnce(0);
    vi.mocked(oddsRepo.purgeOddsMovements).mockResolvedValueOnce(0);
    vi.mocked(promptShadowRepo.purgePromptShadowRuns).mockResolvedValueOnce(0);
    vi.mocked(pipelineRepo.purgePipelineRuns).mockResolvedValueOnce(0);
    vi.mocked(jobRunsRepo.purgeJobRuns).mockResolvedValueOnce(0);
    vi.mocked(deliveriesRepo.purgeOldDeliveries).mockResolvedValueOnce(0);
    vi.mocked(recsRepo.slimOldRecommendations).mockResolvedValueOnce(0);
    vi.mocked(aiRepo.aggregateAndPurgeOldAiPerformance).mockResolvedValueOnce({ aggregated: 0, deleted: 0 });

    const result = await housekeepingJob();
    expect(result.totalDeleted).toBe(0);
    expect(result.recommendationsSlimmed).toBe(0);
  });

  test('reports progress via purge-audit Redis key for scheduler compat', async () => {
    await housekeepingJob();
    const { reportJobProgress } = await import('../jobs/job-progress.js');
    expect(reportJobProgress).toHaveBeenCalledWith('purge-audit', 'purge', expect.any(String), 15);
  });

  test('purgeAuditJob is a deprecated alias for housekeepingJob', () => {
    expect(purgeAuditJob).toBe(housekeepingJob);
  });
});
