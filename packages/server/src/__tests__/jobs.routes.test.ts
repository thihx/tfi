// ============================================================
// Integration tests — Jobs routes
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

const mockJobs = [
  { name: 'fetch-matches', label: 'Fetch Matches', description: 'Fixtures sync job', order: 1, intervalMs: 60000, lastRun: null, lastError: null, running: false, enabled: true, runCount: 0, progress: null },
  { name: 'expire-watchlist', label: 'Expire Watchlist', description: 'Watchlist expiry job', order: 2, intervalMs: 30000, lastRun: '2026-03-17T10:00:00Z', lastError: null, running: false, enabled: true, runCount: 5, progress: null },
];
const mockRuns = [
  { id: 1, job_name: 'fetch-matches', status: 'success', started_at: '2026-03-31T01:00:00Z', completed_at: '2026-03-31T01:00:02Z' },
];
const mockOverview = [
  { jobName: 'fetch-matches', totalRuns: 12, successRuns: 11, failureRuns: 1, skippedRuns: 0, degradedRuns: 2, avgLagMs: 120, avgDurationMs: 1400, lastStartedAt: '2026-03-31T01:00:00Z', lastCompletedAt: '2026-03-31T01:00:02Z', lastStatus: 'success' },
];

vi.mock('../jobs/scheduler.js', () => ({
  getJobsStatus: vi.fn().mockResolvedValue(mockJobs),
  triggerJob: vi.fn().mockImplementation((name: string) => {
    if (name === 'fetch-matches') return { triggered: true };
    if (name === 'expire-watchlist') return { triggered: false }; // already running
    return null; // not found
  }),
  updateJobInterval: vi.fn().mockImplementation((name: string, intervalMs: number) => {
    if (name === 'fetch-matches') return { name, label: 'Fetch Matches', description: 'Fixtures sync job', order: 1, intervalMs, running: false, enabled: intervalMs > 0, runCount: 0, progress: null, concurrency: 1, activeRuns: 0, pendingRuns: 0 };
    return null; // not found
  }),
}));
vi.mock('../repos/job-runs.repo.js', () => ({
  getRecentJobRuns: vi.fn().mockResolvedValue(mockRuns),
  getJobRunOverview: vi.fn().mockResolvedValue(mockOverview),
}));

let app: FastifyInstance;
let memberApp: FastifyInstance;

beforeAll(async () => {
  const { jobRoutes } = await import('../routes/jobs.routes.js');
  app = await buildApp([jobRoutes], { currentUser: ADMIN_USER });
  memberApp = await buildApp([jobRoutes], { currentUser: MEMBER_USER });
});

afterAll(async () => {
  await app.close();
  await memberApp.close();
});

describe('GET /api/jobs', () => {
  test('rejects member role', async () => {
    const res = await memberApp.inject({ method: 'GET', url: '/api/jobs' });
    expect(res.statusCode).toBe(403);
  });

  test('returns all job statuses', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/jobs' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toHaveLength(2);
    expect(body[0].name).toBe('fetch-matches');
    expect(body[0].label).toBe('Fetch Matches');
  });
});

describe('GET /api/jobs/runs', () => {
  test('returns recent job runs and overview for admins', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/jobs/runs?limit=10&hours=12&jobName=fetch-matches' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.jobName).toBe('fetch-matches');
    expect(body.windowHours).toBe(12);
    expect(body.runs).toEqual(mockRuns);
    expect(body.overview).toEqual(mockOverview);
  });

  test('rejects members for run history', async () => {
    const res = await memberApp.inject({ method: 'GET', url: '/api/jobs/runs' });
    expect(res.statusCode).toBe(403);
  });
});

describe('POST /api/jobs/:name/trigger', () => {
  test('triggers a job successfully', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/jobs/fetch-matches/trigger' });
    expect(res.statusCode).toBe(200);
    expect(res.json().triggered).toBe(true);
  });

  test('returns 409 if job is already running', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/jobs/expire-watchlist/trigger' });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toContain('already running');
  });

  test('returns 404 for unknown job', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/jobs/non-existent/trigger' });
    expect(res.statusCode).toBe(404);
    expect(res.json().error).toContain('not found');
  });
});

describe('PUT /api/jobs/:name', () => {
  test('updates job interval', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/jobs/fetch-matches',
      payload: { intervalMs: 120000 },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().intervalMs).toBe(120000);
  });

  test('disables job with interval 0', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/jobs/fetch-matches',
      payload: { intervalMs: 0 },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().enabled).toBe(false);
  });

  test('returns 400 for invalid interval', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/jobs/fetch-matches',
      payload: { intervalMs: -100 },
    });
    expect(res.statusCode).toBe(400);
  });

  test('returns 400 for non-number interval', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/jobs/fetch-matches',
      payload: { intervalMs: 'fast' },
    });
    expect(res.statusCode).toBe(400);
  });

  test('returns 404 for unknown job', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/jobs/non-existent',
      payload: { intervalMs: 5000 },
    });
    expect(res.statusCode).toBe(404);
  });
});
