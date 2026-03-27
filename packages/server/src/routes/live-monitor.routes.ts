import type { FastifyInstance } from 'fastify';
import { getJobsStatus, triggerJob } from '../jobs/scheduler.js';
import {
  runManualAnalysisForMatch,
  type MatchPipelineResult,
  type PipelineResult,
} from '../lib/server-pipeline.js';

interface LiveMonitorJobSummary {
  liveCount: number;
  candidateCount: number;
  processed: number;
  savedRecommendations: number;
  pushedNotifications: number;
  errors: number;
}

interface LiveMonitorProgressPayload {
  liveCount?: unknown;
  candidateCount?: unknown;
  pipelineResults?: PipelineResult[];
}

function flattenPipelineResults(pipelineResults: PipelineResult[] | undefined): MatchPipelineResult[] {
  if (!Array.isArray(pipelineResults)) return [];
  return pipelineResults.flatMap((batch) => Array.isArray(batch.results) ? batch.results : []);
}

function summarizePipelineResults(raw: LiveMonitorProgressPayload | null): LiveMonitorJobSummary | null {
  if (!raw) return null;
  const pipelineResults = Array.isArray(raw.pipelineResults) ? raw.pipelineResults : [];
  const results = flattenPipelineResults(pipelineResults);
  return {
    liveCount: Number(raw.liveCount ?? 0),
    candidateCount: Number(raw.candidateCount ?? 0),
    processed: pipelineResults.reduce((sum, batch) => sum + Number(batch.processed ?? 0), 0),
    savedRecommendations: results.filter((result) => result.saved).length,
    pushedNotifications: results.filter((result) => result.notified).length,
    errors: pipelineResults.reduce((sum, batch) => sum + Number(batch.errors ?? 0), 0),
  };
}

function parseProgressResult(progressResult: string | null): {
  raw: LiveMonitorProgressPayload | null;
  results: MatchPipelineResult[];
  summary: LiveMonitorJobSummary | null;
} {
  if (!progressResult) {
    return { raw: null, results: [], summary: null };
  }

  try {
    const parsed = JSON.parse(progressResult) as LiveMonitorProgressPayload;
    return {
      raw: parsed,
      results: flattenPipelineResults(parsed.pipelineResults),
      summary: summarizePipelineResults(parsed),
    };
  } catch {
    return { raw: null, results: [], summary: null };
  }
}

export async function liveMonitorRoutes(app: FastifyInstance) {
  app.get('/api/live-monitor/status', async (_req, reply) => {
    reply.header('Cache-Control', 'no-store');
    const jobs = await getJobsStatus();
    const job = jobs.find((entry) => entry.name === 'check-live-trigger');

    if (!job) {
      return reply.status(404).send({ error: 'Live monitor job not registered' });
    }

    const parsed = parseProgressResult(job.progress?.result ?? null);

    return {
      job: {
        name: 'check-live-trigger',
        intervalMs: job.intervalMs,
        enabled: job.enabled,
        running: job.running,
        lastRun: job.lastRun,
        lastError: job.lastError,
        runCount: job.runCount,
      },
      progress: job.progress ? {
        step: job.progress.step,
        message: job.progress.message,
        percent: job.progress.percent,
        startedAt: job.progress.startedAt,
        completedAt: job.progress.completedAt,
        error: job.progress.error,
      } : null,
      summary: parsed.summary,
      results: parsed.results,
    };
  });

  app.post('/api/live-monitor/check-live/trigger', async (_req, reply) => {
    const result = triggerJob('check-live-trigger');
    if (!result) {
      return reply.status(404).send({ error: 'Job "check-live-trigger" not found' });
    }
    if (!result.triggered) {
      return reply.status(409).send({ error: 'Job is already running' });
    }
    return { triggered: true };
  });

  app.post<{ Params: { matchId: string } }>(
    '/api/live-monitor/matches/:matchId/analyze',
    async (req, reply) => {
      const matchId = String(req.params.matchId || '').trim();
      if (!matchId) {
        return reply.status(400).send({ error: 'matchId is required' });
      }

      try {
        const result = await runManualAnalysisForMatch(matchId);
        return { result };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (message.includes('not found')) {
          return reply.status(404).send({ error: message });
        }
        return reply.status(500).send({ error: message });
      }
    },
  );
}