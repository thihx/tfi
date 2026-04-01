// ============================================================
// Watchlist Routes
// ============================================================

import type { FastifyInstance } from 'fastify';
import { requireAdminOrOwner, requireCurrentUser } from '../lib/authz.js';
import { assertWatchlistCapacityAvailable, resolveSubscriptionAccess, sendEntitlementError } from '../lib/subscription-access.js';
import * as repo from '../repos/watchlist.repo.js';
import { getSettings } from '../repos/settings.repo.js';

export async function watchlistRoutes(app: FastifyInstance) {
  app.get('/api/me/watch-subscriptions', async (req, reply) => {
    const user = requireCurrentUser(req, reply);
    if (!user) return;
    return repo.getAllWatchlist(user.userId);
  });

  app.get<{ Params: { id: string } }>('/api/me/watch-subscriptions/:id', async (req, reply) => {
    const user = requireCurrentUser(req, reply);
    if (!user) return;
    const subscriptionId = Number(req.params.id);
    if (!Number.isInteger(subscriptionId) || subscriptionId <= 0) {
      return reply.code(400).send({ error: 'Invalid watch subscription ID' });
    }
    const entry = await repo.getWatchSubscriptionById(subscriptionId, user.userId);
    if (!entry) return reply.code(404).send({ error: 'Watch subscription not found' });
    return entry;
  });

  app.post<{ Body: Partial<repo.WatchlistCreate> }>('/api/me/watch-subscriptions', async (req, reply) => {
    const user = requireCurrentUser(req, reply);
    if (!user) return;
    if (!req.body.match_id) return reply.code(400).send({ error: 'match_id is required' });
    if (user.role !== 'admin' && user.role !== 'owner') {
      try {
        const access = await resolveSubscriptionAccess(user.userId);
        await assertWatchlistCapacityAvailable(access, user.userId);
      } catch (error) {
        const entitlement = sendEntitlementError(error);
        if (entitlement) {
          return reply.code(entitlement.statusCode).send(entitlement.payload);
        }
        throw error;
      }
    }
    let body = req.body;
    if (body.auto_apply_recommended_condition == null) {
      const settings = await getSettings(user.userId, { fallbackToDefault: false }).catch(() => ({}));
      const autoApplyRecommendedCondition =
        (settings as Record<string, unknown>).AUTO_APPLY_RECOMMENDED_CONDITION !== false;
      body = {
        ...body,
        auto_apply_recommended_condition: autoApplyRecommendedCondition,
      };
    }
    const entry = await repo.createWatchlistEntry(body, user.userId);
    return reply.code(201).send(entry);
  });

  app.put<{ Params: { id: string }; Body: Partial<repo.WatchlistRow> }>(
    '/api/me/watch-subscriptions/:id',
    async (req, reply) => {
      const user = requireCurrentUser(req, reply);
      if (!user) return;
      const subscriptionId = Number(req.params.id);
      if (!Number.isInteger(subscriptionId) || subscriptionId <= 0) {
        return reply.code(400).send({ error: 'Invalid watch subscription ID' });
      }
      const entry = await repo.updateWatchSubscriptionById(subscriptionId, req.body, user.userId);
      if (!entry) return reply.code(404).send({ error: 'Watch subscription not found' });
      return entry;
    },
  );

  app.patch<{ Params: { id: string }; Body: Partial<repo.WatchlistRow> }>(
    '/api/me/watch-subscriptions/:id',
    async (req, reply) => {
      const user = requireCurrentUser(req, reply);
      if (!user) return;
      const subscriptionId = Number(req.params.id);
      if (!Number.isInteger(subscriptionId) || subscriptionId <= 0) {
        return reply.code(400).send({ error: 'Invalid watch subscription ID' });
      }
      const entry = await repo.updateWatchSubscriptionById(subscriptionId, req.body, user.userId);
      if (!entry) return reply.code(404).send({ error: 'Watch subscription not found' });
      return entry;
    },
  );

  app.delete<{ Params: { id: string } }>('/api/me/watch-subscriptions/:id', async (req, reply) => {
    const user = requireCurrentUser(req, reply);
    if (!user) return;
    const subscriptionId = Number(req.params.id);
    if (!Number.isInteger(subscriptionId) || subscriptionId <= 0) {
      return reply.code(400).send({ error: 'Invalid watch subscription ID' });
    }
    const ok = await repo.deleteWatchSubscriptionById(subscriptionId, user.userId);
    return { deleted: ok };
  });

  /** Delete by match_id — idempotent fallback when subscription ID is not known */
  app.delete<{ Params: { matchId: string } }>('/api/me/watch-subscriptions/by-match/:matchId', async (req, reply) => {
    const user = requireCurrentUser(req, reply);
    if (!user) return;
    const ok = await repo.deleteWatchlistEntry(req.params.matchId, user.userId);
    return { deleted: ok };
  });

  /** Increment check counter (used by pipeline) */
  app.post<{ Params: { matchId: string } }>(
    '/api/watchlist/:matchId/check',
    async (req, reply) => {
      const user = requireAdminOrOwner(req, reply);
      if (!user) return;
      await repo.incrementChecks(req.params.matchId);
      return { ok: true };
    },
  );

  /** Expire old entries */
  app.post<{ Body: { cutoffMinutes?: number } }>('/api/watchlist/expire', async (req, reply) => {
    const user = requireAdminOrOwner(req, reply);
    if (!user) return;
    const count = await repo.expireOldEntries(req.body.cutoffMinutes);
    return { expired: count };
  });
}
