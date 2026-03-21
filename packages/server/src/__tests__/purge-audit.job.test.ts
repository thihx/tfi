// ============================================================
// Unit tests — Purge Audit Job
// ============================================================

import { describe, test, expect, vi, beforeEach } from 'vitest';

vi.mock('../lib/redis.js', () => ({
  getRedisClient: () => ({ hget: vi.fn(), hset: vi.fn(), expire: vi.fn(), del: vi.fn() }),
}));

vi.mock('../jobs/job-progress.js', () => ({
  reportJobProgress: vi.fn(),
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

const { purgeAuditJob } = await import('../jobs/purge-audit.job.js');

beforeEach(() => {
  vi.clearAllMocks();
});

describe('purgeAuditJob', () => {
  test('purges all high-growth tables using configured keepDays', async () => {
    const result = await purgeAuditJob();
    expect(result).toEqual({
      auditDeleted: 42,
      matchesHistoryDeleted: 5,
      providerStatsDeleted: 9,
      providerOddsDeleted: 7,
      matchSnapshotsDeleted: 11,
      oddsMovementsDeleted: 13,
      promptShadowDeleted: 6,
      totalDeleted: 93,
      keepDays: {
        audit: 30,
        matchesHistory: 120,
        providerSamples: 14,
        matchSnapshots: 14,
        oddsMovements: 30,
        promptShadow: 14,
      },
    });

    const repo = await import('../repos/audit-logs.repo.js');
    expect(repo.purgeAuditLogs).toHaveBeenCalledWith(30);
    const historyRepo = await import('../repos/matches-history.repo.js');
    const providerStatsRepo = await import('../repos/provider-stats-samples.repo.js');
    const providerOddsRepo = await import('../repos/provider-odds-samples.repo.js');
    const snapshotsRepo = await import('../repos/match-snapshots.repo.js');
    const oddsRepo = await import('../repos/odds-movements.repo.js');
    const promptShadowRepo = await import('../repos/prompt-shadow-runs.repo.js');
    expect(historyRepo.purgeHistoricalMatches).toHaveBeenCalledWith(120);
    expect(providerStatsRepo.purgeProviderStatsSamples).toHaveBeenCalledWith(14);
    expect(providerOddsRepo.purgeProviderOddsSamples).toHaveBeenCalledWith(14);
    expect(snapshotsRepo.purgeMatchSnapshots).toHaveBeenCalledWith(14);
    expect(oddsRepo.purgeOddsMovements).toHaveBeenCalledWith(30);
    expect(promptShadowRepo.purgePromptShadowRuns).toHaveBeenCalledWith(14);
  });

  test('reports 0 when nothing to purge', async () => {
    const repo = await import('../repos/audit-logs.repo.js');
    const historyRepo = await import('../repos/matches-history.repo.js');
    const providerStatsRepo = await import('../repos/provider-stats-samples.repo.js');
    const providerOddsRepo = await import('../repos/provider-odds-samples.repo.js');
    const snapshotsRepo = await import('../repos/match-snapshots.repo.js');
    const oddsRepo = await import('../repos/odds-movements.repo.js');
    const promptShadowRepo = await import('../repos/prompt-shadow-runs.repo.js');
    vi.mocked(repo.purgeAuditLogs).mockResolvedValueOnce(0);
    vi.mocked(historyRepo.purgeHistoricalMatches).mockResolvedValueOnce(0);
    vi.mocked(providerStatsRepo.purgeProviderStatsSamples).mockResolvedValueOnce(0);
    vi.mocked(providerOddsRepo.purgeProviderOddsSamples).mockResolvedValueOnce(0);
    vi.mocked(snapshotsRepo.purgeMatchSnapshots).mockResolvedValueOnce(0);
    vi.mocked(oddsRepo.purgeOddsMovements).mockResolvedValueOnce(0);
    vi.mocked(promptShadowRepo.purgePromptShadowRuns).mockResolvedValueOnce(0);

    const result = await purgeAuditJob();
    expect(result.totalDeleted).toBe(0);
  });

  test('reports progress', async () => {
    await purgeAuditJob();
    const { reportJobProgress } = await import('../jobs/job-progress.js');
    expect(reportJobProgress).toHaveBeenCalledWith('purge-audit', 'purge', expect.any(String), 15);
  });
});
