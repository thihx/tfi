import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockFetchDashboardSummary = vi.fn();
const mockFetchAiStats = vi.fn();
const mockFetchAiStatsByModel = vi.fn();
const mockFetchMarketReport = vi.fn();
const mockFetchMyBankroll = vi.fn();

vi.mock('@/hooks/useAppState', () => ({
  useAppState: () => ({
    state: {
      config: { apiUrl: 'http://localhost:4000', defaultMode: 'B' },
    },
  }),
}));

vi.mock('@/lib/services/api', () => ({
  fetchDashboardSummary: (...args: unknown[]) => mockFetchDashboardSummary(...args),
  fetchAiStats: (...args: unknown[]) => mockFetchAiStats(...args),
  fetchAiStatsByModel: (...args: unknown[]) => mockFetchAiStatsByModel(...args),
  fetchMarketReport: (...args: unknown[]) => mockFetchMarketReport(...args),
  fetchMyBankroll: (...args: unknown[]) => mockFetchMyBankroll(...args),
}));

const { DashboardTab } = await import('./DashboardTab');

describe('DashboardTab bankroll summary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetchDashboardSummary.mockResolvedValue({
      totalBets: 2653,
      wins: 1396,
      losses: 1257,
      pushes: 0,
      halfWins: 12,
      halfLosses: 8,
      voids: 0,
      directionalSettled: 2653,
      pushVoidSettled: 0,
      pending: 95,
      winRate: 52.6,
      totalPnl: 0,
      totalStaked: 0,
      roi: 0,
      streak: 'W3',
      matchCount: 0,
      watchlistCount: 0,
      recCount: 0,
      openExposureConcentration: {
        stackedClusters: 0,
        stackedRecommendations: 0,
        stackedStake: 0,
        maxClusterStake: 0,
        topClusters: [],
      },
      pnlTrend: [],
      recentRecs: [],
    });
    mockFetchAiStats.mockResolvedValue(null);
    mockFetchAiStatsByModel.mockResolvedValue([]);
    mockFetchMarketReport.mockResolvedValue([]);
    mockFetchMyBankroll.mockResolvedValue({
      account: {
        user_id: 'user-1',
        currency: 'VND',
        unit_multiplier: 1000,
        initial_balance: 1000,
        current_balance: 1125.5,
        active: true,
        created_at: '2026-05-25T00:00:00.000Z',
        updated_at: '2026-05-25T00:00:00.000Z',
      },
      recentLedger: [],
    });
  });

  it('shows bankroll as a compact inline bar without repeated VND amounts', async () => {
    render(<DashboardTab />);

    await waitFor(() => expect(screen.getByText('My Bankroll')).toBeInTheDocument());

    expect(screen.getByText('1,125.50 units')).toBeInTheDocument();
    expect(screen.getByText('+125.50')).toBeInTheDocument();
    expect(screen.getByText('x1000 VND')).toBeInTheDocument();
    expect(screen.getByText('Initial 1,000')).toBeInTheDocument();
    expect(screen.queryByText('Stake Rule')).not.toBeInTheDocument();
    expect(screen.queryByText('1125.50 (1,125,500 VND)')).not.toBeInTheDocument();
  });

  it('navigates to settings when the bankroll settings link is clicked', async () => {
    const user = userEvent.setup();
    const navigateHandler = vi.fn();
    window.addEventListener('tfi:navigate', navigateHandler);

    render(<DashboardTab />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Settings' })).toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: 'Settings' }));
    expect(navigateHandler).toHaveBeenCalled();
    expect((navigateHandler.mock.calls[0]![0] as CustomEvent).detail).toBe('settings');

    window.removeEventListener('tfi:navigate', navigateHandler);
  });

  it('shows a compact Won Rate subtext with full breakdown in tooltip', async () => {
    render(<DashboardTab />);

    await waitFor(() => expect(screen.getByText('Won Rate')).toBeInTheDocument());

    const sub = screen.getByText('W 1396 · L 1257 · 20 half · W3');
    expect(sub).toBeInTheDocument();
    expect(sub).toHaveAttribute('title', 'Won 1396 | Lost 1257 | Half Won 12 | Half Lost 8 | W3');
    expect(screen.queryByText(/Half Won 12 \| Half Lost 8/)).not.toBeInTheDocument();
  });

  it('collapses model breakdown until expanded', async () => {
    const user = userEvent.setup();
    mockFetchAiStats.mockResolvedValue({
      accuracy: 52.6,
      correct: 100,
      incorrect: 90,
      pending: 5,
      pendingResult: 5,
      push: 0,
      neutral: 0,
      void: 0,
      reviewRequired: 0,
    });
    mockFetchAiStatsByModel.mockResolvedValue([
      { model: 'gpt-4.1', accuracy: 55.2, correct: 55, total: 100 },
      { model: 'claude-sonnet', accuracy: 50.1, correct: 50, total: 100 },
    ]);

    render(<DashboardTab />);

    await waitFor(() => expect(screen.getByText('Analysis performance')).toBeInTheDocument());
    expect(screen.getByText('gpt-4.1')).not.toBeVisible();

    await user.click(screen.getByText('2 models — tap to expand'));
    expect(screen.getByText('gpt-4.1')).toBeVisible();
    expect(screen.getByText('claude-sonnet')).toBeInTheDocument();
  });
});
