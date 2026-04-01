import type { FastifyInstance } from 'fastify';
import { requireAdminOrOwner, requireCurrentUser } from '../lib/authz.js';
import { ENTITLEMENT_CATALOG } from '../lib/subscription-entitlements.js';
import { buildSubscriptionSnapshotResponse } from '../lib/subscription-access.js';
import {
  assignUserSubscription,
  listAdminUserSubscriptions,
  listSubscriptionPlans,
  updateSubscriptionPlan,
  type SubscriptionBillingInterval,
  type SubscriptionStatus,
} from '../repos/subscriptions.repo.js';
import { getUserById } from '../repos/users.repo.js';

const ALLOWED_BILLING_INTERVALS = new Set<SubscriptionBillingInterval>(['manual', 'month', 'year']);
const ALLOWED_SUBSCRIPTION_STATUSES = new Set<SubscriptionStatus>([
  'trialing',
  'active',
  'past_due',
  'canceled',
  'expired',
  'paused',
]);

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export async function subscriptionsRoutes(app: FastifyInstance) {
  app.get('/api/me/subscription', async (req, reply) => {
    const user = requireCurrentUser(req, reply);
    if (!user) return;
    return buildSubscriptionSnapshotResponse(user.userId);
  });

  app.get('/api/settings/subscription/catalog', async (req, reply) => {
    const user = requireAdminOrOwner(req, reply);
    if (!user) return;
    return {
      catalog: ENTITLEMENT_CATALOG,
    };
  });

  app.get('/api/settings/subscription/plans', async (req, reply) => {
    const user = requireAdminOrOwner(req, reply);
    if (!user) return;
    return listSubscriptionPlans();
  });

  app.patch<{
    Params: { planCode: string };
    Body: {
      display_name?: unknown;
      description?: unknown;
      billing_interval?: unknown;
      price_amount?: unknown;
      currency?: unknown;
      active?: unknown;
      public?: unknown;
      display_order?: unknown;
      entitlements?: unknown;
      metadata?: unknown;
    };
  }>('/api/settings/subscription/plans/:planCode', async (req, reply) => {
    const user = requireAdminOrOwner(req, reply);
    if (!user) return;

    const billingInterval = typeof req.body.billing_interval === 'string'
      ? req.body.billing_interval.trim().toLowerCase()
      : undefined;
    if (billingInterval !== undefined && !ALLOWED_BILLING_INTERVALS.has(billingInterval as SubscriptionBillingInterval)) {
      return reply.status(400).send({ error: 'Invalid billing interval' });
    }

    const priceAmount = req.body.price_amount === undefined
      ? undefined
      : typeof req.body.price_amount === 'number'
        ? req.body.price_amount
        : Number(req.body.price_amount);
    if (priceAmount !== undefined && !Number.isFinite(priceAmount)) {
      return reply.status(400).send({ error: 'Invalid price amount' });
    }
    const displayOrder = req.body.display_order === undefined ? undefined : Number(req.body.display_order);
    if (displayOrder !== undefined && !Number.isFinite(displayOrder)) {
      return reply.status(400).send({ error: 'Invalid display order' });
    }

    if (req.body.entitlements !== undefined && !isObjectRecord(req.body.entitlements)) {
      return reply.status(400).send({ error: 'entitlements must be an object' });
    }
    if (req.body.metadata !== undefined && !isObjectRecord(req.body.metadata)) {
      return reply.status(400).send({ error: 'metadata must be an object' });
    }

    const updated = await updateSubscriptionPlan(req.params.planCode, {
      display_name: typeof req.body.display_name === 'string' ? req.body.display_name : undefined,
      description: typeof req.body.description === 'string' ? req.body.description : undefined,
      billing_interval: billingInterval as SubscriptionBillingInterval | undefined,
      price_amount: priceAmount,
      currency: typeof req.body.currency === 'string' ? req.body.currency : undefined,
      active: typeof req.body.active === 'boolean' ? req.body.active : undefined,
      public: typeof req.body.public === 'boolean' ? req.body.public : undefined,
      display_order: displayOrder,
      entitlements: isObjectRecord(req.body.entitlements) ? req.body.entitlements : undefined,
      metadata: isObjectRecord(req.body.metadata) ? req.body.metadata : undefined,
    });

    if (!updated) {
      return reply.status(404).send({ error: 'Subscription plan not found' });
    }

    return updated;
  });

  app.get('/api/settings/subscription/users', async (req, reply) => {
    const user = requireAdminOrOwner(req, reply);
    if (!user) return;
    return listAdminUserSubscriptions();
  });

  app.put<{
    Params: { userId: string };
    Body: {
      planCode?: unknown;
      status?: unknown;
      currentPeriodEnd?: unknown;
      cancelAtPeriodEnd?: unknown;
      metadata?: unknown;
    };
  }>('/api/settings/subscription/users/:userId', async (req, reply) => {
    const currentUser = requireAdminOrOwner(req, reply);
    if (!currentUser) return;

    const target = await getUserById(req.params.userId);
    if (!target) {
      return reply.status(404).send({ error: 'User not found' });
    }

    const planCode = typeof req.body.planCode === 'string' ? req.body.planCode.trim().toLowerCase() : '';
    const status = typeof req.body.status === 'string' ? req.body.status.trim().toLowerCase() : '';

    if (!planCode) {
      return reply.status(400).send({ error: 'planCode is required' });
    }
    if (!ALLOWED_SUBSCRIPTION_STATUSES.has(status as SubscriptionStatus)) {
      return reply.status(400).send({ error: 'Invalid subscription status' });
    }
    if (req.body.metadata !== undefined && !isObjectRecord(req.body.metadata)) {
      return reply.status(400).send({ error: 'metadata must be an object' });
    }

    try {
      const updated = await assignUserSubscription(target.id, {
        planCode,
        status: status as SubscriptionStatus,
        currentPeriodEnd: typeof req.body.currentPeriodEnd === 'string' ? req.body.currentPeriodEnd : null,
        cancelAtPeriodEnd: typeof req.body.cancelAtPeriodEnd === 'boolean' ? req.body.cancelAtPeriodEnd : false,
        metadata: isObjectRecord(req.body.metadata) ? req.body.metadata : undefined,
      });
      return updated;
    } catch (error) {
      if (error instanceof Error && error.message === 'Unknown subscription plan') {
        return reply.status(400).send({ error: 'Unknown subscription plan' });
      }
      throw error;
    }
  });
}
