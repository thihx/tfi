import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockFetchLiveMonitorStatus = vi.fn();
const mockFetchLiveMonitorWhyNoRecommendation = vi.fn();
const mockGetParsedAiResult = vi.fn();

vi.mock('@/hooks/useAppState', () => ({
  useAppState: () => ({
    state: {
      config: { apiUrl: 'http://localhost:4000', defaultMode: 'B' },
      watchlist: [{ match_id: '100' }],
    },
  }),
}));

vi.mock('@/features/live-monitor/services/server-monitor.service', () => ({
  fetchLiveMonitorStatus: mockFetchLiveMonitorStatus,
  fetchLiveMonitorWhyNoRecommendation: mockFetchLiveMonitorWhyNoRecommendation,
  getParsedAiResult: mockGetParsedAiResult,
}));

const { LiveMonitorTab } = await import('./LiveMonitorTab');

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(window, 'setInterval').mockImplementation(() => 0 as unknown as ReturnType<typeof window.setInterval>);
  vi.spyOn(window, 'clearInterval').mockImplementation(() => undefined);
  mockGetParsedAiResult.mockImplementation((result) => result.debug?.parsed ?? null);
  mockFetchLiveMonitorWhyNoRecommendation.mockResolvedValue({
    generatedAt: '2026-06-09T00:00:00.000Z',
    lookbackHours: 24,
    officialPromptVersion: 'v10-hybrid-legacy-g',
    totals: {
      matchAnalyzed: 4,
      moneyRecommendations: 1,
      statsOnlySignals: 1,
      watchInsights: 0,
      shadowCandidates: 1,
      noActions: 2,
      llmCalled: 2,
      llmSkipped: 2,
    },
    outputKindBreakdown: [],
    reasonGroupBreakdown: [
      { group: 'policy', count: 1, latestAt: '2026-06-09T00:00:00.000Z' },
      { group: 'evidence', count: 2, latestAt: '2026-06-09T00:00:00.000Z' },
    ],
    reasonBuckets: [
      {
        key: 'policy_blocked',
        group: 'policy',
        outputKind: 'shadow_candidate',
        evidenceMode: 'odds_events_only_degraded',
        count: 1,
        latestAt: '2026-06-09T00:00:00.000Z',
      },
    ],
    recentDrilldown: [
      {
        id: 10,
        timestamp: '2026-06-09T00:00:00.000Z',
        matchId: '102',
        matchDisplay: 'Atletico vs Sevilla',
        minute: '67',
        status: '2H',
        score: '0-2',
        outputKind: 'shadow_candidate',
        auditBucket: 'policy_blocked',
        reasonGroup: 'policy',
        evidenceMode: 'odds_events_only_degraded',
        route: 'shadow_path',
        llmCalled: true,
        savedRecommendation: false,
        settlementEligible: false,
        roiEligible: false,
        candidatePresent: true,
        noActionReason: 'policy_blocked',
      },
    ],
  });
  mockFetchLiveMonitorStatus.mockResolvedValue({
    job: {
      name: 'check-live-trigger',
      intervalMs: 60_000,
      enabled: true,
      running: false,
      lastRun: '2026-03-24T12:00:00.000Z',
      lastError: null,
      runCount: 3,
    },
    progress: null,
    monitoring: {
      activeWatchCount: 5,
      liveWatchCount: 2,
      candidateCount: 1,
      targets: [
        {
          matchId: '099',
          matchDisplay: 'Machida Zelvia vs FC Tokyo',
          league: 'J1 League',
          status: 'NS',
          minute: null,
          score: '0-0',
          live: false,
          customConditions: '',
          recommendedCondition: '(Home scores first)',
          lastChecked: null,
          totalChecks: 0,
          candidate: false,
          candidateReason: 'not_live',
          baseline: 'none',
        },
        {
          matchId: '100',
          matchDisplay: 'Arsenal vs Chelsea',
          league: 'Premier League',
          status: '2H',
          minute: 64,
          score: '2-1',
          live: true,
          customConditions: '(Minute >= 60)',
          recommendedCondition: '',
          lastChecked: '2026-03-24T11:59:00.000Z',
          totalChecks: 8,
          candidate: false,
          candidateReason: 'no_significant_change',
          baseline: 'recommendation',
        },
        {
          matchId: '101',
          matchDisplay: 'Liverpool vs Man City',
          league: 'Premier League',
          status: '2H',
          minute: 72,
          score: '1-1',
          live: true,
          customConditions: '',
          recommendedCondition: '(Home scores first)',
          lastChecked: null,
          totalChecks: 2,
          candidate: true,
          candidateReason: 'force_analyze',
          baseline: 'none',
        },
      ],
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
    results: [
      {
        matchId: '102',
        matchDisplay: 'Atletico vs Sevilla',
        homeName: 'Atletico',
        awayName: 'Sevilla',
        league: 'La Liga',
        minute: 67,
        score: '0-2',
        status: '2H',
        success: true,
        decisionKind: 'no_bet',
        shouldPush: false,
        selection: 'BTTS Yes @2.20',
        confidence: 8,
        saved: false,
        notified: false,
        debug: {
          promptDataLevel: 'advanced-upgraded',
          prematchAvailability: 'full',
          prematchNoisePenalty: 10,
          prematchStrength: 'strong',
          promptVersion: 'v10-hybrid-legacy-g',
          statsSource: 'api-football',
          evidenceMode: 'full_live_data',
          llmDecisionDiagnostic: 'policy_blocked',
          runtimePolicyShadow: {
            hasPolicyBlockedSelection: true,
            canonicalMarket: 'btts_yes',
            minuteBand: '60-74',
            scoreState: 'two-plus-margin',
            odds: 2.2,
            confidence: 8,
            valuePercent: 6,
            valueBand: '6-7',
            riskLevel: 'MEDIUM',
            stakePercent: 2,
            watchSignalKey: 'btts_yes_medium_edge_6_7_odds_2_plus',
            watchSignalLabel: 'BTTS Yes MEDIUM edge 6-7 odds>=2.0',
            evidenceMode: 'full_live_data',
            marketResolutionStatus: 'resolved',
            prematchStrength: 'strong',
            marketAvailabilityBucket: 'totals_only',
            matchedPockets: [{
              id: 'btts_yes_60_74_two_plus',
              label: 'BTTS Yes 60-74 two-plus clean context shadow',
              stakeCapPercent: 1,
            }],
            skippedReason: '',
          },
        },
      },
      {
        matchId: '101',
        matchDisplay: 'Liverpool vs Man City',
        homeName: 'Liverpool',
        awayName: 'Man City',
        league: 'Premier League',
        minute: 72,
        score: '1-1',
        status: '2H',
        success: true,
        decisionKind: 'no_bet',
        shouldPush: false,
        selection: '',
        confidence: 0,
        saved: false,
        notified: false,
        debug: {
          promptDataLevel: 'basic-only',
          prematchAvailability: 'minimal',
          prematchNoisePenalty: 60,
          prematchStrength: 'weak',
          promptVersion: 'v10-hybrid-legacy-g',
          statsSource: 'api-football',
          evidenceMode: 'full_live_data',
          llmDecisionDiagnostic: 'no_bet_intentional',
        },
      },
      {
        matchId: '100',
        matchDisplay: 'Arsenal vs Chelsea',
        homeName: 'Arsenal',
        awayName: 'Chelsea',
        league: 'Premier League',
        minute: 64,
        score: '2-1',
        status: '2H',
        success: true,
        decisionKind: 'ai_push',
        shouldPush: true,
        selection: 'Over 2.5',
        confidence: 8,
        saved: true,
        notified: true,
        debug: {
          promptDataLevel: 'advanced-upgraded',
          prematchAvailability: 'full',
          prematchNoisePenalty: 12,
          prematchStrength: 'strong',
          promptVersion: 'v10-hybrid-legacy-g',
          statsSource: 'api-football',
          evidenceMode: 'full_live_data',
          parsed: {
            reasoning_vi: 'Du dieu kien',
            warnings: ['EDGE_OK'],
            bet_market: 'over_2.5',
            custom_condition_matched: true,
            condition_triggered_should_push: true,
            condition_triggered_suggestion: 'Under 2.5 Goals @2.00',
            condition_triggered_reasoning_vi: 'Dieu kien under dang duoc kich hoat',
          },
        },
      },
    ],
  });
});

describe('LiveMonitorTab', () => {
  it('renders live monitoring scope and latest results without manual controls', async () => {
    render(<LiveMonitorTab />);

    await waitFor(() => expect(mockFetchLiveMonitorStatus).toHaveBeenCalled());
    expect(screen.getByText('Live Right Now')).toBeInTheDocument();
    expect(screen.getByText('Waiting Or Upcoming')).toBeInTheDocument();
    expect(await screen.findByText('Latest Run Summary')).toBeInTheDocument();
    expect(screen.getByText('Official Bet Alerts')).toBeInTheDocument();
    expect(screen.getByText('Signal Alerts')).toBeInTheDocument();
    expect(screen.getAllByText('Arsenal vs Chelsea').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('Machida Zelvia vs FC Tokyo')).toBeInTheDocument();
    expect(screen.getAllByText('Premier League | 64\' | 2-1 | 2H').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('Passed the coarse gate; the engine may still skip after fresh stats and odds.')).toBeInTheDocument();
    expect(screen.getByText('Tracked live, but not sent to analysis yet.')).toBeInTheDocument();
    expect(screen.getByText('This match is in the system monitoring pool but is not live yet.')).toBeInTheDocument();
    expect(screen.getByText('Waiting for Kickoff')).toBeInTheDocument();
    expect(screen.getByText('Forced by manual trigger | Baseline None')).toBeInTheDocument();
    expect(screen.getByText('No meaningful change since last baseline | Baseline Recommendation')).toBeInTheDocument();
    expect(screen.getByText('Custom condition:', { exact: false })).toBeInTheDocument();
    expect(screen.getAllByText('Suggested condition:', { exact: false }).length).toBeGreaterThanOrEqual(1);
    await waitFor(() => expect(screen.getAllByText('Over 2.5').length).toBeGreaterThanOrEqual(1));
    expect(screen.getByText('Du dieu kien')).toBeInTheDocument();
    expect(screen.getByText('Condition Matched')).toBeInTheDocument();
    expect(screen.getByText('Condition Triggered')).toBeInTheDocument();
    expect(screen.getByText('Live Signals')).toBeInTheDocument();
    expect(screen.getByText('Last 24h No-Recommendation Audit')).toBeInTheDocument();
    expect(screen.getByText('historical operator view')).toBeInTheDocument();
    expect(screen.getByText('Audit Snapshot')).toBeInTheDocument();
    expect(screen.getByText('policy blocked')).toBeInTheDocument();
    expect(screen.getAllByText(/Provider no live stats/).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(/Recorded .* \| policy blocked \| LLM called \| settle no/)).toBeInTheDocument();
    expect(screen.getAllByText('Bet').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Watch').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('No Action').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Atletico vs Sevilla').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('BTTS Yes @2.20').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('BTTS Yes MEDIUM edge 6-7 odds>=2.0').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('AI Selected')).toBeInTheDocument();
    expect(screen.getAllByText('Advanced Prompt').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('Basic Prompt')).toBeInTheDocument();
    expect(screen.getAllByText('Prematch Strong').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('Prematch Weak')).toBeInTheDocument();
    expect(screen.getAllByText('v10-hybrid-legacy-g | Advanced Prompt | api-football | full_live_data').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText(/Prematch Strong \| full \| noise/).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('Prematch Weak | minimal | noise 60')).toBeInTheDocument();
    expect(screen.getByText(/Condition Suggestion:/)).toBeInTheDocument();
    expect(screen.getByText('My Watchlist')).toBeInTheDocument();
    expect(screen.getByText('System Pool')).toBeInTheDocument();
    expect(screen.getByText('Live Now')).toBeInTheDocument();
    expect(screen.getAllByText('Pre-check candidates').length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByText('Engine Progress')).not.toBeInTheDocument();
    expect(screen.queryByText('Live Engine Is Working')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Run Check Live' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Refresh' })).not.toBeInTheDocument();
    expect(mockFetchLiveMonitorStatus).toHaveBeenCalled();
    expect(mockFetchLiveMonitorWhyNoRecommendation).toHaveBeenCalledWith(
      { apiUrl: 'http://localhost:4000', defaultMode: 'B' },
      { lookbackHours: 24, maxSamples: 8 },
    );
  });

  it('keeps auto-refresh polling active for a live screen', async () => {
    render(<LiveMonitorTab />);
    await waitFor(() => expect(mockFetchLiveMonitorStatus).toHaveBeenCalled());

    await waitFor(() => {
      expect(window.setInterval).toHaveBeenCalled();
    });
  });
});
