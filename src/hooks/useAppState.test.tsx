import { useEffect } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppProvider, useAppState } from './useAppState';
import { ToastProvider } from './useToast';
import type { WatchlistItem } from '@/types';

const mockFetchActiveLeagues = vi.fn();
const mockFetchMatches = vi.fn();
const mockFetchWatchlist = vi.fn();
const mockUpdateWatchlistItems = vi.fn();
const mockFetchWatchlistItem = vi.fn();

vi.mock('@/config/config', () => ({
  loadConfig: () => ({ apiUrl: 'http://localhost:4000', defaultMode: 'B' }),
  saveConfig: vi.fn(),
}));

vi.mock('@/lib/services/api', () => ({
  fetchActiveLeagues: (...args: unknown[]) => mockFetchActiveLeagues(...args),
  fetchMatches: (...args: unknown[]) => mockFetchMatches(...args),
  fetchWatchlist: (...args: unknown[]) => mockFetchWatchlist(...args),
  updateWatchlistItems: (...args: unknown[]) => mockUpdateWatchlistItems(...args),
  fetchWatchlistItem: (...args: unknown[]) => mockFetchWatchlistItem(...args),
  createWatchlistItems: vi.fn(),
  deleteWatchlistItems: vi.fn(),
}));

function makeWatchItem(overrides: Partial<WatchlistItem> = {}): WatchlistItem {
  return {
    id: 7,
    match_id: '100',
    date: '2026-04-01',
    league: 'J1 League',
    home_team: 'Machida Zelvia',
    away_team: 'FC Tokyo',
    kickoff: '18:00',
    mode: 'B',
    priority: 2,
    custom_conditions: '',
    status: 'active',
    ...overrides,
  };
}

function Harness() {
  const { state, loadAllData, updateWatchlistItem } = useAppState();

  useEffect(() => {
    void loadAllData(true);
  }, [loadAllData]);

  return (
    <div>
      <div data-testid="condition-value">{state.watchlist[0]?.custom_conditions ?? ''}</div>
      <button
        type="button"
        onClick={() => updateWatchlistItem({
          id: 7,
          match_id: '100',
          custom_conditions: '(ABC)',
        })}
      >
        Save
      </button>
    </div>
  );
}

describe('useAppState watchlist updates', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetchActiveLeagues.mockResolvedValue([]);
    mockFetchMatches.mockResolvedValue([]);
    mockFetchWatchlist.mockResolvedValueOnce([{ ...makeWatchItem({ custom_conditions: '' }), id: '7' }]);
    mockUpdateWatchlistItems.mockResolvedValue({ updatedCount: 1 });
    mockFetchWatchlist.mockResolvedValueOnce([{ ...makeWatchItem({ custom_conditions: '(ABC)' }), id: '7' }]);
  });

  it('refetches canonical watchlist after a successful watch item save', async () => {
    const user = userEvent.setup();

    render(
      <ToastProvider>
        <AppProvider>
          <Harness />
        </AppProvider>
      </ToastProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('condition-value')).toHaveTextContent('');
    });

    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(mockUpdateWatchlistItems).toHaveBeenCalledWith(
        expect.anything(),
        [expect.objectContaining({ id: 7, match_id: '100', custom_conditions: '(ABC)' })],
      );
    });

    await waitFor(() => {
      expect(mockFetchWatchlist).toHaveBeenCalledTimes(2);
      expect(screen.getByTestId('condition-value')).toHaveTextContent('(ABC)');
    });
  });
});
