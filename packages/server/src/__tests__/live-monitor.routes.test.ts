import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from './helpers.js';

const mockGetJobsStatus = vi.fn();
const mockTriggerJob = vi.fn();
const mockRunManualAnalysisForMatch = vi.fn();
const mockGetActiveOperationalWatchlist = vi.fn();
const mockGetMatchesByIds = vi.fn();
const mockGetLatestSnapshotsForMatches = vi.fn();
const mockGetLatestRecommendationsForMatches = vi.fn();
const mockGetSettings = vi.fn();

vi.mock('../jobs/scheduler.js', () => ({
  getJobsStatus: mockGetJobsStatus,
  triggerJob: mockTriggerJob,
}));

vi.mock('../lib/server-pipeline.js', () => ({
  runManualAnalysisForMatch: mockRunManualAnalysisForMatch,
}));

vi.mock('../repos/watchlist.repo.js', () => ({
  getActiveOperationalWatchlist: mockGetActiveOperationalWatchlist,
}));

vi.mock('../repos/matches.repo.js', () => ({
  getMatchesByIds: mockGetMatchesByIds,
}));

vi.mock('../repos/match-snapshots.repo.js', () => ({
  getLatestSnapshotsForMatches: mockGetLatestSnapshotsForMatches,
}));

vi.mock('../repos/recommendations.repo.js', () => ({
  getLatestRecommendationsForMatches: mockGetLatestRecommendationsForMatches,
}));

vi.mock('../repos/settings.repo.js', () => ({
  getSettings: mockGetSettings,
}));

let app: FastifyInstance;

beforeAll(async () => {
  const { liveMonitorRoutes } = await import('../routes/live-monitor.routes.js');
  app = await buildApp(liveMonitorRoutes);
});

beforeEach(() => {
  vi.clearAllMocks();
  mockGetActiveOperationalWatchlist.mockResolvedValue([]);
  mockGetMatchesByIds.mockResolvedValue([]);
  mockGetLatestSnapshotsForMatches.mockResolvedValue(new Map());
  mockGetLatestRecommendationsForMatches.mockResolvedValue(new Map());
  mockGetSettings.mockResolvedValue({});
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
      monitoring: {
        activeWatchCount: 0,
        liveWatchCount: 0,
        candidateCount: 0,
        targets: [],
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

  test('returns monitoring scope for watched live matches and exposes candidate reasons', async () => {
    mockGetJobsStatus.mockResolvedValueOnce([
      {
        name: 'check-live-trigger',
        intervalMs: 60_000,
        lastRun: '2026-03-24T10:00:00.000Z',
        lastError: null,
        running: false,
        enabled: true,
        runCount: 7,
        progress: null,
        concurrency: 1,
        activeRuns: 0,
        pendingRuns: 0,
      },
    ]);
    mockGetActiveOperationalWatchlist.mockResolvedValueOnce([
      {
        match_id: '100',
        league: 'Premier League',
        mode: 'B',
        priority: 90,
        custom_conditions: '(Minute >= 70)',
        recommended_custom_condition: '',
        last_checked: '2026-03-24T09:58:00.000Z',
        total_checks: 4,
        status: 'active',
      },
      {
        match_id: '101',
        league: 'Premier League',
        mode: 'F',
        priority: 70,
        custom_conditions: '',
        recommended_custom_condition: '(Home scores first)',
        last_checked: null,
        total_checks: 1,
        status: 'active',
      },
    ]);
    mockGetMatchesByIds.mockResolvedValueOnce([
      {
        match_id: '100',
        league_name: 'Premier League',
        home_team: 'Arsenal',
        away_team: 'Chelsea',
        status: '2H',
        current_minute: 72,
        home_score: 2,
        away_score: 1,
      },
      {
        match_id: '101',
        league_name: 'Premier League',
        home_team: 'Liverpool',
        away_team: 'Everton',
        status: '2H',
        current_minute: 66,
        home_score: 1,
        away_score: 1,
      },
    ]);
    mockGetLatestRecommendationsForMatches.mockResolvedValueOnce(new Map([
      ['100', {
        match_id: '100',
        minute: 70,
        odds: 1.9,
        bet_market: 'over_2.5',
        selection: 'Over 2.5',
        score: '2-1',
        status: '2H',
      }],
    ]));
    mockGetLatestSnapshotsForMatches.mockResolvedValueOnce(new Map([
      ['101', {
        match_id: '101',
        minute: 60,
        home_score: 1,
        away_score: 1,
        status: '2H',
        odds: {},
      }],
    ]));
    mockGetSettings.mockResolvedValueOnce({ REANALYZE_MIN_MINUTES: 10 });

    const res = await app.inject({ method: 'GET', url: '/api/live-monitor/status' });

    expect(res.statusCode).toBe(200);
    expect(res.json().monitoring).toEqual({
      activeWatchCount: 2,
      liveWatchCount: 2,
      candidateCount: 2,
      targets: [
        {
          matchId: '100',
          matchDisplay: 'Arsenal vs Chelsea',
          league: 'Premier League',
          status: '2H',
          minute: 72,
          score: '2-1',
          live: true,
          mode: 'B',
          priority: 90,
          customConditions: '(Minute >= 70)',
          recommendedCondition: '',
          lastChecked: '2026-03-24T09:58:00.000Z',
          totalChecks: 4,
          candidate: true,
          candidateReason: 'time_elapsed',
          baseline: 'recommendation',
        },
        {
          matchId: '101',
          matchDisplay: 'Liverpool vs Everton',
          league: 'Premier League',
          status: '2H',
          minute: 66,
          score: '1-1',
          live: true,
          mode: 'F',
          priority: 70,
          customConditions: '',
          recommendedCondition: '(Home scores first)',
          lastChecked: null,
          totalChecks: 1,
          candidate: true,
          candidateReason: 'force_analyze',
          baseline: 'none',
        },
      ],
    });
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
    expect(mockRunManualAnalysisForMatch).toHaveBeenCalledWith('123', {
      advisoryOnly: false,
      followUpHistory: undefined,
      userQuestion: undefined,
    });
  });

  test('passes follow-up advisory question and history to manual analysis', async () => {
    mockRunManualAnalysisForMatch.mockResolvedValueOnce({
      matchId: '123',
      success: true,
      decisionKind: 'no_bet',
      shouldPush: false,
      selection: '',
      confidence: 0,
      saved: false,
      notified: false,
    });

    const res = await app.inject({
      method: 'POST',
      url: '/api/live-monitor/matches/123/analyze',
      payload: {
        question: 'Would Home -0.25 be better here?',
        history: [
          { role: 'user', text: 'Why not under?' },
          { role: 'assistant', text: 'The home side still controls the match.' },
        ],
      },
    });

    expect(res.statusCode).toBe(200);
    expect(mockRunManualAnalysisForMatch).toHaveBeenCalledWith('123', {
      advisoryOnly: true,
      followUpHistory: [
        { role: 'user', text: 'Why not under?' },
        { role: 'assistant', text: 'The home side still controls the match.' },
      ],
      userQuestion: 'Would Home -0.25 be better here?',
    });
  });

  test('returns 404 when the match is missing', async () => {
    mockRunManualAnalysisForMatch.mockRejectedValueOnce(new Error('Fixture not found for match 404'));

    const res = await app.inject({ method: 'POST', url: '/api/live-monitor/matches/404/analyze' });

    expect(res.statusCode).toBe(404);
    expect(res.json().error).toContain('Fixture not found');
  });
});
