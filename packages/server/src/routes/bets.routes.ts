// ============================================================
// Bets Routes
// ============================================================

import type { FastifyInstance } from 'fastify';
import * as repo from '../repos/bets.repo.js';

export async function betRoutes(app: FastifyInstance) {
  app.get<{ Querystring: { limit?: string; offset?: string } }>(
    '/api/bets',
    async (req) => {
      const limit = Number(req.query.limit) || 50;
      const offset = Number(req.query.offset) || 0;
      return repo.getAllBets({ limit, offset });
    },
  );

  app.get<{ Params: { matchId: string } }>(
    '/api/bets/match/:matchId',
    async (req) => {
      return repo.getBetsByMatchId(req.params.matchId);
    },
  );

  app.get('/api/bets/stats', async () => {
    return repo.getBetStats();
  });

  app.get('/api/bets/stats/by-market', async () => {
    return repo.getBetStatsByMarket();
  });

  app.post<{ Body: Partial<repo.BetCreate> }>(
    '/api/bets',
    async (req, reply) => {
      if (!req.body.match_id) return reply.code(400).send({ error: 'match_id is required' });
      if (!req.body.bet_market) return reply.code(400).send({ error: 'bet_market is required' });
      const bet = await repo.createBet(req.body);
      return reply.code(201).send(bet);
    },
  );

  app.put<{
    Params: { id: string };
    Body: { result: string; pnl: number; final_score?: string };
  }>('/api/bets/:id/settle', async (req, reply) => {
    const id = Number(req.params.id);
    if (Number.isNaN(id)) return reply.code(400).send({ error: 'Invalid bet ID' });
    const bet = await repo.settleBet(
      id,
      req.body.result,
      req.body.pnl,
      req.body.final_score ?? '',
      'manual',
    );
    if (!bet) return reply.code(404).send({ error: 'Bet not found' });
    return bet;
  });
}
