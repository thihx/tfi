import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const recordProviderRequestSafe = vi.fn();

vi.mock('../repos/provider-request-ledger.repo.js', () => ({
  recordProviderRequestSafe,
}));

function headers(values: Record<string, string>): Headers {
  return new Headers(values);
}

describe('the-odds-api client', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.resetModules();
    recordProviderRequestSafe.mockReset();
    process.env['THEODDSAPI_API_TOKEN'] = 'odds-secret';
    process.env['THEODDSAPI_BASE_URL'] = 'https://odds.example.test';
    process.env['THEODDSAPI_API_TIMEOUT_MS'] = '1000';
  });

  afterEach(() => {
    global.fetch = originalFetch;
    delete process.env['THEODDSAPI_API_TOKEN'];
    delete process.env['THEODDSAPI_BASE_URL'];
    delete process.env['THEODDSAPI_API_TIMEOUT_MS'];
    delete process.env['THEODDSAPI_REGIONS'];
    delete process.env['THEODDSAPI_MARKETS'];
  });

  it('calls odds endpoint with token but stores redacted ledger params and quota metadata', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: headers({
        'x-requests-remaining': '493',
        'x-requests-used': '7',
        'x-requests-last': '1',
      }),
      text: async () => JSON.stringify([{ id: 'evt_123', home_team: 'A', away_team: 'B' }]),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const { fetchTheOddsApiOdds } = await import('../lib/the-odds-api.js');
    const result = await fetchTheOddsApiOdds({
      sportKey: 'soccer_fifa_world_cup',
      regions: 'eu',
      markets: 'h2h,totals',
      eventIds: ['evt_123'],
      consumer: 'unit-test',
    });

    expect(result.data).toHaveLength(1);
    expect(result.quota).toEqual({
      requestsRemaining: 493,
      requestsUsed: 7,
      requestsLast: 1,
    });
    const calledUrl = new URL(fetchMock.mock.calls[0]![0] as string);
    expect(calledUrl.origin + calledUrl.pathname).toBe('https://odds.example.test/v4/sports/soccer_fifa_world_cup/odds');
    expect(calledUrl.searchParams.get('apiKey')).toBe('odds-secret');
    expect(calledUrl.searchParams.get('regions')).toBe('eu');
    expect(calledUrl.searchParams.get('markets')).toBe('h2h,totals');
    expect(calledUrl.searchParams.get('eventIds')).toBe('evt_123');

    expect(recordProviderRequestSafe).toHaveBeenCalledWith(expect.objectContaining({
      provider: 'the-odds-api',
      endpoint: '/v4/sports/soccer_fifa_world_cup/odds',
      consumer: 'unit-test',
      success: true,
      statusCode: 200,
      resultCount: 1,
      params: expect.objectContaining({
        apiKey: '[redacted]',
        regions: 'eu',
        markets: 'h2h,totals',
      }),
      quotaCurrent: 7,
      quotaLimit: 500,
      responseMeta: {
        quota: {
          requestsRemaining: 493,
          requestsUsed: 7,
          requestsLast: 1,
        },
      },
    }));
    expect(JSON.stringify(recordProviderRequestSafe.mock.calls)).not.toContain('odds-secret');
  });

  it('drops unsupported market keys before calling the odds endpoint', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: headers({ 'x-requests-remaining': '500', 'x-requests-used': '0', 'x-requests-last': '0' }),
      text: async () => JSON.stringify([]),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const { fetchTheOddsApiOdds } = await import('../lib/the-odds-api.js');
    await fetchTheOddsApiOdds({
      sportKey: 'soccer_spain_segunda_division',
      markets: 'h2h,btts,totals,unsupported,spreads',
    });

    const calledUrl = new URL(fetchMock.mock.calls[0]![0] as string);
    expect(calledUrl.searchParams.get('markets')).toBe('h2h,totals,spreads');
    expect(recordProviderRequestSafe).toHaveBeenCalledWith(expect.objectContaining({
      params: expect.objectContaining({
        markets: 'h2h,totals,spreads',
      }),
    }));
  });

  it('records rate limited API failures once', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 429,
      headers: headers({ 'x-requests-remaining': '0', 'x-requests-used': '500' }),
      text: async () => JSON.stringify({ message: 'quota used' }),
    }) as unknown as typeof fetch;

    const { fetchTheOddsApiOdds } = await import('../lib/the-odds-api.js');
    await expect(fetchTheOddsApiOdds({ sportKey: 'soccer_epl' })).rejects.toThrow('The Odds API 429');

    expect(recordProviderRequestSafe).toHaveBeenCalledTimes(1);
    expect(recordProviderRequestSafe).toHaveBeenCalledWith(expect.objectContaining({
      provider: 'the-odds-api',
      success: false,
      rateLimited: true,
      statusCode: 429,
      quotaCurrent: 500,
      quotaLimit: 500,
      error: '{"message":"quota used"}',
    }));
  });

  it('fails before network when token is missing and classifies quota state', async () => {
    delete process.env['THEODDSAPI_API_TOKEN'];
    const fetchMock = vi.fn();
    global.fetch = fetchMock as unknown as typeof fetch;

    const { fetchTheOddsApiOdds, inferTheOddsApiQuotaState } = await import('../lib/the-odds-api.js');

    await expect(fetchTheOddsApiOdds({ sportKey: 'soccer_epl' }))
      .rejects.toThrow('THEODDSAPI_API_TOKEN not configured');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(recordProviderRequestSafe).not.toHaveBeenCalled();
    expect(inferTheOddsApiQuotaState({ requestsRemaining: 40, requestsUsed: 60, requestsLast: 1 })).toBe('elevated');
    expect(inferTheOddsApiQuotaState({ requestsRemaining: 4, requestsUsed: 96, requestsLast: 1 })).toBe('critical');
    expect(inferTheOddsApiQuotaState({ requestsRemaining: null, requestsUsed: null, requestsLast: null })).toBe('unknown');
    expect(inferTheOddsApiQuotaState({ requestsRemaining: 0, requestsUsed: 500, requestsLast: 1 })).toBe('daily_limit');
    expect(inferTheOddsApiQuotaState({ requestsRemaining: 1, requestsUsed: 1, requestsLast: 1 }, 429)).toBe('daily_limit');
  });

  it('records malformed success responses as provider failures', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: headers({}),
      text: async () => '{not-json',
    }) as unknown as typeof fetch;

    const { fetchTheOddsApiOdds } = await import('../lib/the-odds-api.js');

    await expect(fetchTheOddsApiOdds({ sportKey: 'soccer_epl', consumer: 'unit-test' })).rejects.toThrow();
    expect(recordProviderRequestSafe).toHaveBeenCalledWith(expect.objectContaining({
      provider: 'the-odds-api',
      endpoint: '/v4/sports/soccer_epl/odds',
      consumer: 'unit-test',
      success: false,
      statusCode: null,
    }));
  });

  it('handles empty and non-array successful payloads without leaking key aliases', async () => {
    delete process.env['THEODDSAPI_API_TOKEN'];
    delete process.env['THEODDSAPI_BASE_URL'];
    delete process.env['THEODDSAPI_API_TIMEOUT_MS'];
    process.env['THE_ODDS_API_KEY'] = 'legacy-key-alias';
    process.env['THE_ODDS_API_TIMEOUT_MS'] = '1500';
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: headers({}),
        text: async () => '',
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: headers({ 'x-requests-remaining': '', 'x-requests-used': 'bad', 'x-requests-last': '2' }),
        text: async () => JSON.stringify({ message: 'object payload' }),
      });
    global.fetch = fetchMock as unknown as typeof fetch;

    const { fetchTheOddsApiOdds, theOddsApiGet, inferTheOddsApiQuotaState } = await import('../lib/the-odds-api.js');

    const empty = await fetchTheOddsApiOdds({ sportKey: 'soccer_epl', timeoutMs: 50 });
    expect(empty.data).toEqual([]);
    let calledUrl = new URL(fetchMock.mock.calls[0]![0] as string);
    expect(calledUrl.origin + calledUrl.pathname).toBe('https://api.the-odds-api.com/v4/sports/soccer_epl/odds');
    expect(calledUrl.searchParams.get('apiKey')).toBe('legacy-key-alias');

    const objectPayload = await theOddsApiGet('v4/sports', { apiKey: 'legacy-key-alias' });
    expect(objectPayload.data).toEqual([]);
    calledUrl = new URL(fetchMock.mock.calls[1]![0] as string);
    expect(calledUrl.pathname).toBe('/v4/sports');
    expect(recordProviderRequestSafe).toHaveBeenLastCalledWith(expect.objectContaining({
      provider: 'the-odds-api',
      success: true,
      resultCount: 0,
      quotaCurrent: null,
      quotaLimit: null,
      params: { apiKey: '[redacted]' },
    }));
    expect(inferTheOddsApiQuotaState({ requestsRemaining: 0, requestsUsed: 0, requestsLast: null })).toBe('unknown');
    expect(JSON.stringify(recordProviderRequestSafe.mock.calls)).not.toContain('legacy-key-alias');

    delete process.env['THE_ODDS_API_KEY'];
    delete process.env['THE_ODDS_API_TIMEOUT_MS'];
  });

  it('records non-API network failures once with redacted params', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('socket closed')) as unknown as typeof fetch;

    const { theOddsApiGet } = await import('../lib/the-odds-api.js');

    await expect(theOddsApiGet('/v4/sports', { apiKey: 'odds-secret', group: 'soccer' }, {
      consumer: 'unit-test',
      jobName: 'shadow',
    })).rejects.toThrow('socket closed');
    expect(recordProviderRequestSafe).toHaveBeenCalledTimes(1);
    expect(recordProviderRequestSafe).toHaveBeenCalledWith(expect.objectContaining({
      provider: 'the-odds-api',
      endpoint: '/v4/sports',
      consumer: 'unit-test',
      jobName: 'shadow',
      success: false,
      statusCode: null,
      error: 'socket closed',
      params: { apiKey: '[redacted]', group: 'soccer' },
    }));
  });

  it('supports fallback env aliases, optional filters, and direct path calls', async () => {
    delete process.env['THEODDSAPI_API_TOKEN'];
    delete process.env['THEODDSAPI_BASE_URL'];
    process.env['THE_ODDS_API_TOKEN'] = 'alias-secret';
    process.env['THE_ODDS_API_BASE_URL'] = 'https://alias-odds.example.test/';
    process.env['THEODDSAPI_REGIONS'] = 'us';
    process.env['THEODDSAPI_MARKETS'] = 'h2h';
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: headers({ 'x-requests-remaining': '80', 'x-requests-used': '20' }),
      text: async () => JSON.stringify([]),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const { fetchTheOddsApiOdds, theOddsApiGet, inferTheOddsApiQuotaState } = await import('../lib/the-odds-api.js');

    await fetchTheOddsApiOdds({
      sportKey: 'soccer_epl',
      bookmakers: 'bet365',
      commenceTimeFrom: '2026-06-14T00:00:00.000Z',
      commenceTimeTo: '2026-06-15T00:00:00.000Z',
      oddsFormat: 'american',
      dateFormat: 'unix',
    });
    let calledUrl = new URL(fetchMock.mock.calls[0]![0] as string);
    expect(calledUrl.origin + calledUrl.pathname).toBe('https://alias-odds.example.test/v4/sports/soccer_epl/odds');
    expect(calledUrl.searchParams.get('apiKey')).toBe('alias-secret');
    expect(calledUrl.searchParams.get('regions')).toBe('us');
    expect(calledUrl.searchParams.get('markets')).toBe('h2h');
    expect(calledUrl.searchParams.get('bookmakers')).toBe('bet365');
    expect(calledUrl.searchParams.get('commenceTimeFrom')).toBe('2026-06-14T00:00:00Z');
    expect(calledUrl.searchParams.get('commenceTimeTo')).toBe('2026-06-15T00:00:00Z');
    expect(calledUrl.searchParams.get('oddsFormat')).toBe('american');
    expect(calledUrl.searchParams.get('dateFormat')).toBe('unix');

    await theOddsApiGet('v4/sports', { api_key: 'alias-secret', group: 'soccer' }, { consumer: 'direct' });
    calledUrl = new URL(fetchMock.mock.calls[1]![0] as string);
    expect(calledUrl.pathname).toBe('/v4/sports');
    expect(recordProviderRequestSafe).toHaveBeenLastCalledWith(expect.objectContaining({
      endpoint: 'v4/sports',
      consumer: 'direct',
      params: { api_key: '[redacted]', group: 'soccer' },
    }));
    expect(inferTheOddsApiQuotaState({ requestsRemaining: 20, requestsUsed: 80, requestsLast: 1 })).toBe('high');

    delete process.env['THE_ODDS_API_TOKEN'];
    delete process.env['THE_ODDS_API_BASE_URL'];
  });
});
