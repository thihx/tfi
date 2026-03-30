// ============================================================
// Integration tests — Proxy routes (external API error handling)
// ============================================================

import { describe, test, expect, vi, beforeAll, afterAll } from 'vitest';
import { buildApp } from './helpers.js';
import type { FastifyInstance } from 'fastify';

// Mock config
vi.mock('../config.js', () => ({
  config: {
    databaseUrl: 'postgresql://test:test@localhost:5432/test',
    timezone: 'Asia/Seoul',
    geminiApiKey: 'test-key',
    geminiModel: 'gemini-test',
    telegramBotToken: 'test-bot-token',
    footballApiKey: 'test-football-key',
    footballApiBaseUrl: 'https://api-football.example.com',
    providerSamplingEnabled: false,
  },
}));

// Mock audit — no DB in tests
vi.mock('../lib/audit.js', () => ({
  audit: vi.fn(),
  auditSuccess: vi.fn(),
  auditFailure: vi.fn(),
  auditSkipped: vi.fn(),
  auditWrap: vi.fn(),
}));

// Mock football-api
vi.mock('../lib/football-api.js', () => ({
  fetchFixturesByIds: vi.fn().mockRejectedValue(new Error('Football API timeout')),
  fetchLiveOdds: vi.fn().mockRejectedValue(new Error('Football API 500: Internal Server Error')),
  fetchPreMatchOdds: vi.fn().mockRejectedValue(new Error('Football API 500: Internal Server Error')),
  fetchFixtureLineups: vi.fn().mockResolvedValue([]),
  fetchPrediction: vi.fn().mockResolvedValue(null),
  fetchStandings: vi.fn().mockResolvedValue([]),
}));

vi.mock('../lib/reference-data-provider.js', () => ({
  fetchLeagueFixturesFromReferenceProvider: vi.fn().mockResolvedValue([]),
}));

vi.mock('../lib/provider-insight-cache.js', () => ({
  ensureFixturesForMatchIds: vi.fn().mockRejectedValue(new Error('Football API timeout')),
  ensureScoutInsight: vi.fn().mockResolvedValue({
    fixture: { payload: null, freshness: 'missing', cacheStatus: 'miss', cachedAt: null, fetchedAt: null, degraded: false },
    statistics: { payload: [], freshness: 'missing', cacheStatus: 'miss', cachedAt: null, fetchedAt: null, degraded: false },
    events: { payload: [], freshness: 'missing', cacheStatus: 'miss', cachedAt: null, fetchedAt: null, degraded: false },
    lineups: { payload: [], freshness: 'missing', cacheStatus: 'miss', cachedAt: null, fetchedAt: null, degraded: false },
    prediction: { payload: null, freshness: 'missing', cacheStatus: 'miss', cachedAt: null, fetchedAt: null, degraded: false },
    standings: { payload: [], freshness: 'missing', cacheStatus: 'miss', cachedAt: null, fetchedAt: null, degraded: false },
  }),
}));

vi.mock('../lib/server-pipeline.js', () => ({
  runPromptOnlyAnalysisForMatch: vi.fn().mockResolvedValue({
    text: 'AI response here',
    prompt: 'server prompt',
    result: { success: true },
  }),
}));

vi.mock('../repos/provider-odds-cache.repo.js', () => ({
  getProviderOddsCache: vi.fn().mockResolvedValue(null),
  upsertProviderOddsCache: vi.fn().mockResolvedValue(null),
}));

// Mock global fetch for Gemini and Telegram
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

let app: FastifyInstance;

beforeAll(async () => {
  const { proxyRoutes } = await import('../routes/proxy.routes.js');
  app = await buildApp(proxyRoutes);
});

afterAll(async () => {
  await app.close();
  vi.unstubAllGlobals();
});

describe('POST /api/proxy/football/live-fixtures — error handling', () => {
  test('returns 502 on football API failure', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/proxy/football/live-fixtures',
      payload: { matchIds: ['100'] },
    });
    expect(res.statusCode).toBe(502);
    expect(res.json().error).toContain('Football API timeout');
  });
});

describe('POST /api/proxy/football/odds — fallback behavior', () => {
  test('returns empty response when both live and pre-match odds fail', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/proxy/football/odds',
      payload: { matchId: '100' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ odds_source: 'none', odds_freshness: 'missing', cache_status: 'miss', response: [] });
  });
});

describe('POST /api/proxy/football/scout', () => {
  test('returns aggregated prematch scout data from insight layer', async () => {
    const insight = await import('../lib/provider-insight-cache.js');
    vi.mocked(insight.ensureFixturesForMatchIds).mockResolvedValueOnce([
      {
        fixture: { id: 100, referee: null, timezone: 'UTC', date: '2026-03-25T12:00:00Z', timestamp: 1, periods: { first: null, second: null }, venue: { id: null, name: 'Test', city: null }, status: { long: 'Not Started', short: 'NS', elapsed: null } },
        league: { id: 39, name: 'Premier League', country: 'England', logo: '', flag: null, season: 2025, round: 'Round 1' },
        teams: { home: { id: 1, name: 'Team A', logo: '', winner: null }, away: { id: 2, name: 'Team B', logo: '', winner: null } },
        goals: { home: null, away: null },
        score: {},
      },
    ] as never);
    vi.mocked(insight.ensureScoutInsight).mockResolvedValueOnce({
      fixture: { payload: null, freshness: 'fresh', cacheStatus: 'hit', cachedAt: null, fetchedAt: null, degraded: false },
      statistics: { payload: [], freshness: 'missing', cacheStatus: 'miss', cachedAt: null, fetchedAt: null, degraded: false },
      events: { payload: [], freshness: 'missing', cacheStatus: 'miss', cachedAt: null, fetchedAt: null, degraded: false },
      lineups: { payload: [], freshness: 'missing', cacheStatus: 'miss', cachedAt: null, fetchedAt: null, degraded: false },
      prediction: { payload: { predictions: { winner: { id: 1, name: 'Team A', comment: 'favored' }, win_or_draw: true, advice: 'Lean home', percent: null, under_over: null, goals: null }, comparison: { form: null, att: null, def: null, goals: null, total: null } }, freshness: 'fresh', cacheStatus: 'hit', cachedAt: null, fetchedAt: null, degraded: false },
      standings: { payload: [{ rank: 1, team: { id: 1, name: 'Team A', logo: '' }, points: 10, goalsDiff: 5, form: 'WWWWW', description: null, all: { played: 4, win: 3, draw: 1, lose: 0, goals: { for: 8, against: 3 } } }], freshness: 'fresh', cacheStatus: 'hit', cachedAt: null, fetchedAt: null, degraded: false },
    });

    const res = await app.inject({
      method: 'POST',
      url: '/api/proxy/football/scout',
      payload: { fixtureId: '100', leagueId: 39, season: 2025, status: 'NS' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().prediction?.predictions?.winner?.name).toBe('Team A');
    expect(res.json().standings).toHaveLength(1);
    expect(insight.ensureScoutInsight).toHaveBeenCalledWith('100', expect.objectContaining({ leagueId: 39, season: 2025, status: 'NS', freshnessMode: 'stale_safe' }));
  });

  test('uses real-required freshness mode for live scout requests', async () => {
    const insight = await import('../lib/provider-insight-cache.js');
    vi.mocked(insight.ensureFixturesForMatchIds).mockResolvedValueOnce([
      {
        fixture: { id: 100, referee: null, timezone: 'UTC', date: '2026-03-25T12:00:00Z', timestamp: 1, periods: { first: null, second: null }, venue: { id: null, name: 'Test', city: null }, status: { long: 'Second Half', short: '2H', elapsed: 67 } },
        league: { id: 39, name: 'Premier League', country: 'England', logo: '', flag: null, season: 2025, round: 'Round 1' },
        teams: { home: { id: 1, name: 'Team A', logo: '', winner: null }, away: { id: 2, name: 'Team B', logo: '', winner: null } },
        goals: { home: 1, away: 0 },
        score: {},
      },
    ] as never);

    const res = await app.inject({
      method: 'POST',
      url: '/api/proxy/football/scout',
      payload: { fixtureId: '100', leagueId: 39, season: 2025, status: '2H' },
    });

    expect(res.statusCode).toBe(200);
    expect(insight.ensureFixturesForMatchIds).toHaveBeenCalledWith(['100'], { freshnessMode: 'real_required' });
    expect(insight.ensureScoutInsight).toHaveBeenCalledWith('100', expect.objectContaining({
      status: '2H',
      consumer: 'proxy-scout-live',
      freshnessMode: 'real_required',
    }));
  });
});

describe('GET /api/proxy/football/league-fixtures', () => {
  test('loads fixtures through the centralized reference-data provider', async () => {
    const referenceProvider = await import('../lib/reference-data-provider.js');
    vi.mocked(referenceProvider.fetchLeagueFixturesFromReferenceProvider).mockResolvedValueOnce([
      { fixture: { id: 100 }, league: { round: 'Round 1' }, teams: { home: { name: 'A', logo: '', winner: null }, away: { name: 'B', logo: '', winner: null } }, goals: { home: null, away: null } },
    ] as never);

    const res = await app.inject({
      method: 'GET',
      url: '/api/proxy/football/league-fixtures?leagueId=39&season=2025&next=10',
    });

    expect(res.statusCode).toBe(200);
    expect(referenceProvider.fetchLeagueFixturesFromReferenceProvider).toHaveBeenCalledWith(39, 2025, 10);
    expect(res.json()).toHaveLength(1);
  });
});

describe('POST /api/proxy/ai/analyze — error handling', () => {
  test('returns 502 on Gemini API failure', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      text: () => Promise.resolve('Internal Server Error'),
    });

    const res = await app.inject({
      method: 'POST',
      url: '/api/proxy/ai/analyze',
      payload: { prompt: 'test', provider: 'gemini', model: 'gemini-pro' },
    });
    expect(res.statusCode).toBe(502);
    expect(res.json().error).toContain('Gemini API');
  });

  test('returns 400 for unsupported provider', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/proxy/ai/analyze',
      payload: { prompt: 'test', provider: 'unknown', model: 'any' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toContain('not yet supported');
  });

  test('returns text on success', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({
        candidates: [{ content: { parts: [{ text: 'AI response here' }] } }],
      }),
    });

    const res = await app.inject({
      method: 'POST',
      url: '/api/proxy/ai/analyze',
      payload: { prompt: 'test', provider: 'gemini', model: 'gemini-pro' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().text).toBe('AI response here');
  });

  test('builds prompt on server when only matchId is provided', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/proxy/ai/analyze',
      payload: { matchId: '12345', provider: 'gemini', model: 'gemini-pro', forceAnalyze: true },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().text).toBe('AI response here');

    const pipeline = await import('../lib/server-pipeline.js');
    expect(pipeline.runPromptOnlyAnalysisForMatch).toHaveBeenCalledWith('12345', {
      forceAnalyze: true,
      modelOverride: 'gemini-pro',
    });
  });
});

describe('POST /api/proxy/notify/telegram — error handling', () => {
  test('returns 502 on Telegram API failure', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 403,
      text: () => Promise.resolve('Forbidden: bot was blocked'),
    });

    const res = await app.inject({
      method: 'POST',
      url: '/api/proxy/notify/telegram',
      payload: { chat_id: '12345', text: 'hello' },
    });
    expect(res.statusCode).toBe(502);
    expect(res.json().error).toContain('Telegram API');
  });

  test('returns success on successful send', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ ok: true }),
    });

    const res = await app.inject({
      method: 'POST',
      url: '/api/proxy/notify/telegram',
      payload: { chat_id: '12345', text: 'hello' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().sent).toBe(true);
  });

  test('renders chart config into a Telegram photo URL on the backend', async () => {
    mockFetch.mockClear();
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ ok: true }),
    });

    const res = await app.inject({
      method: 'POST',
      url: '/api/proxy/notify/telegram',
      payload: {
        chat_id: '12345',
        text: 'hello',
        chart_config: { type: 'horizontalBar', data: { labels: ['Shots'], datasets: [] } },
      },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().sent).toBe(true);
    const lastCall = mockFetch.mock.calls.at(-1) ?? [];
    const [, requestInit] = lastCall;
    expect(String(lastCall[0] ?? '')).toContain('/sendPhoto');
    expect(String(requestInit?.body ?? '')).toContain('https://quickchart.io/chart?c=');
  });
});

describe('POST /api/proxy/notify/email', () => {
  test('logs only (SMTP not configured)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/proxy/notify/email',
      payload: { email_to: 'test@test.com', email_subject: 'Test', email_body_html: '<p>Hi</p>' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().sent).toBe(false);
    expect(res.json().reason).toContain('SMTP');
  });
});
