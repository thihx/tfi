// ============================================================
// Integration tests — Bets routes
// ============================================================

import { describe, test, expect, vi, beforeAll, afterAll } from 'vitest';
import { buildApp } from './helpers.js';
import type { FastifyInstance } from 'fastify';

// Mock the repo module
vi.mock('../repos/bets.repo.js', () => ({
  getAllBets: vi.fn().mockResolvedValue({
    rows: [{ id: 1, match_id: '100', bet_market: 'ou2.5', selection: 'over', odds: 1.85 }],
    total: 1,
  }),
  getBetsByMatchId: vi.fn().mockResolvedValue([
    { id: 1, match_id: '100', bet_market: 'ou2.5', selection: 'over', odds: 1.85 },
  ]),
  getBetStats: vi.fn().mockResolvedValue({ total: 10, won: 6, lost: 4, pnl: 3.25 }),
  getBetStatsByMarket: vi.fn().mockResolvedValue([
    { market: 'ou2.5', total: 5, won: 3, lost: 2, pnl: 1.5 },
  ]),
  createBet: vi.fn().mockImplementation((body: Record<string, unknown>) =>
    Promise.resolve({ id: 99, ...body }),
  ),
  settleBet: vi.fn().mockImplementation((id: number) =>
    id === 1
      ? Promise.resolve({ id: 1, result: 'win', pnl: 0.85 })
      : Promise.resolve(null),
  ),
  getUnsettledBets: vi.fn().mockResolvedValue([]),
}));

let app: FastifyInstance;

beforeAll(async () => {
  const { betRoutes } = await import('../routes/bets.routes.js');
  app = await buildApp(betRoutes);
});

afterAll(async () => {
  await app.close();
});

describe('GET /api/bets', () => {
  test('returns list', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/bets' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.rows).toHaveLength(1);
    expect(body.rows[0].match_id).toBe('100');
  });

  test('passes limit/offset to repo', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/bets?limit=10&offset=5' });
    expect(res.statusCode).toBe(200);
  });
});

describe('GET /api/bets/match/:matchId', () => {
  test('returns bets for a match', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/bets/match/100' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(Array.isArray(body)).toBe(true);
  });
});

describe('GET /api/bets/stats', () => {
  test('returns stats', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/bets/stats' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.total).toBe(10);
    expect(body.won).toBe(6);
  });
});

describe('GET /api/bets/stats/by-market', () => {
  test('returns market breakdown', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/bets/stats/by-market' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body[0].market).toBe('ou2.5');
  });
});

describe('POST /api/bets', () => {
  test('creates a bet', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/bets',
      payload: { match_id: '200', bet_market: 'btts', selection: 'yes', odds: 1.9, stake: 10 },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().id).toBe(99);
  });

  test('rejects without match_id', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/bets',
      payload: { bet_market: 'btts', selection: 'yes' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toContain('match_id');
  });

  test('rejects without bet_market', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/bets',
      payload: { match_id: '200' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toContain('bet_market');
  });
});

describe('PUT /api/bets/:id/settle', () => {
  test('settles an existing bet', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/bets/1/settle',
      payload: { result: 'win', pnl: 0.85 },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().result).toBe('win');
  });

  test('returns 404 for non-existent bet', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/bets/999/settle',
      payload: { result: 'loss', pnl: -1 },
    });
    expect(res.statusCode).toBe(404);
  });

  test('rejects invalid ID', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/bets/abc/settle',
      payload: { result: 'win', pnl: 1 },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toContain('Invalid');
  });
});
