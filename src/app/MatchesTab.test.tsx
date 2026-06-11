import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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
const mockFetchMatchAlertRules = vi.fn().mockResolvedValue([]);
const mockCreateMatchAlertRule = vi.fn().mockResolvedValue({ id: 77, matchId: '200', alertKind: 'match_start', enabled: true, source: 'manual' });
const mockDeleteMatchAlertRule = vi.fn().mockResolvedValue({ deleted: true });
const mockFetchConditionAlertPresets = vi.fn().mockResolvedValue([]);
const mockLookupMatchLiveStreams = vi.fn().mockResolvedValue([]);
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
    custom_conditions: '',
  },
];

const leagues: League[] = [
  { league_id: 39, league_name: 'Premier League', country: 'England', top_league: true } as League,
  { league_id: 140, league_name: 'La Liga', country: 'Spain', top_league: true } as League,
  { league_id: 9, league_name: 'Friendly League', country: 'World', top_league: false } as League,
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

vi.mock('@/lib/services/notification-channels', () => ({
  fetchNotificationChannels: vi.fn().mockResolvedValue([]),
}));

vi.mock('@/features/live-monitor/services/server-monitor.service', () => ({
  analyzeMatchWithServerPipeline: mockAnalyzeMatchWithServerPipeline,
  getParsedAiResult: mockGetParsedAiResult,
}));

vi.mock('@/components/ui/MatchHubModal', () => ({
  MatchHubModal: () => null,
}));

vi.mock('@/lib/services/api', () => ({
  fetchLeagueProfile: vi.fn().mockResolvedValue(null),
  fetchTeamProfile: vi.fn().mockResolvedValue(null),
  fetchFavoriteLeagueSelection: mockFetchFavoriteLeagueSelection,
  fetchMatchAlertRules: mockFetchMatchAlertRules,
  createMatchAlertRule: mockCreateMatchAlertRule,
  deleteMatchAlertRule: mockDeleteMatchAlertRule,
  fetchConditionAlertPresets: mockFetchConditionAlertPresets,
  lookupMatchLiveStreams: mockLookupMatchLiveStreams,
  applyFavoriteLeaguesToWatchlist: mockApplyFavoriteLeaguesToWatchlist,
  evaluateWatchConditionPreview: vi.fn().mockResolvedValue({
    supported: true,
    matched: true,
    summary: 'ok',
    notify_enabled: true,
    context_summary: { minute: 1, home_goals: 0, away_goals: 0, data_source: 'match_fixture' },
  }),
}));

vi.mock('@/lib/services/auth', async () => {
  const actual = await vi.importActual<typeof import('@/lib/services/auth')>('@/lib/services/auth');
  return {
    ...actual,
    fetchCurrentUser: mockFetchCurrentUser,
  };
});

beforeAll(() => {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
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
let shouldShowKickoffAlertAction: typeof import('./MatchesTab').shouldShowKickoffAlertAction;

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
  mockFetchMatchAlertRules.mockResolvedValue([]);
  mockFetchConditionAlertPresets.mockResolvedValue([]);
  mockLookupMatchLiveStreams.mockResolvedValue([]);
  mockCreateMatchAlertRule.mockResolvedValue({ id: 77, matchId: '200', alertKind: 'match_start', enabled: true, source: 'manual' });
  mockDeleteMatchAlertRule.mockResolvedValue({ deleted: true });
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
  ({ MatchesTab, shouldAutoRefreshMatch, shouldShowKickoffAlertAction } = await import('./MatchesTab'));
});

describe('MatchesTab', () => {
  it('shows kickoff alert action only before a match starts', async () => {
    const user = userEvent.setup();
    mockState.matches = [baseMatches[0]!, baseMatches[1]!].map((match) => ({ ...match }));
    mockState.watchlist = [];

    render(<MatchesTab />);

    await user.click(screen.getByTitle('Table view'));

    expect(screen.getByText('Arsenal')).toBeInTheDocument();
    expect(screen.getByText('Barcelona')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Enable kickoff alert' })).toHaveLength(1);

    await user.click(screen.getByRole('button', { name: 'Enable kickoff alert' }));

    await waitFor(() => {
      expect(mockCreateMatchAlertRule).toHaveBeenCalledWith(
        expect.objectContaining({ apiUrl: 'http://localhost:4000' }),
        expect.objectContaining({ matchId: '200', alertKind: 'match_start' }),
      );
    });
  }, 15_000);

  it('classifies kickoff alert visibility from match status and kickoff time', () => {
    expect(shouldShowKickoffAlertAction(baseMatches[1]!)).toBe(true);
    expect(shouldShowKickoffAlertAction(baseMatches[0]!)).toBe(false);
    expect(shouldShowKickoffAlertAction({ ...baseMatches[1]!, status: 'FT' })).toBe(false);
  });

  it('does not infer extra time from long stoppage time alone', async () => {
    const user = userEvent.setup();
    mockState.matches = [
      {
        ...baseMatches[0]!,
        status: '2H',
        current_minute: '102',
        home_score: 0,
        away_score: 0,
        halftime_home: 0,
        halftime_away: 0,
      },
    ];
    mockState.watchlist = [];

    render(<MatchesTab />);

    await user.click(screen.getByTitle('Table view'));

    expect(screen.getByText("102'")).toBeInTheDocument();
    expect(screen.queryByText("ET 102'")).not.toBeInTheDocument();
  });

  it('labels extra time when provider status is ET', async () => {
    const user = userEvent.setup();
    mockState.matches = [
      {
        ...baseMatches[0]!,
        status: 'ET',
        current_minute: '102',
        home_score: 0,
        away_score: 0,
        halftime_home: 0,
        halftime_away: 0,
      },
    ];
    mockState.watchlist = [];

    render(<MatchesTab />);

    await user.click(screen.getByTitle('Table view'));

    expect(screen.getByText("ET 102'")).toBeInTheDocument();
    expect(screen.getByTitle('Extra Time')).toBeInTheDocument();
  });

  it('labels active penalty shootouts when provider status is P', async () => {
    const user = userEvent.setup();
    mockState.matches = [{ ...baseMatches[0]!, status: 'P', current_minute: '120' }];
    mockState.watchlist = [];

    render(<MatchesTab />);

    await user.click(screen.getByTitle('Table view'));

    expect(screen.getAllByText('PEN').length).toBeGreaterThan(0);
    expect(screen.getByTitle('Penalty shootout')).toBeInTheDocument();
  });

  it('uses the server pipeline for match analysis and renders the returned analysis', async () => {
    const user = userEvent.setup();
    render(<MatchesTab />);

    await user.click(screen.getByTitle('Card view'));
    await user.click(screen.getByRole('button', { name: 'Run match analysis' }));

    await waitFor(() => {
      expect(mockAnalyzeMatchWithServerPipeline).toHaveBeenCalledWith(
        expect.objectContaining({ apiUrl: 'http://localhost:4000' }),
        '100',
        expect.objectContaining({ history: [] }),
      );
    });

    expect(await screen.findByText(/Match analysis/i)).toBeInTheDocument();
    expect(screen.getByText('Signal')).toBeInTheDocument();
    expect(screen.getByText(/Over 2\.5/)).toBeInTheDocument();
    expect(screen.getByText('Ap luc tang dan')).toBeInTheDocument();
    expect(screen.getByText('Under 2.5 Goals @2.00')).toBeInTheDocument();
  }, 10000);

  it('shows numbered live controls beside the match when stream links are found', async () => {
    const user = userEvent.setup();
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);
    mockState.matches = [baseMatches[0]!].map((match) => ({ ...match }));
    mockState.watchlist = [];
    mockLookupMatchLiveStreams.mockResolvedValueOnce([
      {
        matchId: '100',
        found: true,
        status: 'found',
        url: 'https://xoilacztu.tv/arsenal-chelsea',
        sourceName: 'xoilacztu.tv',
        sourceUrl: 'https://xoilacztu.tv/',
        title: 'Arsenal vs Chelsea',
        links: [
          {
            url: 'https://xoilacztu.tv/arsenal-chelsea',
            sourceName: 'xoilacztu.tv',
            sourceUrl: 'https://xoilacztu.tv/',
            title: 'Arsenal vs Chelsea',
            verificationStatus: 'team_match',
            liveHint: true,
          },
          {
            url: 'https://socolive16.cv/arsenal-chelsea',
            sourceName: 'socolive16.cv',
            sourceUrl: 'https://socolive16.cv/',
            title: 'Arsenal vs Chelsea',
            verificationStatus: 'reachable',
            liveHint: true,
          },
        ],
        checkedAt: '2026-03-24T10:05:00.000Z',
      },
    ]);

    render(<MatchesTab />);
    await user.click(screen.getByTitle('Table view'));

    expect(screen.queryByLabelText('Checking live stream availability')).not.toBeInTheDocument();

    const liveStreamButtons = await screen.findAllByRole('button', { name: /^Live \d+/ });
    expect(liveStreamButtons).toHaveLength(2);
    expect(liveStreamButtons[0]).toHaveAttribute('title', 'Live 1 · xoilacztu.tv');
    expect(liveStreamButtons[1]).toHaveAttribute('title', 'Live 2 · socolive16.cv');
    expect(liveStreamButtons[0]!.closest('[data-label="Match"]')).toBeTruthy();
    expect(liveStreamButtons[0]!.closest('[data-label="Action"]')).toBeNull();

    await user.click(liveStreamButtons[0]!);
    await user.click(liveStreamButtons[1]!);

    expect(mockLookupMatchLiveStreams).toHaveBeenCalledWith(
      expect.objectContaining({ apiUrl: 'http://localhost:4000' }),
      ['100'],
    );
    expect(openSpy).toHaveBeenCalledWith('https://xoilacztu.tv/arsenal-chelsea', '_blank', 'noopener,noreferrer');
    expect(openSpy).toHaveBeenCalledWith('https://socolive16.cv/arsenal-chelsea', '_blank', 'noopener,noreferrer');
    openSpy.mockRestore();
  });

  it('shows the cached result instead of re-calling the server pipeline', async () => {
    const user = userEvent.setup();
    render(<MatchesTab />);

    await user.click(screen.getByTitle('Card view'));
    const askAiButton = screen.getByRole('button', { name: 'Run match analysis' });

    await user.click(askAiButton);
    await waitFor(() => expect(mockAnalyzeMatchWithServerPipeline).toHaveBeenCalledTimes(1));

    await user.click(screen.getByRole('button', { name: 'View analysis result' }));

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
    await user.click(screen.getByRole('button', { name: 'Run match analysis' }));
    expect(await screen.findByText(/Match analysis/i)).toBeInTheDocument();

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
          advisoryOnly: true,
        },
      );
    });

    expect(screen.getByText('What about Home -0.25 here?')).toBeInTheDocument();
    expect(screen.getByLabelText('Assistant reply')).toBeInTheDocument();
    expect(screen.getByText('Keo Home -0.25 van co the can nhac, nhung chua tot hon over hien tai.')).toBeInTheDocument();
  }, 10000);

  it('passes the subscription id when saving a watched match edit', async () => {
    const user = userEvent.setup();
    render(<MatchesTab />);

    await user.click(screen.getByTitle('Table view'));
    await user.click(screen.getByRole('button', { name: 'Watch alerts and conditions' }));
    await user.click(await screen.findByRole('button', { name: 'Save changes' }));

    await waitFor(() => {
      expect(mockUpdateWatchlistItem).toHaveBeenCalledWith(
        expect.objectContaining({ id: 7, match_id: '100' }),
      );
    });
  });

  it('creates a free-text condition alert rule when saving manual conditions', async () => {
    const user = userEvent.setup();
    render(<MatchesTab />);

    await user.click(screen.getByTitle('Table view'));
    await user.click(screen.getByRole('button', { name: 'Watch alerts and conditions' }));
    fireEvent.change(await screen.findByPlaceholderText('Minute >= 60'), {
      target: { value: 'Neu 2 doi ko co ban thang sau phut 70' },
    });
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() => {
      expect(mockCreateMatchAlertRule).toHaveBeenCalledWith(
        expect.objectContaining({ apiUrl: 'http://localhost:4000' }),
        expect.objectContaining({
          matchId: '100',
          alertKind: 'condition_signal',
          source: 'manual:free_text',
          conditionText: '(Neu 2 doi ko co ban thang sau phut 70)',
        }),
      );
    });
  });

  it('uses configured preset defaults when saving condition preset alerts', async () => {
    const user = userEvent.setup();
    mockFetchConditionAlertPresets.mockResolvedValue([
      {
        id: 'red_card',
        label: 'Red card',
        labelVi: 'Red card',
        description: 'Major state change.',
        category: 'big_event',
        enabled: true,
        defaultCooldownMinutes: 0,
        defaultOncePerMatch: false,
        sortOrder: 10,
        ruleJson: { id: 'red_card', all: [{ field: 'events.red_card.side', op: 'exists' }] },
        source: 'system',
      },
    ]);
    render(<MatchesTab />);

    await user.click(screen.getByTitle('Table view'));
    await user.click(screen.getByRole('button', { name: 'Watch alerts and conditions' }));
    expect(await screen.findByText('Red card')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() => {
      expect(mockCreateMatchAlertRule).toHaveBeenCalledWith(
        expect.objectContaining({ apiUrl: 'http://localhost:4000' }),
        expect.objectContaining({
          matchId: '100',
          alertKind: 'condition_signal',
          source: 'preset:red_card',
          presetId: 'red_card',
          cooldownMinutes: 0,
          oncePerMatch: false,
        }),
      );
    });
  });

  it('removes condition preset alert rules when watch push is disabled', async () => {
    const user = userEvent.setup();
    mockFetchConditionAlertPresets.mockResolvedValue([
      {
        id: 'red_card',
        label: 'Red card',
        labelVi: 'Red card',
        description: 'Major state change.',
        category: 'big_event',
        enabled: true,
        defaultCooldownMinutes: 0,
        defaultOncePerMatch: false,
        sortOrder: 10,
        ruleJson: { id: 'red_card', all: [{ field: 'events.red_card.side', op: 'exists' }] },
        source: 'system',
      },
    ]);
    mockFetchMatchAlertRules.mockImplementation((_config, options) => {
      if (options?.alertKind === 'condition_signal') {
        return Promise.resolve([
          {
            id: 88,
            userId: 'member-1',
            matchId: '100',
            alertKind: 'condition_signal',
            enabled: true,
            source: 'preset:red_card',
            sourceRef: {},
            ruleJson: { id: 'red_card' },
            cooldownMinutes: 0,
            oncePerMatch: false,
            channelPolicy: {},
            metadata: {},
          },
        ]);
      }
      return Promise.resolve([]);
    });
    render(<MatchesTab />);

    await user.click(screen.getByTitle('Table view'));
    await user.click(screen.getByRole('button', { name: 'Watch alerts and conditions' }));
    await user.click(await screen.findByRole('checkbox', { name: 'Push when condition matches' }));
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() => {
      expect(mockDeleteMatchAlertRule).toHaveBeenCalledWith(
        expect.objectContaining({ apiUrl: 'http://localhost:4000' }),
        88,
      );
    });
    expect(mockCreateMatchAlertRule).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ alertKind: 'condition_signal' }),
    );
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
    await user.click(screen.getByRole('button', { name: 'Watch alerts and conditions' }));
    const saveBtn = await screen.findByRole('button', { name: 'Save changes' });
    await user.click(screen.getByRole('checkbox', { name: /Use system suggestion when saving/i }));
    await user.click(saveBtn);

    await waitFor(() => {
      expect(mockUpdateWatchlistItem).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 7,
          match_id: '100',
          auto_apply_recommended_condition: false,
        }),
      );
    });
  }, 10000);

  it('keeps auto-refresh active for live-window matches using kickoff_at_utc after refactor', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-24T10:12:00.000Z'));
    const now = new Date('2026-03-24T10:12:00.000Z').getTime();
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
    expect(shouldAutoRefreshMatch(mockState.matches[0]!, now)).toBe(true);

    await vi.advanceTimersByTimeAsync(2000);

    expect(mockLoadAllData).toHaveBeenCalledTimes(1);
    expect(mockLoadAllData).toHaveBeenNthCalledWith(1, true);
    expect(mockRefreshMatches).toHaveBeenCalledTimes(1);
  });

  it('loads favorite leagues from the backend snapshot', async () => {
    render(<MatchesTab />);

    expect(await screen.findByRole('option', { name: 'Favorite Leagues' })).toBeInTheDocument();
    expect(screen.getAllByText(/Premier League/).length).toBeGreaterThan(0);
  });

  it('keeps active leagues selectable even before their matches are fetched', async () => {
    mockState.leagues = [
      ...leagues,
      {
        league_id: 999,
        league_name: 'Newly Active League',
        country: 'World',
        active: true,
        top_league: false,
        sort_order: 999,
      } as League,
    ];

    render(<MatchesTab />);

    expect(await screen.findByRole('option', { name: 'WORLD - Newly Active League (0)' })).toBeInTheDocument();
  });

  it('saves favorite leagues and applies eligible matches into watchlist', async () => {
    const user = userEvent.setup();
    const { container } = render(<MatchesTab />);

    await user.click(await screen.findByRole('button', { name: /Watchlist by Favorite Leagues/i }));
    expect(screen.getByText(/across all dates, not just the filter on this tab/i)).toBeInTheDocument();
    expect(screen.getByText(/Up to 1 allowed/i)).toBeInTheDocument();

    const modal = await waitFor(() => container.querySelector('.modal-overlay .modal'));
    expect(modal).toBeTruthy();
    const modalScope = within(modal as HTMLElement);
    expect(modalScope.getByText(/already in your watchlist/i)).toBeInTheDocument();

    const saveButton = modalScope.getByRole('button', { name: 'Save' });
    expect(saveButton).toBeDisabled();

    await user.click(modalScope.getByRole('checkbox', { name: 'La Liga' }));
    expect(mockShowToast).toHaveBeenCalledWith(expect.stringContaining('allows up to 1 favorite leagues'), 'info');
    await user.click(modalScope.getByRole('checkbox', { name: 'Premier League' }));
    expect(saveButton).not.toBeDisabled();
    await user.click(saveButton);

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
    const modal = await waitFor(() => container.querySelector('.modal-overlay .modal'));
    expect(modal).toBeTruthy();
    const modalScope = within(modal as HTMLElement);
    await user.click(modalScope.getByRole('checkbox', { name: 'La Liga' }));
    expect(modalScope.getByText(/new match will be added/i)).toBeInTheDocument();
    await user.click(modalScope.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(mockApplyFavoriteLeaguesToWatchlist).toHaveBeenCalledWith(
        expect.objectContaining({ apiUrl: 'http://localhost:4000' }),
        [39, 140],
      );
    });
  });
});
