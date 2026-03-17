// ============================================================
// Unit tests — Enrich Watchlist Job (enrichWatchlistJob + generateCondition)
// ============================================================

import { describe, test, expect, vi, beforeEach } from 'vitest';

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

const sixHoursAgo = new Date(Date.now() - 7 * 60 * 60 * 1000).toISOString();
const recentEnrich = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();

const mockWatchlist = [
  {
    match_id: '100', home_team: 'Arsenal', away_team: 'Chelsea',
    league: 'Premier League', date: '2026-03-17', status: 'active',
    strategic_context_at: null, recommended_custom_condition: '',
  },
  {
    match_id: '200', home_team: 'Liverpool', away_team: 'Man City',
    league: 'Premier League', date: '2026-03-17', status: 'active',
    strategic_context_at: null, recommended_custom_condition: '',
  },
  {
    match_id: '300', home_team: 'Barca', away_team: 'Real',
    league: 'La Liga', date: '2026-03-17', status: 'active',
    strategic_context_at: recentEnrich, recommended_custom_condition: '',
  },
];

vi.mock('../repos/watchlist.repo.js', () => ({
  getActiveWatchlist: vi.fn().mockResolvedValue(mockWatchlist),
  updateWatchlistEntry: vi.fn().mockResolvedValue({}),
}));

vi.mock('../lib/strategic-context.service.js', () => ({
  fetchStrategicContext: vi.fn().mockResolvedValue({
    home_motivation: 'Fighting for title race',
    away_motivation: 'Battling relegation',
    rotation_risk: 'No major rotation expected',
    key_absences: 'No major absences',
    h2h_narrative: 'Arsenal won last 3 meetings',
    league_positions: '2nd vs 18th',
    fixture_congestion: 'Champions League in 2 days',
  }),
}));

const { enrichWatchlistJob } = await import('../jobs/enrich-watchlist.job.js');

beforeEach(() => {
  vi.clearAllMocks();
});

describe('enrichWatchlistJob', () => {
  test('only enriches NS entries not recently enriched', async () => {
    const result = await enrichWatchlistJob();
    // match 100 = NS, not enriched → eligible
    // match 200 = 1H, skip (not NS)
    // match 300 = NS, but enriched 2h ago (< 6h stale) → skip
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

  test('re-enriches entries older than 6 hours', async () => {
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

  test('handles API errors gracefully', async () => {
    const service = await import('../lib/strategic-context.service.js');
    vi.mocked(service.fetchStrategicContext).mockRejectedValueOnce(new Error('Gemini rate limit'));

    const result = await enrichWatchlistJob();
    expect(result.checked).toBe(1);
    expect(result.enriched).toBe(0);
  });

  test('does not overwrite manually set conditions', async () => {
    const watchlistRepo = await import('../repos/watchlist.repo.js');
    vi.mocked(watchlistRepo.getActiveWatchlist).mockResolvedValueOnce([
      {
        match_id: '500', home_team: 'X', away_team: 'Y', league: 'L', date: '2026-03-17',
        status: 'active', strategic_context_at: null, recommended_custom_condition: 'Over 2.5 goals',
      },
    ] as never);
    const matchRepo = await import('../repos/matches.repo.js');
    vi.mocked(matchRepo.getAllMatches).mockResolvedValueOnce([
      { match_id: '500', status: 'NS' },
    ] as never);

    await enrichWatchlistJob();
    expect(watchlistRepo.updateWatchlistEntry).toHaveBeenCalledWith(
      '500',
      expect.not.objectContaining({ recommended_custom_condition: expect.any(String) }),
    );
  });
});
