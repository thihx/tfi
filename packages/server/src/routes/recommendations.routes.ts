// ============================================================
// Recommendations Routes
// ============================================================

import type { FastifyInstance } from 'fastify';
import * as repo from '../repos/recommendations.repo.js';

export async function recommendationRoutes(app: FastifyInstance) {
  app.get<{ Querystring: { limit?: string; offset?: string } }>(
    '/api/recommendations',
    async (req) => {
      const limit = Number(req.query.limit) || 50;
      const offset = Number(req.query.offset) || 0;
      return repo.getAllRecommendations({ limit, offset });
    },
  );

  app.get<{ Params: { matchId: string } }>(
    '/api/recommendations/match/:matchId',
    async (req) => {
      return repo.getRecommendationsByMatchId(req.params.matchId);
    },
  );

  app.get('/api/recommendations/stats', async () => {
    return repo.getStats();
  });

  app.post<{ Body: Partial<repo.RecommendationCreate> }>(
    '/api/recommendations',
    async (req, reply) => {
      if (!req.body.match_id) return reply.code(400).send({ error: 'match_id is required' });
      const rec = await repo.createRecommendation(req.body);
      return reply.code(201).send(rec);
    },
  );

  app.post<{ Body: Partial<repo.RecommendationCreate>[] }>(
    '/api/recommendations/bulk',
    async (req) => {
      const count = await repo.bulkCreateRecommendations(req.body);
      return { inserted: count };
    },
  );

  app.put<{
    Params: { id: string };
    Body: { result: string; pnl: number; actual_outcome?: string };
  }>('/api/recommendations/:id/settle', async (req, reply) => {
    const id = Number(req.params.id);
    if (Number.isNaN(id)) return reply.code(400).send({ error: 'Invalid recommendation ID' });
    const rec = await repo.settleRecommendation(
      id,
      req.body.result,
      req.body.pnl,
      req.body.actual_outcome,
    );
    if (!rec) return reply.code(404).send({ error: 'Recommendation not found' });
    return rec;
  });
}
