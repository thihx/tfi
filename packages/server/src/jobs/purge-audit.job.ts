// ============================================================
// Job: Housekeeping
// Covers all high-growth tables with separate retention windows.
// File name kept as purge-audit for scheduler / Redis key compat.
// ============================================================

import { config } from '../config.js';
import { query } from '../db/pool.js';
import * as auditRepo from '../repos/audit-logs.repo.js';
import * as historyRepo from '../repos/matches-history.repo.js';
import * as providerStatsRepo from '../repos/provider-stats-samples.repo.js';
import * as providerOddsRepo from '../repos/provider-odds-samples.repo.js';
import * as providerOddsCacheRepo from '../repos/provider-odds-cache.repo.js';
import * as providerFixtureInsightRepo from '../repos/provider-fixture-insight.repo.js';
import * as snapshotsRepo from '../repos/match-snapshots.repo.js';
import * as oddsMovementsRepo from '../repos/odds-movements.repo.js';
import * as promptShadowRepo from '../repos/prompt-shadow-runs.repo.js';
import * as pipelineRunsRepo from '../repos/pipeline-runs.repo.js';
import * as jobRunsRepo from '../repos/job-runs.repo.js';
import * as recommendationsRepo from '../repos/recommendations.repo.js';
import * as aiPerfRepo from '../repos/ai-performance.repo.js';
import * as recommendationDeliveriesRepo from '../repos/recommendation-deliveries.repo.js';
import { reportJobProgress } from './job-progress.js';

export interface HousekeepingResult {
  auditDeleted: number;
  matchesHistoryDeleted: number;
  providerStatsDeleted: number;
  providerOddsDeleted: number;
  providerCacheDeleted: number;
  matchSnapshotsDeleted: number;
  oddsMovementsDeleted: number;
  promptShadowDeleted: number;
  pipelineRunsDeleted: number;
  jobRunHistoryDeleted: number;
  recommendationDeliveriesDeleted: number;
  recommendationsSlimmed: number;
  aiPerfAggregated: number;
  aiPerfDeleted: number;
  totalDeleted: number;
  failedPhases: string[];
  keepDays: {
    audit: number;
    matchesHistory: number;
    matchesHistoryHardDelete: number;
    providerSamples: number;
    providerCache: number;
    matchSnapshots: number;
    oddsMovements: number;
    promptShadow: number;
    pipelineRuns: number;
    jobRunHistory: number;
    recommendationDeliveries: number;
    recommendationsSlim: number;
    aiPerformance: number;
  };
}

/**
 * Daily housekeeping job.
 *
 * Delivery history retention is opt-in. Default keepDays=0 disables global
 * purge unless the deployment explicitly accepts age-based retention.
 */
export async function housekeepingJob(): Promise<HousekeepingResult> {
  const keepDays = {
    audit: config.auditKeepDays,
    matchesHistory: config.matchesHistoryKeepDays,
    matchesHistoryHardDelete: config.matchesHistoryHardDeleteDays,
    providerSamples: config.providerSamplesKeepDays,
    providerCache: config.providerCacheKeepDays,
    matchSnapshots: config.matchSnapshotsKeepDays,
    oddsMovements: config.oddsMovementsKeepDays,
    promptShadow: config.promptShadowKeepDays,
    pipelineRuns: config.pipelineRunsKeepDays,
    jobRunHistory: config.jobRunHistoryKeepDays,
    recommendationDeliveries: config.recommendationDeliveriesKeepDays,
    recommendationsSlim: config.recommendationsSlimDays,
    aiPerformance: config.aiPerformanceKeepDays,
  };

  const failedPhases: string[] = [];
  const failedPhaseSet = new Set<string>();
  const recordFailure = (phase: string, error: unknown) => {
    if (!failedPhaseSet.has(phase)) {
      failedPhaseSet.add(phase);
      failedPhases.push(phase);
    }
    console.error(`[housekeepingJob] phase "${phase}" failed:`, error);
  };
  const runStep = async <T>(phase: string, fn: () => Promise<T>, fallback: T): Promise<T> => {
    try {
      return await fn();
    } catch (error) {
      recordFailure(phase, error);
      return fallback;
    }
  };

  await reportJobProgress('purge-audit', 'purge', 'Running housekeeping cleanup...', 15);
  await reportJobProgress('purge-audit', 'retention', 'Purging logs, history, and provider samples...', 30);

  const [
    auditDeleted,
    matchesHistoryDeleted,
    providerStatsDeleted,
    providerOddsDeleted,
    providerCacheDeleted,
    matchSnapshotsDeleted,
    oddsMovementsDeleted,
    promptShadowDeleted,
    pipelineRunsDeleted,
    jobRunHistoryDeleted,
    recommendationDeliveriesDeleted,
  ] = await Promise.all([
    runStep('audit-logs', () => auditRepo.purgeAuditLogs(keepDays.audit), 0),
    runStep('matches-history', () => historyRepo.purgeHistoricalMatches(keepDays.matchesHistory, keepDays.matchesHistoryHardDelete), 0),
    runStep('provider-stats-samples', () => providerStatsRepo.purgeProviderStatsSamples(keepDays.providerSamples), 0),
    runStep('provider-odds-samples', () => providerOddsRepo.purgeProviderOddsSamples(keepDays.providerSamples), 0),
    runStep(
      'provider-cache',
      async () => {
        const [providerOddsCacheDeleted, providerFixtureCaches] = await Promise.all([
          providerOddsCacheRepo.purgeProviderOddsCache(keepDays.providerCache),
          providerFixtureInsightRepo.purgeProviderFixtureCaches(keepDays.providerCache),
        ]);
        return providerOddsCacheDeleted + providerFixtureCaches.totalDeleted;
      },
      0,
    ),
    runStep('match-snapshots', () => snapshotsRepo.purgeMatchSnapshots(keepDays.matchSnapshots), 0),
    runStep('odds-movements', () => oddsMovementsRepo.purgeOddsMovements(keepDays.oddsMovements), 0),
    runStep('prompt-shadow-runs', () => promptShadowRepo.purgePromptShadowRuns(keepDays.promptShadow), 0),
    runStep('pipeline-runs', () => pipelineRunsRepo.purgePipelineRuns(keepDays.pipelineRuns), 0),
    runStep('job-run-history', () => jobRunsRepo.purgeJobRuns(keepDays.jobRunHistory), 0),
    keepDays.recommendationDeliveries > 0
      ? runStep(
        'recommendation-deliveries',
        () => recommendationDeliveriesRepo.purgeOldDeliveries(keepDays.recommendationDeliveries),
        0,
      )
      : Promise.resolve(0),
  ]);

  await reportJobProgress('purge-audit', 'analytics', 'Slimming recommendations and aggregating AI performance...', 65);
  const [recommendationsSlimmed, aiPerfResult] = await Promise.all([
    runStep('recommendations-slimming', () => recommendationsRepo.slimOldRecommendations(keepDays.recommendationsSlim), 0),
    runStep(
      'ai-performance',
      () => aiPerfRepo.aggregateAndPurgeOldAiPerformance(keepDays.aiPerformance),
      { aggregated: 0, deleted: 0 },
    ),
  ]);

  const aiPerfAggregated = aiPerfResult.aggregated;
  const aiPerfDeleted = aiPerfResult.deleted;

  const totalDeleted =
    auditDeleted
    + matchesHistoryDeleted
    + providerStatsDeleted
    + providerOddsDeleted
    + providerCacheDeleted
    + matchSnapshotsDeleted
    + oddsMovementsDeleted
    + promptShadowDeleted
    + pipelineRunsDeleted
    + jobRunHistoryDeleted
    + recommendationDeliveriesDeleted
    + aiPerfDeleted;

  if (totalDeleted > 0 || recommendationsSlimmed > 0) {
    console.log(
      `[housekeepingJob] deleted=${totalDeleted} slimmed=${recommendationsSlimmed} ` +
      `(audit=${auditDeleted}, history=${matchesHistoryDeleted}, providerStats=${providerStatsDeleted}, ` +
      `providerOdds=${providerOddsDeleted}, providerCache=${providerCacheDeleted}, snapshots=${matchSnapshotsDeleted}, oddsMovements=${oddsMovementsDeleted}, ` +
      `promptShadow=${promptShadowDeleted}, pipelineRuns=${pipelineRunsDeleted}, jobRuns=${jobRunHistoryDeleted}, deliveries=${recommendationDeliveriesDeleted}, ` +
      `aiPerf=${aiPerfDeleted} aiPerfAgg=${aiPerfAggregated})`,
    );

    await reportJobProgress('purge-audit', 'vacuum', 'Evaluating VACUUM ANALYZE thresholds...', 85);
    const vacuumTargets = [
      auditDeleted > 250 ? 'audit_logs' : null,
      matchesHistoryDeleted > 250 ? 'matches_history' : null,
      aiPerfDeleted > 250 ? 'ai_performance' : null,
      pipelineRunsDeleted > 250 ? 'pipeline_runs' : null,
      providerStatsDeleted > 250 ? 'provider_stats_samples' : null,
      providerOddsDeleted > 250 ? 'provider_odds_samples' : null,
      providerCacheDeleted > 250 ? 'provider_odds_cache, provider_fixture_cache, provider_fixture_stats_cache, provider_fixture_events_cache, provider_fixture_lineups_cache, provider_fixture_prediction_cache, provider_league_standings_cache' : null,
      matchSnapshotsDeleted > 250 ? 'match_snapshots' : null,
      oddsMovementsDeleted > 250 ? 'odds_movements' : null,
      promptShadowDeleted > 250 ? 'prompt_shadow_runs' : null,
      jobRunHistoryDeleted > 250 ? 'job_run_history' : null,
      recommendationDeliveriesDeleted > 250 ? 'user_recommendation_deliveries' : null,
    ].filter((table): table is string => table != null);

    if (vacuumTargets.length > 0) {
      await runStep(
        'vacuum-analyze',
        async () => {
          await query(`VACUUM ANALYZE ${vacuumTargets.join(', ')}`);
          return true;
        },
        false,
      );
    }
  }

  return {
    auditDeleted,
    matchesHistoryDeleted,
    providerStatsDeleted,
    providerOddsDeleted,
    providerCacheDeleted,
    matchSnapshotsDeleted,
    oddsMovementsDeleted,
    promptShadowDeleted,
    pipelineRunsDeleted,
    jobRunHistoryDeleted,
    recommendationDeliveriesDeleted,
    recommendationsSlimmed,
    aiPerfAggregated,
    aiPerfDeleted,
    totalDeleted,
    failedPhases,
    keepDays,
  };
}

/** @deprecated Use housekeepingJob */
export const purgeAuditJob = housekeepingJob;
