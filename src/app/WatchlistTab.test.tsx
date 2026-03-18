// ============================================================
// Unit tests — WatchlistTab (status filtering & display)
// ============================================================

import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { WatchlistItem, AppConfig, Match, League } from '@/types';

// ── Fixtures ──────────────────────────────────────────

const defaultConfig: AppConfig = {
  apiUrl: 'http://localhost:4000',
  apiKey: '',
  defaultMode: 'B',
  defaultPriority: 2,
  dateFormat: 'DD-MMM-YYYY HH:mm',
};

function makeItem(overrides: Partial<WatchlistItem> = {}): WatchlistItem {
  return {
    match_id: '100',
    date: '2026-03-18',
    league: 'Premier League',
    home_team: 'Arsenal',
    away_team: 'Chelsea',
    kickoff: '20:00',
    mode: 'B',
    priority: 2,
    custom_conditions: '',
    status: 'active',
    ...overrides,
  };
}

const ACTIVE_1 = makeItem({ match_id: '100', home_team: 'Arsenal', away_team: 'Chelsea', status: 'active' });
const ACTIVE_2 = makeItem({ match_id: '101', home_team: 'Liverpool', away_team: 'Man City', status: 'active' });
const EXPIRED_1 = makeItem({ match_id: '200', home_team: 'Barca', away_team: 'Real Madrid', status: 'expired', date: '2026-03-16' });
const EXPIRED_2 = makeItem({ match_id: '201', home_team: 'Bayern', away_team: 'Dortmund', status: 'expired', date: '2026-03-15' });
const PENDING_1 = makeItem({ match_id: '300', home_team: 'PSG', away_team: 'Lyon', status: 'pending' });

const ALL_ITEMS = [ACTIVE_1, ACTIVE_2, EXPIRED_1, EXPIRED_2, PENDING_1];

// ── Mock useAppState ──────────────────────────────────

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

// ── Helpers ───────────────────────────────────────────

/** Get visible team name texts from the table body */
function getVisibleTeams(): string[] {
  const rows = screen.queryAllByRole('row').filter((r) => r.querySelector('td'));
  const teams: string[] = [];
  for (const row of rows) {
    const cells = within(row).queryAllByText(/.+/);
    cells.forEach((c) => {
      const text = c.textContent || '';
      if (['Arsenal', 'Chelsea', 'Liverpool', 'Man City', 'Barca', 'Real Madrid', 'Bayern', 'Dortmund', 'PSG', 'Lyon'].includes(text)) {
        teams.push(text);
      }
    });
  }
  return teams;
}

// ── Import component AFTER mocks ──────────────────────
const { WatchlistTab } = await import('./WatchlistTab');

beforeEach(() => {
  vi.clearAllMocks();
  mockWatchlist = ALL_ITEMS;
});

describe('WatchlistTab — status filtering', () => {
  it('defaults to showing only active entries', () => {
    render(<WatchlistTab />);
    const teams = getVisibleTeams();
    // Active: Arsenal, Chelsea, Liverpool, Man City
    expect(teams).toContain('Arsenal');
    expect(teams).toContain('Liverpool');
    // Expired should NOT appear
    expect(teams).not.toContain('Barca');
    expect(teams).not.toContain('Bayern');
    // Pending should NOT appear
    expect(teams).not.toContain('PSG');
  });

  it('shows expired entries when status filter changed to Expired', async () => {
    const user = userEvent.setup();
    render(<WatchlistTab />);

    const statusSelect = screen.getByDisplayValue('Active');
    await user.selectOptions(statusSelect, 'expired');

    const teams = getVisibleTeams();
    expect(teams).toContain('Barca');
    expect(teams).toContain('Bayern');
    expect(teams).not.toContain('Arsenal');
    expect(teams).not.toContain('PSG');
  });

  it('shows all entries when status filter set to All Status', async () => {
    const user = userEvent.setup();
    render(<WatchlistTab />);

    const statusSelect = screen.getByDisplayValue('Active');
    await user.selectOptions(statusSelect, '');

    const teams = getVisibleTeams();
    expect(teams).toContain('Arsenal');
    expect(teams).toContain('Barca');
    expect(teams).toContain('Bayern');
    expect(teams).toContain('PSG');
  });

  it('shows pending entries when status filter changed to Pending', async () => {
    const user = userEvent.setup();
    render(<WatchlistTab />);

    const statusSelect = screen.getByDisplayValue('Active');
    await user.selectOptions(statusSelect, 'pending');

    const teams = getVisibleTeams();
    expect(teams).toContain('PSG');
    expect(teams).not.toContain('Arsenal');
    expect(teams).not.toContain('Barca');
  });
});

describe('WatchlistTab — status badge rendering', () => {
  it('renders Active badge for active entries', () => {
    mockWatchlist = [ACTIVE_1];
    render(<WatchlistTab />);
    // The badge is inside the table body (not the filter dropdown)
    const tbody = screen.getAllByRole('row').filter((r) => r.querySelector('td'));
    expect(tbody.length).toBe(1);
    expect(within(tbody[0]!).getByText('Active')).toBeInTheDocument();
  });

  it('renders Expired badge for expired entries', async () => {
    const user = userEvent.setup();
    mockWatchlist = [EXPIRED_1];
    render(<WatchlistTab />);

    const statusSelect = screen.getByDisplayValue('Active');
    await user.selectOptions(statusSelect, 'expired');

    const tbody = screen.getAllByRole('row').filter((r) => r.querySelector('td'));
    expect(tbody.length).toBe(1);
    expect(within(tbody[0]!).getByText('Expired')).toBeInTheDocument();
  });

  it('renders Pending badge for pending entries', async () => {
    const user = userEvent.setup();
    mockWatchlist = [PENDING_1];
    render(<WatchlistTab />);

    const statusSelect = screen.getByDisplayValue('Active');
    await user.selectOptions(statusSelect, 'pending');

    const tbody = screen.getAllByRole('row').filter((r) => r.querySelector('td'));
    expect(tbody.length).toBe(1);
    expect(within(tbody[0]!).getByText('Pending')).toBeInTheDocument();
  });
});

describe('WatchlistTab — clear filters', () => {
  it('resets status filter back to active on clear', async () => {
    const user = userEvent.setup();
    render(<WatchlistTab />);

    // Change to show all
    const statusSelect = screen.getByDisplayValue('Active');
    await user.selectOptions(statusSelect, '');
    expect(getVisibleTeams()).toContain('Barca');

    // Click Clear Filters
    await user.click(screen.getByText('Clear Filters'));

    // Should revert to active-only
    const teams = getVisibleTeams();
    expect(teams).toContain('Arsenal');
    expect(teams).not.toContain('Barca');
  });
});

describe('WatchlistTab — empty state', () => {
  it('shows empty state when no active entries exist', () => {
    mockWatchlist = [EXPIRED_1, EXPIRED_2];
    render(<WatchlistTab />);

    // No active entries → should show empty message
    expect(screen.getByText('Your watchlist is empty')).toBeInTheDocument();
  });

  it('shows filter-aware empty message when filter yields no results', async () => {
    const user = userEvent.setup();
    mockWatchlist = [ACTIVE_1];
    render(<WatchlistTab />);

    // Switch to expired (no expired entries in list)
    const statusSelect = screen.getByDisplayValue('Active');
    await user.selectOptions(statusSelect, 'expired');

    expect(screen.getByText('No matches found for your filters')).toBeInTheDocument();
  });
});
