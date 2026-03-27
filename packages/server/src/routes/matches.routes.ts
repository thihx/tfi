// ============================================================
// Matches Routes
// ============================================================

import type { FastifyInstance } from 'fastify';
import * as repo from '../repos/matches.repo.js';

export async function matchRoutes(app: FastifyInstance) {
  app.get('/api/matches', async (_req, reply) => {
    reply.header('Cache-Control', 'no-store');
    return repo.getAllMatches();
  });

  app.get<{ Querystring: { statuses?: string } }>('/api/matches/by-status', async (req) => {
    const statuses = req.query.statuses?.split(',').filter(Boolean) ?? [];
    return repo.getMatchesByStatus(statuses);
  });

  app.post<{ Body: { ids: string[] } }>('/api/matches/by-ids', async (req) => {
    return repo.getMatchesByIds(req.body.ids);
  });

  /** Full refresh — replaces all matches (used by match fetcher) */
  app.post<{ Body: repo.MatchRow[] }>('/api/matches/refresh', async (req) => {
    const count = await repo.replaceAllMatches(req.body);
    return { replaced: count };
  });

  /** Partial update — live score updates */
  app.patch<{ Body: Partial<repo.MatchRow>[] }>('/api/matches', async (req) => {
    const count = await repo.updateMatches(req.body);
    return { updated: count };
  });

  app.delete<{ Body: { ids: string[] } }>('/api/matches', async (req) => {
    const count = await repo.deleteMatchesByIds(req.body.ids);
    return { deleted: count };
  });
}
