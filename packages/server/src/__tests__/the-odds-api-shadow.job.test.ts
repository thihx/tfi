import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { MatchRow } from '../repos/matches.repo.js';
import type { LeagueRow } from '../repos/leagues.repo.js';

const mockConfig = vi.hoisted(() => ({
  theOddsApiEnabled: true,
  theOddsApiToken: 'test-token',
  theOddsApiDefaultSoccerSportKey: 'soccer_fifa_world_cup',
  theOddsApiRegions: 'eu,uk,us',
  theOddsApiMarkets: 'h2h,totals',
  theOddsApiBookmakers: '',
  theOddsApiTimeoutMs: 10_000,
  theOddsApiShadowMaxMatchesPerRun: 3,
  theOddsApiShadowMaxCallsPerRun: 6,
  theOddsApiShadowWindowHours: 24,
  liveStatuses: ['1H', 'HT', '2H', 'LIVE'],
  timezone: 'Asia/Seoul',
  providerSamplingEnabled: true,
}));

vi.mock('../config.js', () => ({ config: mockConfig }));

vi.mock('../repos/watchlist.repo.js', () => ({
  getActiveOperationalWatchlist: vi.fn(),
  getKickoffMinutesForMatchIds: vi.fn(),
}));

vi.mock('../repos/matches.repo.js', () => ({
  getAllMatches: vi.fn(),
}));

vi.mock('../repos/leagues.repo.js', () => ({
  getAllLeagues: vi.fn(),
}));

vi.mock('../repos/favorite-teams.repo.js', () => ({
  getFavoriteTeamIds: vi.fn(),
}));

vi.mock('../repos/provider-fixture-mappings.repo.js', () => ({
  getProviderFixtureMapping: vi.fn(),
  upsertProviderFixtureMapping: vi.fn(),
}));

vi.mock('../repos/provider-fixture-samples.repo.js', () => ({
  createProviderFixtureSample: vi.fn(),
}));

vi.mock('../lib/provider-sampling.js', () => ({
  recordProviderOddsSampleSafe: vi.fn(),
}));

vi.mock('../lib/the-odds-api.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/the-odds-api.js')>();
  return {
    ...actual,
    fetchTheOddsApiOdds: vi.fn(),
  };
});

vi.mock('../jobs/job-progress.js', () => ({
  reportJobProgress: vi.fn(),
}));

const { theOddsApiShadowJob } = await import('../jobs/the-odds-api-shadow.job.js');
const watchlistRepo = await import('../repos/watchlist.repo.js');
const matchesRepo = await import('../repos/matches.repo.js');
const leaguesRepo = await import('../repos/leagues.repo.js');
const favoriteTeamsRepo = await import('../repos/favorite-teams.repo.js');
const mappingRepo = await import('../repos/provider-fixture-mappings.repo.js');
const fixtureSamplesRepo = await import('../repos/provider-fixture-samples.repo.js');
const providerSampling = await import('../lib/provider-sampling.js');
const theOddsApi = await import('../lib/the-odds-api.js');

function match(overrides: Partial<MatchRow> = {}): MatchRow {
  return {
    match_id: '100',
    date: '2026-06-14',
    kickoff: '16:00',
    kickoff_at_utc: '2026-06-14T16:00:00.000Z',
    league_id: 1,
    league_name: 'World Cup',
    home_team: 'Germany',
    away_team: 'Curacao',
    home_logo: '',
    away_logo: '',
    venue: 'NRG Stadium',
    status: '1H',
    home_score: 0,
    away_score: 0,
    current_minute: 12,
    last_updated: '2026-06-14T16:05:00.000Z',
    home_team_id: 10,
    away_team_id: 20,
    ...overrides,
  };
}

function league(overrides: Partial<LeagueRow> = {}): LeagueRow {
  return {
    league_id: 1,
    league_name: 'World Cup',
    display_name: null,
    country: 'World',
    tier: 'international',
    active: true,
    top_league: true,
    type: 'cup',
    logo: '',
    last_updated: '2026-06-14T00:00:00.000Z',
    sort_order: 1,
    ...overrides,
  };
}

function watch(matchId: string) {
  return {
    id: Number(matchId),
    match_id: matchId,
    date: '2026-06-14',
    league: 'World Cup',
    home_team: 'Germany',
    away_team: 'Curacao',
    home_logo: '',
    away_logo: '',
    kickoff: '16:00',
    recommended_custom_condition: '',
    recommended_condition_reason: '',
    recommended_condition_reason_vi: '',
    recommended_condition_at: null,
    custom_conditions: '',
    added_at: '2026-06-14T00:00:00.000Z',
    added_by: 'user',
    last_checked: null,
    total_checks: 0,
    recommendations_count: 0,
    strategic_context: null,
    strategic_context_at: null,
  };
}

function theOddsEvent(overrides: Record<string, unknown> = {}) {
  return {
    id: 'odds-100',
    sport_key: 'soccer_fifa_world_cup',
    sport_title: 'World Cup',
    commence_time: '2026-06-14T16:00:00.000Z',
    home_team: 'Germany',
    away_team: 'Curacao',
    bookmakers: [
      {
        key: 'pinnacle',
        title: 'Pinnacle',
        markets: [
          {
            key: 'h2h',
            outcomes: [
              { name: 'Germany', price: 1.4 },
              { name: 'Draw', price: 4.2 },
              { name: 'Curacao', price: 8.5 },
            ],
          },
        ],
      },
    ],
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-06-14T16:12:00.000Z'));
  mockConfig.theOddsApiEnabled = true;
  mockConfig.theOddsApiToken = 'test-token';
  mockConfig.theOddsApiShadowMaxMatchesPerRun = 3;
  mockConfig.theOddsApiShadowMaxCallsPerRun = 6;
  mockConfig.theOddsApiShadowWindowHours = 24;

  vi.mocked(watchlistRepo.getActiveOperationalWatchlist).mockResolvedValue([watch('100')] as never);
  vi.mocked(matchesRepo.getAllMatches).mockResolvedValue([match()] as never);
  vi.mocked(leaguesRepo.getAllLeagues).mockResolvedValue([league()] as never);
  vi.mocked(favoriteTeamsRepo.getFavoriteTeamIds).mockResolvedValue(new Set<string>() as never);
  vi.mocked(watchlistRepo.getKickoffMinutesForMatchIds).mockResolvedValue(new Map([['100', -12]]) as never);
  vi.mocked(mappingRepo.getProviderFixtureMapping).mockResolvedValue(null);
  vi.mocked(mappingRepo.upsertProviderFixtureMapping).mockResolvedValue({
    id: '1',
    match_id: '100',
    provider: 'the-odds-api',
    provider_fixture_id: 'odds-100',
    confidence: 'high',
    mapping_method: 'date_team_match',
    evidence: {},
    first_seen_at: '2026-06-14T16:12:00.000Z',
    last_seen_at: '2026-06-14T16:12:00.000Z',
  });
  vi.mocked(theOddsApi.fetchTheOddsApiOdds).mockResolvedValue({
    data: [theOddsEvent()],
    raw: [theOddsEvent()],
    statusCode: 200,
    latencyMs: 42,
    quota: {
      requestsRemaining: 99,
      requestsUsed: 1,
      requestsLast: 1,
    },
  });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('theOddsApiShadowJob', () => {
  test('skips without provider enablement or token', async () => {
    mockConfig.theOddsApiEnabled = false;

    const result = await theOddsApiShadowJob();

    expect(result.skipped).toBe(true);
    expect(result.skipReason).toBe('the_odds_api_disabled_or_token_missing');
    expect(result.metrics.skipped.disabled).toBe(1);
    expect(theOddsApi.fetchTheOddsApiOdds).not.toHaveBeenCalled();
  });

  test('samples favorite-scope watchlist matches and persists odds plus fusion audit evidence', async () => {
    const result = await theOddsApiShadowJob();

    expect(result.sampled).toBe(1);
    expect(result.metrics).toMatchObject({
      checked: 1,
      selected: 1,
      sampled: 1,
      mapped: 1,
      logicalCalls: 1,
      quotaCost: 1,
      quotaRemaining: 99,
      quotaState: 'ok',
    });
    expect(theOddsApi.fetchTheOddsApiOdds).toHaveBeenCalledWith(expect.objectContaining({
      sportKey: 'soccer_fifa_world_cup',
      commenceTimeFrom: expect.any(String),
      commenceTimeTo: expect.any(String),
      consumer: 'the-odds-api-shadow',
      jobName: 'the-odds-api-shadow',
    }));
    expect(fixtureSamplesRepo.createProviderFixtureSample).toHaveBeenCalledWith(expect.objectContaining({
      match_id: '100',
      provider_fixture_id: 'odds-100',
      provider: 'the-odds-api',
      consumer: 'the-odds-api-shadow',
      success: true,
      coverage_flags: expect.objectContaining({
        mapping: expect.objectContaining({ confidence: 'high' }),
        fusion: expect.objectContaining({
          matchId: '100',
          canonicalCounts: expect.objectContaining({ odds: 3 }),
        }),
      }),
    }));
    expect(providerSampling.recordProviderOddsSampleSafe).toHaveBeenCalledWith(expect.objectContaining({
      match_id: '100',
      provider: 'the-odds-api',
      source: 'scheduled-shadow',
      consumer: 'the-odds-api-shadow',
      success: true,
      usable: true,
      coverage_flags: expect.objectContaining({
        hasCanonicalOdds: true,
        liveUsable: true,
        sourceKind: 'live',
        fusion: expect.objectContaining({ matchId: '100' }),
      }),
    }));
  });

  test('skips non-favorite watchlist matches before spending The Odds API calls', async () => {
    vi.mocked(watchlistRepo.getActiveOperationalWatchlist).mockResolvedValue([watch('200')] as never);
    vi.mocked(matchesRepo.getAllMatches).mockResolvedValue([
      match({
        match_id: '200',
        league_id: 2,
        league_name: 'Non Favorite',
        home_team: 'Alpha',
        away_team: 'Beta',
        home_team_id: 2001,
        away_team_id: 2002,
      }),
    ] as never);
    vi.mocked(leaguesRepo.getAllLeagues).mockResolvedValue([
      league({ league_id: 2, league_name: 'Non Favorite', top_league: false }),
    ] as never);
    vi.mocked(watchlistRepo.getKickoffMinutesForMatchIds).mockResolvedValue(new Map([['200', 30]]) as never);

    const result = await theOddsApiShadowJob();

    expect(result.metrics.selected).toBe(0);
    expect(result.metrics.skipped.outsideFavoriteScope).toBe(1);
    expect(theOddsApi.fetchTheOddsApiOdds).not.toHaveBeenCalled();
  });

  test('stops remaining samples when per-run call budget is exhausted', async () => {
    mockConfig.theOddsApiShadowMaxCallsPerRun = 1;
    vi.mocked(watchlistRepo.getActiveOperationalWatchlist).mockResolvedValue([watch('100'), watch('101')] as never);
    vi.mocked(matchesRepo.getAllMatches).mockResolvedValue([
      match({ match_id: '100' }),
      match({
        match_id: '101',
        home_team: 'France',
        away_team: 'Japan',
        home_team_id: 11,
        away_team_id: 21,
      }),
    ] as never);
    vi.mocked(watchlistRepo.getKickoffMinutesForMatchIds).mockResolvedValue(new Map([
      ['100', -12],
      ['101', -10],
    ]) as never);

    const result = await theOddsApiShadowJob();

    expect(result.metrics.selected).toBe(2);
    expect(result.metrics.sampled).toBe(1);
    expect(result.metrics.logicalCalls).toBe(1);
    expect(result.metrics.skipped.callBudget).toBe(1);
    expect(theOddsApi.fetchTheOddsApiOdds).toHaveBeenCalledTimes(1);
  });
});
