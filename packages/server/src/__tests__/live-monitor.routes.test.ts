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
const mockResolveSubscriptionAccess = vi.fn();
const mockConsumeManualAiQuota = vi.fn();
const mockBuildLiveOutputOperatorReport = vi.fn();

const CURRENT_USER = {
  userId: 'user-1',
  email: 'user@example.com',
  role: 'member' as const,
  status: 'active' as const,
  displayName: 'User',
  avatarUrl: '',
};

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

vi.mock('../lib/subscription-access.js', () => ({
  resolveSubscriptionAccess: mockResolveSubscriptionAccess,
  consumeManualAiQuota: mockConsumeManualAiQuota,
  sendEntitlementError: vi.fn((error: unknown) => {
    if (error && typeof error === 'object' && 'statusCode' in error) {
      const typed = error as { statusCode: number; payload?: unknown; message?: string; code?: string };
      return {
        statusCode: typed.statusCode,
        payload: typed.payload ?? { error: typed.message ?? 'Entitlement blocked', code: typed.code ?? 'ENTITLEMENT_BLOCKED' },
      };
    }
    return null;
  }),
}));

vi.mock('../lib/live-output-operator-report.js', () => ({
  buildLiveOutputOperatorReport: mockBuildLiveOutputOperatorReport,
}));

let app: FastifyInstance;

beforeAll(async () => {
  const { liveMonitorRoutes } = await import('../routes/live-monitor.routes.js');
  app = await buildApp([liveMonitorRoutes], { currentUser: CURRENT_USER });
});

beforeEach(() => {
  vi.clearAllMocks();
  mockGetActiveOperationalWatchlist.mockResolvedValue([]);
  mockGetMatchesByIds.mockResolvedValue([]);
  mockGetLatestSnapshotsForMatches.mockResolvedValue(new Map());
  mockGetLatestRecommendationsForMatches.mockResolvedValue(new Map());
  mockGetSettings.mockResolvedValue({});
  mockResolveSubscriptionAccess.mockResolvedValue({ plan: { plan_code: 'free' }, entitlements: {} });
  mockConsumeManualAiQuota.mockResolvedValue({ periodKey: '2026-06-09', limit: 3, used: 1 });
  mockBuildLiveOutputOperatorReport.mockResolvedValue({
    generatedAt: '2026-06-09T00:00:00.000Z',
    lookbackHours: 24,
    officialPromptVersion: 'v10-hybrid-legacy-g',
    totals: {
      matchAnalyzed: 0,
      moneyRecommendations: 0,
      statsOnlySignals: 0,
      watchInsights: 0,
      shadowCandidates: 0,
      noActions: 0,
      llmCalled: 0,
      llmSkipped: 0,
    },
    outputKindBreakdown: [],
    reasonGroupBreakdown: [],
    reasonBuckets: [],
    recentDrilldown: [],
  });
});

afterAll(async () => {
  await app.close();
});

describe('GET /api/live-monitor/why-no-recommendation', () => {
  test('returns operator reason grouping and drilldown from the report builder', async () => {
    mockBuildLiveOutputOperatorReport.mockResolvedValueOnce({
      generatedAt: '2026-06-09T00:00:00.000Z',
      lookbackHours: 48,
      officialPromptVersion: 'v10-hybrid-legacy-g',
      totals: {
        matchAnalyzed: 3,
        moneyRecommendations: 1,
        statsOnlySignals: 1,
        watchInsights: 0,
        shadowCandidates: 1,
        noActions: 1,
        llmCalled: 2,
        llmSkipped: 1,
      },
      outputKindBreakdown: [{ outputKind: 'no_action', count: 1, latestAt: '2026-06-09T00:00:00.000Z' }],
      reasonGroupBreakdown: [{ group: 'policy', count: 1, latestAt: '2026-06-09T00:00:00.000Z' }],
      reasonBuckets: [{
        key: 'policy_blocked',
        group: 'policy',
        outputKind: 'shadow_candidate',
        evidenceMode: 'full_live_data',
        count: 1,
        latestAt: '2026-06-09T00:00:00.000Z',
      }],
      recentDrilldown: [{
        id: 10,
        timestamp: '2026-06-09T00:00:00.000Z',
        matchId: '100',
        matchDisplay: 'Arsenal vs Chelsea',
        minute: '64',
        status: '2H',
        score: '1-1',
        outputKind: 'shadow_candidate',
        auditBucket: 'policy_blocked',
        reasonGroup: 'policy',
        evidenceMode: 'full_live_data',
        route: 'shadow_path',
        llmCalled: true,
        savedRecommendation: false,
        settlementEligible: false,
        roiEligible: false,
        candidatePresent: true,
        noActionReason: 'policy_blocked',
      }],
    });

    const res = await app.inject({
      method: 'GET',
      url: '/api/live-monitor/why-no-recommendation?lookbackHours=48&maxSamples=7',
    });

    expect(res.statusCode).toBe(200);
    expect(mockBuildLiveOutputOperatorReport).toHaveBeenCalledWith({ lookbackHours: 48, maxSamples: 7 });
    expect(res.json()).toMatchObject({
      lookbackHours: 48,
      reasonBuckets: [{ key: 'policy_blocked', group: 'policy' }],
      recentDrilldown: [{ matchId: '100', auditBucket: 'policy_blocked' }],
    });
  });
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
        officialBetNotifications: 1,
        signalNotifications: 0,
        noActionAudits: 1,
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
      officialBetNotifications: 1,
      signalNotifications: 0,
      noActionAudits: 1,
      errors: 1,
    });
    expect(res.json().results).toHaveLength(2);
  });

  test('separates official bet notifications from signal notifications', async () => {
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
          message: 'Completed',
          percent: 100,
          startedAt: '2026-03-24T09:59:50.000Z',
          completedAt: '2026-03-24T10:00:00.000Z',
          error: null,
          result: JSON.stringify({
            liveCount: 3,
            candidateCount: 3,
            pipelineResults: [
              {
                processed: 3,
                errors: 0,
                results: [
                  { matchId: '100', success: true, decisionKind: 'ai_push', shouldPush: true, selection: 'Over 2.5', confidence: 7, saved: true, notified: true },
                  { matchId: '101', success: true, decisionKind: 'condition_only', shouldPush: true, selection: 'Pressure watch', confidence: 6, saved: false, notified: true },
                  { matchId: '102', success: true, decisionKind: 'no_bet', shouldPush: false, selection: '', confidence: 0, saved: false, notified: false },
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
    expect(res.json().summary).toMatchObject({
      savedRecommendations: 1,
      pushedNotifications: 2,
      officialBetNotifications: 1,
      signalNotifications: 1,
      noActionAudits: 1,
    });
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
          customConditions: '',
          recommendedCondition: '(Home scores first)',
          lastChecked: null,
          totalChecks: 1,
          candidate: true,
          candidateReason: 'time_elapsed',
          baseline: 'snapshot',
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
    const context = await import('../lib/football-api-request-context.js');
    let seenContext: unknown = null;
    mockRunManualAnalysisForMatch.mockImplementationOnce(() => {
      seenContext = context.getFootballApiRequestContext();
      return Promise.resolve({
        matchId: '123',
        success: true,
        decisionKind: 'ai_push',
        shouldPush: true,
        selection: 'BTTS Yes',
        confidence: 8,
        saved: true,
        notified: true,
      });
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
    expect(seenContext).toMatchObject({ consumer: 'live-monitor-manual-analyze' });
    expect(mockResolveSubscriptionAccess).toHaveBeenCalledWith('user-1');
    expect(mockConsumeManualAiQuota).toHaveBeenCalledWith(expect.anything(), 'user-1', expect.objectContaining({
      route: 'live-monitor-match-analyze',
      matchId: '123',
      advisoryOnly: false,
    }));
  });

  test('blocks manual match analysis when the subscription quota is exhausted', async () => {
    mockConsumeManualAiQuota.mockRejectedValueOnce({
      statusCode: 429,
      code: 'MANUAL_AI_DAILY_LIMIT_REACHED',
      message: 'Daily Manual Ask AI limit reached',
    });

    const res = await app.inject({ method: 'POST', url: '/api/live-monitor/matches/123/analyze' });

    expect(res.statusCode).toBe(429);
    expect(res.json()).toEqual({
      error: 'Daily Manual Ask AI limit reached',
      code: 'MANUAL_AI_DAILY_LIMIT_REACHED',
    });
    expect(mockRunManualAnalysisForMatch).not.toHaveBeenCalled();
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

  test('treats a first-run guided question as official manual analysis', async () => {
    mockRunManualAnalysisForMatch.mockResolvedValueOnce({
      matchId: '123',
      success: true,
      decisionKind: 'ai_push',
      shouldPush: true,
      selection: 'Over 2.5',
      confidence: 8,
      saved: true,
      notified: true,
    });

    const res = await app.inject({
      method: 'POST',
      url: '/api/live-monitor/matches/123/analyze',
      payload: {
        question: 'Focus on second-half goals.',
        history: [],
        advisoryOnly: false,
      },
    });

    expect(res.statusCode).toBe(200);
    expect(mockRunManualAnalysisForMatch).toHaveBeenCalledWith('123', {
      advisoryOnly: false,
      followUpHistory: [],
      userQuestion: 'Focus on second-half goals.',
    });
  });

  test('honors explicit advisoryOnly for first follow-up even when history is empty', async () => {
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
        question: 'What if the home side gets another corner?',
        history: [],
        advisoryOnly: true,
      },
    });

    expect(res.statusCode).toBe(200);
    expect(mockRunManualAnalysisForMatch).toHaveBeenCalledWith('123', {
      advisoryOnly: true,
      followUpHistory: [],
      userQuestion: 'What if the home side gets another corner?',
    });
  });

  test('returns 404 when the match is missing', async () => {
    mockRunManualAnalysisForMatch.mockRejectedValueOnce(new Error('Fixture not found for match 404'));

    const res = await app.inject({ method: 'POST', url: '/api/live-monitor/matches/404/analyze' });

    expect(res.statusCode).toBe(404);
    expect(res.json().error).toContain('Fixture not found');
  });
});
