import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from './helpers.js';

const mockGetJobsStatus = vi.fn();
const mockTriggerJob = vi.fn();
const mockRunManualAnalysisForMatch = vi.fn();

vi.mock('../jobs/scheduler.js', () => ({
  getJobsStatus: mockGetJobsStatus,
  triggerJob: mockTriggerJob,
}));

vi.mock('../lib/server-pipeline.js', () => ({
  runManualAnalysisForMatch: mockRunManualAnalysisForMatch,
}));

let app: FastifyInstance;

beforeAll(async () => {
  const { liveMonitorRoutes } = await import('../routes/live-monitor.routes.js');
  app = await buildApp(liveMonitorRoutes);
});

afterAll(async () => {
  await app.close();
});

describe('GET /api/live-monitor/status', () => {
  test('returns parsed job state, summary, and flattened results', async () => {
    mockGetJobsStatus.mockResolvedValueOnce([
      {
        name: 'check-live-trigger',
        intervalMs: 60_000,
        lastRun: '2026-03-24T10:00:00.000Z',
        lastError: null,
        running: false,
        enabled: true,
        runCount: 5,
        progress: {
          step: 'done',
          message: 'Completed',
          percent: 100,
          startedAt: '2026-03-24T09:59:50.000Z',
          completedAt: '2026-03-24T10:00:00.000Z',
          error: null,
          result: JSON.stringify({
            liveCount: 4,
            candidateCount: 2,
            pipelineResults: [
              {
                totalMatches: 2,
                processed: 2,
                errors: 0,
                results: [
                  {
                    matchId: '100',
                    matchDisplay: 'Arsenal vs Chelsea',
                    homeName: 'Arsenal',
                    awayName: 'Chelsea',
                    league: 'Premier League',
                    minute: 67,
                    score: '2-1',
                    status: '2H',
                    success: true,
                    decisionKind: 'ai_push',
                    shouldPush: true,
                    selection: 'Over 2.5',
                    confidence: 7,
                    saved: true,
                    notified: true,
                  },
                  {
                    matchId: '101',
                    matchDisplay: 'Liverpool vs Everton',
                    homeName: 'Liverpool',
                    awayName: 'Everton',
                    league: 'Premier League',
                    minute: 55,
                    score: '0-0',
                    status: '2H',
                    success: true,
                    decisionKind: 'no_bet',
                    shouldPush: false,
                    selection: '',
                    confidence: 0,
                    saved: false,
                    notified: false,
                  },
                ],
              },
            ],
          }),
        },
        concurrency: 1,
        activeRuns: 0,
        pendingRuns: 0,
      },
    ]);

    const res = await app.inject({ method: 'GET', url: '/api/live-monitor/status' });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      job: {
        name: 'check-live-trigger',
        intervalMs: 60_000,
        enabled: true,
        running: false,
        lastRun: '2026-03-24T10:00:00.000Z',
        lastError: null,
        runCount: 5,
      },
      progress: {
        step: 'done',
        message: 'Completed',
        percent: 100,
        startedAt: '2026-03-24T09:59:50.000Z',
        completedAt: '2026-03-24T10:00:00.000Z',
        error: null,
      },
      summary: {
        liveCount: 4,
        candidateCount: 2,
        processed: 2,
        savedRecommendations: 1,
        pushedNotifications: 1,
        errors: 0,
      },
      results: [
        {
          matchId: '100',
          matchDisplay: 'Arsenal vs Chelsea',
          homeName: 'Arsenal',
          awayName: 'Chelsea',
          league: 'Premier League',
          minute: 67,
          score: '2-1',
          status: '2H',
          success: true,
          decisionKind: 'ai_push',
          shouldPush: true,
          selection: 'Over 2.5',
          confidence: 7,
          saved: true,
          notified: true,
        },
        {
          matchId: '101',
          matchDisplay: 'Liverpool vs Everton',
          homeName: 'Liverpool',
          awayName: 'Everton',
          league: 'Premier League',
          minute: 55,
          score: '0-0',
          status: '2H',
          success: true,
          decisionKind: 'no_bet',
          shouldPush: false,
          selection: '',
          confidence: 0,
          saved: false,
          notified: false,
        },
      ],
    });
  });

  test('uses batch-level processed and error totals instead of flattened row counts', async () => {
    mockGetJobsStatus.mockResolvedValueOnce([
      {
        name: 'check-live-trigger',
        intervalMs: 60_000,
        lastRun: '2026-03-24T10:00:00.000Z',
        lastError: null,
        running: false,
        enabled: true,
        runCount: 6,
        progress: {
          step: 'done',
          message: 'Completed with partial failures',
          percent: 100,
          startedAt: '2026-03-24T09:59:50.000Z',
          completedAt: '2026-03-24T10:00:00.000Z',
          error: null,
          result: JSON.stringify({
            liveCount: 5,
            candidateCount: 3,
            pipelineResults: [
              {
                totalMatches: 3,
                processed: 3,
                errors: 1,
                results: [
                  {
                    matchId: '100',
                    matchDisplay: 'Arsenal vs Chelsea',
                    success: true,
                    decisionKind: 'ai_push',
                    shouldPush: true,
                    selection: 'Over 2.5',
                    confidence: 7,
                    saved: true,
                    notified: true,
                  },
                  {
                    matchId: '101',
                    matchDisplay: 'Liverpool vs Everton',
                    success: true,
                    decisionKind: 'no_bet',
                    shouldPush: false,
                    selection: '',
                    confidence: 0,
                    saved: false,
                    notified: false,
                  },
                ],
              },
            ],
          }),
        },
        concurrency: 1,
        activeRuns: 0,
        pendingRuns: 0,
      },
    ]);

    const res = await app.inject({ method: 'GET', url: '/api/live-monitor/status' });

    expect(res.statusCode).toBe(200);
    expect(res.json().summary).toEqual({
      liveCount: 5,
      candidateCount: 3,
      processed: 3,
      savedRecommendations: 1,
      pushedNotifications: 1,
      errors: 1,
    });
    expect(res.json().results).toHaveLength(2);
  });

  test('returns 404 when check-live-trigger is not registered', async () => {
    mockGetJobsStatus.mockResolvedValueOnce([]);

    const res = await app.inject({ method: 'GET', url: '/api/live-monitor/status' });

    expect(res.statusCode).toBe(404);
    expect(res.json().error).toContain('not registered');
  });
});

describe('POST /api/live-monitor/check-live/trigger', () => {
  test('triggers the canonical live-monitor job', async () => {
    mockTriggerJob.mockReturnValueOnce({ triggered: true });

    const res = await app.inject({ method: 'POST', url: '/api/live-monitor/check-live/trigger' });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ triggered: true });
    expect(mockTriggerJob).toHaveBeenCalledWith('check-live-trigger');
  });

  test('returns 409 when the job is already running', async () => {
    mockTriggerJob.mockReturnValueOnce({ triggered: false });

    const res = await app.inject({ method: 'POST', url: '/api/live-monitor/check-live/trigger' });

    expect(res.statusCode).toBe(409);
  });
});

describe('POST /api/live-monitor/matches/:matchId/analyze', () => {
  test('returns manual analysis result from the server pipeline', async () => {
    mockRunManualAnalysisForMatch.mockResolvedValueOnce({
      matchId: '123',
      success: true,
      decisionKind: 'ai_push',
      shouldPush: true,
      selection: 'BTTS Yes',
      confidence: 8,
      saved: true,
      notified: true,
    });

    const res = await app.inject({ method: 'POST', url: '/api/live-monitor/matches/123/analyze' });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      result: {
        matchId: '123',
        success: true,
        decisionKind: 'ai_push',
        shouldPush: true,
        selection: 'BTTS Yes',
        confidence: 8,
        saved: true,
        notified: true,
      },
    });
    expect(mockRunManualAnalysisForMatch).toHaveBeenCalledWith('123');
  });

  test('returns 404 when the match is missing', async () => {
    mockRunManualAnalysisForMatch.mockRejectedValueOnce(new Error('Fixture not found for match 404'));

    const res = await app.inject({ method: 'POST', url: '/api/live-monitor/matches/404/analyze' });

    expect(res.statusCode).toBe(404);
    expect(res.json().error).toContain('Fixture not found');
  });
});