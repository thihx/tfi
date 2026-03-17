// ============================================================
// Job Management Routes — /api/jobs
// ============================================================

import type { FastifyInstance } from 'fastify';
import { getJobsStatus, triggerJob, updateJobInterval } from '../jobs/scheduler.js';
import { setForceEnrich } from '../jobs/enrich-watchlist.job.js';

export async function jobRoutes(app: FastifyInstance) {
  // GET /api/jobs — list all jobs and their status
  app.get('/api/jobs', async () => {
    return getJobsStatus();
  });

  // POST /api/jobs/:name/trigger — manually run a job (non-blocking)
  app.post<{ Params: { name: string }; Body: { force?: boolean } }>('/api/jobs/:name/trigger', async (req, reply) => {
    if (req.params.name === 'enrich-watchlist' && req.body?.force) {
      setForceEnrich();
    }
    const result = triggerJob(req.params.name);
    if (!result) {
      return reply.status(404).send({ error: `Job "${req.params.name}" not found` });
    }
    if (!result.triggered) {
      return reply.status(409).send({ error: 'Job is already running' });
    }
    return { triggered: true };
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
