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

const { normalizeApiSportsOddsResponse, resolveMatchOdds, summarizeNormalizedOdds } = await import('../lib/odds-resolver.js');

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

describe('summarizeNormalizedOdds', () => {
  test('detects API-Sports market coverage across common live odds names', () => {
    const summary = summarizeNormalizedOdds([{
      bookmakers: [{
        id: 1,
        name: 'Live Odds',
        bets: [
          {
            id: 1,
            name: 'Full Time Result',
            values: [
              { value: '1', odd: '2.10' },
              { value: 'X', odd: '3.20' },
              { value: '2', odd: '3.40' },
            ],
          },
          {
            id: 2,
            name: 'Goals Over/Under',
            values: [
              { value: 'Over', odd: '1.88', handicap: '2.5' },
              { value: 'Under', odd: '1.96', handicap: '2.5' },
            ],
          },
          {
            id: 3,
            name: 'Handicap Result',
            values: [
              { value: 'Home', odd: '1.91', handicap: '-0.25' },
              { value: 'Away', odd: '1.95', handicap: '+0.25' },
            ],
          },
          {
            id: 4,
            name: 'Both Teams To Score',
            values: [
              { value: 'Yes', odd: '1.75' },
              { value: 'No', odd: '2.05' },
            ],
          },
        ],
      }],
    }]);

    expect(summary).toEqual(expect.objectContaining({
      bookmaker_count: 1,
      bet_count: 4,
      priced_bet_count: 4,
      one_x2_bet_count: 1,
      ou_bet_count: 1,
      ah_bet_count: 1,
      btts_bet_count: 1,
      has_1x2: true,
      has_ou: true,
      has_ah: true,
      has_btts: true,
      canonical_has_1x2: true,
      canonical_has_ou: true,
      canonical_has_ah: true,
      canonical_has_btts: true,
    }));
  });

  test('does not mark an unpriced market as covered', () => {
    const summary = summarizeNormalizedOdds([{
      bookmakers: [{
        name: 'Live Odds',
        bets: [{
          name: 'Match Winner',
          values: [
            { value: 'Home', odd: '0' },
            { value: 'Draw', odd: '' },
            { value: 'Away', odd: '1' },
          ],
        }],
      }],
    }]);

    expect(summary).toEqual(expect.objectContaining({
      one_x2_bet_count: 1,
      priced_bet_count: 0,
      has_1x2: false,
      canonical_has_1x2: false,
    }));
  });

  test('keeps raw 1X2 availability separate from canonical tradability', () => {
    const summary = summarizeNormalizedOdds([{
      bookmakers: [{
        name: 'Live Odds',
        bets: [
          {
            name: '1x2 - 80 minutes',
            values: [
              { value: 'Home', odd: '251.00' },
              { value: 'Draw', odd: '11.00' },
              { value: 'Away', odd: '1.045' },
            ],
          },
          {
            name: 'Corners 1x2',
            values: [
              { value: 'Home', odd: '1.57' },
              { value: 'Draw', odd: '3.40' },
              { value: 'Away', odd: '5.00' },
            ],
          },
          {
            name: 'Fulltime Result',
            values: [
              { value: 'Home', odd: '41.00' },
              { value: 'Draw', odd: '4.50' },
              { value: 'Away', odd: '1.20' },
            ],
          },
        ],
      }],
    }]);

    expect(summary).toEqual(expect.objectContaining({
      has_1x2: true,
      one_x2_bet_count: 1,
      canonical_has_1x2: true,
    }));
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
