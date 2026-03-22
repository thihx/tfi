// ============================================================
// Push Routes — /api/push
// ============================================================

import type { FastifyInstance } from 'fastify';
import { config } from '../config.js';
import { isWebPushConfigured } from '../lib/web-push.js';
import {
  upsertSubscription,
  deleteSubscription,
  countSubscriptions,
} from '../repos/push-subscriptions.repo.js';

interface SubscribeBody {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

export async function pushRoutes(app: FastifyInstance) {
  // GET /api/push/vapid-public-key
  app.get('/api/push/vapid-public-key', async (_req, reply) => {
    if (!isWebPushConfigured()) {
      return reply.status(503).send({ error: 'Web Push not configured on this server.' });
    }
    return { vapidPublicKey: config.vapidPublicKey };
  });

  // GET /api/push/status
  app.get('/api/push/status', async (_req, reply) => {
    if (!isWebPushConfigured()) {
      return reply.status(503).send({ error: 'Web Push not configured on this server.' });
    }
    const count = await countSubscriptions();
    return { configured: true, subscriptionCount: count };
  });

  // POST /api/push/subscribe
  app.post<{ Body: SubscribeBody }>('/api/push/subscribe', async (req, reply) => {
    if (!isWebPushConfigured()) {
      return reply.status(503).send({ error: 'Web Push not configured on this server.' });
    }
    const { endpoint, keys } = req.body ?? {};
    if (!endpoint || !keys?.p256dh || !keys?.auth) {
      return reply.status(400).send({ error: 'Invalid subscription: endpoint and keys (p256dh, auth) are required.' });
    }
    const userAgent = req.headers['user-agent'] ?? undefined;
    await upsertSubscription(endpoint, keys.p256dh, keys.auth, userAgent);
    return reply.status(201).send({ ok: true });
  });

  // DELETE /api/push/subscribe
  app.delete<{ Body: { endpoint: string } }>('/api/push/subscribe', async (req, reply) => {
    const { endpoint } = req.body ?? {};
    if (!endpoint) {
      return reply.status(400).send({ error: 'endpoint is required.' });
    }
    await deleteSubscription(endpoint);
    return { ok: true };
  });
}
