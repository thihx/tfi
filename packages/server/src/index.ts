// ============================================================
// TFI Server - Fastify + PostgreSQL
// ============================================================

import 'dotenv/config';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import { config } from './config.js';
import { closePool, query } from './db/pool.js';
import { closeRedis, getRedisClient } from './lib/redis.js';
import { verifyToken } from './lib/jwt.js';
import { toRequestUser } from './lib/request-user.js';
import { getUserById } from './repos/users.repo.js';
import { aiPerformanceRoutes } from './routes/ai-performance.routes.js';
import { auditLogRoutes } from './routes/audit-logs.routes.js';
import { authRoutes } from './routes/auth.routes.js';
import { betRoutes } from './routes/bets.routes.js';
import { integrationsRoutes } from './routes/integrations.routes.js';
import { leagueRoutes } from './routes/leagues.routes.js';
import { matchRoutes } from './routes/matches.routes.js';
import { oddsRoutes } from './routes/odds.routes.js';
import { opsRoutes } from './routes/ops.routes.js';
import { pipelineRoutes } from './routes/pipeline-runs.routes.js';
import { liveMonitorRoutes } from './routes/live-monitor.routes.js';
import { proxyRoutes } from './routes/proxy.routes.js';
import { recommendationRoutes } from './routes/recommendations.routes.js';
import { recommendationDeliveriesRoutes } from './routes/recommendation-deliveries.routes.js';
import { reportRoutes } from './routes/reports.routes.js';
import { notificationSettingsRoutes } from './routes/notification-settings.routes.js';
import { notificationChannelsRoutes } from './routes/notification-channels.routes.js';
import { settingsRoutes } from './routes/settings.routes.js';
import { snapshotRoutes } from './routes/snapshots.routes.js';
import { pushRoutes } from './routes/push.routes.js';
import { watchlistRoutes } from './routes/watchlist.routes.js';
import { favoriteTeamsRoutes } from './routes/favorite-teams.routes.js';
import { jobRoutes } from './routes/jobs.routes.js';
import { teamProfileRoutes } from './routes/team-profiles.routes.js';
import { startScheduler, stopScheduler } from './jobs/scheduler.js';

const app = Fastify({ logger: true });

app.decorateRequest('currentUser', null);

function isLocalFrontendUrl(urlString: string): boolean {
  try {
    const { hostname } = new URL(urlString);
    return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '0.0.0.0';
  } catch {
    return false;
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

process.on('uncaughtException', (err) => {
  app.log.error({ err }, 'Uncaught exception');
});

process.on('unhandledRejection', (reason) => {
  app.log.error({ reason }, 'Unhandled rejection');
});

async function validateConnections(): Promise<void> {
  try {
    await query('SELECT 1');
    app.log.info('PostgreSQL connection OK');
  } catch (err) {
    app.log.error({ err }, 'PostgreSQL connection FAILED');
    throw err;
  }

  try {
    const redis = getRedisClient();
    await redis.ping();
    app.log.info('Redis connection OK');
  } catch (err) {
    app.log.error({ err }, 'Redis connection FAILED');
    throw err;
  }
}

await app.register(cors, {
  origin: (origin, cb) => {
    if (!origin || origin === config.corsOrigin || /^https?:\/\/localhost(:\d+)?$/.test(origin)) {
      cb(null, true);
    } else {
      cb(new Error(`CORS: origin ${origin} not allowed`), false);
    }
  },
  methods: ['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE'],
  credentials: true,
});

await app.register(authRoutes);

const hasJwtSecret = config.jwtSecret.trim() !== '';
const hasGoogleClientId = config.googleClientId.trim() !== '';
const hasGoogleClientSecret = config.googleClientSecret.trim() !== '';
const googleAuthConfigured = hasGoogleClientId && hasGoogleClientSecret;
const localFrontend = isLocalFrontendUrl(config.frontendUrl);

if (hasGoogleClientId !== hasGoogleClientSecret) {
  throw new Error('FATAL: GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must be configured together');
}
if (!hasJwtSecret && (hasGoogleClientId || hasGoogleClientSecret)) {
  throw new Error('FATAL: JWT_SECRET is required whenever Google OAuth is configured');
}
if (!localFrontend && (!hasJwtSecret || !googleAuthConfigured)) {
  throw new Error('FATAL: JWT_SECRET, GOOGLE_CLIENT_ID, and GOOGLE_CLIENT_SECRET are required for non-local deployments');
}

if (hasJwtSecret) {
  app.addHook('preHandler', async (req, reply) => {
    req.currentUser = null;
    const url = req.url.split('?')[0]!;
    if (!url.startsWith('/api/') || url.startsWith('/api/auth/') || url === '/api/health') return;

    const authHeader = req.headers['authorization'];
    const bearer = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
    const cookieToken = parseCookies(req.headers.cookie)['tfi_auth_token'] ?? null;
    const token = bearer || cookieToken;
    if (!token) {
      return reply.status(401).send({ error: 'Unauthorized - no token' });
    }
    const payload = verifyToken(token, config.jwtSecret);
    if (!payload) {
      return reply.status(401).send({ error: 'Unauthorized - invalid or expired token' });
    }

    const user = await getUserById(payload.sub);
    if (!user) {
      return reply.status(401).send({ error: 'Unauthorized - unknown user' });
    }
    if (user.status !== 'active') {
      return reply.status(403).send({ error: 'Forbidden - account disabled' });
    }

    req.currentUser = toRequestUser(user);
  });
  app.log.info('[auth] JWT guard ENABLED');
} else {
  app.log.warn('[auth] JWT guard DISABLED - local dev only because JWT_SECRET is not configured');
}

await app.register(leagueRoutes);
await app.register(matchRoutes);
await app.register(watchlistRoutes);
await app.register(recommendationRoutes);
await app.register(recommendationDeliveriesRoutes);
await app.register(pipelineRoutes);
await app.register(liveMonitorRoutes);
await app.register(jobRoutes);
await app.register(proxyRoutes);
await app.register(betRoutes);
await app.register(snapshotRoutes);
await app.register(oddsRoutes);
await app.register(aiPerformanceRoutes);
await app.register(reportRoutes);
await app.register(opsRoutes);
await app.register(settingsRoutes);
await app.register(notificationSettingsRoutes);
await app.register(notificationChannelsRoutes);
await app.register(auditLogRoutes);
await app.register(integrationsRoutes);
await app.register(pushRoutes);
await app.register(favoriteTeamsRoutes);
await app.register(teamProfileRoutes);

app.get('/api/health', async () => ({ status: 'ok', timestamp: new Date().toISOString() }));

const __dirname = dirname(fileURLToPath(import.meta.url));
const clientDir = join(__dirname, '..', 'client');
if (existsSync(clientDir)) {
  await app.register(fastifyStatic, { root: clientDir, wildcard: false });
  app.setNotFoundHandler((req, reply) => {
    if (req.url.startsWith('/api/')) {
      reply.status(404).send({ error: 'Not found' });
    } else {
      reply.sendFile('index.html');
    }
  });
  app.log.info(`Serving static files from ${clientDir}`);
}

const shutdown = async () => {
  app.log.info('Shutting down...');
  stopScheduler();
  await app.close();
  await closePool();
  await closeRedis();
  process.exit(0);
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

try {
  await validateConnections();
  await app.listen({ port: config.port, host: '0.0.0.0' });
  app.log.info(`TFI server listening on port ${config.port}`);
  await startScheduler();
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
