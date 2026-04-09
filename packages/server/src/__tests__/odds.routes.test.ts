// ============================================================
// Integration tests — Odds routes
// ============================================================

import { describe, test, expect, vi, beforeAll, afterAll } from 'vitest';
import { buildApp } from './helpers.js';
import type { FastifyInstance } from 'fastify';

vi.mock('../repos/odds-movements.repo.js', () => ({
  getOddsHistory: vi.fn().mockResolvedValue([
    { id: 1, match_id: '100', market: 'ou2.5', price_1: 1.85, price_2: 2.0, captured_at: '2026-03-17T10:00:00Z' },
  ]),
  recordOddsMovement: vi.fn().mockImplementation((body: Record<string, unknown>) =>
    Promise.resolve({ id: 50, ...body }),
  ),
  recordOddsMovementsBulk: vi.fn().mockImplementation((body: Array<Record<string, unknown>>) =>
    Promise.resolve(body.filter((item) => item.match_id && item.market).map((item, index) => ({ id: 50 + index, ...item }))),
  ),
}));

let app: FastifyInstance;

beforeAll(async () => {
  const { oddsRoutes } = await import('../routes/odds.routes.js');
  app = await buildApp(oddsRoutes);
});

afterAll(async () => {
  await app.close();
});

describe('GET /api/odds/match/:matchId', () => {
  test('returns odds history', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/odds/match/100' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toHaveLength(1);
    expect(body[0].market).toBe('ou2.5');
  });

  test('passes market query param', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/odds/match/100?market=1x2' });
    expect(res.statusCode).toBe(200);
  });
});

describe('POST /api/odds', () => {
  test('records a single odds movement', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/odds',
      payload: { match_id: '200', market: 'ou2.5', price_1: 1.9, price_2: 1.95 },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().id).toBe(50);
  });

  test('rejects without match_id', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/odds',
      payload: { market: 'ou2.5' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toContain('match_id');
  });

  test('rejects without market', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/odds',
      payload: { match_id: '200' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toContain('market');
  });
});

describe('POST /api/odds/bulk', () => {
  test('records multiple odds movements', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/odds/bulk',
      payload: [
        { match_id: '200', market: 'ou2.5', price_1: 1.9 },
        { match_id: '200', market: '1x2', price_1: 2.1 },
      ],
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().recorded).toBe(2);
  });

  test('skips entries without match_id or market', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/odds/bulk',
      payload: [
        { match_id: '200', market: 'ou2.5' },
        { market: '1x2' }, // missing match_id
        { match_id: '200' }, // missing market
      ],
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().recorded).toBe(1);
  });

  test('rejects non-array body', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/odds/bulk',
      payload: { match_id: '200', market: 'ou2.5' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toContain('array');
  });
});
