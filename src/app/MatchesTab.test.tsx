import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { League, Match, WatchlistItem } from '@/types';

const mockShowToast = vi.fn();
const mockAnalyzeMatchWithServerPipeline = vi.fn();
const mockGetParsedAiResult = vi.fn();
const mockLoadAllData = vi.fn().mockResolvedValue(undefined);
const mockRefreshMatches = vi.fn().mockResolvedValue(undefined);
const mockAddToWatchlist = vi.fn().mockResolvedValue(true);
const mockUpdateWatchlistItem = vi.fn().mockResolvedValue(true);
const mockFetchFavoriteLeagueSelection = vi.fn();
const mockApplyFavoriteLeaguesToWatchlist = vi.fn().mockResolvedValue({
  error: null,
  limitExceeded: false,
  savedLeagueIds: [39],
  candidateMatches: 1,
  alreadyWatched: 0,
  newMatches: 1,
  added: 1,
  localDate: '2026-03-24',
  userTimeZone: 'Asia/Seoul',
  currentWatchlistCount: 1,
  watchlistActiveLimit: 5,
  favoriteLeagueLimit: 1,
});
const mockFetchCurrentUser = vi.fn().mockResolvedValue({
  userId: 'member-1',
  email: 'member@example.com',
  role: 'member',
  name: 'Member',
  picture: '',
});

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
  {
    match_id: '200',
    date: '2026-03-24',
    kickoff: '21:00',
    kickoff_at_utc: '2026-03-24T12:00:00.000Z',
    league_id: 140,
    league_name: 'La Liga',
    home_team: 'Barcelona',
    away_team: 'Sevilla',
    home_logo: '/barca.png',
    away_logo: '/sevilla.png',
    home_score: 0,
    away_score: 0,
    status: 'NS',
  },
  {
    match_id: '300',
    date: '2026-03-24',
    kickoff: '23:00',
    kickoff_at_utc: '2026-03-24T14:00:00.000Z',
    league_id: 9,
    league_name: 'Friendly League',
    home_team: 'Team A',
    away_team: 'Team B',
    home_logo: '/a.png',
    away_logo: '/b.png',
    home_score: 0,
    away_score: 0,
    status: 'NS',
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

const leagues: League[] = [
  { league_id: 39, league_name: 'Premier League', top_league: true } as League,
  { league_id: 140, league_name: 'La Liga', top_league: true } as League,
  { league_id: 9, league_name: 'Friendly League', top_league: false } as League,
];

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
    refreshMatches: mockRefreshMatches,
  }),
}));

vi.mock('@/lib/matchesAiResultsStorage', () => ({
  loadMatchesAiResultsFromStorage: () => null,
  saveMatchesAiResultsToStorage: vi.fn(),
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

vi.mock('@/lib/services/api', () => ({
  fetchLeagueProfile: vi.fn().mockResolvedValue(null),
  fetchTeamProfile: vi.fn().mockResolvedValue(null),
  fetchFavoriteLeagueSelection: mockFetchFavoriteLeagueSelection,
  applyFavoriteLeaguesToWatchlist: mockApplyFavoriteLeaguesToWatchlist,
}));

vi.mock('@/lib/services/auth', async () => {
  const actual = await vi.importActual<typeof import('@/lib/services/auth')>('@/lib/services/auth');
  return {
    ...actual,
    fetchCurrentUser: mockFetchCurrentUser,
  };
});

beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
    configurable: true,
    value: vi.fn(),
  });
  class ResizeObserverMock {
    observe() {}
    disconnect() {}
    unobserve() {}
  }
  vi.stubGlobal('ResizeObserver', ResizeObserverMock);
});

let MatchesTab: typeof import('./MatchesTab').MatchesTab;
let shouldAutoRefreshMatch: typeof import('./MatchesTab').shouldAutoRefreshMatch;

beforeEach(async () => {
  localStorage.clear();
  vi.clearAllMocks();
  vi.resetModules();
  vi.useRealTimers();
  mockState.matches = baseMatches.map((match) => ({ ...match }));
  mockState.watchlist = watchlist;
  mockState.config = { apiUrl: 'http://localhost:4000', defaultMode: 'B' };
  mockState.leagues = leagues;
  mockRefreshMatches.mockResolvedValue(undefined);
  mockFetchFavoriteLeagueSelection.mockResolvedValue({
    availableLeagues: leagues.filter((league) => league.top_league),
    selectedLeagueIds: [39],
    favoriteLeaguesEnabled: true,
    favoriteLeagueLimit: 1,
    watchlistActiveLimit: 5,
    watchlistActiveCount: 1,
  });
  mockApplyFavoriteLeaguesToWatchlist.mockResolvedValue({
    error: null,
    limitExceeded: false,
    savedLeagueIds: [39],
    candidateMatches: 1,
    alreadyWatched: 0,
    newMatches: 1,
    added: 1,
    localDate: '2026-03-24',
    userTimeZone: 'Asia/Seoul',
    currentWatchlistCount: 1,
    watchlistActiveLimit: 5,
    favoriteLeagueLimit: 1,
  });
  mockFetchCurrentUser.mockResolvedValue({
    userId: 'member-1',
    email: 'member@example.com',
    role: 'member',
    name: 'Member',
    picture: '',
  });
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
      prematchStrength: 'strong',
      promptDataLevel: 'advanced-upgraded',
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
    await user.click(screen.getByRole('button', { name: 'Run AI analysis' }));

    await waitFor(() => {
      expect(mockAnalyzeMatchWithServerPipeline).toHaveBeenCalledWith(
        expect.objectContaining({ apiUrl: 'http://localhost:4000' }),
        '100',
        expect.objectContaining({ history: [] }),
      );
    });

    expect(await screen.findByText(/AI Analysis/i)).toBeInTheDocument();
    expect(screen.getByText('AI Push')).toBeInTheDocument();
    expect(screen.getByText('Over 2.5')).toBeInTheDocument();
    expect(screen.getByText('Ap luc tang dan')).toBeInTheDocument();
    expect(screen.getByText('Strong prematch context')).toBeInTheDocument();
    expect(screen.getByText('Expanded analysis')).toBeInTheDocument();
    expect(screen.getByText('Under 2.5 Goals @2.00')).toBeInTheDocument();
  }, 10000);

  it('shows the cached result instead of re-calling the server pipeline', async () => {
    const user = userEvent.setup();
    render(<MatchesTab />);

    await user.click(screen.getByTitle('Card view'));
    const askAiButton = screen.getByRole('button', { name: 'Run AI analysis' });

    await user.click(askAiButton);
    await waitFor(() => expect(mockAnalyzeMatchWithServerPipeline).toHaveBeenCalledTimes(1));

    await user.click(screen.getByRole('button', { name: 'View AI result' }));

    expect(mockAnalyzeMatchWithServerPipeline).toHaveBeenCalledTimes(1);
  });

  it('sends a match-scoped follow-up question and renders the grounded reply', async () => {
    const user = userEvent.setup();
    mockAnalyzeMatchWithServerPipeline
      .mockResolvedValueOnce({
        matchId: '100',
        success: true,
        decisionKind: 'ai_push',
        shouldPush: true,
        selection: 'Over 2.5',
        confidence: 8,
        saved: true,
        notified: false,
        debug: {
          prematchStrength: 'strong',
          promptDataLevel: 'advanced-upgraded',
          parsed: {
            selection: 'Over 2.5',
            bet_market: 'over_2.5',
            risk_level: 'MEDIUM',
            stake_percent: 4,
            value_percent: 9,
            reasoning_vi: 'Ap luc tang dan',
            warnings: ['EDGE_OK'],
            custom_condition_matched: false,
          },
        },
      })
      .mockResolvedValueOnce({
        matchId: '100',
        success: true,
        decisionKind: 'no_bet',
        shouldPush: false,
        selection: '',
        confidence: 0,
        saved: false,
        notified: false,
        debug: {
          advisoryOnly: true,
          prematchStrength: 'strong',
          promptDataLevel: 'advanced-upgraded',
          parsed: {
            selection: '',
            bet_market: '',
            risk_level: 'LOW',
            stake_percent: 0,
            value_percent: 0,
            reasoning_vi: 'Theo doi them.',
            warnings: ['ADVISORY_ONLY'],
            custom_condition_matched: false,
            follow_up_answer_vi: 'Keo Home -0.25 van co the can nhac, nhung chua tot hon over hien tai.',
            follow_up_answer_en: 'Home -0.25 is still only a secondary lean here.',
          },
        },
      });

    render(<MatchesTab />);

    await user.click(screen.getByTitle('Card view'));
    await user.click(screen.getByRole('button', { name: 'Run AI analysis' }));
    expect(await screen.findByText(/AI Analysis/i)).toBeInTheDocument();

    await user.type(screen.getByLabelText('Follow-up question for this match'), 'What about Home -0.25 here?');
    await user.keyboard('{Enter}');

    await waitFor(() => {
      expect(mockAnalyzeMatchWithServerPipeline).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({ apiUrl: 'http://localhost:4000' }),
        '100',
        {
          question: 'What about Home -0.25 here?',
          history: [],
        },
      );
    });

    expect(screen.getByText('What about Home -0.25 here?')).toBeInTheDocument();
    expect(screen.getByLabelText('AI')).toBeInTheDocument();
    expect(screen.getByText('Keo Home -0.25 van co the can nhac, nhung chua tot hon over hien tai.')).toBeInTheDocument();
    expect(screen.getByText('Advisory follow-up')).toBeInTheDocument();
  });

  it('passes the subscription id when saving a watched match edit', async () => {
    const user = userEvent.setup();
    render(<MatchesTab />);

    await user.click(screen.getByTitle('Table view'));
    await user.click(screen.getByRole('button', { name: 'Edit watchlist item' }));
    await user.click(await screen.findByRole('button', { name: 'Save Changes' }));

    await waitFor(() => {
      expect(mockUpdateWatchlistItem).toHaveBeenCalledWith(
        expect.objectContaining({ id: 7, match_id: '100' }),
      );
    });
  });

  it('passes auto-apply override when saving a watched match edit', async () => {
    const user = userEvent.setup();
    mockState.watchlist = [{
      ...watchlist[0]!,
      auto_apply_recommended_condition: true,
      custom_conditions: '(Minute >= 55) AND (Total goals <= 1)',
      recommended_custom_condition: '(Minute >= 60) AND (NOT Home leading)',
    }];

    render(<MatchesTab />);

    await user.click(screen.getByTitle('Table view'));
    await user.click(screen.getByRole('button', { name: 'Edit watchlist item' }));
    await user.click(await screen.findByLabelText('Auto-apply recommended condition for this match'));
    await user.click(screen.getByRole('button', { name: 'Save Changes' }));

    await waitFor(() => {
      expect(mockUpdateWatchlistItem).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 7,
          match_id: '100',
          auto_apply_recommended_condition: false,
        }),
      );
    });
  });

  it('keeps auto-refresh active for live-window matches using kickoff_at_utc after refactor', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-24T10:12:00.000Z'));
    mockState.matches = [
      {
        match_id: '100',
        league_id: 39,
        league_name: 'Premier League',
        home_team: 'Arsenal',
        away_team: 'Chelsea',
        home_logo: '/home.png',
        away_logo: '/away.png',
        home_score: 0,
        away_score: 0,
        current_minute: undefined,
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

    expect(mockLoadAllData).toHaveBeenCalledTimes(1);
    expect(mockLoadAllData).toHaveBeenNthCalledWith(1, true);
    expect(mockRefreshMatches).toHaveBeenCalledTimes(1);
  });

  it('loads favorite leagues from the backend snapshot', async () => {
    render(<MatchesTab />);

    expect(await screen.findByRole('option', { name: 'Favorite Leagues' })).toBeInTheDocument();
    expect(screen.getAllByText('Premier League').length).toBeGreaterThan(0);
  });

  it('saves favorite leagues and applies today matches into watchlist', async () => {
    const user = userEvent.setup();
    const { container } = render(<MatchesTab />);

    await user.click(await screen.findByRole('button', { name: /Watchlist by Favorite Leagues/i }));
    expect(screen.getByText(/Up to 1 allowed/i)).toBeInTheDocument();

    await user.click(screen.getByLabelText('La Liga'));
    expect(mockShowToast).toHaveBeenCalledWith(expect.stringContaining('allows up to 1 favorite leagues'), 'info');
    await user.click(screen.getByLabelText('Premier League'));
    const modal = await waitFor(() => container.querySelector('.modal-overlay .modal'));
    expect(modal).toBeTruthy();
    await user.click(within(modal as HTMLElement).getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(mockApplyFavoriteLeaguesToWatchlist).toHaveBeenCalledWith(
        expect.objectContaining({ apiUrl: 'http://localhost:4000' }),
        [],
      );
    });
    expect(mockLoadAllData).toHaveBeenCalledTimes(2);
  });

  it('allows admin users to choose beyond the member favorite league cap in the UI', async () => {
    const user = userEvent.setup();
    mockFetchCurrentUser.mockResolvedValueOnce({
      userId: 'admin-1',
      email: 'admin@example.com',
      role: 'admin',
      name: 'Admin',
      picture: '',
    });
    const { container } = render(<MatchesTab />);

    await user.click(await screen.findByRole('button', { name: /Watchlist by Favorite Leagues/i }));
    await user.click(screen.getByLabelText('La Liga'));
    const modal = await waitFor(() => container.querySelector('.modal-overlay .modal'));
    expect(modal).toBeTruthy();
    await user.click(within(modal as HTMLElement).getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(mockApplyFavoriteLeaguesToWatchlist).toHaveBeenCalledWith(
        expect.objectContaining({ apiUrl: 'http://localhost:4000' }),
        [39, 140],
      );
    });
  });
});

