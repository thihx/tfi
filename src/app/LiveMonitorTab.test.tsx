import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockShowToast = vi.fn();
const mockFetchLiveMonitorStatus = vi.fn();
const mockTriggerCheckLiveRun = vi.fn();
const mockGetParsedAiResult = vi.fn();

vi.mock('@/hooks/useAppState', () => ({
  useAppState: () => ({
    state: {
      config: { apiUrl: 'http://localhost:4000', defaultMode: 'B' },
    },
  }),
}));

vi.mock('@/hooks/useToast', () => ({
  useToast: () => ({ showToast: mockShowToast }),
}));

vi.mock('@/features/live-monitor/services/server-monitor.service', () => ({
  fetchLiveMonitorStatus: mockFetchLiveMonitorStatus,
  triggerCheckLiveRun: mockTriggerCheckLiveRun,
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
  it('renders server-owned dashboard data and latest results', async () => {
    render(<LiveMonitorTab />);

    expect(await screen.findByText('Live Monitor Dashboard')).toBeInTheDocument();
    expect(await screen.findByText('Latest Run Summary')).toBeInTheDocument();
    expect(screen.getByText('Arsenal vs Chelsea')).toBeInTheDocument();
    expect(screen.getByText('Premier League | 64\' | 2-1 | 2H')).toBeInTheDocument();
    expect(await screen.findByText('Over 2.5')).toBeInTheDocument();
    expect(screen.getByText('Du dieu kien')).toBeInTheDocument();
    expect(screen.getByText('Condition Matched')).toBeInTheDocument();
    expect(screen.getByText('Condition Triggered')).toBeInTheDocument();
    expect(screen.getByText('AI Push')).toBeInTheDocument();
    expect(screen.getAllByText('Advanced Prompt')).toHaveLength(2);
    expect(screen.getAllByText('Basic Prompt')).toHaveLength(2);
    expect(screen.getAllByText('Prematch Strong')).toHaveLength(2);
    expect(screen.getAllByText('Prematch Weak')).toHaveLength(2);
    expect(screen.getByText('v4-evidence-hardened | Advanced Prompt | api-football | full_live_data')).toBeInTheDocument();
    expect(screen.getByText('Prematch Strong | full | noise 12')).toBeInTheDocument();
    expect(screen.getByText('Prematch Weak | minimal | noise 60')).toBeInTheDocument();
    expect(screen.getByText(/Condition Suggestion:/)).toBeInTheDocument();
    expect(screen.getByText('4')).toBeInTheDocument();
    expect(mockFetchLiveMonitorStatus).toHaveBeenCalled();
  });

  it('triggers the canonical server job from the dashboard', async () => {
    const user = userEvent.setup();
    mockTriggerCheckLiveRun.mockResolvedValue(undefined);

    render(<LiveMonitorTab />);
    await screen.findByText('Live Monitor Dashboard');

    await user.click(screen.getByRole('button', { name: 'Run Check Live' }));

    await waitFor(() => {
      expect(mockTriggerCheckLiveRun).toHaveBeenCalledTimes(1);
    });
    expect(mockShowToast).toHaveBeenCalledWith('Live monitor job triggered', 'success');
    expect(mockFetchLiveMonitorStatus.mock.calls.length).toBeGreaterThanOrEqual(2);
  });
});