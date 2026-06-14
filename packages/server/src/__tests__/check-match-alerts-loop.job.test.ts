import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getCandidateAlertRules: vi.fn(),
  getMatchesByIds: vi.fn(),
  getLatestSnapshotsForMatches: vi.fn(),
  buildMatchAlertContext: vi.fn(),
  evaluateMatchAlertRule: vi.fn(),
  adjudicateMatchAlertWithLlm: vi.fn(),
  deliverPendingWebPushMatchAlerts: vi.fn(),
  deliverPendingNativePushMatchAlerts: vi.fn(),
  deliverPendingFallbackMatchAlerts: vi.fn(),
  enqueueMatchAlertDelivery: vi.fn(),
  hasRecentMatchAlertDelivery: vi.fn(),
  recordSuppressedMatchAlertDelivery: vi.fn(),
  reportJobProgress: vi.fn(),
}));

vi.mock('../config.js', () => ({
  config: {
    matchAlertLlmEnabled: true,
    geminiApiKey: 'test-key',
    geminiMatchAlertModel: 'gemini-2.5-flash-lite',
  },
}));

vi.mock('../repos/match-alert-rules.repo.js', () => ({
  getCandidateAlertRules: mocks.getCandidateAlertRules,
}));

vi.mock('../repos/matches.repo.js', () => ({
  getMatchesByIds: mocks.getMatchesByIds,
}));

vi.mock('../repos/match-snapshots.repo.js', () => ({
  getLatestSnapshotsForMatches: mocks.getLatestSnapshotsForMatches,
}));

vi.mock('../lib/match-alert-context.js', () => ({
  buildMatchAlertContext: mocks.buildMatchAlertContext,
}));

vi.mock('../lib/match-alert-rule-engine.js', async () => {
  const actual = await vi.importActual<typeof import('../lib/match-alert-rule-engine.js')>('../lib/match-alert-rule-engine.js');
  return {
    ...actual,
    evaluateMatchAlertRule: mocks.evaluateMatchAlertRule,
  };
});

vi.mock('../lib/match-alert-llm.js', () => ({
  adjudicateMatchAlertWithLlm: mocks.adjudicateMatchAlertWithLlm,
}));

vi.mock('../repos/match-alert-deliveries.repo.js', () => ({
  deliverPendingWebPushMatchAlerts: mocks.deliverPendingWebPushMatchAlerts,
  deliverPendingNativePushMatchAlerts: mocks.deliverPendingNativePushMatchAlerts,
  deliverPendingFallbackMatchAlerts: mocks.deliverPendingFallbackMatchAlerts,
  enqueueMatchAlertDelivery: mocks.enqueueMatchAlertDelivery,
  hasRecentMatchAlertDelivery: mocks.hasRecentMatchAlertDelivery,
  recordSuppressedMatchAlertDelivery: mocks.recordSuppressedMatchAlertDelivery,
}));

vi.mock('../jobs/job-progress.js', () => ({
  reportJobProgress: mocks.reportJobProgress,
}));

const { checkMatchAlertsJob } = await import('../jobs/check-match-alerts.job.js');

const baseRule = {
  id: 100,
  userId: 'user-1',
  matchId: '1546317',
  alertKind: 'condition_signal',
  source: 'favorite_team',
  ruleJson: { id: 'test-rule' },
  enabled: true,
  oncePerMatch: true,
  cooldownMinutes: 10,
  channelPolicy: {},
};

const baseContext = {
  matchId: '1546317',
  homeTeam: 'Kashima',
  awayTeam: 'Vissel Kobe',
  leagueName: 'J1 League',
  status: '2H',
  minute: 68,
  score: { home: 0, away: 0 },
  kickoffAtUtc: '2026-06-06T05:00:00Z',
};

const baseEvaluation = {
  supported: true,
  matched: true,
  triggerKey: 'no_goals_after_65:1546317:68:0-0',
  severity: 'medium',
  summaryEn: 'No goals after minute 65.',
  summaryVi: 'No goals after minute 65.',
  suggestedAction: 'review_live_market',
  facts: {},
};

describe('checkMatchAlertsJob loop protection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getCandidateAlertRules.mockResolvedValue([{ ...baseRule }]);
    mocks.getMatchesByIds.mockResolvedValue([{ match_id: '1546317' }]);
    mocks.getLatestSnapshotsForMatches.mockResolvedValue(new Map());
    mocks.buildMatchAlertContext.mockReturnValue(baseContext);
    mocks.evaluateMatchAlertRule.mockReturnValue(baseEvaluation);
    mocks.deliverPendingWebPushMatchAlerts.mockResolvedValue({ delivered: 0, failed: 0 });
    mocks.deliverPendingNativePushMatchAlerts.mockResolvedValue({ delivered: 0, failed: 0 });
    mocks.deliverPendingFallbackMatchAlerts.mockResolvedValue({ delivered: 0, failed: 0 });
    mocks.enqueueMatchAlertDelivery.mockResolvedValue({ id: 1 });
    mocks.hasRecentMatchAlertDelivery.mockResolvedValue(false);
    mocks.recordSuppressedMatchAlertDelivery.mockResolvedValue({ id: 2 });
    mocks.adjudicateMatchAlertWithLlm.mockResolvedValue({
      model: 'gemini-2.5-flash-lite',
      shouldPush: true,
      confidence: 80,
      reasonVi: 'ok',
      summaryVi: 'ok',
      suggestedAction: 'review_live_market',
    });
  });

  it('checks existing delivery before any LLM adjudication', async () => {
    mocks.hasRecentMatchAlertDelivery.mockResolvedValueOnce(true);

    const result = await checkMatchAlertsJob();

    expect(result.enqueued).toBe(0);
    expect(result.llmEvaluated).toBe(0);
    expect(mocks.adjudicateMatchAlertWithLlm).not.toHaveBeenCalled();
    expect(mocks.enqueueMatchAlertDelivery).not.toHaveBeenCalled();
  });

  it('records suppressed LLM decisions so later ticks are idempotent', async () => {
    mocks.adjudicateMatchAlertWithLlm.mockResolvedValueOnce({
      model: 'gemini-2.5-flash-lite',
      shouldPush: false,
      confidence: 45,
      reasonVi: 'Do not push.',
      summaryVi: '',
      suggestedAction: '',
    });

    const result = await checkMatchAlertsJob();

    expect(result.llmEvaluated).toBe(1);
    expect(result.llmSuppressed).toBe(1);
    expect(result.enqueued).toBe(0);
    expect(mocks.recordSuppressedMatchAlertDelivery).toHaveBeenCalledTimes(1);
    expect(mocks.recordSuppressedMatchAlertDelivery).toHaveBeenCalledWith(
      expect.objectContaining({ id: 100 }),
      expect.objectContaining({ triggerKey: baseEvaluation.triggerKey }),
      baseContext,
      expect.objectContaining({
        llm: expect.objectContaining({
          status: 'suppressed',
          shouldPush: false,
        }),
      }),
    );
    expect(mocks.enqueueMatchAlertDelivery).not.toHaveBeenCalled();
  });
});
