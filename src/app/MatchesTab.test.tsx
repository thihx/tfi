import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Match, WatchlistItem, League } from '@/types';

const mockShowToast = vi.fn();
const mockAnalyzeMatchWithServerPipeline = vi.fn();
const mockGetParsedAiResult = vi.fn();
const mockLoadAllData = vi.fn().mockResolvedValue(undefined);
const mockAddToWatchlist = vi.fn().mockResolvedValue(true);
const mockUpdateWatchlistItem = vi.fn().mockResolvedValue(true);

const baseMatches: Match[] = [
  {
    match_id: '100',
    date: '2026-03-24',
    kickoff: '19:00',
    kickoff_at_utc: '2026-03-24T10:00:00.000Z',
    league_id: 39,
    league_name: 'Premier League',
    home_team: 'Arsenal',
    away_team: 'Chelsea',
    home_logo: '/home.png',
    away_logo: '/away.png',
    home_score: 1,
    away_score: 0,
    status: '1H',
    current_minute: '41',
  },
];

const watchlist: WatchlistItem[] = [
  {
    id: 7,
    match_id: '100',
    date: '2026-03-24',
    league: 'Premier League',
    league_id: 39,
    league_name: 'Premier League',
    home_team: 'Arsenal',
    away_team: 'Chelsea',
    kickoff: '19:00',
    mode: 'B',
    priority: 2,
    custom_conditions: '',
    status: 'active',
  },
];

const leagues: League[] = [{ league_id: 39, league_name: 'Premier League', top_league: true } as League];

const mockState = {
  matches: baseMatches,
  watchlist,
  config: { apiUrl: 'http://localhost:4000', defaultMode: 'B' },
  leagues,
};

vi.mock('@/hooks/useAppState', () => ({
  useAppState: () => ({
    state: mockState,
    addToWatchlist: mockAddToWatchlist,
    updateWatchlistItem: mockUpdateWatchlistItem,
    loadAllData: mockLoadAllData,
  }),
}));

vi.mock('@/hooks/useToast', () => ({
  useToast: () => ({ showToast: mockShowToast }),
}));

vi.mock('@/hooks/useUiLanguage', () => ({
  useUiLanguage: () => 'vi',
}));

vi.mock('@/features/live-monitor/services/server-monitor.service', () => ({
  analyzeMatchWithServerPipeline: mockAnalyzeMatchWithServerPipeline,
  getParsedAiResult: mockGetParsedAiResult,
}));

vi.mock('@/components/ui/MatchScoutModal', () => ({
  MatchScoutModal: () => null,
}));

beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
    configurable: true,
    value: vi.fn(),
  });
});

let MatchesTab: typeof import('./MatchesTab').MatchesTab;
let shouldAutoRefreshMatch: typeof import('./MatchesTab').shouldAutoRefreshMatch;

beforeEach(async () => {
  vi.clearAllMocks();
  vi.resetModules();
  vi.useRealTimers();
  mockState.matches = baseMatches.map((match) => ({ ...match }));
  mockState.watchlist = watchlist;
  mockState.config = { apiUrl: 'http://localhost:4000', defaultMode: 'B' };
  mockState.leagues = leagues;
  mockAnalyzeMatchWithServerPipeline.mockResolvedValue({
    matchId: '100',
    success: true,
    decisionKind: 'ai_push',
    shouldPush: true,
    selection: 'Over 2.5',
    confidence: 8,
    saved: true,
    notified: false,
    debug: {
      parsed: {
        selection: 'Over 2.5',
        bet_market: 'over_2.5',
        risk_level: 'MEDIUM',
        stake_percent: 4,
        value_percent: 9,
        reasoning_vi: 'Ap luc tang dan',
        warnings: ['EDGE_OK'],
        custom_condition_matched: true,
        condition_triggered_should_push: true,
        condition_triggered_suggestion: 'Under 2.5 Goals @2.00',
      },
    },
  });
  mockGetParsedAiResult.mockImplementation((result) => result.debug?.parsed ?? null);
  ({ MatchesTab, shouldAutoRefreshMatch } = await import('./MatchesTab'));
});

describe('MatchesTab', () => {
  it('uses the server pipeline for Ask AI and renders the returned analysis', async () => {
    const user = userEvent.setup();
    render(<MatchesTab />);

    await user.click(screen.getByTitle('Card view'));
    await user.click(screen.getByRole('button', { name: 'Ask AI' }));

    await waitFor(() => {
      expect(mockAnalyzeMatchWithServerPipeline).toHaveBeenCalledWith(
        expect.objectContaining({ apiUrl: 'http://localhost:4000' }),
        '100',
      );
    });

    expect(await screen.findByText('AI Analysis — Arsenal vs Chelsea')).toBeInTheDocument();
    expect(screen.getByText(/Selection:/)).toBeInTheDocument();
    expect(screen.getByText(/Decision:/)).toBeInTheDocument();
    expect(screen.getByText('AI Push')).toBeInTheDocument();
    expect(screen.getByText('Ap luc tang dan')).toBeInTheDocument();
    expect(screen.getByText(/Condition Matched:/)).toBeInTheDocument();
    expect(screen.getByText(/Condition Triggered:/)).toBeInTheDocument();
    expect(screen.getByText(/Condition Suggestion:/)).toBeInTheDocument();
    expect(mockShowToast).toHaveBeenCalledWith('✅ Arsenal vs Chelsea — done', 'success');
  });

  it('shows the cached result instead of re-calling the server pipeline', async () => {
    const user = userEvent.setup();
    render(<MatchesTab />);

    await user.click(screen.getByTitle('Card view'));
    const askAiButton = screen.getByRole('button', { name: 'Ask AI' });

    await user.click(askAiButton);
    await waitFor(() => expect(mockAnalyzeMatchWithServerPipeline).toHaveBeenCalledTimes(1));

    await user.click(screen.getByRole('button', { name: '✅ View Result' }));

    expect(mockAnalyzeMatchWithServerPipeline).toHaveBeenCalledTimes(1);
    expect(mockShowToast).toHaveBeenCalledWith('📋 Arsenal vs Chelsea — showing cached result', 'info');
  });

  it('passes the subscription id when saving a watched match edit', async () => {
    const user = userEvent.setup();
    render(<MatchesTab />);

    await user.click(screen.getByRole('button', { name: 'Edit watchlist item' }));
    await user.click(await screen.findByRole('button', { name: 'Save Changes' }));

    await waitFor(() => {
      expect(mockUpdateWatchlistItem).toHaveBeenCalledWith(
        expect.objectContaining({ id: 7, match_id: '100' }),
      );
    });
  });

  it('keeps auto-refresh active for live-window matches using kickoff_at_utc after refactor', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-24T10:12:00.000Z'));
    mockState.matches = [
      {
        ...baseMatches[0],
        status: 'NS',
        date: '2026-03-25',
        kickoff: '19:00',
        kickoff_at_utc: '2026-03-24T10:00:00.000Z',
      },
    ];

    render(<MatchesTab />);

    expect(mockLoadAllData).toHaveBeenCalledTimes(1);
    expect(shouldAutoRefreshMatch(mockState.matches[0]!, Date.now())).toBe(true);

    await vi.advanceTimersByTimeAsync(3000);

    expect(mockLoadAllData).toHaveBeenCalledTimes(2);
    expect(mockLoadAllData).toHaveBeenNthCalledWith(1, true);
    expect(mockLoadAllData).toHaveBeenNthCalledWith(2, true);
  });
});