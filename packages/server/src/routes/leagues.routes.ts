// ============================================================
// Leagues Routes
// ============================================================

import type { FastifyInstance } from 'fastify';
import * as repo from '../repos/leagues.repo.js';

export async function leagueRoutes(app: FastifyInstance) {
  app.get('/api/leagues', async () => {
    return repo.getAllLeagues();
  });

  app.get('/api/leagues/active', async () => {
    return repo.getActiveLeagues();
  });

  app.get<{ Params: { id: string } }>('/api/leagues/:id', async (req, reply) => {
    const id = Number(req.params.id);
    if (Number.isNaN(id)) return reply.code(400).send({ error: 'Invalid league ID' });
    const league = await repo.getLeagueById(id);
    if (!league) return reply.code(404).send({ error: 'League not found' });
    return league;
  });

  app.put<{ Params: { id: string }; Body: { active: boolean } }>(
    '/api/leagues/:id/active',
    async (req, reply) => {
      const id = Number(req.params.id);
      if (Number.isNaN(id)) return reply.code(400).send({ error: 'Invalid league ID' });
      const league = await repo.updateLeagueActive(id, req.body.active);
      if (!league) return reply.code(404).send({ error: 'League not found' });
      return league;
    },
  );

  app.post<{ Body: { ids: number[]; active: boolean } }>(
    '/api/leagues/bulk-active',
    async (req) => {
      const count = await repo.bulkSetActive(req.body.ids, req.body.active);
      return { updated: count };
    },
  );

  app.post<{ Body: repo.LeagueRow[] }>('/api/leagues/sync', async (req) => {
    const count = await repo.upsertLeagues(req.body);
    return { upserted: count };
  });
}
