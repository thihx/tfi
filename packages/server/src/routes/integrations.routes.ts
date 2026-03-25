// ============================================================
// Integration Health Routes
// GET /api/integrations/health          → check all services
// GET /api/integrations/health?service= → check single service
// ============================================================

import type { FastifyInstance } from 'fastify';
import { requireAdminOrOwner } from '../lib/authz.js';
import { checkAllIntegrations, checkSingleIntegration } from '../lib/integration-health.js';

export async function integrationsRoutes(app: FastifyInstance) {
  app.get<{ Querystring: { service?: string } }>('/api/integrations/health', async (req, reply) => {
    const user = requireAdminOrOwner(req, reply);
    if (!user) return;
    try {
      const { service } = req.query;
      if (service) {
        const result = await checkSingleIntegration(service);
        if (!result) return reply.status(404).send({ error: `Unknown service: ${service}` });
        return reply.send(result);
      }
      const snapshot = await checkAllIntegrations();
      return reply.send(snapshot);
    } catch (err) {
      req.log.error(err, 'Integration health check failed');
      return reply.status(500).send({ error: 'Health check failed' });
    }
  });
}
