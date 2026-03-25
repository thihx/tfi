import type { FastifyInstance } from 'fastify';
import { requireCurrentUser } from '../lib/authz.js';
import * as repo from '../repos/recommendation-deliveries.repo.js';

export async function recommendationDeliveriesRoutes(app: FastifyInstance) {
  app.get<{
    Querystring: {
      limit?: string;
      offset?: string;
      matchId?: string;
      eligibilityStatus?: string;
      deliveryStatus?: string;
      includeHidden?: string;
      dismissed?: string;
      result?: string;
      bet_type?: string;
      search?: string;
      league?: string;
      date_from?: string;
      date_to?: string;
      risk_level?: string;
      sort_by?: string;
      sort_dir?: string;
    };
  }>('/api/me/recommendation-deliveries', async (req, reply) => {
    const user = requireCurrentUser(req, reply);
    if (!user) return;

    return repo.getRecommendationDeliveriesByUserId(user.userId, {
      limit: req.query.limit ? Number(req.query.limit) : undefined,
      offset: req.query.offset ? Number(req.query.offset) : undefined,
      matchId: req.query.matchId || undefined,
      eligibilityStatus: req.query.eligibilityStatus || undefined,
      deliveryStatus: req.query.deliveryStatus || undefined,
      includeHidden: req.query.includeHidden === 'true',
      dismissed: req.query.dismissed === undefined ? undefined : req.query.dismissed === 'true',
      result: req.query.result || undefined,
      betType: req.query.bet_type || undefined,
      search: req.query.search || undefined,
      league: req.query.league || undefined,
      dateFrom: req.query.date_from || undefined,
      dateTo: req.query.date_to || undefined,
      riskLevel: req.query.risk_level || undefined,
      sortBy: req.query.sort_by || undefined,
      sortDir: req.query.sort_dir || undefined,
    });
  });

  app.patch<{
    Params: { id: string };
    Body: { hidden?: boolean; dismissed?: boolean };
  }>('/api/me/recommendation-deliveries/:id', async (req, reply) => {
    const user = requireCurrentUser(req, reply);
    if (!user) return;

    const deliveryId = Number(req.params.id);
    if (!Number.isInteger(deliveryId) || deliveryId <= 0) {
      return reply.status(400).send({ error: 'Invalid delivery ID' });
    }

    const hasSupportedUpdate =
      typeof req.body?.hidden === 'boolean' ||
      typeof req.body?.dismissed === 'boolean';
    if (!hasSupportedUpdate) {
      return reply.status(400).send({ error: 'No delivery updates provided' });
    }

    const updated = await repo.updateRecommendationDeliveryFlags(user.userId, deliveryId, req.body ?? {});
    if (!updated) {
      return reply.status(404).send({ error: 'Recommendation delivery not found' });
    }

    return { updated: true };
  });
}