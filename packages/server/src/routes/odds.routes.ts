// ============================================================
// Odds Movements Routes
// ============================================================

import type { FastifyInstance } from 'fastify';
import * as repo from '../repos/odds-movements.repo.js';

export async function oddsRoutes(app: FastifyInstance) {
  app.get<{ Params: { matchId: string }; Querystring: { market?: string } }>(
    '/api/odds/match/:matchId',
    async (req) => {
      return repo.getOddsHistory(req.params.matchId, req.query.market);
    },
  );

  app.post<{
    Body: {
      match_id: string;
      match_minute?: number | null;
      market: string;
      bookmaker?: string;
      line?: number | null;
      price_1?: number | null;
      price_2?: number | null;
      price_x?: number | null;
      prev_price_1?: number | null;
      prev_price_2?: number | null;
    };
  }>('/api/odds', async (req, reply) => {
    if (!req.body.match_id) return reply.code(400).send({ error: 'match_id is required' });
    if (!req.body.market) return reply.code(400).send({ error: 'market is required' });
    const mov = await repo.recordOddsMovement(req.body);
    return reply.code(201).send(mov);
  });

  app.post<{
    Body: Array<{
      match_id: string;
      match_minute?: number | null;
      market: string;
      bookmaker?: string;
      line?: number | null;
      price_1?: number | null;
      price_2?: number | null;
      price_x?: number | null;
      prev_price_1?: number | null;
      prev_price_2?: number | null;
    }>;
  }>('/api/odds/bulk', async (req, reply) => {
    if (!Array.isArray(req.body)) return reply.code(400).send({ error: 'Body must be an array' });
    const results = [];
    for (const mov of req.body) {
      if (!mov.match_id || !mov.market) continue;
      results.push(await repo.recordOddsMovement(mov));
    }
    return reply.code(201).send({ recorded: results.length });
  });
}
