// ============================================================
// Auth Routes - Google OAuth2 (Authorization Code Flow)
// GET  /api/auth/google           -> redirect to Google
// GET  /api/auth/google/callback  -> exchange code, issue JWT
// GET  /api/auth/me               -> return current user from JWT
// POST /api/auth/logout           -> no-op (client clears token)
// ============================================================

import type { FastifyInstance } from 'fastify';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { config } from '../config.js';
import { signToken, verifyToken } from '../lib/jwt.js';
import { toAuthUserResponse } from '../lib/request-user.js';
import { getUserById, resolveOrCreateUserFromIdentity } from '../repos/users.repo.js';

const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_USER_URL = 'https://www.googleapis.com/oauth2/v2/userinfo';
const OAUTH_STATE_COOKIE = 'tfi_oauth_state';
const AUTH_COOKIE = 'tfi_auth_token';
const OAUTH_STATE_MAX_AGE_SECONDS = 10 * 60;
const AUTH_TIMEOUT_MS = 15_000;

// Dynamic: in production the callback goes through the public URL, not localhost
function getRedirectUri(): string {
  const base = config.frontendUrl.includes('localhost')
    ? `http://localhost:${config.port}`
    : config.frontendUrl;
  return `${base}/api/auth/google/callback`;
}

function isSecureFrontendUrl(): boolean {
  try {
    return new URL(config.frontendUrl).protocol === 'https:';
  } catch {
    return false;
  }
}

function buildFrontendRedirect(params: Record<string, string>): string {
  try {
    const url = new URL(config.frontendUrl);
    url.hash = new URLSearchParams(params).toString();
    return url.toString();
  } catch {
    const fragment = new URLSearchParams(params).toString();
    return `${config.frontendUrl}#${fragment}`;
  }
}

function parseCookies(cookieHeader?: string): Record<string, string> {
  const cookies: Record<string, string> = {};
  for (const part of cookieHeader?.split(';') ?? []) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const value = trimmed.slice(eqIdx + 1).trim();
    cookies[key] = decodeURIComponent(value);
  }
  return cookies;
}

function serializeStateCookie(value: string, maxAgeSeconds: number): string {
  const secure = isSecureFrontendUrl() ? '; Secure' : '';
  return `${OAUTH_STATE_COOKIE}=${encodeURIComponent(value)}; HttpOnly; Path=/api/auth/google; SameSite=Lax; Max-Age=${maxAgeSeconds}${secure}`;
}

function clearStateCookie(): string {
  return serializeStateCookie('', 0);
}

function serializeAuthCookie(value: string, maxAgeSeconds: number): string {
  const secure = isSecureFrontendUrl() ? '; Secure' : '';
  return `${AUTH_COOKIE}=${encodeURIComponent(value)}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${maxAgeSeconds}${secure}`;
}

function clearAuthCookie(): string {
  return serializeAuthCookie('', 0);
}

function statesMatch(expected: string, actual: string): boolean {
  const expectedBuf = Buffer.from(expected);
  const actualBuf = Buffer.from(actual);
  if (expectedBuf.length !== actualBuf.length) return false;
  return timingSafeEqual(expectedBuf, actualBuf);
}

async function fetchJsonWithTimeout<T>(url: string, init: RequestInit, label: string): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), AUTH_TIMEOUT_MS);
  let response: Response;

  try {
    response = await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`${label} ${response.status}: ${text.substring(0, 300)}`);
  }

  return await response.json() as T;
}

export async function authRoutes(app: FastifyInstance) {
  const oauthReady = !!(config.jwtSecret && config.googleClientId && config.googleClientSecret);
  const allowedEmails = new Set(config.allowedEmails.map((email) => email.toLowerCase()));

  function createState(): string {
    return randomBytes(32).toString('hex');
  }

  app.get('/api/auth/google', async (_req, reply) => {
    if (!oauthReady) {
      app.log.warn('[auth] Google OAuth requested but auth is not configured');
      return reply.redirect(buildFrontendRedirect({ auth_error: 'auth_unavailable' }));
    }

    const state = createState();
    reply.header('Cache-Control', 'no-store');
    reply.header('Set-Cookie', serializeStateCookie(state, OAUTH_STATE_MAX_AGE_SECONDS));

    const params = new URLSearchParams({
      client_id: config.googleClientId,
      redirect_uri: getRedirectUri(),
      response_type: 'code',
      scope: 'openid email profile',
      access_type: 'online',
      state,
    });
    return reply.redirect(`${GOOGLE_AUTH_URL}?${params.toString()}`);
  });

  app.get<{ Querystring: { code?: string; error?: string; state?: string } }>(
    '/api/auth/google/callback',
    async (req, reply) => {
      reply.header('Cache-Control', 'no-store');
      reply.header('Set-Cookie', clearStateCookie());

      if (!oauthReady) {
        app.log.warn('[auth] Google OAuth callback received but auth is not configured');
        return reply.redirect(buildFrontendRedirect({ auth_error: 'auth_unavailable' }));
      }

      const { code, error, state } = req.query;
      const cookieState = parseCookies(req.headers.cookie)[OAUTH_STATE_COOKIE];
      if (!state || !cookieState || !statesMatch(cookieState, state)) {
        app.log.warn('[auth] Invalid or missing OAuth state parameter');
        return reply.redirect(buildFrontendRedirect({ auth_error: 'invalid_state' }));
      }

      if (error || !code) {
        app.log.warn(`[auth] Google OAuth error: ${error || 'no code'}`);
        return reply.redirect(buildFrontendRedirect({ auth_error: error || 'cancelled' }));
      }

      let accessToken: string;
      try {
        const tokenData = await fetchJsonWithTimeout<{ access_token?: string; error?: string }>(
          GOOGLE_TOKEN_URL,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
              code,
              client_id: config.googleClientId,
              client_secret: config.googleClientSecret,
              redirect_uri: getRedirectUri(),
              grant_type: 'authorization_code',
            }).toString(),
          },
          'Google token exchange failed',
        );
        if (!tokenData.access_token) {
          throw new Error(tokenData.error || 'No access_token in response');
        }
        accessToken = tokenData.access_token;
      } catch (err) {
        app.log.error(err, '[auth] Token exchange failed');
        return reply.redirect(buildFrontendRedirect({ auth_error: 'token_exchange_failed' }));
      }

      let providerSubject: string;
      let userEmail: string;
      let userName: string;
      let userPicture: string;
      try {
        const user = await fetchJsonWithTimeout<{ id?: string; email?: string; name?: string; picture?: string }>(
          GOOGLE_USER_URL,
          {
            headers: { Authorization: `Bearer ${accessToken}` },
          },
          'Google profile fetch failed',
        );
        if (!user.email) throw new Error('No email in user profile');
        providerSubject = user.id || user.email;
        userEmail = user.email.toLowerCase();
        userName = user.name || user.email;
        userPicture = user.picture || '';
      } catch (err) {
        app.log.error(err, '[auth] Failed to fetch user profile');
        return reply.redirect(buildFrontendRedirect({ auth_error: 'profile_fetch_failed' }));
      }

      if (allowedEmails.size > 0 && !allowedEmails.has(userEmail)) {
        app.log.warn(`[auth] Blocked login attempt from: ${userEmail}`);
        return reply.redirect(buildFrontendRedirect({ auth_error: 'not_allowed' }));
      }

      const user = await resolveOrCreateUserFromIdentity({
        provider: 'google',
        providerSubject,
        email: userEmail,
        displayName: userName,
        avatarUrl: userPicture,
      });

      if (user.status !== 'active') {
        app.log.warn(`[auth] Login blocked for disabled user: ${user.email}`);
        return reply.redirect(buildFrontendRedirect({ auth_error: 'account_disabled' }));
      }

      const jwt = signToken(
        {
          sub: user.id,
          email: user.email,
          role: user.role,
          name: user.display_name,
          picture: user.avatar_url,
        },
        config.jwtSecret,
        config.jwtExpiresInSeconds,
      );

      reply.header('Set-Cookie', [clearStateCookie(), serializeAuthCookie(jwt, config.jwtExpiresInSeconds)]);
      app.log.info(`[auth] Login success: ${userEmail}`);
      return reply.redirect(buildFrontendRedirect({ auth: 'success' }));
    },
  );

  app.get('/api/auth/me', async (req, reply) => {
    if (!config.jwtSecret) return reply.status(503).send({ error: 'Auth not configured' });
    const bearer = req.headers['authorization']?.replace('Bearer ', '');
    const cookieToken = parseCookies(req.headers.cookie)[AUTH_COOKIE];
    const token = bearer || cookieToken;
    if (!token) return reply.status(401).send({ error: 'No token' });

    const payload = verifyToken(token, config.jwtSecret);
    if (!payload) return reply.status(401).send({ error: 'Invalid or expired token' });

    const user = await getUserById(payload.sub);
    if (!user) return reply.status(401).send({ error: 'Invalid or expired token' });
    if (user.status !== 'active') return reply.status(403).send({ error: 'Account disabled' });

    return reply.send(toAuthUserResponse(user));
  });

  app.post('/api/auth/logout', async (_req, reply) => {
    reply.header('Set-Cookie', clearAuthCookie());
    return reply.send({ ok: true });
  });
}
