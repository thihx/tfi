import type { FastifyInstance } from 'fastify';
import { requireCurrentUser } from '../lib/authz.js';
import {
  addUserBankrollFunds,
  getUserBankroll,
  resetUserBankroll,
  withdrawUserBankrollFunds,
} from '../repos/bankroll.repo.js';

function parseMoney(value: unknown): number | null {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return Math.round(parsed * 100) / 100;
}

export async function bankrollRoutes(app: FastifyInstance) {
  app.get('/api/me/bankroll', async (req, reply) => {
    const user = requireCurrentUser(req, reply);
    if (!user) return;
    return getUserBankroll(user.userId);
  });

  app.put<{
    Body: {
      balance?: number | string;
      currency?: string;
      unitMultiplier?: number | string;
      note?: string;
    };
  }>('/api/me/bankroll', async (req, reply) => {
    const user = requireCurrentUser(req, reply);
    if (!user) return;

    const balance = parseMoney(req.body?.balance);
    if (balance == null) {
      return reply.status(400).send({ error: 'balance must be a non-negative number' });
    }

    const unitMultiplier = req.body?.unitMultiplier == null
      ? undefined
      : Number(req.body.unitMultiplier);
    if (unitMultiplier != null && (!Number.isFinite(unitMultiplier) || unitMultiplier <= 0)) {
      return reply.status(400).send({ error: 'unitMultiplier must be greater than 0' });
    }

    return resetUserBankroll(user.userId, {
      balance,
      currency: req.body?.currency,
      unitMultiplier,
      note: req.body?.note,
    });
  });

  app.post<{
    Body: {
      amount?: number | string;
      note?: string;
    };
  }>('/api/me/bankroll/deposit', async (req, reply) => {
    const user = requireCurrentUser(req, reply);
    if (!user) return;

    const amount = parseMoney(req.body?.amount);
    if (amount == null || amount <= 0) {
      return reply.status(400).send({ error: 'amount must be greater than 0' });
    }

    return addUserBankrollFunds(user.userId, {
      amount,
      note: req.body?.note,
    });
  });

  app.post<{
    Body: {
      amount?: number | string;
      note?: string;
    };
  }>('/api/me/bankroll/withdraw', async (req, reply) => {
    const user = requireCurrentUser(req, reply);
    if (!user) return;

    const amount = parseMoney(req.body?.amount);
    if (amount == null || amount <= 0) {
      return reply.status(400).send({ error: 'amount must be greater than 0' });
    }

    try {
      return await withdrawUserBankrollFunds(user.userId, {
        amount,
        note: req.body?.note,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const status = /exceeds|amount/i.test(message) ? 400 : 500;
      return reply.status(status).send({ error: message });
    }
  });
}
