// ============================================================
// Job Management Routes — /api/jobs
// ============================================================

import type { FastifyInstance } from 'fastify';
import { getJobsStatus, triggerJob, updateJobInterval } from '../jobs/scheduler.js';

export async function jobRoutes(app: FastifyInstance) {
  // GET /api/jobs — list all jobs and their status
  app.get('/api/jobs', async () => {
    return getJobsStatus();
  });

  // POST /api/jobs/:name/trigger — manually run a job
  app.post<{ Params: { name: string } }>('/api/jobs/:name/trigger', async (req, reply) => {
    const result = await triggerJob(req.params.name);
    if (!result) {
      return reply.status(404).send({ error: `Job "${req.params.name}" not found` });
    }
    return result;
  });

  // PUT /api/jobs/:name — update job interval
  app.put<{ Params: { name: string }; Body: { intervalMs: number } }>('/api/jobs/:name', async (req, reply) => {
    const { intervalMs } = req.body;
    if (typeof intervalMs !== 'number' || intervalMs < 0) {
      return reply.status(400).send({ error: 'intervalMs must be a non-negative number' });
    }
    const result = updateJobInterval(req.params.name, intervalMs);
    if (!result) {
      return reply.status(404).send({ error: `Job "${req.params.name}" not found` });
    }
    return result;
  });
}
