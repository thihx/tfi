import type { FastifyInstance } from 'fastify';
import { requireCurrentUser } from '../lib/authz.js';
import * as repo from '../repos/recommendation-deliveries.repo.js';

type DeliveryKind = 'actionable' | 'no_action' | 'all';

function parseDeliveryListQuery(query: {
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
  delivery_kind?: string;
}) {
  const deliveryKind: DeliveryKind | undefined = query.delivery_kind === 'actionable' || query.delivery_kind === 'no_action' || query.delivery_kind === 'all'
    ? query.delivery_kind
    : undefined;
  return {
    limit: query.limit ? Number(query.limit) : undefined,
    offset: query.offset ? Number(query.offset) : undefined,
    matchId: query.matchId || undefined,
    eligibilityStatus: query.eligibilityStatus || undefined,
    deliveryStatus: query.deliveryStatus || undefined,
    includeHidden: query.includeHidden === 'true',
    dismissed: query.dismissed === undefined ? undefined : query.dismissed === 'true',
    result: query.result || undefined,
    betType: query.bet_type || undefined,
    search: query.search || undefined,
    league: query.league || undefined,
    dateFrom: query.date_from || undefined,
    dateTo: query.date_to || undefined,
    riskLevel: query.risk_level || undefined,
    sortBy: query.sort_by || undefined,
    sortDir: query.sort_dir || undefined,
    deliveryKind,
  };
}

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
      delivery_kind?: string;
    };
  }>('/api/me/recommendation-deliveries', async (req, reply) => {
    const user = requireCurrentUser(req, reply);
    if (!user) return;

    return repo.getRecommendationDeliveriesByUserId(user.userId, parseDeliveryListQuery(req.query));
  });

  app.get<{
    Querystring: {
      result?: string;
      bet_type?: string;
      search?: string;
      league?: string;
      date_from?: string;
      date_to?: string;
      risk_level?: string;
      delivery_kind?: string;
    };
  }>('/api/me/recommendation-deliveries/summary', async (req, reply) => {
    const user = requireCurrentUser(req, reply);
    if (!user) return;

    const { limit: _l, offset: _o, sortBy: _sb, sortDir: _sd, ...summaryOpts } = parseDeliveryListQuery(req.query);
    return repo.getRecommendationDeliveriesSummary(user.userId, summaryOpts);
  });

  app.get<{
    Querystring: {
      result?: string;
      bet_type?: string;
      search?: string;
      league?: string;
      date_from?: string;
      date_to?: string;
      risk_level?: string;
      delivery_kind?: string;
    };
  }>('/api/me/recommendation-deliveries/chart-series', async (req, reply) => {
    const user = requireCurrentUser(req, reply);
    if (!user) return;

    const { limit: _l, offset: _o, sortBy: _sb, sortDir: _sd, ...chartOpts } = parseDeliveryListQuery(req.query);
    return repo.getRecommendationDeliveriesChartSeries(user.userId, chartOpts);
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
