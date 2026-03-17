// ============================================================
// Integration tests — Snapshots routes
// ============================================================

import { describe, test, expect, vi, beforeAll, afterAll } from 'vitest';
import { buildApp } from './helpers.js';
import type { FastifyInstance } from 'fastify';

vi.mock('../repos/match-snapshots.repo.js', () => ({
  getSnapshotsByMatch: vi.fn().mockResolvedValue([
    { id: 1, match_id: '100', minute: 30, status: '1H', home_score: 1, away_score: 0, stats: {} },
    { id: 2, match_id: '100', minute: 45, status: 'HT', home_score: 1, away_score: 0, stats: {} },
  ]),
  getLatestSnapshot: vi.fn().mockImplementation((matchId: string) =>
    matchId === '100'
      ? Promise.resolve({ id: 2, match_id: '100', minute: 45, status: 'HT', home_score: 1, away_score: 0 })
      : Promise.resolve(null),
  ),
  createSnapshot: vi.fn().mockImplementation((body: Record<string, unknown>) =>
    Promise.resolve({ id: 10, ...body }),
  ),
}));

let app: FastifyInstance;

beforeAll(async () => {
  const { snapshotRoutes } = await import('../routes/snapshots.routes.js');
  app = await buildApp(snapshotRoutes);
});

afterAll(async () => {
  await app.close();
});

describe('GET /api/snapshots/match/:matchId', () => {
  test('returns snapshots for match', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/snapshots/match/100' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toHaveLength(2);
    expect(body[0].minute).toBe(30);
    expect(body[1].minute).toBe(45);
  });
});

describe('GET /api/snapshots/match/:matchId/latest', () => {
  test('returns latest snapshot', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/snapshots/match/100/latest' });
    expect(res.statusCode).toBe(200);
    expect(res.json().minute).toBe(45);
  });

  test('returns null for non-existent match', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/snapshots/match/999/latest' });
    expect(res.statusCode).toBe(200);
    expect(res.json().snapshot).toBeNull();
  });
});

describe('POST /api/snapshots', () => {
  test('creates a snapshot', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/snapshots',
      payload: { match_id: '200', minute: 60, status: '2H', home_score: 2, away_score: 1 },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().id).toBe(10);
  });

  test('rejects without match_id', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/snapshots',
      payload: { minute: 60 },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toContain('match_id');
  });

  test('rejects without minute', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/snapshots',
      payload: { match_id: '200' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toContain('minute');
  });
});
