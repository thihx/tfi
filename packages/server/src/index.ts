// ============================================================
// TFI Server — Fastify + PostgreSQL
// ============================================================

import 'dotenv/config';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { existsSync } from 'node:fs';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import { config } from './config.js';
import { closePool, query } from './db/pool.js';
import { closeRedis, getRedisClient } from './lib/redis.js';
import { leagueRoutes } from './routes/leagues.routes.js';
import { matchRoutes } from './routes/matches.routes.js';
import { watchlistRoutes } from './routes/watchlist.routes.js';
import { recommendationRoutes } from './routes/recommendations.routes.js';
import { pipelineRoutes } from './routes/pipeline-runs.routes.js';
import { jobRoutes } from './routes/jobs.routes.js';
import { proxyRoutes } from './routes/proxy.routes.js';
import { betRoutes } from './routes/bets.routes.js';
import { snapshotRoutes } from './routes/snapshots.routes.js';
import { oddsRoutes } from './routes/odds.routes.js';
import { aiPerformanceRoutes } from './routes/ai-performance.routes.js';
import { reportRoutes } from './routes/reports.routes.js';
import { settingsRoutes } from './routes/settings.routes.js';
import { auditLogRoutes } from './routes/audit-logs.routes.js';
import { integrationsRoutes } from './routes/integrations.routes.js';
import { startScheduler, stopScheduler } from './jobs/scheduler.js';
import { authRoutes } from './routes/auth.routes.js';
import { verifyToken } from './lib/jwt.js';

const app = Fastify({ logger: true });

// ── Process-level error handlers ─────────────────────────────
process.on('uncaughtException', (err) => {
  app.log.error({ err }, 'Uncaught exception');
  // Let the process crash after logging — supervisor should restart
});

process.on('unhandledRejection', (reason) => {
  app.log.error({ reason }, 'Unhandled rejection');
});

// ── Startup connection validation ────────────────────────────
async function validateConnections(): Promise<void> {
  // PostgreSQL
  try {
    await query('SELECT 1');
    app.log.info('PostgreSQL connection OK');
  } catch (err) {
    app.log.error({ err }, 'PostgreSQL connection FAILED');
    throw err;
  }

  // Redis
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
  // Allow the configured origin plus any localhost port (covers multiple dev servers)
  origin: (origin, cb) => {
    if (!origin || origin === config.corsOrigin || /^https?:\/\/localhost(:\d+)?$/.test(origin)) {
      cb(null, true);
    } else {
      cb(new Error(`CORS: origin ${origin} not allowed`), false);
    }
  },
  methods: ['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE'],
});

// ── Auth routes (public — no JWT required) ───────────────────
await app.register(authRoutes);

// ── JWT guard: only active when Google OAuth is fully configured ──
const authEnabled = !!(config.googleClientId && config.googleClientSecret);
if (authEnabled) {
  app.addHook('preHandler', async (req, reply) => {
    const url = req.url.split('?')[0]!;
    if (!url.startsWith('/api/') || url.startsWith('/api/auth/') || url === '/api/health') return;

    const authHeader = req.headers['authorization'];
    const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
    if (!token) {
      return reply.status(401).send({ error: 'Unauthorized — no token' });
    }
    const payload = verifyToken(token, config.jwtSecret);
    if (!payload) {
      return reply.status(401).send({ error: 'Unauthorized — invalid or expired token' });
    }
  });
  app.log.info('[auth] JWT guard ENABLED (Google OAuth configured)');
} else {
  app.log.info('[auth] JWT guard DISABLED (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET not set)');
}

// Register route modules
await app.register(leagueRoutes);
await app.register(matchRoutes);
await app.register(watchlistRoutes);
await app.register(recommendationRoutes);
await app.register(pipelineRoutes);
await app.register(jobRoutes);
await app.register(proxyRoutes);
await app.register(betRoutes);
await app.register(snapshotRoutes);
await app.register(oddsRoutes);
await app.register(aiPerformanceRoutes);
await app.register(reportRoutes);
await app.register(settingsRoutes);
await app.register(auditLogRoutes);
await app.register(integrationsRoutes);

// Health check
app.get('/api/health', async () => ({ status: 'ok', timestamp: new Date().toISOString() }));

// ── Static file serving (production single-container) ────────
const __dirname = dirname(fileURLToPath(import.meta.url));
const clientDir = join(__dirname, '..', 'client');
if (existsSync(clientDir)) {
  await app.register(fastifyStatic, { root: clientDir, wildcard: false });
  // SPA fallback: serve index.html for non-API routes
  app.setNotFoundHandler((req, reply) => {
    if (req.url.startsWith('/api/')) {
      reply.status(404).send({ error: 'Not found' });
    } else {
      reply.sendFile('index.html');
    }
  });
  app.log.info(`Serving static files from ${clientDir}`);
}

// Graceful shutdown
const shutdown = async () => {
  app.log.info('Shutting down…');
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
