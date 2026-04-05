import { render, screen, waitFor } from '@testing-library/react';
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
const mockFetchMonitorConfig = vi.fn();
const mockPersistMonitorConfig = vi.fn().mockResolvedValue(undefined);
const mockFetchCurrentSubscription = vi.fn();

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

vi.mock('@/features/live-monitor/config', () => ({
  fetchMonitorConfig: mockFetchMonitorConfig,
  persistMonitorConfig: mockPersistMonitorConfig,
}));

vi.mock('@/components/ui/MatchScoutModal', () => ({
  MatchScoutModal: () => null,
}));

vi.mock('@/lib/services/api', () => ({
  fetchLeagueProfile: vi.fn().mockResolvedValue(null),
  fetchTeamProfile: vi.fn().mockResolvedValue(null),
  fetchCurrentSubscription: mockFetchCurrentSubscription,
}));

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
  vi.clearAllMocks();
  vi.resetModules();
  vi.useRealTimers();
  mockState.matches = baseMatches.map((match) => ({ ...match }));
  mockState.watchlist = watchlist;
  mockState.config = { apiUrl: 'http://localhost:4000', defaultMode: 'B' };
  mockState.leagues = leagues;
  mockRefreshMatches.mockResolvedValue(undefined);
  mockFetchMonitorConfig.mockResolvedValue({
    UI_LANGUAGE: 'vi',
    NOTIFICATION_LANGUAGE: 'vi',
    SUGGESTED_TOP_LEAGUE_IDS: [39],
  });
  mockPersistMonitorConfig.mockResolvedValue(undefined);
  mockFetchCurrentSubscription.mockResolvedValue({
    plan: { plan_code: 'free', display_name: 'Free' },
    subscription: null,
    effectiveStatus: 'free_fallback',
    entitlements: {
      'watchlist.active_matches.limit': 5,
      'watchlist.suggested_top_leagues.enabled': true,
      'watchlist.suggested_top_leagues.limit': 1,
    },
    usage: { manualAiDaily: { entitlementKey: 'ai.manual.ask.daily_limit', periodKey: '2026-03-24', limit: 3, used: 0 } },
    catalog: [],
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
    await user.click(screen.getByRole('button', { name: 'Ask AI for analysis' }));

    await waitFor(() => {
      expect(mockAnalyzeMatchWithServerPipeline).toHaveBeenCalledWith(
        expect.objectContaining({ apiUrl: 'http://localhost:4000' }),
        '100',
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
    const askAiButton = screen.getByRole('button', { name: 'Ask AI for analysis' });

    await user.click(askAiButton);
    await waitFor(() => expect(mockAnalyzeMatchWithServerPipeline).toHaveBeenCalledTimes(1));

    await user.click(screen.getByRole('button', { name: 'View AI result' }));

    expect(mockAnalyzeMatchWithServerPipeline).toHaveBeenCalledTimes(1);
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

  it('loads suggested top leagues from DB-backed user settings and filters to them on demand', async () => {
    const user = userEvent.setup();
    render(<MatchesTab />);

    expect(await screen.findByText('Suggested Top Leagues')).toBeInTheDocument();
    expect(screen.getAllByText('Premier League (1)').length).toBeGreaterThan(0);

    await user.click(screen.getByRole('button', { name: 'Show Suggested' }));

    expect(screen.getByText('Arsenal')).toBeInTheDocument();
    expect(screen.queryByText('Barcelona')).not.toBeInTheDocument();
    expect(screen.queryByText('Team A')).not.toBeInTheDocument();
  });

  it('persists customized suggested top leagues and respects the plan cap', async () => {
    const user = userEvent.setup();
    render(<MatchesTab />);

    await user.click(await screen.findByRole('button', { name: 'Customize' }));
    expect(screen.getByText(/allows up to 1/i)).toBeInTheDocument();

    await user.click(screen.getByLabelText('La Liga'));
    expect(mockShowToast).toHaveBeenCalledWith(expect.stringContaining('allows up to 1 suggested top leagues'), 'info');
    await user.click(screen.getByLabelText('Premier League'));
    await user.click(screen.getByLabelText('La Liga'));

    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(mockPersistMonitorConfig).toHaveBeenCalledWith({ SUGGESTED_TOP_LEAGUE_IDS: [] });
    });
    expect(screen.getAllByText('La Liga (1)').length).toBeGreaterThan(0);
  });
});

