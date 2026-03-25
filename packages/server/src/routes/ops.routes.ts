import type { FastifyInstance, FastifyReply } from 'fastify';
import { requireAdminOrOwner } from '../lib/authz.js';
import { getOpsMonitoringSnapshot } from '../repos/ops-monitoring.repo.js';

export async function opsRoutes(app: FastifyInstance) {
  app.get('/api/ops/overview', async (req, reply: FastifyReply) => {
    const user = requireAdminOrOwner(req, reply);
    if (!user) return;
    try {
      return getOpsMonitoringSnapshot();
    } catch (err) {
      app.log.error(err, '[ops] getOpsMonitoringSnapshot failed');
      return reply.status(500).send({ error: 'Failed to generate ops snapshot', detail: err instanceof Error ? err.message : String(err) });
    }
  });
}
