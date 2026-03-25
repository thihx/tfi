// ============================================================
// Push Routes — /api/push
// ============================================================

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { config } from '../config.js';
import { requireCurrentUser } from '../lib/authz.js';
import { isWebPushConfigured } from '../lib/web-push.js';
import {
  upsertSubscription,
  deleteSubscriptionForUser,
  countSubscriptionsByUserId,
} from '../repos/push-subscriptions.repo.js';

interface SubscribeBody {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

export async function pushRoutes(app: FastifyInstance) {
  const getPushStatus = async (req: FastifyRequest, reply: FastifyReply) => {
    if (!isWebPushConfigured()) {
      return reply.status(503).send({ error: 'Web Push not configured on this server.' });
    }
    const user = requireCurrentUser(req, reply);
    if (!user) return;
    const count = await countSubscriptionsByUserId(user.userId);
    return { configured: true, subscriptionCount: count };
  };

  const subscribeCurrentUser = async (
    req: FastifyRequest<{ Body: SubscribeBody }>,
    reply: FastifyReply,
  ) => {
    if (!isWebPushConfigured()) {
      return reply.status(503).send({ error: 'Web Push not configured on this server.' });
    }
    const user = requireCurrentUser(req, reply);
    if (!user) return;
    const { endpoint, keys } = req.body ?? {};
    if (!endpoint || !keys?.p256dh || !keys?.auth) {
      return reply.status(400).send({ error: 'Invalid subscription: endpoint and keys (p256dh, auth) are required.' });
    }
    const userAgent = req.headers['user-agent'] ?? undefined;
    await upsertSubscription(user.userId, endpoint, keys.p256dh, keys.auth, userAgent);
    return reply.status(201).send({ ok: true });
  };

  const deleteCurrentUserSubscription = async (
    req: FastifyRequest<{ Body: { endpoint: string } }>,
    reply: FastifyReply,
  ) => {
    const user = requireCurrentUser(req, reply);
    if (!user) return;
    const { endpoint } = req.body ?? {};
    if (!endpoint) {
      return reply.status(400).send({ error: 'endpoint is required.' });
    }
    await deleteSubscriptionForUser(user.userId, endpoint);
    return { ok: true };
  };

  // GET /api/push/vapid-public-key
  app.get('/api/push/vapid-public-key', async (_req, reply) => {
    if (!isWebPushConfigured()) {
      return reply.status(503).send({ error: 'Web Push not configured on this server.' });
    }
    return { vapidPublicKey: config.vapidPublicKey };
  });

  // GET /api/push/status
  app.get('/api/push/status', getPushStatus);
  app.get('/api/me/push/status', getPushStatus);

  // POST /api/push/subscribe
  app.post<{ Body: SubscribeBody }>('/api/push/subscribe', subscribeCurrentUser);
  app.post<{ Body: SubscribeBody }>('/api/me/push/subscribe', subscribeCurrentUser);

  // DELETE /api/push/subscribe
  app.delete<{ Body: { endpoint: string } }>('/api/push/subscribe', deleteCurrentUserSubscription);
  app.delete<{ Body: { endpoint: string } }>('/api/me/push/subscribe', deleteCurrentUserSubscription);
}
