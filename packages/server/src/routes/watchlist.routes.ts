// ============================================================
// Watchlist Routes
// ============================================================

import type { FastifyInstance } from 'fastify';
import * as repo from '../repos/watchlist.repo.js';

export async function watchlistRoutes(app: FastifyInstance) {
  app.get('/api/watchlist', async () => {
    return repo.getAllWatchlist();
  });

  app.get('/api/watchlist/active', async () => {
    return repo.getActiveWatchlist();
  });

  app.get<{ Params: { matchId: string } }>('/api/watchlist/:matchId', async (req, reply) => {
    const entry = await repo.getWatchlistByMatchId(req.params.matchId);
    if (!entry) return reply.code(404).send({ error: 'Watchlist entry not found' });
    return entry;
  });

  app.post<{ Body: Partial<repo.WatchlistCreate> }>('/api/watchlist', async (req, reply) => {
    if (!req.body.match_id) return reply.code(400).send({ error: 'match_id is required' });
    const entry = await repo.createWatchlistEntry(req.body);
    return reply.code(201).send(entry);
  });

  app.put<{ Params: { matchId: string }; Body: Partial<repo.WatchlistRow> }>(
    '/api/watchlist/:matchId',
    async (req, reply) => {
      const entry = await repo.updateWatchlistEntry(req.params.matchId, req.body);
      if (!entry) return reply.code(404).send({ error: 'Watchlist entry not found' });
      return entry;
    },
  );

  app.delete<{ Params: { matchId: string } }>('/api/watchlist/:matchId', async (req, reply) => {
    const ok = await repo.deleteWatchlistEntry(req.params.matchId);
    if (!ok) return reply.code(404).send({ error: 'Watchlist entry not found' });
    return { deleted: true };
  });

  /** Increment check counter (used by pipeline) */
  app.post<{ Params: { matchId: string } }>(
    '/api/watchlist/:matchId/check',
    async (req) => {
      await repo.incrementChecks(req.params.matchId);
      return { ok: true };
    },
  );

  /** Expire old entries */
  app.post<{ Body: { cutoffMinutes?: number } }>('/api/watchlist/expire', async (req) => {
    const count = await repo.expireOldEntries(req.body.cutoffMinutes);
    return { expired: count };
  });
}
