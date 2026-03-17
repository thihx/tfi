// ============================================================
// Integration tests — Proxy routes (external API error handling)
// ============================================================

import { describe, test, expect, vi, beforeAll, afterAll } from 'vitest';
import { buildApp } from './helpers.js';
import type { FastifyInstance } from 'fastify';

// Mock config
vi.mock('../config.js', () => ({
  config: {
    geminiApiKey: 'test-key',
    telegramBotToken: 'test-bot-token',
    footballApiKey: 'test-football-key',
    footballApiBaseUrl: 'https://api-football.example.com',
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
    expect(res.json()).toEqual({ odds_source: 'pre-match', response: [] });
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
