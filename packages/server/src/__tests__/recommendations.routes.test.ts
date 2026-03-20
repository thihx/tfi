// ============================================================
// Integration tests — Recommendations routes
// ============================================================

import { describe, test, expect, vi, beforeAll, afterAll } from 'vitest';
import { buildApp } from './helpers.js';
import type { FastifyInstance } from 'fastify';

const mockRecs = [
  { id: 1, match_id: '100', selection: 'Over 2.5', confidence: 75, result: 'win', ai_model: 'gemini' },
  { id: 2, match_id: '101', selection: 'BTTS Yes', confidence: 60, result: null, ai_model: 'gemini' },
];

vi.mock('../repos/recommendations.repo.js', () => ({
  getAllRecommendations: vi.fn().mockResolvedValue({ rows: mockRecs, total: 2 }),
  getDashboardSummary: vi.fn().mockResolvedValue({
    totalBets: 10, wins: 6, losses: 3, pushes: 1, pending: 0,
    winRate: 60, totalPnl: 5.5, totalStaked: 100, roi: 5.5,
  }),
  getDistinctBetTypes: vi.fn().mockResolvedValue(['ou2.5', 'btts', '1x2']),
  getDistinctLeagues: vi.fn().mockResolvedValue(['Premier League', 'La Liga']),
  getRecommendationsByMatchId: vi.fn().mockImplementation((matchId: string) =>
    Promise.resolve(mockRecs.filter((r) => r.match_id === matchId)),
  ),
  getStats: vi.fn().mockResolvedValue({ total: 50, won: 30, lost: 15, pending: 5 }),
  createRecommendation: vi.fn().mockImplementation((body: Record<string, unknown>) =>
    Promise.resolve({ id: 99, ...body }),
  ),
  bulkCreateRecommendations: vi.fn().mockImplementation((recs: unknown[]) =>
    Promise.resolve(recs.length),
  ),
  settleRecommendation: vi.fn().mockImplementation((id: number) =>
    id === 1 ? Promise.resolve({ id: 1, result: 'win', pnl: 0.85 }) : Promise.resolve(null),
  ),
  markLegacyDuplicates: vi.fn().mockResolvedValue({ marked: 3 }),
}));

vi.mock('../repos/ai-performance.repo.js', () => ({
  createAiPerformanceRecord: vi.fn().mockResolvedValue({ id: 1 }),
}));

// Mock audit — no DB in tests
vi.mock('../lib/audit.js', () => ({
  audit: vi.fn(),
  auditSuccess: vi.fn(),
  auditFailure: vi.fn(),
  auditSkipped: vi.fn(),
  auditWrap: vi.fn(),
}));

vi.mock('../jobs/re-evaluate.job.js', () => ({
  reEvaluateAllResults: vi.fn().mockResolvedValue({ corrected: 2, skipped: 8 }),
}));

let app: FastifyInstance;

beforeAll(async () => {
  const { recommendationRoutes } = await import('../routes/recommendations.routes.js');
  app = await buildApp(recommendationRoutes);
});

afterAll(async () => {
  await app.close();
});

// ── GET endpoints ──

describe('GET /api/recommendations', () => {
  test('returns paginated list', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/recommendations' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.rows).toHaveLength(2);
    expect(body.total).toBe(2);
  });

  test('passes query params to repo', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/recommendations?limit=10&offset=5&result=win&bet_type=ou2.5&league=Premier+League',
    });
    expect(res.statusCode).toBe(200);
  });
});

describe('GET /api/recommendations/dashboard', () => {
  test('returns dashboard summary', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/recommendations/dashboard' });
    expect(res.statusCode).toBe(200);
    expect(res.json().totalBets).toBe(10);
  });
});

describe('GET /api/recommendations/bet-types', () => {
  test('returns distinct bet types', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/recommendations/bet-types' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toContain('ou2.5');
  });
});

describe('GET /api/recommendations/leagues', () => {
  test('returns distinct leagues', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/recommendations/leagues' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toContain('La Liga');
  });
});

describe('GET /api/recommendations/match/:matchId', () => {
  test('returns recommendations for a match', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/recommendations/match/100' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toHaveLength(1);
    expect(res.json()[0].match_id).toBe('100');
  });

  test('returns empty array for unknown match', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/recommendations/match/999' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toHaveLength(0);
  });
});

describe('GET /api/recommendations/stats', () => {
  test('returns stats', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/recommendations/stats' });
    expect(res.statusCode).toBe(200);
    expect(res.json().total).toBe(50);
  });
});

// ── POST endpoints ──

describe('POST /api/recommendations', () => {
  test('creates a recommendation', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/recommendations',
      payload: { match_id: '200', selection: 'Over 2.5', confidence: 80, ai_model: 'gemini', bet_type: 'AI', bet_market: 'over_2.5' },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().match_id).toBe('200');
  });

  test('returns 400 when match_id is missing', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/recommendations',
      payload: { selection: 'Over 2.5' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toContain('match_id');
  });

  test('creates without ai_model (no AI perf record)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/recommendations',
      payload: { match_id: '201', selection: 'BTTS Yes' },
    });
    expect(res.statusCode).toBe(201);
  });

  test('passes real ai_should_push=true into ai_performance rows', async () => {
    await app.inject({
      method: 'POST',
      url: '/api/recommendations',
      payload: { match_id: '202', selection: 'Over 2.5', confidence: 80, ai_model: 'gemini', bet_type: 'AI', bet_market: 'over_2.5' },
    });

    const aiPerfRepo = await import('../repos/ai-performance.repo.js');
    expect(aiPerfRepo.createAiPerformanceRecord).toHaveBeenCalledWith(expect.objectContaining({
      match_id: '202',
      ai_should_push: true,
      predicted_market: 'over_2.5',
    }));
  });

  test('propagates prompt_version into ai_performance rows', async () => {
    await app.inject({
      method: 'POST',
      url: '/api/recommendations',
      payload: {
        match_id: '203',
        selection: 'Over 2.5',
        confidence: 80,
        ai_model: 'gemini',
        bet_type: 'AI',
        bet_market: 'over_2.5',
        prompt_version: 'v4-evidence-hardened',
      },
    });

    const aiPerfRepo = await import('../repos/ai-performance.repo.js');
    expect(aiPerfRepo.createAiPerformanceRecord).toHaveBeenCalledWith(expect.objectContaining({
      match_id: '203',
      prompt_version: 'v4-evidence-hardened',
    }));
  });
});

describe('POST /api/recommendations/bulk', () => {
  test('bulk creates recommendations', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/recommendations/bulk',
      payload: [
        { match_id: '300', selection: 'A' },
        { match_id: '301', selection: 'B' },
      ],
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().inserted).toBe(2);
  });
});

// ── PUT endpoints ──

describe('PUT /api/recommendations/:id/settle', () => {
  test('settles an existing recommendation', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/recommendations/1/settle',
      payload: { result: 'win', pnl: 0.85 },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().result).toBe('win');
  });

  test('returns 404 for non-existent recommendation', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/recommendations/999/settle',
      payload: { result: 'loss', pnl: -1 },
    });
    expect(res.statusCode).toBe(404);
  });

  test('returns 400 for invalid ID', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/recommendations/abc/settle',
      payload: { result: 'win', pnl: 1 },
    });
    expect(res.statusCode).toBe(400);
  });
});

// ── Special actions ──

describe('POST /api/recommendations/mark-duplicates', () => {
  test('marks legacy duplicates', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/recommendations/mark-duplicates' });
    expect(res.statusCode).toBe(200);
    expect(res.json().marked).toBe(3);
  });
});

describe('POST /api/recommendations/re-evaluate', () => {
  test('re-evaluates all results', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/recommendations/re-evaluate' });
    expect(res.statusCode).toBe(200);
    expect(res.json().corrected).toBe(2);
  });
});
