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
const mockFetchCurrentUser = vi.fn();
const mockGetUser = vi.fn();
const mockFetchRecommendationDeliveriesPaginated = vi.fn();

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
  getUser: mockGetUser,
  fetchCurrentUser: mockFetchCurrentUser,
}));

vi.mock('@/lib/services/api', () => ({
  fetchRecommendationsPaginated: vi.fn().mockResolvedValue({ rows: recommendationRows, total: 2 }),
  fetchRecommendationDeliveriesPaginated: mockFetchRecommendationDeliveriesPaginated,
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
    mockGetUser.mockReturnValue({ id: 'admin-1', role: 'admin', email: 'admin@example.com' });
    mockFetchCurrentUser.mockResolvedValue({ id: 'admin-1', role: 'admin', email: 'admin@example.com' });
    mockFetchRecommendationDeliveriesPaginated.mockResolvedValue({
      rows: [
        {
          recommendation_id: 1,
          match_id: '100',
          created_at: '2026-04-03T10:05:00.000Z',
          delivery_status: 'sent',
          recommendation_home_team: 'Arsenal',
          recommendation_away_team: 'Chelsea',
          recommendation_league: 'Premier League',
          recommendation_timestamp: '2026-04-03T10:00:00.000Z',
          recommendation_minute: 55,
          recommendation_score: '1-0',
          recommendation_actual_outcome: null,
          recommendation_bet_type: 'AI',
          recommendation_bet_market: 'over_2.5',
          recommendation_selection: 'Over 2.5 Goals @1.90',
          recommendation_odds: 1.9,
          recommendation_confidence: 7,
          recommendation_value_percent: null,
          recommendation_risk_level: null,
          recommendation_stake_percent: 3,
          recommendation_reasoning: 'Test reasoning',
          recommendation_reasoning_vi: 'Test reasoning',
          recommendation_key_factors: null,
          recommendation_warnings: null,
          recommendation_result: 'pending',
          recommendation_pnl: 0,
          recommendation_settlement_status: null,
          recommendation_settlement_note: null,
        },
      ],
      total: 1,
    });
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

  it('allows admin to delete from My Deliveries when the row is linked to a canonical recommendation', async () => {
    const user = await renderTab();

    await user.click(screen.getByRole('button', { name: 'My Deliveries' }));
    expect(await screen.findByText('Arsenal vs Chelsea')).toBeInTheDocument();

    const arsenalCard = screen.getByText('Arsenal vs Chelsea').closest('.card') as HTMLElement | null;
    expect(arsenalCard).not.toBeNull();
    await user.click(within(arsenalCard!).getByRole('button', { name: 'Delete' }));

    const deleteModal = getDeleteModal();
    await user.click(within(deleteModal).getByRole('button', { name: 'Delete' }));

    await waitFor(() => {
      expect(mockDeleteRecommendation).toHaveBeenCalledWith(defaultConfig, 1);
    });
  }, 10000);

  it('does not expose delete actions to non-admin users in either feed', async () => {
    mockGetUser.mockReturnValue({ id: 'user-1', role: 'user', email: 'user@example.com' });
    mockFetchCurrentUser.mockResolvedValue({ id: 'user-1', role: 'user', email: 'user@example.com' });

    const user = await renderTab();

    expect(screen.queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Delete Selected' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'My Deliveries' }));
    expect(await screen.findByText('Arsenal vs Chelsea')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Delete Selected' })).not.toBeInTheDocument();
  }, 10000);
});
