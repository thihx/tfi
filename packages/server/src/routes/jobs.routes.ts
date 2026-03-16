// ============================================================
// Job Management Routes — /api/jobs
// ============================================================

import type { FastifyInstance } from 'fastify';
import { getJobsStatus, triggerJob } from '../jobs/scheduler.js';

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
}
