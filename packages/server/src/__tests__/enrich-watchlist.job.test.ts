// ============================================================
// Unit tests - Enrich Watchlist Job (enrichWatchlistJob)
// ============================================================

import { beforeEach, describe, expect, test, vi } from 'vitest';

vi.mock('../lib/redis.js', () => ({
  getRedisClient: () => ({
    hget: vi.fn(),
    hset: vi.fn(),
    expire: vi.fn(),
    del: vi.fn(),
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn().mockResolvedValue('OK'),
  }),
}));

vi.mock('../jobs/job-progress.js', () => ({
  reportJobProgress: vi.fn(),
}));

vi.mock('../repos/matches.repo.js', () => ({
  getAllMatches: vi.fn().mockResolvedValue([
    { match_id: '100', status: 'NS', league_id: 39 },
    { match_id: '200', status: '1H', league_id: 39 },
    { match_id: '300', status: 'NS', league_id: 140 },
  ]),
}));

vi.mock('../repos/leagues.repo.js', () => ({
  getAllLeagues: vi.fn().mockResolvedValue([
    { league_id: 39, league_name: 'Premier League', country: 'England', top_league: true, active: true, tier: '1', type: 'league', logo: '', last_updated: '' },
    { league_id: 140, league_name: 'La Liga', country: 'Spain', top_league: true, active: true, tier: '1', type: 'league', logo: '', last_updated: '' },
  ]),
}));

vi.mock('../repos/settings.repo.js', () => ({
  getSettings: vi.fn().mockResolvedValue({
    AUTO_APPLY_RECOMMENDED_CONDITION: true,
  }),
}));

const sixHoursAgo = new Date(Date.now() - 7 * 60 * 60 * 1000).toISOString();
const recentEnrich = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();

const defaultStrategicContext = {
  home_motivation: 'Fighting for title race',
  away_motivation: 'Battling relegation',
  rotation_risk: 'No major rotation expected',
  key_absences: 'No major absences',
  h2h_narrative: 'Arsenal won last 3 meetings',
  league_positions: '2nd vs 18th',
  fixture_congestion: 'Champions League in 2 days',
  competition_type: 'domestic_league',
  summary: 'High-stakes domestic match',
  home_motivation_vi: 'Dang dua vo dich',
  away_motivation_vi: 'Dang dua tru hang',
  league_positions_vi: 'Thu 2 vs thu 18',
  fixture_congestion_vi: 'Da cup sau 2 ngay',
  rotation_risk_vi: 'Khong co xoay tua lon',
  key_absences_vi: 'Khong co vang mat lon',
  h2h_narrative_vi: 'Arsenal thang 3 lan gap gan nhat',
  summary_vi: 'Tran dau co tinh chat cao',
  searched_at: new Date().toISOString(),
  version: 2 as const,
  ai_condition: '(Minute >= 60) AND (NOT Home leading)',
  ai_condition_reason: 'Title race team expected to dominate',
  ai_condition_reason_vi: 'Doi dua vo dich du kien ap dao',
  qualitative: {
    en: {
      home_motivation: 'Fighting for title race',
      away_motivation: 'Battling relegation',
      league_positions: '2nd vs 18th',
      fixture_congestion: 'Champions League in 2 days',
      rotation_risk: 'No major rotation expected',
      key_absences: 'No major absences',
      h2h_narrative: 'Arsenal won last 3 meetings',
      summary: 'High-stakes domestic match',
    },
    vi: {
      home_motivation: 'Dang dua vo dich',
      away_motivation: 'Dang dua tru hang',
      league_positions: 'Thu 2 vs thu 18',
      fixture_congestion: 'Da cup sau 2 ngay',
      rotation_risk: 'Khong co xoay tua lon',
      key_absences: 'Khong co vang mat lon',
      h2h_narrative: 'Arsenal thang 3 lan gap gan nhat',
      summary: 'Tran dau co tinh chat cao',
    },
  },
  quantitative: {
    home_last5_points: 11,
    away_last5_points: 3,
    home_last5_goals_for: 9,
    away_last5_goals_for: 4,
    home_last5_goals_against: 4,
    away_last5_goals_against: 10,
    home_home_goals_avg: 1.8,
    away_away_goals_avg: 0.9,
    home_over_2_5_rate_last10: 60,
    away_over_2_5_rate_last10: 45,
    home_btts_rate_last10: 50,
    away_btts_rate_last10: 40,
    home_clean_sheet_rate_last10: 30,
    away_clean_sheet_rate_last10: 10,
    home_failed_to_score_rate_last10: 10,
    away_failed_to_score_rate_last10: 35,
  },
  source_meta: {
    search_quality: 'high' as const,
    web_search_queries: ['Premier League table'],
    sources: [
      {
        title: 'Reuters squad update',
        url: 'https://reuters.com/example',
        domain: 'reuters.com',
        publisher: 'reuters.com',
        language: 'en' as const,
        source_type: 'major_news' as const,
        trust_tier: 'tier_1' as const,
      },
    ],
    trusted_source_count: 1,
    rejected_source_count: 0,
    rejected_domains: [],
  },
};

const mockWatchlist = [
  {
    match_id: '100', home_team: 'Arsenal', away_team: 'Chelsea',
    league: 'Premier League', date: '2026-03-17', status: 'active',
    strategic_context_at: null, recommended_custom_condition: '', custom_conditions: '',
    auto_apply_recommended_condition: true,
  },
  {
    match_id: '200', home_team: 'Liverpool', away_team: 'Man City',
    league: 'Premier League', date: '2026-03-17', status: 'active',
    strategic_context_at: null, recommended_custom_condition: '', custom_conditions: '',
    auto_apply_recommended_condition: true,
  },
  {
    match_id: '300', home_team: 'Barca', away_team: 'Real',
    league: 'La Liga', date: '2026-03-17', status: 'active',
    strategic_context_at: recentEnrich, recommended_custom_condition: '', custom_conditions: '',
    auto_apply_recommended_condition: true,
  },
];

vi.mock('../repos/watchlist.repo.js', () => ({
  getActiveOperationalWatchlist: vi.fn().mockResolvedValue(mockWatchlist),
  getKickoffMinutesForMatchIds: vi.fn().mockImplementation((matchIds: string[]) => {
    const map = new Map<string, number | null>();
    for (const matchId of matchIds) {
      map.set(matchId, matchId === '300' ? 1500 : 60);
    }
    return Promise.resolve(map);
  }),
  updateOperationalWatchlistEntry: vi.fn().mockResolvedValue({}),
}));

vi.mock('../lib/strategic-context.service.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/strategic-context.service.js')>();
  return {
    ...actual,
    fetchStrategicContext: vi.fn(),
  };
});

const { enrichWatchlistJob } = await import('../jobs/enrich-watchlist.job.js');

beforeEach(async () => {
  vi.clearAllMocks();

  const watchlistRepo = await import('../repos/watchlist.repo.js');
  vi.mocked(watchlistRepo.getActiveOperationalWatchlist).mockResolvedValue(mockWatchlist as never);
  vi.mocked(watchlistRepo.getKickoffMinutesForMatchIds).mockImplementation((matchIds: string[]) => {
    const map = new Map<string, number | null>();
    for (const matchId of matchIds) {
      map.set(matchId, matchId === '300' ? 1500 : 60);
    }
    return Promise.resolve(map);
  });
  vi.mocked(watchlistRepo.updateOperationalWatchlistEntry).mockResolvedValue({} as never);

  const matchRepo = await import('../repos/matches.repo.js');
  vi.mocked(matchRepo.getAllMatches).mockResolvedValue([
    { match_id: '100', status: 'NS', league_id: 39 },
    { match_id: '200', status: '1H', league_id: 39 },
    { match_id: '300', status: 'NS', league_id: 140 },
  ] as never);

  const leaguesRepo = await import('../repos/leagues.repo.js');
  vi.mocked(leaguesRepo.getAllLeagues).mockResolvedValue([
    { league_id: 39, league_name: 'Premier League', country: 'England', top_league: true, active: true, tier: '1', type: 'league', logo: '', last_updated: '' },
    { league_id: 140, league_name: 'La Liga', country: 'Spain', top_league: true, active: true, tier: '1', type: 'league', logo: '', last_updated: '' },
  ] as never);

  const service = await import('../lib/strategic-context.service.js');
  vi.mocked(service.fetchStrategicContext).mockReset();
  vi.mocked(service.fetchStrategicContext).mockResolvedValue(defaultStrategicContext as never);
});

describe('enrichWatchlistJob', () => {
  test('enriches eligible NS entries in the active refresh window', async () => {
    const result = await enrichWatchlistJob();
    expect(result.checked).toBe(1);
    expect(result.enriched).toBe(1);
  });

  test('updates strategic context and generates conditions', async () => {
    await enrichWatchlistJob();
    const watchlistRepo = await import('../repos/watchlist.repo.js');
    expect(watchlistRepo.updateOperationalWatchlistEntry).toHaveBeenCalledWith(
      '100',
      expect.objectContaining({
        strategic_context: expect.any(Object),
        strategic_context_at: expect.any(String),
      }),
    );
  });

  test('returns 0 when watchlist is empty', async () => {
    const watchlistRepo = await import('../repos/watchlist.repo.js');
    vi.mocked(watchlistRepo.getActiveOperationalWatchlist).mockResolvedValueOnce([]);

    const result = await enrichWatchlistJob();
    expect(result).toEqual({ checked: 0, enriched: 0 });
  });

  test('enriches entries within kickoff window even when previous timestamp is old', async () => {
    const watchlistRepo = await import('../repos/watchlist.repo.js');
    vi.mocked(watchlistRepo.getActiveOperationalWatchlist).mockResolvedValueOnce([
      {
        match_id: '400', home_team: 'A', away_team: 'B', league: 'L', date: '2026-03-17',
        status: 'active', strategic_context_at: sixHoursAgo, recommended_custom_condition: '',
      },
    ] as never);
    const matchRepo = await import('../repos/matches.repo.js');
    vi.mocked(matchRepo.getAllMatches).mockResolvedValueOnce([
      { match_id: '400', status: 'NS', league_id: 39 },
    ] as never);

    const result = await enrichWatchlistJob();
    expect(result.checked).toBe(1);
  });

  test('broad pre-kickoff window enriches watchlist entries up to 24h before kickoff', async () => {
    const watchlistRepo = await import('../repos/watchlist.repo.js');
    vi.mocked(watchlistRepo.getKickoffMinutesForMatchIds).mockImplementationOnce((matchIds: string[]) => {
      const map = new Map<string, number | null>();
      for (const matchId of matchIds) {
        map.set(matchId, matchId === '300' ? 240 : 60);
      }
      return Promise.resolve(map);
    });

    const result = await enrichWatchlistJob();

    expect(result.checked).toBe(2);
    expect(result.enriched).toBe(2);
  });

  test('refreshes usable broad context again when match enters prematch window', async () => {
    const watchlistRepo = await import('../repos/watchlist.repo.js');
    vi.mocked(watchlistRepo.getActiveOperationalWatchlist).mockResolvedValueOnce([
      {
        match_id: '460',
        home_team: 'A',
        away_team: 'B',
        league: 'L',
        date: '2026-03-17',
        status: 'active',
        strategic_context: {
          ...defaultStrategicContext,
          _meta: { refresh_status: 'good', refresh_window: 'broad' },
        },
        strategic_context_at: sixHoursAgo,
        recommended_custom_condition: '',
      },
    ] as never);
    vi.mocked(watchlistRepo.getKickoffMinutesForMatchIds).mockResolvedValueOnce(new Map([['460', 75]]) as never);
    const matchRepo = await import('../repos/matches.repo.js');
    vi.mocked(matchRepo.getAllMatches).mockResolvedValueOnce([
      { match_id: '460', status: 'NS', league_id: 39 },
    ] as never);

    const result = await enrichWatchlistJob();
    const service = await import('../lib/strategic-context.service.js');

    expect(result.checked).toBe(1);
    expect(result.enriched).toBe(1);
    expect(service.fetchStrategicContext).toHaveBeenCalledTimes(1);
  });

  test('does not refresh usable context when kickoff is inside the window', async () => {
    const watchlistRepo = await import('../repos/watchlist.repo.js');
    vi.mocked(watchlistRepo.getActiveOperationalWatchlist).mockResolvedValueOnce([
      {
        match_id: '450',
        home_team: 'A',
        away_team: 'B',
        league: 'L',
        date: '2026-03-17',
        status: 'active',
        strategic_context: {
          ...defaultStrategicContext,
          _meta: { refresh_status: 'good', refresh_window: 'prematch' },
        },
        strategic_context_at: sixHoursAgo,
        recommended_custom_condition: '',
      },
    ] as never);
    const matchRepo = await import('../repos/matches.repo.js');
    vi.mocked(matchRepo.getAllMatches).mockResolvedValueOnce([
      { match_id: '450', status: 'NS', league_id: 39 },
    ] as never);

    const result = await enrichWatchlistJob();
    const service = await import('../lib/strategic-context.service.js');

    expect(result.checked).toBe(0);
    expect(result.enriched).toBe(0);
    expect(service.fetchStrategicContext).not.toHaveBeenCalled();
  });

  test('handles API errors gracefully', async () => {
    const service = await import('../lib/strategic-context.service.js');
    vi.mocked(service.fetchStrategicContext).mockRejectedValueOnce(new Error('Gemini rate limit'));

    const result = await enrichWatchlistJob();
    expect(result.checked).toBe(1);
    expect(result.enriched).toBe(0);

    const watchlistRepo = await import('../repos/watchlist.repo.js');
    expect(watchlistRepo.updateOperationalWatchlistEntry).toHaveBeenCalledWith(
      '100',
      expect.objectContaining({
        strategic_context: expect.objectContaining({
          _meta: expect.objectContaining({
            refresh_status: 'failed',
            retry_after: expect.any(String),
          }),
        }),
      }),
    );
  });

  test('uses AI-generated condition from strategic context', async () => {
    await enrichWatchlistJob();
    const watchlistRepo = await import('../repos/watchlist.repo.js');
    expect(watchlistRepo.updateOperationalWatchlistEntry).toHaveBeenCalledWith(
      '100',
      expect.objectContaining({
        recommended_custom_condition: '(Minute >= 60) AND (NOT Home leading)',
        recommended_condition_reason: 'Title race team expected to dominate',
        recommended_condition_reason_vi: 'Doi dua vo dich du kien ap dao',
        custom_conditions: '(Minute >= 60) AND (NOT Home leading)',
      }),
    );
  });

  test('does not overwrite manually set trigger conditions', async () => {
    const watchlistRepo = await import('../repos/watchlist.repo.js');
    vi.mocked(watchlistRepo.getActiveOperationalWatchlist).mockResolvedValueOnce([
      {
        match_id: '500', home_team: 'X', away_team: 'Y', league: 'L', date: '2026-03-17',
        status: 'active',
        strategic_context_at: null,
        recommended_custom_condition: '',
        custom_conditions: '(Minute >= 45) AND (Home shots on target >= 4)',
        auto_apply_recommended_condition: true,
      },
    ] as never);
    const matchRepo = await import('../repos/matches.repo.js');
    vi.mocked(matchRepo.getAllMatches).mockResolvedValueOnce([
      { match_id: '500', status: 'NS', league_id: 39 },
    ] as never);

    await enrichWatchlistJob();
    expect(watchlistRepo.updateOperationalWatchlistEntry).toHaveBeenCalledWith(
      '500',
      expect.objectContaining({
        recommended_custom_condition: '(Minute >= 60) AND (NOT Home leading)',
      }),
    );
    expect(watchlistRepo.updateOperationalWatchlistEntry).not.toHaveBeenCalledWith(
      '500',
      expect.objectContaining({
        custom_conditions: '(Minute >= 60) AND (NOT Home leading)',
      }),
    );
  });

  test('replaces trigger condition when it still matches the previous AI recommendation', async () => {
    const watchlistRepo = await import('../repos/watchlist.repo.js');
    vi.mocked(watchlistRepo.getActiveOperationalWatchlist).mockResolvedValueOnce([
      {
        match_id: '510',
        home_team: 'X',
        away_team: 'Y',
        league: 'L',
        date: '2026-03-17',
        status: 'active',
        strategic_context_at: null,
        recommended_custom_condition: '(Minute >= 50) AND (NOT Home leading)',
        custom_conditions: '(Minute >= 50) AND (NOT Home leading)',
        auto_apply_recommended_condition: true,
      },
    ] as never);
    const matchRepo = await import('../repos/matches.repo.js');
    vi.mocked(matchRepo.getAllMatches).mockResolvedValueOnce([
      { match_id: '510', status: 'NS', league_id: 39 },
    ] as never);

    await enrichWatchlistJob();

    expect(watchlistRepo.updateOperationalWatchlistEntry).toHaveBeenCalledWith(
      '510',
      expect.objectContaining({
        recommended_custom_condition: '(Minute >= 60) AND (NOT Home leading)',
        custom_conditions: '(Minute >= 60) AND (NOT Home leading)',
      }),
    );
  });

  test('does not auto-apply when per-match override is disabled', async () => {
    const watchlistRepo = await import('../repos/watchlist.repo.js');
    vi.mocked(watchlistRepo.getActiveOperationalWatchlist).mockResolvedValueOnce([
      {
        match_id: '520',
        home_team: 'X',
        away_team: 'Y',
        league: 'L',
        date: '2026-03-17',
        status: 'active',
        strategic_context_at: null,
        recommended_custom_condition: '',
        custom_conditions: '',
        auto_apply_recommended_condition: false,
      },
    ] as never);
    const matchRepo = await import('../repos/matches.repo.js');
    vi.mocked(matchRepo.getAllMatches).mockResolvedValueOnce([
      { match_id: '520', status: 'NS', league_id: 39 },
    ] as never);

    await enrichWatchlistJob();

    expect(watchlistRepo.updateOperationalWatchlistEntry).toHaveBeenCalledWith(
      '520',
      expect.objectContaining({
        recommended_custom_condition: '(Minute >= 60) AND (NOT Home leading)',
      }),
    );
    expect(watchlistRepo.updateOperationalWatchlistEntry).not.toHaveBeenCalledWith(
      '520',
      expect.objectContaining({
        custom_conditions: '(Minute >= 60) AND (NOT Home leading)',
      }),
    );
  });

  test('skips poor context entries until retry_after passes', async () => {
    const watchlistRepo = await import('../repos/watchlist.repo.js');
    vi.mocked(watchlistRepo.getActiveOperationalWatchlist).mockResolvedValueOnce([
      {
        match_id: '600',
        home_team: 'A',
        away_team: 'B',
        league: 'L',
        date: '2026-03-17',
        status: 'active',
        strategic_context: {
          summary: 'No data found',
          source_meta: { search_quality: 'low' },
          _meta: {
            refresh_status: 'poor',
            refresh_window: 'broad',
            retry_after: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
          },
        },
        strategic_context_at: sixHoursAgo,
        recommended_custom_condition: '',
      },
    ] as never);
    const matchRepo = await import('../repos/matches.repo.js');
    vi.mocked(matchRepo.getAllMatches).mockResolvedValueOnce([
      { match_id: '600', status: 'NS', league_id: 999 },
    ] as never);
    vi.mocked(watchlistRepo.getKickoffMinutesForMatchIds).mockResolvedValueOnce(new Map([['600', 240]]) as never);

    const result = await enrichWatchlistJob();
    const service = await import('../lib/strategic-context.service.js');

    expect(result.checked).toBe(0);
    expect(result.enriched).toBe(0);
    expect(service.fetchStrategicContext).not.toHaveBeenCalled();
  });

  test('skips refreshing when usable context already exists, even if it is old', async () => {
    const watchlistRepo = await import('../repos/watchlist.repo.js');
    vi.mocked(watchlistRepo.getActiveOperationalWatchlist).mockResolvedValueOnce([
      {
        match_id: '700',
        home_team: 'A',
        away_team: 'B',
        league: 'L',
        date: '2026-03-17',
        status: 'active',
        strategic_context: {
          ...defaultStrategicContext,
          summary: 'Useful context',
          home_motivation: 'Title race',
          _meta: { refresh_status: 'good', failure_count: 0, refresh_window: 'prematch' },
        },
        strategic_context_at: sixHoursAgo,
        recommended_custom_condition: '',
      },
    ] as never);
    const matchRepo = await import('../repos/matches.repo.js');
    vi.mocked(matchRepo.getAllMatches).mockResolvedValueOnce([
      { match_id: '700', status: 'NS', league_id: 39 },
    ] as never);
    const result = await enrichWatchlistJob();
    const service = await import('../lib/strategic-context.service.js');

    expect(result.checked).toBe(0);
    expect(result.enriched).toBe(0);
    expect(service.fetchStrategicContext).not.toHaveBeenCalled();
    expect(watchlistRepo.updateOperationalWatchlistEntry).not.toHaveBeenCalled();
  });

  test('re-enriches legacy context missing trust metadata even when summary text exists', async () => {
    const watchlistRepo = await import('../repos/watchlist.repo.js');
    vi.mocked(watchlistRepo.getActiveOperationalWatchlist).mockResolvedValueOnce([
      {
        match_id: '750',
        home_team: 'A',
        away_team: 'B',
        league: 'L',
        date: '2026-03-17',
        status: 'active',
        strategic_context: {
          summary: 'Legacy context without source metadata.',
          home_motivation: 'Legacy motivation',
          _meta: { refresh_status: 'failed', failure_count: 1 },
        },
        strategic_context_at: sixHoursAgo,
        recommended_custom_condition: '',
      },
    ] as never);
    const matchRepo = await import('../repos/matches.repo.js');
    vi.mocked(matchRepo.getAllMatches).mockResolvedValueOnce([
      { match_id: '750', status: 'NS', league_id: 39 },
    ] as never);
    const service = await import('../lib/strategic-context.service.js');
    vi.mocked(service.fetchStrategicContext).mockResolvedValueOnce(defaultStrategicContext as never);

    const result = await enrichWatchlistJob();

    expect(result.checked).toBe(1);
    expect(result.enriched).toBe(1);
    expect(service.fetchStrategicContext).toHaveBeenCalledTimes(1);
    expect(watchlistRepo.updateOperationalWatchlistEntry).toHaveBeenCalledWith(
      '750',
      expect.objectContaining({
        strategic_context: expect.objectContaining({
          version: 2,
          source_meta: expect.any(Object),
          _meta: expect.objectContaining({ refresh_status: 'good' }),
        }),
      }),
    );
  });

  test('accepts quantitative trusted context even when summary is still no-data', async () => {
    const watchlistRepo = await import('../repos/watchlist.repo.js');
    vi.mocked(watchlistRepo.getActiveOperationalWatchlist).mockResolvedValueOnce([
      {
        match_id: '800',
        home_team: 'A',
        away_team: 'B',
        league: 'L',
        date: '2026-03-17',
        status: 'active',
        strategic_context_at: null,
        recommended_custom_condition: '',
      },
    ] as never);
    const matchRepo = await import('../repos/matches.repo.js');
    vi.mocked(matchRepo.getAllMatches).mockResolvedValueOnce([
      { match_id: '800', status: 'NS', league_id: 999 },
    ] as never);
    const service = await import('../lib/strategic-context.service.js');
    vi.mocked(service.fetchStrategicContext).mockResolvedValueOnce({
      ...defaultStrategicContext,
      summary: 'No data found',
      summary_vi: 'Khong tim thay du lieu',
      qualitative: {
        en: {
          ...defaultStrategicContext.qualitative.en,
          summary: 'No data found',
        },
        vi: {
          ...defaultStrategicContext.qualitative.vi,
          summary: 'Khong tim thay du lieu',
        },
      },
      source_meta: {
        ...defaultStrategicContext.source_meta,
        search_quality: 'medium',
      },
      quantitative: {
        ...defaultStrategicContext.quantitative,
        home_last5_points: 11,
        away_last5_points: 4,
        home_last5_goals_for: 8,
        away_last5_goals_for: 5,
      },
      ai_condition: '',
      ai_condition_reason: '',
      ai_condition_reason_vi: '',
    } as never);

    const result = await enrichWatchlistJob();

    expect(result.checked).toBe(1);
    expect(result.enriched).toBe(1);
    expect(watchlistRepo.updateOperationalWatchlistEntry).toHaveBeenCalledWith(
      '800',
      expect.objectContaining({
        strategic_context: expect.objectContaining({
          version: 2,
          source_meta: expect.objectContaining({ search_quality: 'medium' }),
          quantitative: expect.objectContaining({ home_last5_points: 11 }),
        }),
      }),
    );
  });

  test('treats low-trust strategic context as poor and schedules retry', async () => {
    const watchlistRepo = await import('../repos/watchlist.repo.js');
    vi.mocked(watchlistRepo.getActiveOperationalWatchlist).mockResolvedValueOnce([
      {
        match_id: '900',
        home_team: 'A',
        away_team: 'B',
        league: 'L',
        date: '2026-03-17',
        status: 'active',
        strategic_context_at: null,
        recommended_custom_condition: '',
      },
    ] as never);
    const matchRepo = await import('../repos/matches.repo.js');
    vi.mocked(matchRepo.getAllMatches).mockResolvedValueOnce([
      { match_id: '900', status: 'NS', league_id: 39 },
    ] as never);
    const service = await import('../lib/strategic-context.service.js');
    vi.mocked(service.fetchStrategicContext).mockResolvedValueOnce({
      ...defaultStrategicContext,
      summary: 'Looks okay but comes from weak sources',
      source_meta: {
        ...defaultStrategicContext.source_meta,
        search_quality: 'low',
        trusted_source_count: 0,
        rejected_source_count: 1,
        rejected_domains: ['betting.example.com'],
      },
    } as never);

    const result = await enrichWatchlistJob();

    expect(result.checked).toBe(1);
    expect(result.enriched).toBe(0);
    expect(watchlistRepo.updateOperationalWatchlistEntry).toHaveBeenCalledWith(
      '900',
      expect.objectContaining({
        strategic_context: expect.objectContaining({
          _meta: expect.objectContaining({ refresh_status: 'poor' }),
          source_meta: expect.objectContaining({ search_quality: 'low' }),
        }),
      }),
    );
  });

  test('retries top-league poor context even when legacy retry_after is still in the future', async () => {
    const watchlistRepo = await import('../repos/watchlist.repo.js');
    vi.mocked(watchlistRepo.getActiveOperationalWatchlist).mockResolvedValueOnce([
      {
        match_id: '950',
        home_team: 'Barcelona',
        away_team: 'Rayo Vallecano',
        league: 'La Liga',
        date: '2026-03-17',
        status: 'active',
        strategic_context: {
          ...defaultStrategicContext,
          summary: 'No data found',
          summary_vi: 'Khong tim thay du lieu',
          source_meta: {
            ...defaultStrategicContext.source_meta,
            search_quality: 'low',
            trusted_source_count: 1,
          },
          _meta: {
            refresh_status: 'poor',
            retry_after: new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString(),
          },
        },
        strategic_context_at: sixHoursAgo,
        recommended_custom_condition: '',
        custom_conditions: '',
      },
    ] as never);
    const matchRepo = await import('../repos/matches.repo.js');
    vi.mocked(matchRepo.getAllMatches).mockResolvedValueOnce([
      { match_id: '950', status: 'NS', league_id: 140 },
    ] as never);
    const service = await import('../lib/strategic-context.service.js');
    vi.mocked(service.fetchStrategicContext).mockResolvedValueOnce(defaultStrategicContext as never);

    const result = await enrichWatchlistJob();

    expect(result.checked).toBe(1);
    expect(result.enriched).toBe(1);
    expect(service.fetchStrategicContext).toHaveBeenCalledWith(
      'Barcelona',
      'Rayo Vallecano',
      'La Liga',
      '2026-03-17',
      expect.objectContaining({
        topLeague: true,
        leagueCountry: 'Spain',
      }),
    );
  });

  test('uses deterministic prediction fallback to rescue sparse top-league context', async () => {
    const watchlistRepo = await import('../repos/watchlist.repo.js');
    vi.mocked(watchlistRepo.getActiveOperationalWatchlist).mockResolvedValueOnce([
      {
        match_id: '980',
        home_team: 'Barcelona',
        away_team: 'Rayo Vallecano',
        league: 'La Liga',
        date: '2026-03-17',
        status: 'active',
        strategic_context_at: null,
        recommended_custom_condition: '',
        custom_conditions: '',
        prediction: {
          predictions: {
            advice: 'Winner : Barcelona',
            winner: { name: 'Barcelona' },
          },
          team_form: {
            home: 'WWDWW',
            away: 'WLDLD',
          },
          h2h_summary: {
            total: 5,
            home_wins: 3,
            away_wins: 0,
            draws: 2,
          },
        },
      },
    ] as never);
    const matchRepo = await import('../repos/matches.repo.js');
    vi.mocked(matchRepo.getAllMatches).mockResolvedValueOnce([
      { match_id: '980', status: 'NS', league_id: 140 },
    ] as never);
    const service = await import('../lib/strategic-context.service.js');
    vi.mocked(service.fetchStrategicContext).mockResolvedValueOnce({
      ...defaultStrategicContext,
      home_motivation: 'Barcelona have title pressure.',
      away_motivation: 'Rayo still need points.',
      league_positions: 'No data found',
      fixture_congestion: 'No data found',
      rotation_risk: 'No data found',
      key_absences: 'No data found',
      h2h_narrative: 'No data found',
      summary: 'No data found',
      home_motivation_vi: 'Barcelona co ap luc dua vo dich.',
      away_motivation_vi: 'Rayo van can diem.',
      league_positions_vi: 'Khong tim thay du lieu',
      fixture_congestion_vi: 'Khong tim thay du lieu',
      rotation_risk_vi: 'Khong tim thay du lieu',
      key_absences_vi: 'Khong tim thay du lieu',
      h2h_narrative_vi: 'Khong tim thay du lieu',
      summary_vi: 'Khong tim thay du lieu',
      qualitative: {
        en: {
          ...defaultStrategicContext.qualitative.en,
          home_motivation: 'Barcelona have title pressure.',
          away_motivation: 'Rayo still need points.',
          league_positions: 'No data found',
          fixture_congestion: 'No data found',
          rotation_risk: 'No data found',
          key_absences: 'No data found',
          h2h_narrative: 'No data found',
          summary: 'No data found',
        },
        vi: {
          ...defaultStrategicContext.qualitative.vi,
          home_motivation: 'Barcelona co ap luc dua vo dich.',
          away_motivation: 'Rayo van can diem.',
          league_positions: 'Khong tim thay du lieu',
          fixture_congestion: 'Khong tim thay du lieu',
          rotation_risk: 'Khong tim thay du lieu',
          key_absences: 'Khong tim thay du lieu',
          h2h_narrative: 'Khong tim thay du lieu',
          summary: 'Khong tim thay du lieu',
        },
      },
      quantitative: {
        ...defaultStrategicContext.quantitative,
        home_last5_points: null,
        away_last5_points: null,
      },
      source_meta: {
        ...defaultStrategicContext.source_meta,
        search_quality: 'low',
        trusted_source_count: 1,
      },
    } as never);

    const result = await enrichWatchlistJob();

    expect(result.checked).toBe(1);
    expect(result.enriched).toBe(1);
    expect(watchlistRepo.updateOperationalWatchlistEntry).toHaveBeenCalledWith(
      '980',
      expect.objectContaining({
        strategic_context: expect.objectContaining({
          summary: expect.stringContaining('Pre-match model leans Barcelona.'),
          h2h_narrative: expect.stringContaining('Last 5 H2H'),
          quantitative: expect.objectContaining({
            home_last5_points: 13,
            away_last5_points: 5,
          }),
          _meta: expect.objectContaining({
            refresh_status: 'good',
          }),
        }),
      }),
    );
  });

  test('prioritizes top leagues first, then nearer kickoff entries', async () => {
    const watchlistRepo = await import('../repos/watchlist.repo.js');
    vi.mocked(watchlistRepo.getActiveOperationalWatchlist).mockResolvedValueOnce([
      {
        match_id: '100', home_team: 'Arsenal', away_team: 'Chelsea', league: 'Premier League', date: '2026-03-17',
        status: 'active', strategic_context_at: null, recommended_custom_condition: '', custom_conditions: '',
        auto_apply_recommended_condition: true,
      },
      {
        match_id: '300', home_team: 'Barca', away_team: 'Real', league: 'La Liga', date: '2026-03-17',
        status: 'active', strategic_context_at: null, recommended_custom_condition: '', custom_conditions: '',
        auto_apply_recommended_condition: true,
      },
      {
        match_id: '600', home_team: 'Midtable A', away_team: 'Midtable B', league: 'Lower League', date: '2026-03-17',
        status: 'active', strategic_context_at: null, recommended_custom_condition: '', custom_conditions: '',
        auto_apply_recommended_condition: true,
      },
    ] as never);
    vi.mocked(watchlistRepo.getKickoffMinutesForMatchIds).mockResolvedValueOnce(new Map([
      ['100', 90],
      ['300', 30],
      ['600', 10],
    ]));

    const matchRepo = await import('../repos/matches.repo.js');
    vi.mocked(matchRepo.getAllMatches).mockResolvedValueOnce([
      { match_id: '100', status: 'NS', league_id: 39 },
      { match_id: '300', status: 'NS', league_id: 140 },
      { match_id: '600', status: 'NS', league_id: 999 },
    ] as never);

    const leaguesRepo = await import('../repos/leagues.repo.js');
    vi.mocked(leaguesRepo.getAllLeagues).mockResolvedValueOnce([
      { league_id: 39, league_name: 'Premier League', country: 'England', top_league: true, active: true, tier: '1', type: 'league', logo: '', last_updated: '' },
      { league_id: 140, league_name: 'La Liga', country: 'Spain', top_league: true, active: true, tier: '1', type: 'league', logo: '', last_updated: '' },
      { league_id: 999, league_name: 'Lower League', country: 'Nowhere', top_league: false, active: true, tier: '2', type: 'league', logo: '', last_updated: '' },
    ] as never);

    const service = await import('../lib/strategic-context.service.js');
    await enrichWatchlistJob();

    expect(vi.mocked(service.fetchStrategicContext).mock.calls.map((call) => String(call[0]))).toEqual([
      'Barca',
      'Arsenal',
      'Midtable A',
    ]);
  });
});
