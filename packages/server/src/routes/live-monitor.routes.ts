import type { FastifyInstance } from 'fastify';
import { getJobsStatus, triggerJob } from '../jobs/scheduler.js';
import { config } from '../config.js';
import * as watchlistRepo from '../repos/watchlist.repo.js';
import * as matchRepo from '../repos/matches.repo.js';
import * as snapshotsRepo from '../repos/match-snapshots.repo.js';
import * as recommendationsRepo from '../repos/recommendations.repo.js';
import { getSettings } from '../repos/settings.repo.js';
import { checkCoarseStalenessServer } from '../lib/server-pipeline-gates.js';
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

interface LiveMonitorMonitoringTarget {
  matchId: string;
  matchDisplay: string;
  league: string;
  status: string | null;
  minute: number | null;
  score: string;
  live: boolean;
  mode: string;
  priority: number;
  customConditions: string;
  recommendedCondition: string;
  lastChecked: string | null;
  totalChecks: number;
  candidate: boolean;
  candidateReason: string;
  baseline: 'none' | 'recommendation' | 'snapshot';
}

interface LiveMonitorMonitoringScope {
  activeWatchCount: number;
  liveWatchCount: number;
  candidateCount: number;
  targets: LiveMonitorMonitoringTarget[];
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

function parseNumSetting(raw: unknown, fallback: number): number {
  const n = Number(raw);
  return Number.isFinite(n) && raw !== '' && raw !== null && raw !== undefined ? n : fallback;
}

async function buildMonitoringScope(): Promise<LiveMonitorMonitoringScope> {
  const activeWatchlist = await watchlistRepo.getActiveOperationalWatchlist();
  if (activeWatchlist.length === 0) {
    return {
      activeWatchCount: 0,
      liveWatchCount: 0,
      candidateCount: 0,
      targets: [],
    };
  }

  const activeMatchIds = activeWatchlist.map((row) => row.match_id);
  const [matches, rawSettings] = await Promise.all([
    matchRepo.getMatchesByIds(activeMatchIds),
    getSettings().catch(() => ({} as Record<string, unknown>)),
  ]);
  const matchMap = new Map(matches.map((match) => [match.match_id, match] as const));
  const liveMatchIds = activeWatchlist.filter((row) => {
    const match = matchMap.get(row.match_id);
    return Boolean(match?.status && config.liveStatuses.includes(match.status));
  }).map((row) => row.match_id);
  const [latestSnapshots, latestRecommendations] = await Promise.all([
    snapshotsRepo.getLatestSnapshotsForMatches(liveMatchIds),
    recommendationsRepo.getLatestRecommendationsForMatches(liveMatchIds),
  ]);
  const reanalyzeMinMinutes = parseNumSetting(
    rawSettings['REANALYZE_MIN_MINUTES'],
    config.pipelineReanalyzeMinMinutes,
  );

  const targets = activeWatchlist.map((row) => {
    const match = matchMap.get(row.match_id);
    const live = Boolean(match?.status && config.liveStatuses.includes(match.status));
    const mode = String(row.mode || 'B').toUpperCase();
    const forceAnalyze = mode === 'F';
    const score = `${match?.home_score ?? 0}-${match?.away_score ?? 0}`;
    const staleness = live
      ? checkCoarseStalenessServer({
          minute: match?.current_minute ?? 0,
          status: match?.status,
          score,
          previousRecommendation: latestRecommendations.get(row.match_id)
            ? {
                minute: latestRecommendations.get(row.match_id)!.minute,
                odds: latestRecommendations.get(row.match_id)!.odds,
                bet_market: latestRecommendations.get(row.match_id)!.bet_market,
                selection: latestRecommendations.get(row.match_id)!.selection,
                score: latestRecommendations.get(row.match_id)!.score,
                status: latestRecommendations.get(row.match_id)!.status,
              }
            : null,
          previousSnapshot: latestSnapshots.get(row.match_id)
            ? {
                minute: latestSnapshots.get(row.match_id)!.minute,
                home_score: latestSnapshots.get(row.match_id)!.home_score,
                away_score: latestSnapshots.get(row.match_id)!.away_score,
                status: latestSnapshots.get(row.match_id)!.status,
                odds: latestSnapshots.get(row.match_id)!.odds,
              }
            : null,
          settings: { reanalyzeMinMinutes },
          forceAnalyze,
        })
      : { isStale: true, reason: 'not_live', baseline: 'none' as const };

    return {
      matchId: row.match_id,
      matchDisplay: [match?.home_team, match?.away_team].filter(Boolean).join(' vs ') || row.match_id,
      league: match?.league_name || row.league || '',
      status: match?.status ?? row.status ?? null,
      minute: match?.current_minute ?? null,
      score,
      live,
      mode,
      priority: Number(row.priority ?? 0),
      customConditions: row.custom_conditions || '',
      recommendedCondition: row.recommended_custom_condition || '',
      lastChecked: row.last_checked ?? null,
      totalChecks: Number(row.total_checks ?? 0),
      candidate: live ? !staleness.isStale : false,
      candidateReason: staleness.reason,
      baseline: staleness.baseline,
    } satisfies LiveMonitorMonitoringTarget;
  }).sort((left, right) => {
    if (left.live !== right.live) return Number(right.live) - Number(left.live);
    if (left.candidate !== right.candidate) return Number(right.candidate) - Number(left.candidate);
    if (left.priority !== right.priority) return right.priority - left.priority;
    return (right.minute ?? 0) - (left.minute ?? 0);
  });

  return {
    activeWatchCount: activeWatchlist.length,
    liveWatchCount: targets.filter((target) => target.live).length,
    candidateCount: targets.filter((target) => target.candidate).length,
    targets,
  };
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
    const monitoring = await buildMonitoringScope();

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
      monitoring,
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

  app.post<{
    Params: { matchId: string };
    Body: { question?: string; history?: Array<{ role: 'user' | 'assistant'; text: string }> };
  }>(
    '/api/live-monitor/matches/:matchId/analyze',
    async (req, reply) => {
      const matchId = String(req.params.matchId || '').trim();
      if (!matchId) {
        return reply.status(400).send({ error: 'matchId is required' });
      }
      const question = typeof req.body?.question === 'string' ? req.body.question.trim() : '';
      const advisoryOnly = question.length > 0;
      const history = Array.isArray(req.body?.history)
        ? req.body.history.filter((entry) => entry && (entry.role === 'user' || entry.role === 'assistant') && typeof entry.text === 'string')
        : undefined;

      try {
        const result = await runManualAnalysisForMatch(matchId, {
          userQuestion: advisoryOnly ? question : undefined,
          followUpHistory: history,
          advisoryOnly,
        });
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
