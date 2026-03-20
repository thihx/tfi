import { beforeEach, describe, expect, test, vi } from 'vitest';

vi.mock('../lib/football-api.js', () => ({
  fetchLiveOdds: vi.fn(),
  fetchPreMatchOdds: vi.fn(),
}));

vi.mock('../lib/the-odds-api.js', () => ({
  fetchTheOddsLiveDetailed: vi.fn(),
}));

vi.mock('../lib/provider-sampling.js', () => ({
  extractStatusCode: vi.fn(() => null),
  recordProviderOddsSampleSafe: vi.fn().mockResolvedValue(undefined),
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

  test('uses normalized live odds before any fallback', async () => {
    const footballApi = await import('../lib/football-api.js');
    const theOddsApi = await import('../lib/the-odds-api.js');

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
    expect(Array.isArray(result.response)).toBe(true);
    expect(vi.mocked(theOddsApi.fetchTheOddsLiveDetailed)).not.toHaveBeenCalled();
    expect(footballApi.fetchPreMatchOdds).not.toHaveBeenCalled();
  });

  test('prefers The Odds exact-event fallback before pre-match', async () => {
    const footballApi = await import('../lib/football-api.js');
    const theOddsApi = await import('../lib/the-odds-api.js');

    vi.mocked(footballApi.fetchLiveOdds).mockResolvedValueOnce([] as never);
    vi.mocked(theOddsApi.fetchTheOddsLiveDetailed).mockResolvedValueOnce({
      result: {
        fixture: { id: 100 },
        bookmakers: [{
          id: 100,
          name: 'FallbackBook',
          bets: [{
            id: 2,
            name: 'Over/Under',
            values: [
              { value: 'Over', odd: '1.88', handicap: '2.5' },
              { value: 'Under', odd: '1.98', handicap: '2.5' },
            ],
          }],
        }],
      },
      matchedEvent: null,
      rawEventOdds: null,
      sportKey: 'soccer_epl',
      scannedSportKeys: ['soccer_epl'],
      error: null,
    } as never);

    const result = await resolveMatchOdds({
      matchId: '100',
      homeTeam: 'Team A',
      awayTeam: 'Team B',
      kickoffTimestamp: 1700000000,
      leagueName: 'Premier League',
      leagueCountry: 'England',
      status: '2H',
    });

    expect(result.oddsSource).toBe('the-odds-api');
    expect(footballApi.fetchPreMatchOdds).not.toHaveBeenCalled();
  });

  test('falls back to pre-match when live and The Odds are unavailable', async () => {
    const footballApi = await import('../lib/football-api.js');
    const theOddsApi = await import('../lib/the-odds-api.js');

    vi.mocked(footballApi.fetchLiveOdds).mockResolvedValueOnce([] as never);
    vi.mocked(theOddsApi.fetchTheOddsLiveDetailed).mockResolvedValueOnce({
      result: null,
      matchedEvent: null,
      rawEventOdds: null,
      sportKey: null,
      scannedSportKeys: ['soccer_epl'],
      error: 'NO_EXACT_EVENT_MATCH',
    } as never);
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

    expect(result.oddsSource).toBe('pre-match');
  });

  test('records final none state when all sources are unusable', async () => {
    const footballApi = await import('../lib/football-api.js');
    const theOddsApi = await import('../lib/the-odds-api.js');
    const sampling = await import('../lib/provider-sampling.js');

    vi.mocked(footballApi.fetchLiveOdds).mockResolvedValueOnce([] as never);
    vi.mocked(theOddsApi.fetchTheOddsLiveDetailed).mockResolvedValueOnce({
      result: null,
      matchedEvent: null,
      rawEventOdds: null,
      sportKey: null,
      scannedSportKeys: ['soccer_epl'],
      error: 'NO_EXACT_EVENT_MATCH',
    } as never);
    vi.mocked(footballApi.fetchPreMatchOdds).mockResolvedValueOnce([] as never);

    const result = await resolveMatchOdds({
      matchId: '100',
      homeTeam: 'Team A',
      awayTeam: 'Team B',
      consumer: 'proxy-route',
      matchMinute: 61,
    });

    expect(result.oddsSource).toBe('none');
    expect(vi.mocked(sampling.recordProviderOddsSampleSafe)).toHaveBeenCalledTimes(4);
    expect(vi.mocked(sampling.recordProviderOddsSampleSafe)).toHaveBeenLastCalledWith(expect.objectContaining({
      provider: 'resolver',
      source: 'none',
      consumer: 'proxy-route',
      match_minute: 61,
      usable: false,
    }));
  });
});
