import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const recordProviderRequestSafe = vi.fn();

vi.mock('../repos/provider-request-ledger.repo.js', () => ({
  recordProviderRequestSafe,
}));

describe('sportmonks-api', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.resetModules();
    recordProviderRequestSafe.mockReset();
    process.env['SPORTMONKS_API_TOKEN'] = 'secret-token';
    process.env['SPORTMONKS_API_BASE_URL'] = 'https://api.sportmonks.test/v3/football';
    process.env['SPORTMONKS_API_TIMEOUT_MS'] = '1000';
  });

  afterEach(() => {
    global.fetch = originalFetch;
    delete process.env['SPORTMONKS_API_TOKEN'];
    delete process.env['SPORTMONKS_API_BASE_URL'];
    delete process.env['SPORTMONKS_API_TIMEOUT_MS'];
  });

  it('calls Sportmonks with api_token but records redacted params', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({
        data: [{ id: 123, name: 'A vs B' }],
        timezone: 'UTC',
        rate_limit: {
          remaining: 2499,
          resets_in_seconds: 3550,
          requested_entity: 'Fixture',
        },
      }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const { fetchSportmonksLivescores } = await import('../lib/sportmonks-api.js');
    const result = await fetchSportmonksLivescores({ include: 'participants;scores', consumer: 'unit-test' });

    expect(result.data).toHaveLength(1);
    expect(result.rateLimit).toEqual({
      remaining: 2499,
      resetsInSeconds: 3550,
      requestedEntity: 'Fixture',
    });
    const calledUrl = new URL(fetchMock.mock.calls[0]![0] as string);
    expect(calledUrl.origin + calledUrl.pathname).toBe('https://api.sportmonks.test/v3/football/livescores');
    expect(calledUrl.searchParams.get('api_token')).toBe('secret-token');
    expect(calledUrl.searchParams.get('include')).toBe('participants;scores');

    expect(recordProviderRequestSafe).toHaveBeenCalledWith(expect.objectContaining({
      provider: 'sportmonks',
      endpoint: '/livescores',
      consumer: 'unit-test',
      success: true,
      statusCode: 200,
      resultCount: 1,
      params: { include: 'participants;scores' },
      responseMeta: expect.objectContaining({
        hasRateLimit: true,
        rateLimit: {
          remaining: 2499,
          resetsInSeconds: 3550,
          requestedEntity: 'Fixture',
        },
      }),
    }));
    expect(JSON.stringify(recordProviderRequestSafe.mock.calls)).not.toContain('secret-token');
  });

  it('records rate limited failures', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 429,
      text: async () => JSON.stringify({ message: 'Too many requests' }),
    }) as unknown as typeof fetch;

    const { fetchSportmonksFixtureById } = await import('../lib/sportmonks-api.js');
    await expect(fetchSportmonksFixtureById('123', { consumer: 'unit-test' })).rejects.toThrow('Sportmonks API 429');

    expect(recordProviderRequestSafe).toHaveBeenCalledWith(expect.objectContaining({
      provider: 'sportmonks',
      endpoint: '/fixtures/123',
      success: false,
      rateLimited: true,
      statusCode: 429,
    }));
  });

  it('fails before calling the network when the API token is missing', async () => {
    delete process.env['SPORTMONKS_API_TOKEN'];
    const fetchMock = vi.fn();
    global.fetch = fetchMock as unknown as typeof fetch;

    const { fetchSportmonksLivescores } = await import('../lib/sportmonks-api.js');

    await expect(fetchSportmonksLivescores()).rejects.toThrow('SPORTMONKS_API_TOKEN not configured');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(recordProviderRequestSafe).not.toHaveBeenCalled();
  });

  it('records non-API network failures once with redacted metadata', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('socket closed')) as unknown as typeof fetch;

    const { fetchSportmonksLivescores } = await import('../lib/sportmonks-api.js');

    await expect(fetchSportmonksLivescores({ consumer: 'unit-test', jobName: 'shadow' }))
      .rejects.toThrow('socket closed');
    expect(recordProviderRequestSafe).toHaveBeenCalledTimes(1);
    expect(recordProviderRequestSafe).toHaveBeenCalledWith(expect.objectContaining({
      provider: 'sportmonks',
      endpoint: '/livescores',
      consumer: 'unit-test',
      jobName: 'shadow',
      success: false,
      statusCode: null,
      error: 'socket closed',
    }));
  });

  it('serializes structured API errors without double-recording the failed request', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 403,
      text: async () => JSON.stringify({ errors: { token: ['Forbidden'] } }),
    }) as unknown as typeof fetch;

    const { fetchSportmonksFixtureById } = await import('../lib/sportmonks-api.js');

    await expect(fetchSportmonksFixtureById('abc/123')).rejects.toThrow('Sportmonks API 403');
    expect(recordProviderRequestSafe).toHaveBeenCalledTimes(1);
    expect(recordProviderRequestSafe).toHaveBeenCalledWith(expect.objectContaining({
      endpoint: '/fixtures/abc%2F123',
      success: false,
      statusCode: 403,
      error: '{"token":["Forbidden"]}',
    }));
  });

  it('supports latest livescores with empty successful responses', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => '',
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const { fetchSportmonksLatestLivescores } = await import('../lib/sportmonks-api.js');
    const result = await fetchSportmonksLatestLivescores();

    expect(result.data).toEqual([]);
    const calledUrl = new URL(fetchMock.mock.calls[0]![0] as string);
    expect(calledUrl.pathname).toBe('/v3/football/livescores/latest');
    expect(recordProviderRequestSafe).toHaveBeenCalledWith(expect.objectContaining({
      success: true,
      resultCount: 0,
    }));
  });

  it('requests statistic type metadata by default so live stats can be canonicalized', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ data: { id: 321, statistics: [] } }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const { fetchSportmonksFixtureById } = await import('../lib/sportmonks-api.js');
    await fetchSportmonksFixtureById('321');

    const calledUrl = new URL(fetchMock.mock.calls[0]![0] as string);
    expect(calledUrl.searchParams.get('include')).toBe(
      'participants;league;state;scores;events;statistics.type;periods',
    );
  });

  it('normalizes object and null response data while omitting empty params', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ data: { id: 321, name: 'Single fixture' } }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ data: null }),
      });
    global.fetch = fetchMock as unknown as typeof fetch;

    const { sportmonksGet } = await import('../lib/sportmonks-api.js');

    const single = await sportmonksGet('/fixtures/321', { include: '' });
    expect(single.data).toEqual([{ id: 321, name: 'Single fixture' }]);
    let calledUrl = new URL(fetchMock.mock.calls[0]![0] as string);
    expect(calledUrl.searchParams.has('include')).toBe(false);

    const empty = await sportmonksGet('fixtures/empty');
    expect(empty.data).toEqual([]);
    calledUrl = new URL(fetchMock.mock.calls[1]![0] as string);
    expect(calledUrl.pathname).toBe('/v3/football/fixtures/empty');
    expect(recordProviderRequestSafe).toHaveBeenLastCalledWith(expect.objectContaining({
      success: true,
      resultCount: 0,
    }));
  });

  it('records invalid JSON responses as failed provider requests', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => '{not json',
    }) as unknown as typeof fetch;

    const { fetchSportmonksLivescores } = await import('../lib/sportmonks-api.js');

    await expect(fetchSportmonksLivescores()).rejects.toThrow();
    expect(recordProviderRequestSafe).toHaveBeenCalledWith(expect.objectContaining({
      provider: 'sportmonks',
      endpoint: '/livescores',
      success: false,
      statusCode: null,
    }));
  });

  it('fetches fixtures by date through the football fixtures date endpoint', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ data: [{ id: 987, name: 'C vs D' }] }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const { fetchSportmonksFixturesByDate } = await import('../lib/sportmonks-api.js');
    const result = await fetchSportmonksFixturesByDate('2026-06-12', { include: 'participants' });

    expect(result.data).toHaveLength(1);
    const calledUrl = new URL(fetchMock.mock.calls[0]![0] as string);
    expect(calledUrl.pathname).toBe('/v3/football/fixtures/date/2026-06-12');
    expect(calledUrl.searchParams.get('include')).toBe('participants');
  });

  it('normalizes Sportmonks fixture arrays from the API helper surface', async () => {
    const { normalizeSportmonksFixtures, parseSportmonksRateLimit } = await import('../lib/sportmonks-api.js');

    expect(parseSportmonksRateLimit(null)).toBeNull();
    expect(parseSportmonksRateLimit({
      remaining: '',
      resets_in_seconds: 'bad',
      requested_entity: ' ',
    })).toEqual({
      remaining: null,
      resetsInSeconds: null,
      requestedEntity: null,
    });
    expect(normalizeSportmonksFixtures([{ id: 10, name: 'A vs B' }])).toEqual([
      expect.objectContaining({
        provider: 'sportmonks',
        providerFixtureId: '10',
        name: 'A vs B',
      }),
    ]);
  });
});
