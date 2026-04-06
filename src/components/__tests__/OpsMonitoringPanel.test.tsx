import { beforeEach, describe, expect, test, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

const mockSnapshot = {
  generatedAt: '2026-03-21T10:00:00.000Z',
  checklist: [
    {
      id: 'pipeline-activity',
      label: 'Pipeline activity is present',
      status: 'pass',
      detail: '12 pipeline audit events in last 2h',
    },
  ],
  cards: [
    { label: 'Notify-Eligible Rate 24h', value: '40%', tone: 'neutral', detail: '8/20 analyzed' },
    { label: 'Prematch High Noise 24h', value: '16.7%', tone: 'warn', detail: '2/12 analyzed rows' },
  ],
  pipeline: {
    activityLast2h: 12,
    analyzed24h: 20,
    notifyEligible24h: 8,
    saved24h: 10,
    notified24h: 6,
    skipped24h: 5,
    errors24h: 1,
    notifyEligibleRate24h: 40,
    saveRate24h: 50,
    notifyRate24h: 75,
    topSkipReasons: [{ reason: 'stale_state', count: 3 }],
    jobFailures24h: 0,
    jobFailuresByAction: [{ action: 'JOB_FETCH_MATCHES', count: 1 }],
  },
  providers: {
    statsWindowHours: 6,
    oddsWindowHours: 6,
    statsSamples: 10,
    statsSuccessRate: 80,
    oddsSamples: 12,
    oddsUsableRate: 75,
    statsByProvider: [{
      provider: 'api-football',
      samples: 10,
      successRate: 80,
      avgLatencyMs: 450,
      possessionCoverageRate: 70,
      shotsOnTargetCoverageRate: 60,
    }],
    oddsByProvider: [{
      provider: 'api-football',
      source: 'live',
      samples: 12,
      usableRate: 75,
      avgLatencyMs: 500,
      oneX2Rate: 75,
      overUnderRate: 80,
      asianHandicapRate: 66.7,
    }],
  },
  settlement: {
    recommendationPending: 5,
    recommendationUnresolved: 2,
    recommendationCorrected7d: 1,
    betPending: 4,
    betUnresolved: 1,
    methodMix30d: [{ method: 'rules', count: 7 }],
    unresolvedByMarket: [{ market: 'corners_over_9.5', count: 2 }],
  },
  notifications: {
    attempts24h: 10,
    failures24h: 1,
    failureRate24h: 10,
    deliveredRecommendations24h: 6,
  },
  promptShadow: {
    windowHours: 24,
    runs24h: 4,
    shadowRows24h: 4,
    shadowSuccessRate24h: 100,
    comparedRuns24h: 4,
    shouldPushAgreementRate24h: 100,
    marketAgreementRate24h: 75,
    avgActiveLatencyMs24h: 19000,
    avgShadowLatencyMs24h: 16000,
    disagreementTypes: [{ type: 'market_mismatch', count: 1 }],
    versionBreakdown: [
      {
        executionRole: 'active',
        promptVersion: 'v4-evidence-hardened',
        samples: 4,
        successRate: 100,
        avgLatencyMs: 19000,
        avgPromptTokens: 3500,
      },
      {
        executionRole: 'shadow',
        promptVersion: 'v5-compact-a',
        samples: 4,
        successRate: 100,
        avgLatencyMs: 16000,
        avgPromptTokens: 2000,
      },
    ],
  },
  promptQuality: {
    windowHours: 24,
    notifyEligibleRate24h: 40,
    totalRecommendations: 12,
    sameThesisClusters: 2,
    sameThesisStackedRows: 5,
    sameThesisStackingRate: 41.7,
    sameThesisStackedStake: 16,
    cornersRows: 3,
    cornersUsageRate: 25,
    lateHighLineRows: 2,
    lateHighLineRate: 16.7,
    lateHighLineStake: 7,
    prematch: {
      totalAnalyzedRows: 12,
      strongRows: 4,
      moderateRows: 3,
      weakRows: 3,
      noneRows: 2,
      fullAvailabilityRows: 4,
      partialAvailabilityRows: 3,
      minimalAvailabilityRows: 3,
      noPrematchRows: 2,
      highNoiseRows: 2,
      highNoiseRate: 16.7,
      avgNoisePenalty: 34.5,
      structuredAskAiEligibleRows: 5,
      structuredAskAiEligibleRate: 62.5,
      structuredAskAiBlockedRows: 3,
      structuredAskAiReasonBreakdown: [
        { reason: 'eligible', count: 5 },
        { reason: 'prediction_or_profile_coverage_too_thin', count: 2 },
        { reason: 'prematch_features_missing', count: 1 },
      ],
      topHighNoiseMatches: [
        {
          matchId: 'm2',
          matchDisplay: 'West Ham vs Spurs',
          noisePenalty: 64,
          prematchStrength: 'weak',
          prematchAvailability: 'minimal',
          promptDataLevel: 'basic-only',
          analyzedAt: '2026-03-21T09:55:00.000Z',
        },
      ],
    },
    exposureConcentration: {
      stackedClusters: 2,
      stackedRecommendations: 5,
      stackedStake: 16,
      maxClusterStake: 9,
      topClusters: [
        {
          matchId: 'm1',
          matchDisplay: 'Atletico San Luis vs Leon',
          thesisKey: 'goals_over',
          label: 'Goals Over thesis',
          count: 2,
          settledCount: 1,
          totalStake: 9,
          totalPnl: 6.7,
          latestMinute: 82,
          canonicalMarkets: ['over_2.75', 'over_2.5'],
        },
      ],
    },
  },
  promptOnly: {
    windowHours: 24,
    totalRows: 6,
    successRows: 2,
    skippedRows: 3,
    failedRows: 1,
    structuredEligibleRows: 4,
    structuredEligibleRate: 66.7,
    reasonBreakdown: [
      { reason: 'eligible', count: 4 },
      { reason: 'low_evidence_without_watch_condition', count: 1 },
      { reason: 'prompt_only_failed', count: 1 },
    ],
  },
};

vi.mock('@/hooks/useAppState', () => ({
  useAppState: () => ({
    state: {
      config: {
        apiUrl: 'http://localhost:4000',
      },
    },
  }),
}));

vi.mock('@/lib/services/auth', () => ({
  getToken: () => 'test-token',
}));

beforeEach(() => {
  vi.restoreAllMocks();
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
    ok: true,
    json: async () => mockSnapshot,
  }));
});

const { OpsMonitoringPanel } = await import('../OpsMonitoringPanel');

describe('OpsMonitoringPanel', () => {
  test('renders checklist and cards from snapshot', async () => {
    render(<OpsMonitoringPanel />);

    await waitFor(() => {
      expect(screen.getByText('Pipeline activity is present')).toBeInTheDocument();
    });

    expect(screen.getByText('All systems operational')).toBeInTheDocument();
    expect(screen.getByText('Notify-Eligible Rate 24h')).toBeInTheDocument();
    expect(screen.getAllByText('40%').length).toBeGreaterThan(0);
    expect(screen.getByText('Stats Providers')).toBeInTheDocument();
    expect(screen.getByText('Settlement')).toBeInTheDocument();
    expect(screen.getByText('Notifications')).toBeInTheDocument();
    expect(screen.getByText('Prompt Shadow')).toBeInTheDocument();
    expect(screen.getByText('Manual analysis')).toBeInTheDocument();
    expect(screen.getByText('Manual analysis outcomes')).toBeInTheDocument();
    expect(screen.getByText('Low evidence and no custom watch condition')).toBeInTheDocument();
    expect(screen.getByText('Prompt Quality')).toBeInTheDocument();
    expect(screen.getByText('High-noise prematch')).toBeInTheDocument();
    expect(screen.getByText('Prematch Override Eligible')).toBeInTheDocument();
    expect(screen.getByText('Top High-Noise Matches')).toBeInTheDocument();
    expect(screen.getByText('West Ham vs Spurs')).toBeInTheDocument();
    expect(screen.getByText('Prematch Gate Reasons')).toBeInTheDocument();
    expect(screen.getByText('Prediction or profile coverage too thin')).toBeInTheDocument();
    expect(screen.getByText('Stacking rate')).toBeInTheDocument();
    expect(screen.getByText('Atletico San Luis vs Leon')).toBeInTheDocument();
    expect(screen.getByText('v4-evidence-hardened')).toBeInTheDocument();
    expect(screen.getByText('v5-compact-a')).toBeInTheDocument();
  });
});
