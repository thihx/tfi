// ============================================================
// Bets Routes
// ============================================================

import type { FastifyInstance } from 'fastify';
import * as repo from '../repos/bets.repo.js';
import { requireCurrentUser } from '../lib/authz.js';
import { getUserBankroll } from '../repos/bankroll.repo.js';

export async function betRoutes(app: FastifyInstance) {
  app.get<{ Querystring: { limit?: string; offset?: string } }>(
    '/api/bets',
    async (req, reply) => {
      const user = requireCurrentUser(req, reply);
      if (!user) return;
      const limit = Number(req.query.limit) || 50;
      const offset = Number(req.query.offset) || 0;
      return repo.getAllBets({ limit, offset, userId: user.userId });
    },
  );

  app.get<{ Params: { matchId: string } }>(
    '/api/bets/match/:matchId',
    async (req, reply) => {
      const user = requireCurrentUser(req, reply);
      if (!user) return;
      return repo.getBetsByMatchId(req.params.matchId, user.userId);
    },
  );

  app.get('/api/bets/stats', async (req, reply) => {
    const user = requireCurrentUser(req, reply);
    if (!user) return;
    return repo.getBetStats(user.userId);
  });

  app.get('/api/bets/stats/by-market', async (req, reply) => {
    const user = requireCurrentUser(req, reply);
    if (!user) return;
    return repo.getBetStatsByMarket(user.userId);
  });

  app.post<{ Body: Partial<repo.BetCreate> }>(
    '/api/bets',
    async (req, reply) => {
      const user = requireCurrentUser(req, reply);
      if (!user) return;
      if (!req.body.match_id) return reply.code(400).send({ error: 'match_id is required' });
      const body = req.body as Partial<repo.BetCreate> & { market?: string; stake?: number };
      const betMarket = body.bet_market ?? body.market;
      if (!betMarket) return reply.code(400).send({ error: 'bet_market is required' });
      try {
        const bet = await repo.createBetWithBankrollStake({
          ...body,
          user_id: user.userId,
          bet_market: betMarket,
          stake_amount: body.stake_amount ?? body.stake ?? null,
          created_by: user.userId,
        });
        const bankroll = await getUserBankroll(user.userId);
        return reply.code(201).send({ bet, bankroll });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const status = /exceeds|stake|odds/i.test(message) ? 400 : 500;
        return reply.code(status).send({ error: message });
      }
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
      {
        status: 'resolved',
        method: 'manual',
        note: req.body.final_score ?? '',
      },
    );
    if (!bet) return reply.code(404).send({ error: 'Bet not found' });
    return bet;
  });
}
