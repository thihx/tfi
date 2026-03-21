import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from './helpers.js';

const mockSnapshot = {
  generatedAt: '2026-03-21T10:00:00.000Z',
  checklist: [
    { id: 'pipeline-activity', label: 'Pipeline activity is present', status: 'pass', detail: 'ok' },
  ],
  cards: [
    { label: 'Push Rate 24h', value: '40%', tone: 'neutral' },
  ],
  pipeline: {
    activityLast2h: 10,
    analyzed24h: 20,
    shouldPush24h: 8,
    saved24h: 10,
    notified24h: 6,
    skipped24h: 5,
    errors24h: 1,
    pushRate24h: 40,
    saveRate24h: 50,
    notifyRate24h: 75,
    topSkipReasons: [],
    jobFailures24h: 0,
    jobFailuresByAction: [],
  },
  providers: {
    statsWindowHours: 6,
    oddsWindowHours: 6,
    statsSamples: 10,
    statsSuccessRate: 80,
    oddsSamples: 12,
    oddsUsableRate: 75,
    statsByProvider: [],
    oddsByProvider: [],
  },
  settlement: {
    recommendationPending: 5,
    recommendationUnresolved: 1,
    recommendationCorrected7d: 2,
    betPending: 4,
    betUnresolved: 0,
    methodMix30d: [],
    unresolvedByMarket: [],
  },
  notifications: {
    attempts24h: 10,
    failures24h: 1,
    failureRate24h: 10,
    deliveredRecommendations24h: 6,
  },
};

vi.mock('../repos/ops-monitoring.repo.js', () => ({
  getOpsMonitoringSnapshot: vi.fn().mockResolvedValue(mockSnapshot),
}));

let app: FastifyInstance;

beforeAll(async () => {
  const { opsRoutes } = await import('../routes/ops.routes.js');
  app = await buildApp(opsRoutes);
});

afterAll(async () => {
  await app.close();
});

describe('GET /api/ops/overview', () => {
  test('returns monitoring snapshot', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/ops/overview' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.generatedAt).toBe(mockSnapshot.generatedAt);
    expect(body.pipeline.pushRate24h).toBe(40);
    expect(body.providers.statsSuccessRate).toBe(80);
    expect(body.settlement.recommendationPending).toBe(5);
    expect(body.notifications.deliveredRecommendations24h).toBe(6);
  });
});
