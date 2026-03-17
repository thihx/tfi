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
    pending: 5,
    accuracy: 0.667,
  }),
  getAccuracyByModel: vi.fn().mockResolvedValue([
    { model: 'gemini-3-pro-preview', total: 50, correct: 30, accuracy: 0.667 },
  ]),
  createAiPerformanceRecord: vi.fn().mockImplementation((body: Record<string, unknown>) =>
    Promise.resolve({ id: 1, ...body }),
  ),
  settleAiPerformance: vi.fn().mockResolvedValue(null),
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
