// ============================================================
// Unit tests - Enrich Watchlist Job (enrichWatchlistJob)
// ============================================================

import { beforeEach, describe, expect, test, vi } from 'vitest';

vi.mock('../lib/redis.js', () => ({
  getRedisClient: () => ({ hget: vi.fn(), hset: vi.fn(), expire: vi.fn(), del: vi.fn() }),
}));

vi.mock('../jobs/job-progress.js', () => ({
  reportJobProgress: vi.fn(),
}));

vi.mock('../repos/matches.repo.js', () => ({
  getAllMatches: vi.fn().mockResolvedValue([
    { match_id: '100', status: 'NS' },
    { match_id: '200', status: '1H' },
    { match_id: '300', status: 'NS' },
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
  getActiveWatchlist: vi.fn().mockResolvedValue(mockWatchlist),
  getKickoffMinutesForMatchIds: vi.fn().mockImplementation((matchIds: string[]) => {
    const map = new Map<string, number | null>();
    for (const matchId of matchIds) {
      map.set(matchId, matchId === '300' ? 240 : 60);
    }
    return Promise.resolve(map);
  }),
  updateWatchlistEntry: vi.fn().mockResolvedValue({}),
}));

vi.mock('../lib/strategic-context.service.js', () => ({
  fetchStrategicContext: vi.fn().mockResolvedValue(defaultStrategicContext),
}));

const { enrichWatchlistJob } = await import('../jobs/enrich-watchlist.job.js');

beforeEach(async () => {
  vi.clearAllMocks();

  const watchlistRepo = await import('../repos/watchlist.repo.js');
  vi.mocked(watchlistRepo.getActiveWatchlist).mockResolvedValue(mockWatchlist as never);
  vi.mocked(watchlistRepo.getKickoffMinutesForMatchIds).mockImplementation((matchIds: string[]) => {
    const map = new Map<string, number | null>();
    for (const matchId of matchIds) {
      map.set(matchId, matchId === '300' ? 240 : 60);
    }
    return Promise.resolve(map);
  });
  vi.mocked(watchlistRepo.updateWatchlistEntry).mockResolvedValue({} as never);

  const matchRepo = await import('../repos/matches.repo.js');
  vi.mocked(matchRepo.getAllMatches).mockResolvedValue([
    { match_id: '100', status: 'NS' },
    { match_id: '200', status: '1H' },
    { match_id: '300', status: 'NS' },
  ] as never);

  const service = await import('../lib/strategic-context.service.js');
  vi.mocked(service.fetchStrategicContext).mockReset();
  vi.mocked(service.fetchStrategicContext).mockResolvedValue(defaultStrategicContext as never);
});

describe('enrichWatchlistJob', () => {
  test('only enriches NS entries inside the 2-hour kickoff window', async () => {
    const result = await enrichWatchlistJob();
    expect(result.checked).toBe(1);
    expect(result.enriched).toBe(1);
  });

  test('updates strategic context and generates conditions', async () => {
    await enrichWatchlistJob();
    const watchlistRepo = await import('../repos/watchlist.repo.js');
    expect(watchlistRepo.updateWatchlistEntry).toHaveBeenCalledWith(
      '100',
      expect.objectContaining({
        strategic_context: expect.any(Object),
        strategic_context_at: expect.any(String),
      }),
    );
  });

  test('returns 0 when watchlist is empty', async () => {
    const watchlistRepo = await import('../repos/watchlist.repo.js');
    vi.mocked(watchlistRepo.getActiveWatchlist).mockResolvedValueOnce([]);

    const result = await enrichWatchlistJob();
    expect(result).toEqual({ checked: 0, enriched: 0 });
  });

  test('enriches entries within kickoff window even when previous timestamp is old', async () => {
    const watchlistRepo = await import('../repos/watchlist.repo.js');
    vi.mocked(watchlistRepo.getActiveWatchlist).mockResolvedValueOnce([
      {
        match_id: '400', home_team: 'A', away_team: 'B', league: 'L', date: '2026-03-17',
        status: 'active', strategic_context_at: sixHoursAgo, recommended_custom_condition: '',
      },
    ] as never);
    const matchRepo = await import('../repos/matches.repo.js');
    vi.mocked(matchRepo.getAllMatches).mockResolvedValueOnce([
      { match_id: '400', status: 'NS' },
    ] as never);

    const result = await enrichWatchlistJob();
    expect(result.checked).toBe(1);
  });

  test('does not refresh usable context when kickoff is inside the window', async () => {
    const watchlistRepo = await import('../repos/watchlist.repo.js');
    vi.mocked(watchlistRepo.getActiveWatchlist).mockResolvedValueOnce([
      {
        match_id: '450',
        home_team: 'A',
        away_team: 'B',
        league: 'L',
        date: '2026-03-17',
        status: 'active',
        strategic_context: defaultStrategicContext,
        strategic_context_at: sixHoursAgo,
        recommended_custom_condition: '',
      },
    ] as never);
    const matchRepo = await import('../repos/matches.repo.js');
    vi.mocked(matchRepo.getAllMatches).mockResolvedValueOnce([
      { match_id: '450', status: 'NS' },
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
    expect(watchlistRepo.updateWatchlistEntry).toHaveBeenCalledWith(
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
    expect(watchlistRepo.updateWatchlistEntry).toHaveBeenCalledWith(
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
    vi.mocked(watchlistRepo.getActiveWatchlist).mockResolvedValueOnce([
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
      { match_id: '500', status: 'NS' },
    ] as never);

    await enrichWatchlistJob();
    expect(watchlistRepo.updateWatchlistEntry).toHaveBeenCalledWith(
      '500',
      expect.objectContaining({
        recommended_custom_condition: '(Minute >= 60) AND (NOT Home leading)',
      }),
    );
    expect(watchlistRepo.updateWatchlistEntry).not.toHaveBeenCalledWith(
      '500',
      expect.objectContaining({
        custom_conditions: '(Minute >= 60) AND (NOT Home leading)',
      }),
    );
  });

  test('replaces trigger condition when it still matches the previous AI recommendation', async () => {
    const watchlistRepo = await import('../repos/watchlist.repo.js');
    vi.mocked(watchlistRepo.getActiveWatchlist).mockResolvedValueOnce([
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
      { match_id: '510', status: 'NS' },
    ] as never);

    await enrichWatchlistJob();

    expect(watchlistRepo.updateWatchlistEntry).toHaveBeenCalledWith(
      '510',
      expect.objectContaining({
        recommended_custom_condition: '(Minute >= 60) AND (NOT Home leading)',
        custom_conditions: '(Minute >= 60) AND (NOT Home leading)',
      }),
    );
  });

  test('does not auto-apply when per-match override is disabled', async () => {
    const watchlistRepo = await import('../repos/watchlist.repo.js');
    vi.mocked(watchlistRepo.getActiveWatchlist).mockResolvedValueOnce([
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
      { match_id: '520', status: 'NS' },
    ] as never);

    await enrichWatchlistJob();

    expect(watchlistRepo.updateWatchlistEntry).toHaveBeenCalledWith(
      '520',
      expect.objectContaining({
        recommended_custom_condition: '(Minute >= 60) AND (NOT Home leading)',
      }),
    );
    expect(watchlistRepo.updateWatchlistEntry).not.toHaveBeenCalledWith(
      '520',
      expect.objectContaining({
        custom_conditions: '(Minute >= 60) AND (NOT Home leading)',
      }),
    );
  });

  test('skips poor context entries until retry_after passes', async () => {
    const watchlistRepo = await import('../repos/watchlist.repo.js');
    vi.mocked(watchlistRepo.getActiveWatchlist).mockResolvedValueOnce([
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
            retry_after: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
          },
        },
        strategic_context_at: sixHoursAgo,
        recommended_custom_condition: '',
      },
    ] as never);
    const matchRepo = await import('../repos/matches.repo.js');
    vi.mocked(matchRepo.getAllMatches).mockResolvedValueOnce([
      { match_id: '600', status: 'NS' },
    ] as never);

    const result = await enrichWatchlistJob();
    const service = await import('../lib/strategic-context.service.js');

    expect(result.checked).toBe(0);
    expect(result.enriched).toBe(0);
    expect(service.fetchStrategicContext).not.toHaveBeenCalled();
  });

  test('skips refreshing when usable context already exists, even if it is old', async () => {
    const watchlistRepo = await import('../repos/watchlist.repo.js');
    vi.mocked(watchlistRepo.getActiveWatchlist).mockResolvedValueOnce([
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
          _meta: { refresh_status: 'good', failure_count: 0 },
        },
        strategic_context_at: sixHoursAgo,
        recommended_custom_condition: '',
      },
    ] as never);
    const matchRepo = await import('../repos/matches.repo.js');
    vi.mocked(matchRepo.getAllMatches).mockResolvedValueOnce([
      { match_id: '700', status: 'NS' },
    ] as never);
    const result = await enrichWatchlistJob();
    const service = await import('../lib/strategic-context.service.js');

    expect(result.checked).toBe(0);
    expect(result.enriched).toBe(0);
    expect(service.fetchStrategicContext).not.toHaveBeenCalled();
    expect(watchlistRepo.updateWatchlistEntry).not.toHaveBeenCalled();
  });

  test('re-enriches legacy context missing trust metadata even when summary text exists', async () => {
    const watchlistRepo = await import('../repos/watchlist.repo.js');
    vi.mocked(watchlistRepo.getActiveWatchlist).mockResolvedValueOnce([
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
      { match_id: '750', status: 'NS' },
    ] as never);
    const service = await import('../lib/strategic-context.service.js');
    vi.mocked(service.fetchStrategicContext).mockResolvedValueOnce(defaultStrategicContext as never);

    const result = await enrichWatchlistJob();

    expect(result.checked).toBe(1);
    expect(result.enriched).toBe(1);
    expect(service.fetchStrategicContext).toHaveBeenCalledTimes(1);
    expect(watchlistRepo.updateWatchlistEntry).toHaveBeenCalledWith(
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
    vi.mocked(watchlistRepo.getActiveWatchlist).mockResolvedValueOnce([
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
      { match_id: '800', status: 'NS' },
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
    expect(watchlistRepo.updateWatchlistEntry).toHaveBeenCalledWith(
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
    vi.mocked(watchlistRepo.getActiveWatchlist).mockResolvedValueOnce([
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
      { match_id: '900', status: 'NS' },
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
    expect(watchlistRepo.updateWatchlistEntry).toHaveBeenCalledWith(
      '900',
      expect.objectContaining({
        strategic_context: expect.objectContaining({
          _meta: expect.objectContaining({ refresh_status: 'poor' }),
          source_meta: expect.objectContaining({ search_quality: 'low' }),
        }),
      }),
    );
  });
});
