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
    { label: 'Push Rate 24h', value: '40%', tone: 'neutral', detail: '8/20 analyzed' },
  ],
  pipeline: {
    activityLast2h: 12,
    analyzed24h: 20,
    shouldPush24h: 8,
    saved24h: 10,
    notified24h: 6,
    skipped24h: 5,
    errors24h: 1,
    pushRate24h: 40,
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
      expect(screen.getByText('Post-Release Checklist')).toBeInTheDocument();
    });

    expect(screen.getByText('Pipeline activity is present')).toBeInTheDocument();
    expect(screen.getByText('Push Rate 24h')).toBeInTheDocument();
    expect(screen.getByText('40%')).toBeInTheDocument();
    expect(screen.getByText('Stats Providers (6h)')).toBeInTheDocument();
    expect(screen.getByText('Settlement Method Mix (30d)')).toBeInTheDocument();
    expect(screen.getByText('Notifications (24h)')).toBeInTheDocument();
    expect(screen.getByText('Prompt Shadow (24h)')).toBeInTheDocument();
    expect(screen.getByText('Prompt Shadow Versions')).toBeInTheDocument();
  });
});
