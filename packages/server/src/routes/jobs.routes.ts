// ============================================================
// Job Management Routes — /api/jobs
// ============================================================

import type { FastifyInstance } from 'fastify';
import { requireAdminOrOwner } from '../lib/authz.js';
import { getJobsStatus, triggerJob, updateJobInterval } from '../jobs/scheduler.js';
import { setForceEnrich } from '../jobs/enrich-watchlist.job.js';
import { getJobRunOverview, getRecentJobRuns } from '../repos/job-runs.repo.js';

export async function jobRoutes(app: FastifyInstance) {
  // GET /api/jobs — list all jobs and their status
  app.get('/api/jobs', async (req, reply) => {
    const user = requireAdminOrOwner(req, reply);
    if (!user) return;
    return getJobsStatus();
  });

  app.get<{ Querystring: { limit?: string; jobName?: string; hours?: string } }>('/api/jobs/runs', async (req, reply) => {
    const user = requireAdminOrOwner(req, reply);
    if (!user) return;

    const limit = Number(req.query.limit || 50);
    const hours = Number(req.query.hours || 24);
    const safeLimit = Number.isFinite(limit) ? Math.min(Math.max(limit, 1), 200) : 50;
    const safeHours = Number.isFinite(hours) ? Math.max(hours, 1) : 24;
    const jobName = typeof req.query.jobName === 'string' && req.query.jobName.trim() !== ''
      ? req.query.jobName.trim()
      : undefined;

    const [runs, overview] = await Promise.all([
      getRecentJobRuns(safeLimit, jobName),
      getJobRunOverview(safeHours),
    ]);

    return {
      jobName: jobName ?? null,
      windowHours: safeHours,
      runs,
      overview,
    };
  });

  // POST /api/jobs/:name/trigger — manually run a job (non-blocking)
  app.post<{ Params: { name: string }; Body: { force?: boolean } }>('/api/jobs/:name/trigger', async (req, reply) => {
    const user = requireAdminOrOwner(req, reply);
    if (!user) return;
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
    const user = requireAdminOrOwner(req, reply);
    if (!user) return;
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
