import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from './helpers.js';

const ADMIN_USER = {
  userId: 'admin-1',
  email: 'admin@example.com',
  role: 'admin' as const,
  status: 'active' as const,
  displayName: 'Admin',
  avatarUrl: '',
};

const MEMBER_USER = {
  userId: 'member-1',
  email: 'member@example.com',
  role: 'member' as const,
  status: 'active' as const,
  displayName: 'Member',
  avatarUrl: '',
};

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
let memberApp: FastifyInstance;

beforeAll(async () => {
  const { auditLogRoutes } = await import('../routes/audit-logs.routes.js');
  app = await buildApp([auditLogRoutes], { currentUser: ADMIN_USER });
  memberApp = await buildApp([auditLogRoutes], { currentUser: MEMBER_USER });
});

afterAll(async () => {
  await app.close();
  await memberApp.close();
});

describe('GET /api/audit-logs', () => {
  test('rejects member role', async () => {
    const res = await memberApp.inject({ method: 'GET', url: '/api/audit-logs' });
    expect(res.statusCode).toBe(403);
  });

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

describe('POST /api/audit-logs', () => {
  test('allows authenticated member writes', async () => {
    const res = await memberApp.inject({
      method: 'POST',
      url: '/api/audit-logs',
      payload: { category: 'UI', action: 'CLICKED' },
    });

    expect(res.statusCode).toBe(201);
    expect(mockInsertAuditLog).toHaveBeenCalledWith({ category: 'UI', action: 'CLICKED' });
  });
});