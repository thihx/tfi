// ============================================================
// Auth Routes — Google OAuth2 (Authorization Code Flow)
// GET  /api/auth/google           → redirect to Google
// GET  /api/auth/google/callback  → exchange code, issue JWT
// GET  /api/auth/me               → return current user from JWT
// POST /api/auth/logout           → no-op (client clears token)
// ============================================================

import type { FastifyInstance } from 'fastify';
import { config } from '../config.js';
import { signToken, verifyToken } from '../lib/jwt.js';

const GOOGLE_AUTH_URL  = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_USER_URL  = 'https://www.googleapis.com/oauth2/v2/userinfo';

// Dynamic: in production the callback goes through the public URL, not localhost
function getRedirectUri(): string {
  // If FRONTEND_URL looks like a deployed app, use the backend's own public URL for callback
  const base = config.frontendUrl.includes('localhost')
    ? `http://localhost:${config.port}`
    : config.frontendUrl;
  return `${base}/api/auth/google/callback`;
}

export async function authRoutes(app: FastifyInstance) {

  // ── 1. Redirect to Google login ───────────────────────────
  app.get('/api/auth/google', async (_req, reply) => {
    const params = new URLSearchParams({
      client_id:     config.googleClientId,
      redirect_uri:  getRedirectUri(),
      response_type: 'code',
      scope:         'openid email profile',
      access_type:   'online',
    });
    return reply.redirect(`${GOOGLE_AUTH_URL}?${params.toString()}`);
  });

  // ── 2. Google callback — exchange code → JWT ──────────────
  app.get<{ Querystring: { code?: string; error?: string } }>(
    '/api/auth/google/callback',
    async (req, reply) => {
      const { code, error } = req.query;

      if (error || !code) {
        app.log.warn(`[auth] Google OAuth error: ${error || 'no code'}`);
        return reply.redirect(`${config.frontendUrl}?auth_error=${encodeURIComponent(error || 'cancelled')}`);
      }

      // Exchange authorization code for tokens
      let accessToken: string;
      try {
        const tokenRes = await fetch(GOOGLE_TOKEN_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            code,
            client_id:     config.googleClientId,
            client_secret: config.googleClientSecret,
            redirect_uri:  getRedirectUri(),
            grant_type:    'authorization_code',
          }).toString(),
        });
        const tokenData = await tokenRes.json() as { access_token?: string; error?: string };
        if (!tokenData.access_token) {
          throw new Error(tokenData.error || 'No access_token in response');
        }
        accessToken = tokenData.access_token;
      } catch (err) {
        app.log.error(err, '[auth] Token exchange failed');
        return reply.redirect(`${config.frontendUrl}?auth_error=token_exchange_failed`);
      }

      // Fetch user profile
      let userEmail: string, userName: string, userPicture: string;
      try {
        const userRes  = await fetch(GOOGLE_USER_URL, {
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        const user = await userRes.json() as { email?: string; name?: string; picture?: string };
        if (!user.email) throw new Error('No email in user profile');
        userEmail   = user.email;
        userName    = user.name    || user.email;
        userPicture = user.picture || '';
      } catch (err) {
        app.log.error(err, '[auth] Failed to fetch user profile');
        return reply.redirect(`${config.frontendUrl}?auth_error=profile_fetch_failed`);
      }

      // Email whitelist check
      if (config.allowedEmails.length > 0 && !config.allowedEmails.includes(userEmail)) {
        app.log.warn(`[auth] Blocked login attempt from: ${userEmail}`);
        return reply.redirect(`${config.frontendUrl}?auth_error=not_allowed`);
      }

      // Issue JWT and redirect to frontend with token in query param
      const jwt = signToken(
        { sub: userEmail, name: userName, picture: userPicture },
        config.jwtSecret,
        config.jwtExpiresInSeconds,
      );

      app.log.info(`[auth] Login success: ${userEmail}`);
      return reply.redirect(`${config.frontendUrl}?token=${jwt}`);
    },
  );

  // ── 3. /api/auth/me — return current user info ────────────
  app.get('/api/auth/me', async (req, reply) => {
    const token = req.headers['authorization']?.replace('Bearer ', '');
    if (!token) return reply.status(401).send({ error: 'No token' });

    const payload = verifyToken(token, config.jwtSecret);
    if (!payload) return reply.status(401).send({ error: 'Invalid or expired token' });

    return reply.send({ email: payload.sub, name: payload.name, picture: payload.picture });
  });

  // ── 4. /api/auth/logout — client-side only, no server state ─
  app.post('/api/auth/logout', async (_req, reply) => {
    return reply.send({ ok: true });
  });
}
