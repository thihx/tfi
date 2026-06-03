import type { FastifyInstance, FastifyReply } from 'fastify';
import { requireAdminOrOwner } from '../lib/authz.js';
import { getOpsMonitoringSnapshot } from '../repos/ops-monitoring.repo.js';
import {
  closeAiGatewayBreaker,
  listAiGatewayBreakers,
  listAiGatewayIncidents,
  listAiGatewayLogs,
  updateAiGatewayIncidentStatus,
} from '../repos/ai-gateway.repo.js';

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

  app.get('/api/ops/ai-gateway/logs', async (req, reply: FastifyReply) => {
    const user = requireAdminOrOwner(req, reply);
    if (!user) return;
    const limit = Number((req.query as { limit?: string }).limit ?? 20);
    return { rows: await listAiGatewayLogs(limit) };
  });

  app.get('/api/ops/ai-gateway/incidents', async (req, reply: FastifyReply) => {
    const user = requireAdminOrOwner(req, reply);
    if (!user) return;
    const limit = Number((req.query as { limit?: string }).limit ?? 20);
    return { rows: await listAiGatewayIncidents(limit) };
  });

  app.get('/api/ops/ai-gateway/breakers', async (req, reply: FastifyReply) => {
    const user = requireAdminOrOwner(req, reply);
    if (!user) return;
    const limit = Number((req.query as { limit?: string }).limit ?? 20);
    return { rows: await listAiGatewayBreakers(limit) };
  });

  app.post<{ Params: { id: string }; Body: { note?: unknown } }>(
    '/api/ops/ai-gateway/incidents/:id/acknowledge',
    async (req, reply: FastifyReply) => {
      const user = requireAdminOrOwner(req, reply);
      if (!user) return;
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id <= 0) return reply.status(400).send({ error: 'Invalid incident id' });
      const row = await updateAiGatewayIncidentStatus(
        id,
        'acknowledged',
        user.email,
        typeof req.body?.note === 'string' ? req.body.note : undefined,
      );
      if (!row) return reply.status(404).send({ error: 'Incident not found' });
      return { row };
    },
  );

  app.post<{ Params: { id: string }; Body: { note?: unknown } }>(
    '/api/ops/ai-gateway/incidents/:id/resolve',
    async (req, reply: FastifyReply) => {
      const user = requireAdminOrOwner(req, reply);
      if (!user) return;
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id <= 0) return reply.status(400).send({ error: 'Invalid incident id' });
      const row = await updateAiGatewayIncidentStatus(
        id,
        'resolved',
        user.email,
        typeof req.body?.note === 'string' ? req.body.note : undefined,
      );
      if (!row) return reply.status(404).send({ error: 'Incident not found' });
      return { row };
    },
  );

  app.post<{ Params: { id: string }; Body: { note?: unknown } }>(
    '/api/ops/ai-gateway/breakers/:id/close',
    async (req, reply: FastifyReply) => {
      const user = requireAdminOrOwner(req, reply);
      if (!user) return;
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id <= 0) return reply.status(400).send({ error: 'Invalid breaker id' });
      const row = await closeAiGatewayBreaker(
        id,
        user.email,
        typeof req.body?.note === 'string' ? req.body.note : undefined,
      );
      if (!row) return reply.status(404).send({ error: 'Open breaker not found' });
      return { row };
    },
  );
}
