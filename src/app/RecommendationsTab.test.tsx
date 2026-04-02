import { render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Recommendation, AppConfig, Match, League } from '@/types';

const defaultConfig: AppConfig = {
  apiUrl: 'http://localhost:4000',
  defaultMode: 'B',
};

const mockShowToast = vi.fn();
const mockDeleteRecommendation = vi.fn();
const mockDeleteRecommendationsBulk = vi.fn();

const recommendationRows: Recommendation[] = [
  {
    id: 1,
    match_id: '100',
    match_display: 'Arsenal vs Chelsea',
    home_team: 'Arsenal',
    away_team: 'Chelsea',
    league: 'Premier League',
    timestamp: '2026-04-03T10:00:00.000Z',
    bet_type: 'AI',
    bet_market: 'over_2.5',
    selection: 'Over 2.5 Goals @1.90',
    odds: 1.9,
    confidence: 7,
    stake_amount: 0,
    stake_percent: 3,
    result: 'pending',
    pnl: 0,
    reasoning_vi: 'Test reasoning',
  },
  {
    id: 2,
    match_id: '101',
    match_display: 'Liverpool vs Man City',
    home_team: 'Liverpool',
    away_team: 'Man City',
    league: 'Premier League',
    timestamp: '2026-04-03T12:00:00.000Z',
    bet_type: 'AI',
    bet_market: 'btts_yes',
    selection: 'BTTS Yes @1.80',
    odds: 1.8,
    confidence: 6,
    stake_amount: 0,
    stake_percent: 2,
    result: 'pending',
    pnl: 0,
    reasoning_vi: 'More test reasoning',
  },
];

vi.mock('@/hooks/useAppState', () => ({
  useAppState: () => ({
    state: {
      config: defaultConfig,
      leagues: [] as League[],
      matches: [] as Match[],
    },
  }),
}));

vi.mock('@/hooks/useToast', () => ({
  useToast: () => ({ showToast: mockShowToast }),
}));

vi.mock('@/features/live-monitor/config', () => ({
  fetchMonitorConfig: vi.fn().mockResolvedValue({ NOTIFICATION_LANGUAGE: 'vi' }),
}));

vi.mock('@/lib/services/auth', () => ({
  getToken: vi.fn(() => 'token'),
  getUser: vi.fn(() => ({ id: 'admin-1', role: 'admin', email: 'admin@example.com' })),
  fetchCurrentUser: vi.fn().mockResolvedValue({ id: 'admin-1', role: 'admin', email: 'admin@example.com' }),
}));

vi.mock('@/lib/services/api', () => ({
  fetchRecommendationsPaginated: vi.fn().mockResolvedValue({ rows: recommendationRows, total: 2 }),
  fetchRecommendationDeliveriesPaginated: vi.fn().mockResolvedValue({ rows: [], total: 0 }),
  fetchBetTypes: vi.fn().mockResolvedValue(['AI']),
  fetchDistinctLeagues: vi.fn().mockResolvedValue(['Premier League']),
  settleRecommendationFinal: vi.fn(),
  deleteRecommendation: mockDeleteRecommendation,
  deleteRecommendationsBulk: mockDeleteRecommendationsBulk,
}));

const { RecommendationsTab } = await import('./RecommendationsTab');

function getDeleteModal() {
  const dialogText = screen.getByText(/Are you sure you want to delete \d+ recommendation\(s\)\?/);
  const modal = dialogText.closest('.modal');
  expect(modal).not.toBeNull();
  return modal as HTMLElement;
}

describe('RecommendationsTab delete actions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDeleteRecommendation.mockResolvedValue({
      deletedRecommendationIds: [1],
      recommendationsDeleted: 1,
      aiPerformanceDeleted: 1,
      deliveriesDeleted: 1,
      betsDeleted: 0,
    });
    mockDeleteRecommendationsBulk.mockResolvedValue({
      deletedRecommendationIds: [1, 2],
      recommendationsDeleted: 2,
      aiPerformanceDeleted: 2,
      deliveriesDeleted: 4,
      betsDeleted: 0,
    });
  });

  async function renderTab() {
    const user = userEvent.setup();
    render(<RecommendationsTab />);
    await screen.findByText('Arsenal vs Chelsea', {}, { timeout: 5000 });
    return user;
  }

  it('allows admin to delete an individual recommendation from card view', async () => {
    const user = await renderTab();

    const arsenalCard = screen.getByText('Arsenal vs Chelsea').closest('.card') as HTMLElement | null;
    expect(arsenalCard).not.toBeNull();
    await user.click(within(arsenalCard!).getByRole('button', { name: 'Delete' }));

    expect(screen.getByText('Are you sure you want to delete 1 recommendation(s)?')).toBeInTheDocument();
    const deleteModal = getDeleteModal();
    await user.click(within(deleteModal).getByRole('button', { name: 'Delete' }));

    await waitFor(() => {
      expect(mockDeleteRecommendation).toHaveBeenCalledWith(defaultConfig, 1);
    });
    expect(mockShowToast).toHaveBeenCalledWith('Deleted 1 recommendation(s)', 'success');
  }, 10000);

  it('allows admin to bulk delete selected recommendations from table view', async () => {
    const user = await renderTab();

    await user.click(screen.getByTitle('Table view'));
    await user.click(screen.getByLabelText('Select recommendation 1'));
    await user.click(screen.getByLabelText('Select recommendation 2'));
    await user.click(screen.getByRole('button', { name: 'Delete Selected' }));

    expect(screen.getByText('Are you sure you want to delete 2 recommendation(s)?')).toBeInTheDocument();
    const deleteModal = getDeleteModal();
    await user.click(within(deleteModal).getByRole('button', { name: 'Delete' }));

    await waitFor(() => {
      expect(mockDeleteRecommendationsBulk).toHaveBeenCalledWith(defaultConfig, [1, 2]);
    });
    expect(mockShowToast).toHaveBeenCalledWith('Deleted 2 recommendation(s)', 'success');
  }, 10000);
});
