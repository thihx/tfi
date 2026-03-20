// ============================================================
// Integration tests - Auth routes
// ============================================================

import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from './helpers.js';

vi.mock('../config.js', () => ({
  config: {
    port: 4000,
    frontendUrl: 'http://localhost:3000',
    googleClientId: 'google-client-id',
    googleClientSecret: 'google-client-secret',
    allowedEmails: [],
    jwtSecret: 'jwt-secret',
    jwtExpiresInSeconds: 3600,
  },
}));

vi.mock('../lib/jwt.js', () => ({
  signToken: vi.fn().mockReturnValue('signed.jwt.token'),
  verifyToken: vi.fn().mockReturnValue({ sub: 'user@example.com', name: 'User', picture: '' }),
}));

let app: FastifyInstance;
const fetchMock = vi.fn();

beforeAll(async () => {
  vi.stubGlobal('fetch', fetchMock);
  const { authRoutes } = await import('../routes/auth.routes.js');
  app = await buildApp(authRoutes);
});

afterAll(async () => {
  vi.unstubAllGlobals();
  await app.close();
});

beforeEach(() => {
  fetchMock.mockReset();
});

describe('GET /api/auth/google', () => {
  test('redirects to Google with a state param and one-time cookie', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/auth/google' });

    expect(res.statusCode).toBe(302);
    const location = res.headers.location ?? '';
    const redirect = new URL(location);
    const state = redirect.searchParams.get('state');

    expect(location).toContain('accounts.google.com/o/oauth2/v2/auth');
    expect(state).toMatch(/^[a-f0-9]{64}$/);
    expect(res.headers['set-cookie']).toContain('tfi_oauth_state=');
    expect(res.headers['set-cookie']).toContain('HttpOnly');
    expect(res.headers['set-cookie']).toContain('SameSite=Lax');
  });
});

describe('GET /api/auth/google/callback', () => {
  test('rejects callback when state cookie is missing or mismatched', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/auth/google/callback?code=abc&state=wrong',
    });

    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe('http://localhost:3000/#auth_error=invalid_state');
  });

  test('sets auth cookie, redirects without token in URL, and clears state cookie', async () => {
    const loginRes = await app.inject({ method: 'GET', url: '/api/auth/google' });
    const state = new URL(loginRes.headers.location ?? '').searchParams.get('state');
    const cookie = loginRes.headers['set-cookie'] ?? '';

    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ access_token: 'google-access-token' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ email: 'user@example.com', name: 'Test User', picture: 'avatar.png' }),
      });

    const callbackRes = await app.inject({
      method: 'GET',
      url: `/api/auth/google/callback?code=abc&state=${state}`,
      headers: { cookie },
    });

    expect(callbackRes.statusCode).toBe(302);
    expect(callbackRes.headers.location).toBe('http://localhost:3000/#auth=success');
    expect(callbackRes.headers.location).not.toContain('token=');
    const setCookie = Array.isArray(callbackRes.headers['set-cookie'])
      ? callbackRes.headers['set-cookie'].join('; ')
      : String(callbackRes.headers['set-cookie'] || '');
    expect(setCookie).toContain('tfi_oauth_state=');
    expect(setCookie).toContain('Max-Age=0');
    expect(setCookie).toContain('tfi_auth_token=');
    expect(setCookie).toContain('HttpOnly');
  });
});
