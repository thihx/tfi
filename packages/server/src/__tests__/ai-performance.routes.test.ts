// ============================================================
// Integration tests — AI Performance routes
// ============================================================

import { describe, test, expect, vi, beforeAll, afterAll } from 'vitest';
import { buildApp } from './helpers.js';
import type { FastifyInstance } from 'fastify';

vi.mock('../repos/ai-performance.repo.js', () => ({
  getAccuracyStats: vi.fn().mockResolvedValue({
    total: 50,
    correct: 30,
    incorrect: 15,
    push: 2,
    void: 1,
    neutral: 3,
    pending: 5,
    pendingResult: 2,
    reviewRequired: 3,
    accuracy: 0.667,
  }),
  getAccuracyByModel: vi.fn().mockResolvedValue([
    { model: 'gemini-3-pro-preview', total: 50, correct: 30, accuracy: 0.667 },
  ]),
  createAiPerformanceRecord: vi.fn().mockImplementation((body: Record<string, unknown>) =>
    Promise.resolve({ id: 1, ...body }),
  ),
  settleAiPerformance: vi.fn().mockResolvedValue(null),
  getHistoricalPerformanceContext: vi.fn().mockResolvedValue({
    overall: { settled: 50, correct: 30, accuracy: 60 },
    byMarket: [
      { market: 'over_2.5', settled: 20, correct: 14, accuracy: 70 },
      { market: '1x2_home', settled: 15, correct: 6, accuracy: 40 },
    ],
    byConfidenceBand: [
      { band: '8-10 (high)', settled: 15, correct: 11, accuracy: 73.33 },
    ],
    byMinuteBand: [
      { band: '0-29 (early)', settled: 10, correct: 7, accuracy: 70 },
    ],
    byLeague: [
      { league: 'Premier League', settled: 15, correct: 10, accuracy: 66.67 },
    ],
    generatedAt: '2026-03-17T10:00:00.000Z',
  }),
}));

let app: FastifyInstance;

beforeAll(async () => {
  const { aiPerformanceRoutes } = await import('../routes/ai-performance.routes.js');
  app = await buildApp(aiPerformanceRoutes);
});

afterAll(async () => {
  await app.close();
});

describe('GET /api/ai-performance/stats', () => {
  test('returns accuracy stats', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/ai-performance/stats' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.total).toBe(50);
    expect(body.correct).toBe(30);
    expect(body.accuracy).toBeCloseTo(0.667);
  });
});

describe('GET /api/ai-performance/stats/by-model', () => {
  test('returns per-model breakdown', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/ai-performance/stats/by-model' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toHaveLength(1);
    expect(body[0].model).toBe('gemini-3-pro-preview');
  });
});

describe('POST /api/ai-performance', () => {
  test('creates a record', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/ai-performance',
      payload: {
        recommendation_id: 1,
        match_id: '100',
        ai_model: 'gemini-3-pro-preview',
        ai_confidence: 8,
        ai_should_push: true,
      },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().id).toBe(1);
  });

  test('rejects without recommendation_id', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/ai-performance',
      payload: { match_id: '100' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toContain('recommendation_id');
  });

  test('rejects without match_id', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/ai-performance',
      payload: { recommendation_id: 1 },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toContain('match_id');
  });
});

describe('GET /api/ai-performance/prompt-context', () => {
  test('returns historical performance context', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/ai-performance/prompt-context' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.overall.settled).toBe(50);
    expect(body.overall.correct).toBe(30);
    expect(body.overall.accuracy).toBe(60);
    expect(body.byMarket).toHaveLength(2);
    expect(body.byMarket[0].market).toBe('over_2.5');
    expect(body.byConfidenceBand).toHaveLength(1);
    expect(body.byMinuteBand).toHaveLength(1);
    expect(body.byLeague).toHaveLength(1);
    expect(body.generatedAt).toBeDefined();
  });

  test('returns cached data on second call (no extra DB query)', async () => {
    const repo = await import('../repos/ai-performance.repo.js');
    const spy = vi.mocked(repo.getHistoricalPerformanceContext);
    const callCountBefore = spy.mock.calls.length;

    // First call seeds the cache
    await app.inject({ method: 'GET', url: '/api/ai-performance/prompt-context' });
    // Second call should use cache
    const res = await app.inject({ method: 'GET', url: '/api/ai-performance/prompt-context' });

    expect(res.statusCode).toBe(200);
    // The mock may be called at most once more (for the first call if cache was empty)
    // But not called again for the second call
    const callCountAfter = spy.mock.calls.length;
    // At most 1 new call (for cache population), not 2
    expect(callCountAfter - callCountBefore).toBeLessThanOrEqual(1);
  });
});
