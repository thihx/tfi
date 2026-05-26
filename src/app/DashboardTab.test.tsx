import { render, screen, waitFor } from '@testing-library/react';
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
      totalBets: 0,
      wins: 0,
      losses: 0,
      pushes: 0,
      halfWins: 0,
      halfLosses: 0,
      voids: 0,
      directionalSettled: 0,
      pushVoidSettled: 0,
      pending: 0,
      winRate: 0,
      totalPnl: 0,
      totalStaked: 0,
      roi: 0,
      streak: '',
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

  it('shows bankroll details in one compact summary without repeated VND amounts', async () => {
    render(<DashboardTab />);

    await waitFor(() => expect(screen.getByText('Bankroll')).toBeInTheDocument());

    expect(screen.getByText('1,125.50')).toBeInTheDocument();
    expect(screen.getByText('Initial 1,000 units')).toBeInTheDocument();
    expect(screen.getByText('P/L')).toBeInTheDocument();
    expect(screen.getByText('+125.50')).toBeInTheDocument();
    expect(screen.getByText('Unit Multiplier')).toBeInTheDocument();
    expect(screen.getByText('x1000')).toBeInTheDocument();
    expect(screen.getByText('Currency VND')).toBeInTheDocument();
    expect(screen.getByText('Stake Rule')).toBeInTheDocument();
    expect(screen.getByText('Stake % -> amount')).toBeInTheDocument();
    expect(screen.queryByText('1125.50 (1,125,500 VND)')).not.toBeInTheDocument();
  });
});
