// ============================================================
// TFI Server — Fastify + PostgreSQL
// ============================================================

import 'dotenv/config';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import { config } from './config.js';
import { closePool } from './db/pool.js';
import { closeRedis } from './lib/redis.js';
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
import { startScheduler, stopScheduler } from './jobs/scheduler.js';

const app = Fastify({ logger: true });

await app.register(cors, { origin: config.corsOrigin });

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

// Health check
app.get('/api/health', async () => ({ status: 'ok', timestamp: new Date().toISOString() }));

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
  await app.listen({ port: config.port, host: '0.0.0.0' });
  app.log.info(`TFI server listening on port ${config.port}`);
  await startScheduler();
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
