// ============================================================
// Integration tests — Pipeline Runs routes
// ============================================================

import { describe, test, expect, vi, beforeAll, afterAll } from 'vitest';
import { buildApp } from './helpers.js';
import type { FastifyInstance } from 'fastify';

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

vi.mock('../repos/pipeline-runs.repo.js', () => ({
  getRecentRuns: vi.fn().mockImplementation((limit: number) =>
    Promise.resolve(
      Array.from({ length: Math.min(limit, 3) }, (_, i) => ({
        id: i + 1, triggered_by: 'manual', status: 'completed', started_at: '2026-03-17T10:00:00Z',
      })),
    ),
  ),
  createRun: vi.fn().mockImplementation((triggeredBy?: string) =>
    Promise.resolve({ id: 10, triggered_by: triggeredBy || 'manual', status: 'running', started_at: new Date().toISOString() }),
  ),
  completeRun: vi.fn().mockImplementation((id: number, body: Record<string, unknown>) =>
    Promise.resolve({ id, status: 'completed', ...body }),
  ),
  failRun: vi.fn().mockImplementation((id: number, error: string) =>
    Promise.resolve({ id, status: 'failed', error }),
  ),
}));

let app: FastifyInstance;
let memberApp: FastifyInstance;

beforeAll(async () => {
  const { pipelineRoutes } = await import('../routes/pipeline-runs.routes.js');
  app = await buildApp([pipelineRoutes], { currentUser: ADMIN_USER });
  memberApp = await buildApp([pipelineRoutes], { currentUser: MEMBER_USER });
});

afterAll(async () => {
  await app.close();
  await memberApp.close();
});

describe('GET /api/pipeline-runs', () => {
  test('rejects member role', async () => {
    const res = await memberApp.inject({ method: 'GET', url: '/api/pipeline-runs' });
    expect(res.statusCode).toBe(403);
  });

  test('returns recent runs with default limit', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/pipeline-runs' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toHaveLength(3);
  });

  test('respects custom limit', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/pipeline-runs?limit=2' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toHaveLength(2);
  });
});

describe('POST /api/pipeline-runs', () => {
  test('creates a new run', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/pipeline-runs',
      payload: { triggered_by: 'scheduler' },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().id).toBe(10);
    expect(res.json().triggered_by).toBe('scheduler');
  });

  test('creates with default triggered_by', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/pipeline-runs',
      payload: {},
    });
    expect(res.statusCode).toBe(201);
  });
});

describe('PUT /api/pipeline-runs/:id/complete', () => {
  test('completes a run', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/pipeline-runs/1/complete',
      payload: { matches_count: 5, analyzed: 5, notified: 2, saved: 3 },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe('completed');
  });

  test('returns 400 for invalid ID', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/pipeline-runs/abc/complete',
      payload: { matches_count: 0, analyzed: 0, notified: 0, saved: 0 },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toContain('Invalid');
  });
});

describe('PUT /api/pipeline-runs/:id/fail', () => {
  test('fails a run', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/pipeline-runs/1/fail',
      payload: { error: 'Timeout reached' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe('failed');
    expect(res.json().error).toBe('Timeout reached');
  });

  test('returns 400 for invalid ID', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/pipeline-runs/xyz/fail',
      payload: { error: 'some error' },
    });
    expect(res.statusCode).toBe(400);
  });
});
