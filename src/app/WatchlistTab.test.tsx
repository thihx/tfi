import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import type { WatchlistItem, AppConfig, Match, League } from '@/types';

const defaultConfig: AppConfig = {
  apiUrl: 'http://localhost:4000',
  defaultMode: 'B',
};

function makeItem(overrides: Partial<WatchlistItem> = {}): WatchlistItem {
  return {
    id: 7,
    match_id: '100',
    date: '2026-03-18',
    league: 'Premier League',
    home_team: 'Arsenal',
    away_team: 'Chelsea',
    kickoff: '20:00',
    custom_conditions: '',
    ...overrides,
  };
}

const ITEM_1 = makeItem({ match_id: '100', home_team: 'Arsenal', away_team: 'Chelsea' });
const ITEM_2 = makeItem({ match_id: '101', home_team: 'Liverpool', away_team: 'Man City' });
const ITEM_3 = makeItem({ match_id: '300', home_team: 'PSG', away_team: 'Lyon' });
const ALL_ITEMS = [ITEM_1, ITEM_2, ITEM_3];

const mockLoadAllData = vi.fn();
const mockUpdateWatchlistItem = vi.fn().mockResolvedValue(true);
const mockRemoveFromWatchlist = vi.fn().mockResolvedValue(true);
const mockShowToast = vi.fn();

let mockWatchlist: WatchlistItem[] = ALL_ITEMS;

vi.mock('@/hooks/useAppState', () => ({
  useAppState: () => ({
    state: {
      watchlist: mockWatchlist,
      matches: [] as Match[],
      leagues: [] as League[],
      config: defaultConfig,
    },
    loadAllData: mockLoadAllData,
    updateWatchlistItem: mockUpdateWatchlistItem,
    removeFromWatchlist: mockRemoveFromWatchlist,
  }),
}));

vi.mock('@/hooks/useToast', () => ({
  useToast: () => ({ showToast: mockShowToast }),
}));

vi.mock('@/lib/services/api', () => ({
  fetchLeagueProfile: vi.fn().mockResolvedValue(null),
  fetchTeamProfile: vi.fn().mockResolvedValue(null),
}));

function getVisibleTeams(): string[] {
  const rows = screen.queryAllByRole('row').filter((row) => row.querySelector('td'));
  const teams: string[] = [];
  for (const row of rows) {
    const cells = within(row).queryAllByText(/.+/);
    cells.forEach((cell) => {
      const text = cell.textContent || '';
      if (['Arsenal', 'Chelsea', 'Liverpool', 'Man City', 'PSG', 'Lyon'].includes(text)) {
        teams.push(text);
      }
    });
  }
  return teams;
}

const { WatchlistTab } = await import('./WatchlistTab');

beforeEach(() => {
  vi.clearAllMocks();
  mockWatchlist = ALL_ITEMS;
});

beforeAll(() => {
  class ResizeObserverMock {
    observe() {}
    disconnect() {}
    unobserve() {}
  }
  vi.stubGlobal('ResizeObserver', ResizeObserverMock);
});

describe('WatchlistTab filtering', () => {
  it('shows all entries by default', () => {
    render(<WatchlistTab />);
    const teams = getVisibleTeams();
    expect(teams).toContain('Arsenal');
    expect(teams).toContain('Liverpool');
    expect(teams).toContain('PSG');
  });

  it('filters by search keyword', async () => {
    const user = userEvent.setup();
    render(<WatchlistTab />);

    await user.type(screen.getByPlaceholderText(/search teams/i), 'arsenal');
    await waitFor(() => {
      const teams = getVisibleTeams();
      expect(teams).toContain('Arsenal');
      expect(teams).not.toContain('PSG');
    });
  });
});

describe('WatchlistTab clear filters', () => {
  it('clears keyword filter when clicking Clear Filters', async () => {
    const user = userEvent.setup();
    render(<WatchlistTab />);

    await user.type(screen.getByPlaceholderText(/search teams/i), 'arsenal');
    await waitFor(() => expect(getVisibleTeams()).not.toContain('PSG'));

    await user.click(screen.getByText('Clear Filters'));
    expect(getVisibleTeams()).toContain('PSG');
  });
});

describe('WatchlistTab empty state', () => {
  it('shows empty state when there are no watchlist items', () => {
    mockWatchlist = [];
    render(<WatchlistTab />);
    expect(screen.getByText('Your watchlist is empty')).toBeInTheDocument();
  });

  it('shows filter empty state when search yields no result', async () => {
    const user = userEvent.setup();
    mockWatchlist = [ITEM_1];
    render(<WatchlistTab />);

    await user.type(screen.getByPlaceholderText(/search teams/i), 'zzz-nomatch');
    await waitFor(() => {
      expect(screen.getByText('No matches found for your filters')).toBeInTheDocument();
    });
  });
});

describe('WatchlistTab edit flow', () => {
  it('passes subscription id when saving edit', async () => {
    const user = userEvent.setup();
    mockWatchlist = [makeItem({ id: 11, match_id: '100', home_team: 'Arsenal', away_team: 'Chelsea' })];

    render(<WatchlistTab />);
    await user.click(screen.getByRole('button', { name: 'Edit' }));
    await user.click(await screen.findByRole('button', { name: 'Save Changes' }));

    expect(mockUpdateWatchlistItem).toHaveBeenCalledWith(
      expect.objectContaining({ id: 11, match_id: '100' }),
    );
  });
});
