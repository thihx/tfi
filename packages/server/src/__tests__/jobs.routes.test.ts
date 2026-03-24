// ============================================================
// Integration tests — Jobs routes
// ============================================================

import { describe, test, expect, vi, beforeAll, afterAll } from 'vitest';
import { buildApp } from './helpers.js';
import type { FastifyInstance } from 'fastify';

const mockJobs = [
  { name: 'fetch-matches', label: 'Fetch Matches', description: 'Fixtures sync job', order: 1, intervalMs: 60000, lastRun: null, lastError: null, running: false, enabled: true, runCount: 0, progress: null },
  { name: 'expire-watchlist', label: 'Expire Watchlist', description: 'Watchlist expiry job', order: 2, intervalMs: 30000, lastRun: '2026-03-17T10:00:00Z', lastError: null, running: false, enabled: true, runCount: 5, progress: null },
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

let app: FastifyInstance;

beforeAll(async () => {
  const { jobRoutes } = await import('../routes/jobs.routes.js');
  app = await buildApp(jobRoutes);
});

afterAll(async () => {
  await app.close();
});

describe('GET /api/jobs', () => {
  test('returns all job statuses', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/jobs' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toHaveLength(2);
    expect(body[0].name).toBe('fetch-matches');
    expect(body[0].label).toBe('Fetch Matches');
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
