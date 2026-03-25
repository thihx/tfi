import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
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

vi.mock('../lib/integration-health.js', () => ({
  checkAllIntegrations: vi.fn().mockResolvedValue({ overall: 'HEALTHY', services: [] }),
  checkSingleIntegration: vi.fn().mockResolvedValue({ id: 'telegram', status: 'HEALTHY' }),
}));

let adminApp: FastifyInstance;
let memberApp: FastifyInstance;

beforeAll(async () => {
  const { integrationsRoutes } = await import('../routes/integrations.routes.js');
  adminApp = await buildApp([integrationsRoutes], { currentUser: ADMIN_USER });
  memberApp = await buildApp([integrationsRoutes], { currentUser: MEMBER_USER });
});

afterAll(async () => {
  await adminApp.close();
  await memberApp.close();
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe('GET /api/integrations/health', () => {
  test('rejects member role', async () => {
    const res = await memberApp.inject({ method: 'GET', url: '/api/integrations/health' });
    expect(res.statusCode).toBe(403);
  });

  test('allows admin role', async () => {
    const res = await adminApp.inject({ method: 'GET', url: '/api/integrations/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json().overall).toBe('HEALTHY');
  });
});