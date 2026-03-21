import type { FastifyInstance } from 'fastify';
import { getOpsMonitoringSnapshot } from '../repos/ops-monitoring.repo.js';

export async function opsRoutes(app: FastifyInstance) {
  app.get('/api/ops/overview', async () => {
    return getOpsMonitoringSnapshot();
  });
}
