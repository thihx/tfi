import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from './helpers.js';

const mockGetAuditLogs = vi.fn();
const mockGetAuditLogStats = vi.fn();
const mockInsertAuditLog = vi.fn();
const mockPurgeAuditLogs = vi.fn();

vi.mock('../repos/audit-logs.repo.js', () => ({
  getAuditLogs: mockGetAuditLogs,
  getAuditLogStats: mockGetAuditLogStats,
  insertAuditLog: mockInsertAuditLog,
  purgeAuditLogs: mockPurgeAuditLogs,
}));

let app: FastifyInstance;

beforeAll(async () => {
  const { auditLogRoutes } = await import('../routes/audit-logs.routes.js');
  app = await buildApp(auditLogRoutes);
});

afterAll(async () => {
  await app.close();
});

describe('GET /api/audit-logs', () => {
  test('passes prematch filter params to repository', async () => {
    mockGetAuditLogs.mockResolvedValueOnce({ rows: [], total: 0 });

    const res = await app.inject({
      method: 'GET',
      url: '/api/audit-logs?category=PIPELINE&prematchStrength=weak&prematchNoiseMin=50&limit=25&offset=0',
    });

    expect(res.statusCode).toBe(200);
    expect(mockGetAuditLogs).toHaveBeenCalledWith(expect.objectContaining({
      category: 'PIPELINE',
      prematchStrength: 'weak',
      prematchNoiseMin: 50,
      limit: 25,
      offset: 0,
    }));
  });
});