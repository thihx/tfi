// ============================================================
// Integration tests — Matches routes
// ============================================================

import { describe, test, expect, vi, beforeAll, afterAll } from 'vitest';
import { buildApp } from './helpers.js';
import type { FastifyInstance } from 'fastify';

vi.mock('../repos/matches.repo.js', () => ({
  getAllMatches: vi.fn().mockResolvedValue([
    { match_id: '1', home_team: 'Arsenal', away_team: 'Chelsea', status: 'NS', league_id: 39 },
    { match_id: '2', home_team: 'Liverpool', away_team: 'Man City', status: '1H', league_id: 39 },
  ]),
  getMatchesByStatus: vi.fn().mockImplementation((statuses: string[]) => {
    const all = [
      { match_id: '1', home_team: 'Arsenal', away_team: 'Chelsea', status: 'NS' },
      { match_id: '2', home_team: 'Liverpool', away_team: 'Man City', status: '1H' },
      { match_id: '3', home_team: 'Barca', away_team: 'Real', status: 'FT' },
    ];
    return Promise.resolve(all.filter((m) => statuses.includes(m.status)));
  }),
  getMatchesByIds: vi.fn().mockImplementation((ids: string[]) =>
    Promise.resolve(ids.map((id) => ({ match_id: id, home_team: 'Team A', away_team: 'Team B' }))),
  ),
  replaceAllMatches: vi.fn().mockImplementation((rows: unknown[]) => Promise.resolve(rows.length)),
  updateMatches: vi.fn().mockImplementation((rows: unknown[]) => Promise.resolve(rows.length)),
  deleteMatchesByIds: vi.fn().mockImplementation((ids: string[]) => Promise.resolve(ids.length)),
}));

let app: FastifyInstance;

beforeAll(async () => {
  const { matchRoutes } = await import('../routes/matches.routes.js');
  app = await buildApp(matchRoutes);
});

afterAll(async () => {
  await app.close();
});

describe('GET /api/matches', () => {
  test('returns all matches', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/matches' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toHaveLength(2);
    expect(body[0].match_id).toBe('1');
  });
});

describe('GET /api/matches/by-status', () => {
  test('filters by single status', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/matches/by-status?statuses=NS' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toHaveLength(1);
    expect(body[0].status).toBe('NS');
  });

  test('filters by multiple statuses', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/matches/by-status?statuses=NS,1H' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toHaveLength(2);
  });

  test('returns empty array when no statuses match', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/matches/by-status?statuses=ET' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toHaveLength(0);
  });

  test('returns empty when statuses param is missing', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/matches/by-status' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toHaveLength(0);
  });
});

describe('POST /api/matches/by-ids', () => {
  test('returns matches for given IDs', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/matches/by-ids',
      payload: { ids: ['1', '2', '3'] },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toHaveLength(3);
  });
});

describe('POST /api/matches/refresh', () => {
  test('replaces all matches and returns count', async () => {
    const rows = [
      { match_id: '10', home_team: 'A', away_team: 'B', status: 'NS' },
      { match_id: '11', home_team: 'C', away_team: 'D', status: 'NS' },
    ];
    const res = await app.inject({
      method: 'POST',
      url: '/api/matches/refresh',
      payload: rows,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ replaced: 2 });
  });
});

describe('PATCH /api/matches', () => {
  test('updates matches and returns count', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/matches',
      payload: [{ match_id: '1', home_score: 1, away_score: 0 }],
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ updated: 1 });
  });
});

describe('DELETE /api/matches', () => {
  test('deletes matches and returns count', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: '/api/matches',
      payload: { ids: ['1', '2'] },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ deleted: 2 });
  });
});
