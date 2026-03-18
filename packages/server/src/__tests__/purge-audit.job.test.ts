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

const { purgeAuditJob } = await import('../jobs/purge-audit.job.js');

beforeEach(() => {
  vi.clearAllMocks();
});

describe('purgeAuditJob', () => {
  test('purges logs using configured keepDays', async () => {
    const result = await purgeAuditJob();
    expect(result).toEqual({ deleted: 42, keepDays: 30 });

    const repo = await import('../repos/audit-logs.repo.js');
    expect(repo.purgeAuditLogs).toHaveBeenCalledWith(30);
  });

  test('reports 0 when nothing to purge', async () => {
    const repo = await import('../repos/audit-logs.repo.js');
    vi.mocked(repo.purgeAuditLogs).mockResolvedValueOnce(0);

    const result = await purgeAuditJob();
    expect(result).toEqual({ deleted: 0, keepDays: 30 });
  });

  test('reports progress', async () => {
    await purgeAuditJob();
    const { reportJobProgress } = await import('../jobs/job-progress.js');
    expect(reportJobProgress).toHaveBeenCalledWith('purge-audit', 'purge', expect.any(String), 30);
  });
});
