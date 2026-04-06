import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockFetchLiveMonitorStatus = vi.fn();
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
  getParsedAiResult: mockGetParsedAiResult,
}));

const { LiveMonitorTab } = await import('./LiveMonitorTab');

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(window, 'setInterval').mockImplementation(() => 0 as unknown as ReturnType<typeof window.setInterval>);
  vi.spyOn(window, 'clearInterval').mockImplementation(() => undefined);
  mockGetParsedAiResult.mockImplementation((result) => result.debug?.parsed ?? null);
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
          mode: 'B',
          priority: 95,
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
          mode: 'B',
          priority: 90,
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
          mode: 'F',
          priority: 70,
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
      errors: 0,
    },
    results: [
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
          promptVersion: 'v4-evidence-hardened',
          statsSource: 'api-football',
          evidenceMode: 'full_live_data',
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
          promptVersion: 'v4-evidence-hardened',
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
    expect(screen.getAllByText('Arsenal vs Chelsea').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('Machida Zelvia vs FC Tokyo')).toBeInTheDocument();
    expect(screen.getAllByText('Premier League | 64\' | 2-1 | 2H').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('Will go to analysis on the next engine run.')).toBeInTheDocument();
    expect(screen.getByText('Tracked live, but not sent to analysis yet.')).toBeInTheDocument();
    expect(screen.getByText('This match is in the system monitoring pool but is not live yet.')).toBeInTheDocument();
    expect(screen.getByText('Waiting for Kickoff')).toBeInTheDocument();
    expect(screen.getByText('Forced by monitor mode | Baseline None')).toBeInTheDocument();
    expect(screen.getByText('No meaningful change since last baseline | Baseline Recommendation')).toBeInTheDocument();
    expect(screen.getByText('Custom condition:', { exact: false })).toBeInTheDocument();
    expect(screen.getAllByText('Suggested condition:', { exact: false }).length).toBeGreaterThanOrEqual(1);
    expect(await screen.findByText('Over 2.5')).toBeInTheDocument();
    expect(screen.getByText('Du dieu kien')).toBeInTheDocument();
    expect(screen.getByText('Condition Matched')).toBeInTheDocument();
    expect(screen.getByText('Condition Triggered')).toBeInTheDocument();
    expect(screen.getByText('Signal')).toBeInTheDocument();
    expect(screen.getByText('Advanced Prompt')).toBeInTheDocument();
    expect(screen.getByText('Basic Prompt')).toBeInTheDocument();
    expect(screen.getByText('Prematch Strong')).toBeInTheDocument();
    expect(screen.getByText('Prematch Weak')).toBeInTheDocument();
    expect(screen.getByText('v4-evidence-hardened | Advanced Prompt | api-football | full_live_data')).toBeInTheDocument();
    expect(screen.getByText('Prematch Strong | full | noise 12')).toBeInTheDocument();
    expect(screen.getByText('Prematch Weak | minimal | noise 60')).toBeInTheDocument();
    expect(screen.getByText(/Condition Suggestion:/)).toBeInTheDocument();
    expect(screen.getByText('My Watchlist')).toBeInTheDocument();
    expect(screen.getByText('System Pool')).toBeInTheDocument();
    expect(screen.getByText('Live Now')).toBeInTheDocument();
    expect(screen.getAllByText('Ready for analysis').length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByText('Engine Progress')).not.toBeInTheDocument();
    expect(screen.queryByText('Live Engine Is Working')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Run Check Live' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Refresh' })).not.toBeInTheDocument();
    expect(mockFetchLiveMonitorStatus).toHaveBeenCalled();
  });

  it('keeps auto-refresh polling active for a live screen', async () => {
    render(<LiveMonitorTab />);
    await waitFor(() => expect(mockFetchLiveMonitorStatus).toHaveBeenCalled());

    await waitFor(() => {
      expect(window.setInterval).toHaveBeenCalled();
    });
  });
});
