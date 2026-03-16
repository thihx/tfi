// ============================================================
// Pipeline Runs Routes
// ============================================================

import type { FastifyInstance } from 'fastify';
import * as repo from '../repos/pipeline-runs.repo.js';

export async function pipelineRoutes(app: FastifyInstance) {
  app.get<{ Querystring: { limit?: string } }>('/api/pipeline-runs', async (req) => {
    const limit = Number(req.query.limit) || 20;
    return repo.getRecentRuns(limit);
  });

  app.post<{ Body: { triggered_by?: string } }>('/api/pipeline-runs', async (req, reply) => {
    const run = await repo.createRun(req.body.triggered_by);
    return reply.code(201).send(run);
  });

  app.put<{
    Params: { id: string };
    Body: { matches_count: number; analyzed: number; notified: number; saved: number };
  }>('/api/pipeline-runs/:id/complete', async (req, reply) => {
    const id = Number(req.params.id);
    if (Number.isNaN(id)) return reply.code(400).send({ error: 'Invalid run ID' });
    const run = await repo.completeRun(id, req.body);
    return run;
  });

  app.put<{ Params: { id: string }; Body: { error: string } }>(
    '/api/pipeline-runs/:id/fail',
    async (req, reply) => {
      const id = Number(req.params.id);
      if (Number.isNaN(id)) return reply.code(400).send({ error: 'Invalid run ID' });
      const run = await repo.failRun(id, req.body.error);
      return run;
    },
  );
}
