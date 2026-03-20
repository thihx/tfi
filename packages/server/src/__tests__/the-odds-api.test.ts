import { afterAll, beforeEach, describe, expect, test, vi } from 'vitest';

vi.mock('../config.js', () => ({
  config: {
    theOddsApiKey: 'test-key',
    theOddsApiBaseUrl: 'https://the-odds-api.example.com/v4',
  },
}));

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

const {
  clearTheOddsCaches,
  convertToApiSportsFormat,
  fetchTheOddsLive,
  findMatchingEvent,
} = await import('../lib/the-odds-api.js');

beforeEach(() => {
  clearTheOddsCaches();
  mockFetch.mockReset();
});

afterAll(() => {
  vi.unstubAllGlobals();
});

describe('findMatchingEvent', () => {
  test('distinguishes Manchester United from Manchester City', () => {
    const result = findMatchingEvent(
      [
        {
          id: 'city',
          sport_key: 'soccer_epl',
          sport_title: 'EPL',
          commence_time: '2026-03-20T12:00:00Z',
          home_team: 'Manchester City',
          away_team: 'Burnley',
        },
        {
          id: 'utd',
          sport_key: 'soccer_epl',
          sport_title: 'EPL',
          commence_time: '2026-03-20T12:00:00Z',
          home_team: 'Manchester United',
          away_team: 'Fulham',
        },
      ],
      'Manchester United',
      'Fulham',
      Date.parse('2026-03-20T12:00:00Z') / 1000,
      { leagueName: 'Premier League', leagueCountry: 'England', status: '2H' },
    );

    expect(result?.id).toBe('utd');
  });
});

describe('convertToApiSportsFormat', () => {
  test('keeps only safe markets for the current canonical model', () => {
    const result = convertToApiSportsFormat({
      id: 'event-1',
      sport_key: 'soccer_epl',
      sport_title: 'EPL',
      commence_time: '2026-03-20T12:00:00Z',
      home_team: 'Arsenal',
      away_team: 'Chelsea',
      bookmakers: [{
        key: 'test',
        title: 'TestBook',
        last_update: '2026-03-20T12:45:00Z',
        markets: [
          {
            key: 'h2h',
            last_update: '2026-03-20T12:45:00Z',
            outcomes: [
              { name: 'Arsenal', price: 2.1 },
              { name: 'Draw', price: 3.4 },
              { name: 'Chelsea', price: 3.5 },
            ],
          },
          {
            key: 'totals',
            last_update: '2026-03-20T12:45:00Z',
            outcomes: [
              { name: 'Over', price: 1.9, point: 2.5 },
              { name: 'Under', price: 1.95, point: 2.5 },
            ],
          },
          {
            key: 'spreads',
            last_update: '2026-03-20T12:45:00Z',
            outcomes: [
              { name: 'Arsenal', price: 1.91, point: -0.5 },
              { name: 'Chelsea', price: 1.99, point: 0.5 },
            ],
          },
        ],
      }],
    }, 123);

    expect(result.bookmakers[0]?.bets.map((bet) => bet.name)).toEqual(['Match Winner', 'Over/Under']);
  });
});

describe('fetchTheOddsLive', () => {
  test('uses events lookup then fetches exact event odds and caches the result', async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ([{
          id: 'epl-123',
          sport_key: 'soccer_epl',
          sport_title: 'EPL',
          commence_time: '2026-03-20T12:00:00Z',
          home_team: 'Arsenal',
          away_team: 'Chelsea',
        }]),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: 'epl-123',
          sport_key: 'soccer_epl',
          sport_title: 'EPL',
          commence_time: '2026-03-20T12:00:00Z',
          home_team: 'Arsenal',
          away_team: 'Chelsea',
          bookmakers: [{
            key: 'test',
            title: 'TestBook',
            last_update: '2026-03-20T12:45:00Z',
            markets: [{
              key: 'h2h',
              last_update: '2026-03-20T12:45:00Z',
              outcomes: [
                { name: 'Arsenal', price: 2.1 },
                { name: 'Draw', price: 3.4 },
                { name: 'Chelsea', price: 3.5 },
              ],
            }],
          }],
        }),
      });

    const first = await fetchTheOddsLive(
      'Arsenal',
      'Chelsea',
      123,
      Date.parse('2026-03-20T12:00:00Z') / 1000,
      { leagueName: 'Premier League', leagueCountry: 'England', status: '2H' },
    );
    const second = await fetchTheOddsLive(
      'Arsenal',
      'Chelsea',
      123,
      Date.parse('2026-03-20T12:00:00Z') / 1000,
      { leagueName: 'Premier League', leagueCountry: 'England', status: '2H' },
    );

    expect(first?.bookmakers).toHaveLength(1);
    expect(second?.bookmakers).toHaveLength(1);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  test('does not stop at unrelated cached sports and can still resolve a later hinted sport', async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ([{
          id: 'epl-123',
          sport_key: 'soccer_epl',
          sport_title: 'EPL',
          commence_time: '2026-03-20T12:00:00Z',
          home_team: 'Arsenal',
          away_team: 'Chelsea',
        }]),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: 'epl-123',
          sport_key: 'soccer_epl',
          sport_title: 'EPL',
          commence_time: '2026-03-20T12:00:00Z',
          home_team: 'Arsenal',
          away_team: 'Chelsea',
          bookmakers: [{
            key: 'test',
            title: 'TestBook',
            last_update: '2026-03-20T12:45:00Z',
            markets: [{
              key: 'h2h',
              last_update: '2026-03-20T12:45:00Z',
              outcomes: [
                { name: 'Arsenal', price: 2.1 },
                { name: 'Draw', price: 3.4 },
                { name: 'Chelsea', price: 3.5 },
              ],
            }],
          }],
        }),
      });

    await fetchTheOddsLive(
      'Arsenal',
      'Chelsea',
      123,
      Date.parse('2026-03-20T12:00:00Z') / 1000,
      { leagueName: 'Premier League', leagueCountry: 'England', status: '2H' },
    );

    mockFetch.mockReset();
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ([{
          id: 'kleague-456',
          sport_key: 'soccer_korea_kleague1',
          sport_title: 'K League 1',
          commence_time: '2026-03-20T13:00:00Z',
          home_team: 'Ulsan Hyundai',
          away_team: 'Jeonbuk Motors',
        }]),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: 'kleague-456',
          sport_key: 'soccer_korea_kleague1',
          sport_title: 'K League 1',
          commence_time: '2026-03-20T13:00:00Z',
          home_team: 'Ulsan Hyundai',
          away_team: 'Jeonbuk Motors',
          bookmakers: [{
            key: 'test',
            title: 'TestBook',
            last_update: '2026-03-20T13:30:00Z',
            markets: [{
              key: 'h2h',
              last_update: '2026-03-20T13:30:00Z',
              outcomes: [
                { name: 'Ulsan Hyundai', price: 2.3 },
                { name: 'Draw', price: 3.0 },
                { name: 'Jeonbuk Motors', price: 3.1 },
              ],
            }],
          }],
        }),
      });

    const result = await fetchTheOddsLive(
      'Ulsan Hyundai',
      'Jeonbuk Motors',
      456,
      Date.parse('2026-03-20T13:00:00Z') / 1000,
      { leagueName: 'K League 1', leagueCountry: 'South Korea', status: '2H' },
    );

    expect(result?.bookmakers).toHaveLength(1);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });
});
