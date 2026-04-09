import { beforeEach, describe, expect, test, vi } from 'vitest';

vi.mock('../lib/football-api.js', () => ({
  fetchLiveOdds: vi.fn(),
  fetchPreMatchOdds: vi.fn(),
}));

vi.mock('../lib/provider-sampling.js', () => ({
  extractStatusCode: vi.fn(() => null),
  recordProviderOddsSampleSafe: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../repos/provider-odds-cache.repo.js', () => ({
  getProviderOddsCache: vi.fn().mockResolvedValue(null),
  upsertProviderOddsCache: vi.fn().mockResolvedValue(null),
}));

const { normalizeApiSportsOddsResponse, resolveMatchOdds } = await import('../lib/odds-resolver.js');

describe('normalizeApiSportsOddsResponse', () => {
  test('normalizes API-Sports live odds[] payload into bookmakers[]', () => {
    const result = normalizeApiSportsOddsResponse([{
      fixture: { id: 100 },
      odds: [{
        id: 1,
        name: 'Match Winner',
        values: [
          { value: 'Home', odd: '2.10' },
          { value: 'Draw', odd: '3.40' },
          { value: 'Away', odd: '3.50' },
        ],
      }],
    }]);

    expect(result).toEqual([{
      fixture: { id: 100 },
      bookmakers: [{
        id: 0,
        name: 'Live Odds',
        bets: [{
          id: 1,
          name: 'Match Winner',
          values: [
            { value: 'Home', odd: '2.10' },
            { value: 'Draw', odd: '3.40' },
            { value: 'Away', odd: '3.50' },
          ],
        }],
      }],
    }]);
  });
});

describe('resolveMatchOdds', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('uses normalized live odds before pre-match', async () => {
    const footballApi = await import('../lib/football-api.js');

    vi.mocked(footballApi.fetchLiveOdds).mockResolvedValueOnce([{
      fixture: { id: 100 },
      odds: [{
        id: 2,
        name: 'Over/Under',
        values: [
          { value: 'Over', odd: '1.85', handicap: '2.5' },
          { value: 'Under', odd: '2.00', handicap: '2.5' },
        ],
      }],
    }] as never);

    const result = await resolveMatchOdds({ matchId: '100' });

    expect(result.oddsSource).toBe('live');
    expect(result.cacheStatus).toBe('refreshed');
    expect(Array.isArray(result.response)).toBe(true);
    expect(footballApi.fetchPreMatchOdds).not.toHaveBeenCalled();
  });

  test('falls back to pre-match when live is empty', async () => {
    const footballApi = await import('../lib/football-api.js');

    vi.mocked(footballApi.fetchLiveOdds).mockResolvedValueOnce([] as never);
    vi.mocked(footballApi.fetchPreMatchOdds).mockResolvedValueOnce([{
      fixture: { id: 100 },
      bookmakers: [{
        id: 1,
        name: 'PreMatchBook',
        bets: [{
          id: 2,
          name: 'Over/Under',
          values: [
            { value: 'Over', odd: '1.90', handicap: '2.5' },
            { value: 'Under', odd: '1.95', handicap: '2.5' },
          ],
        }],
      }],
    }] as never);

    const result = await resolveMatchOdds({
      matchId: '100',
      homeTeam: 'Team A',
      awayTeam: 'Team B',
    });

    expect(result.oddsSource).toBe('reference-prematch');
  });

  test('records final none state when all sources are unusable', async () => {
    const footballApi = await import('../lib/football-api.js');
    const sampling = await import('../lib/provider-sampling.js');

    vi.mocked(footballApi.fetchLiveOdds).mockResolvedValueOnce([] as never);
    vi.mocked(footballApi.fetchPreMatchOdds).mockResolvedValueOnce([] as never);

    const result = await resolveMatchOdds({
      matchId: '100',
      homeTeam: 'Team A',
      awayTeam: 'Team B',
      consumer: 'proxy-route',
      matchMinute: 61,
    });

    expect(result.oddsSource).toBe('none');
    expect(vi.mocked(sampling.recordProviderOddsSampleSafe)).toHaveBeenCalledTimes(3);
    expect(vi.mocked(sampling.recordProviderOddsSampleSafe)).toHaveBeenLastCalledWith(expect.objectContaining({
      provider: 'resolver',
      source: 'none',
      consumer: 'proxy-route',
      match_minute: 61,
      usable: false,
    }));
  });

  test('returns fresh cached odds without hitting providers', async () => {
    const footballApi = await import('../lib/football-api.js');
    const cacheRepo = await import('../repos/provider-odds-cache.repo.js');

    vi.mocked(cacheRepo.getProviderOddsCache).mockResolvedValueOnce({
      match_id: '100',
      odds_source: 'live',
      provider_source: 'api-football-live',
      response: [{ bookmakers: [{ bets: [{ name: 'Match Winner', values: [] }] }] }],
      coverage_flags: {},
      provider_trace: {},
      odds_fetched_at: '2026-03-25T12:00:00.000Z',
      cached_at: new Date().toISOString(),
      match_status: '2H',
      match_minute: 61,
      freshness: 'fresh',
      degraded: false,
      last_refresh_error: '',
      has_1x2: true,
      has_ou: false,
      has_ah: false,
      has_btts: false,
    } as never);

    const result = await resolveMatchOdds({ matchId: '100', status: '2H', matchMinute: 61 });

    expect(result.oddsSource).toBe('live');
    expect(result.cacheStatus).toBe('hit');
    expect(result.freshness).toBe('fresh');
    expect(footballApi.fetchLiveOdds).not.toHaveBeenCalled();
  });

  test('ignores fresh legacy the-odds-live cache rows and refreshes from API-Football providers', async () => {
    const footballApi = await import('../lib/football-api.js');
    const cacheRepo = await import('../repos/provider-odds-cache.repo.js');

    vi.mocked(cacheRepo.getProviderOddsCache).mockResolvedValueOnce({
      match_id: '100',
      odds_source: 'fallback-live',
      provider_source: 'the-odds-live',
      response: [{ bookmakers: [{ bets: [{ name: 'Match Winner', values: [] }] }] }],
      coverage_flags: {},
      provider_trace: {},
      odds_fetched_at: '2026-03-25T12:00:00.000Z',
      cached_at: new Date().toISOString(),
      match_status: '2H',
      match_minute: 61,
      freshness: 'fresh',
      degraded: false,
      last_refresh_error: '',
      has_1x2: true,
      has_ou: false,
      has_ah: false,
      has_btts: false,
    } as never);
    vi.mocked(footballApi.fetchLiveOdds).mockResolvedValueOnce([] as never);
    vi.mocked(footballApi.fetchPreMatchOdds).mockResolvedValueOnce([] as never);

    const result = await resolveMatchOdds({
      matchId: '100',
      status: '2H',
      matchMinute: 61,
      homeTeam: 'Team A',
      awayTeam: 'Team B',
    });

    expect(footballApi.fetchLiveOdds).toHaveBeenCalledWith('100');
    expect(result.oddsSource).toBe('none');
    expect(result.cacheStatus).toBe('miss');
  });

  test('does not reuse stale cached live odds when real-time freshness is required', async () => {
    const footballApi = await import('../lib/football-api.js');
    const cacheRepo = await import('../repos/provider-odds-cache.repo.js');

    vi.mocked(cacheRepo.getProviderOddsCache).mockResolvedValueOnce({
      match_id: '100',
      odds_source: 'live',
      provider_source: 'api-football-live',
      response: [{ bookmakers: [{ bets: [{ name: 'Match Winner', values: [] }] }] }],
      coverage_flags: {},
      provider_trace: {},
      odds_fetched_at: '2026-03-25T12:00:00.000Z',
      cached_at: '2026-03-25T12:00:00.000Z',
      match_status: '2H',
      match_minute: 61,
      freshness: 'fresh',
      degraded: false,
      last_refresh_error: '',
      has_1x2: true,
      has_ou: false,
      has_ah: false,
      has_btts: false,
    } as never);
    vi.mocked(footballApi.fetchLiveOdds).mockResolvedValueOnce([] as never);
    vi.mocked(footballApi.fetchPreMatchOdds).mockResolvedValueOnce([] as never);

    const result = await resolveMatchOdds({
      matchId: '100',
      status: '2H',
      matchMinute: 61,
      homeTeam: 'Team A',
      awayTeam: 'Team B',
      freshnessMode: 'real_required',
    });

    expect(footballApi.fetchLiveOdds).toHaveBeenCalledWith('100');
    expect(result).toEqual({
      oddsSource: 'none',
      response: [],
      oddsFetchedAt: null,
      freshness: 'missing',
      cacheStatus: 'miss',
    });
  });

  test('still allows stale cached odds on live paths when explicitly stale-safe', async () => {
    const footballApi = await import('../lib/football-api.js');
    const cacheRepo = await import('../repos/provider-odds-cache.repo.js');

    vi.mocked(cacheRepo.getProviderOddsCache).mockResolvedValueOnce({
      match_id: '100',
      odds_source: 'live',
      provider_source: 'api-football-live',
      response: [{ bookmakers: [{ bets: [{ name: 'Match Winner', values: [] }] }] }],
      coverage_flags: {},
      provider_trace: {},
      odds_fetched_at: '2026-03-25T12:00:00.000Z',
      cached_at: '2026-03-25T12:00:00.000Z',
      match_status: '2H',
      match_minute: 61,
      freshness: 'fresh',
      degraded: false,
      last_refresh_error: '',
      has_1x2: true,
      has_ou: false,
      has_ah: false,
      has_btts: false,
    } as never);
    vi.mocked(footballApi.fetchLiveOdds).mockResolvedValueOnce([] as never);
    vi.mocked(footballApi.fetchPreMatchOdds).mockResolvedValueOnce([] as never);

    const result = await resolveMatchOdds({
      matchId: '100',
      status: '2H',
      matchMinute: 61,
      homeTeam: 'Team A',
      awayTeam: 'Team B',
      freshnessMode: 'stale_safe',
    });

    expect(result.oddsSource).toBe('live');
    expect(result.cacheStatus).toBe('stale_fallback');
    expect(result.freshness).toBe('stale_degraded');
  });
});
