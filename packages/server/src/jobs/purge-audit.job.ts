// ============================================================
// Job: Housekeeping
// Legacy file / job name preserved as purge-audit for scheduler
// compatibility, but the cleanup now covers multiple high-growth
// tables with separate retention windows.
// ============================================================

import { config } from '../config.js';
import { query } from '../db/pool.js';
import * as auditRepo from '../repos/audit-logs.repo.js';
import * as historyRepo from '../repos/matches-history.repo.js';
import * as providerStatsRepo from '../repos/provider-stats-samples.repo.js';
import * as providerOddsRepo from '../repos/provider-odds-samples.repo.js';
import * as snapshotsRepo from '../repos/match-snapshots.repo.js';
import * as oddsMovementsRepo from '../repos/odds-movements.repo.js';
import * as promptShadowRepo from '../repos/prompt-shadow-runs.repo.js';
import * as pipelineRunsRepo from '../repos/pipeline-runs.repo.js';
import * as deliveriesRepo from '../repos/recommendation-deliveries.repo.js';
import * as recommendationsRepo from '../repos/recommendations.repo.js';
import * as aiPerfRepo from '../repos/ai-performance.repo.js';
import { reportJobProgress } from './job-progress.js';

export interface HousekeepingResult {
  auditDeleted: number;
  matchesHistoryDeleted: number;
  providerStatsDeleted: number;
  providerOddsDeleted: number;
  matchSnapshotsDeleted: number;
  oddsMovementsDeleted: number;
  promptShadowDeleted: number;
  pipelineRunsDeleted: number;
  deliveriesDeleted: number;
  recommendationsSlimmed: number;
  aiPerfAggregated: number;
  aiPerfDeleted: number;
  totalDeleted: number;
  keepDays: {
    audit: number;
    matchesHistory: number;
    matchesHistoryHardDelete: number;
    providerSamples: number;
    matchSnapshots: number;
    oddsMovements: number;
    promptShadow: number;
    pipelineRuns: number;
    deliveries: number;
    recommendationsSlim: number;
    aiPerformance: number;
  };
}

export async function purgeAuditJob(): Promise<HousekeepingResult> {
  const keepDays = {
    audit: config.auditKeepDays,
    matchesHistory: config.matchesHistoryKeepDays,
    matchesHistoryHardDelete: config.matchesHistoryHardDeleteDays,
    providerSamples: config.providerSamplesKeepDays,
    matchSnapshots: config.matchSnapshotsKeepDays,
    oddsMovements: config.oddsMovementsKeepDays,
    promptShadow: config.promptShadowKeepDays,
    pipelineRuns: config.pipelineRunsKeepDays,
    deliveries: config.deliveriesKeepDays,
    recommendationsSlim: config.recommendationsSlimDays,
    aiPerformance: config.aiPerformanceKeepDays,
  };

  await reportJobProgress('purge-audit', 'purge', 'Running housekeeping cleanup...', 15);

  const [
    auditDeleted,
    matchesHistoryDeleted,
    providerStatsDeleted,
    providerOddsDeleted,
    matchSnapshotsDeleted,
    oddsMovementsDeleted,
    promptShadowDeleted,
    pipelineRunsDeleted,
    deliveriesDeleted,
    recommendationsSlimmed,
    aiPerfResult,
  ] = await Promise.all([
    auditRepo.purgeAuditLogs(keepDays.audit),
    historyRepo.purgeHistoricalMatches(keepDays.matchesHistory, keepDays.matchesHistoryHardDelete),
    providerStatsRepo.purgeProviderStatsSamples(keepDays.providerSamples),
    providerOddsRepo.purgeProviderOddsSamples(keepDays.providerSamples),
    snapshotsRepo.purgeMatchSnapshots(keepDays.matchSnapshots),
    oddsMovementsRepo.purgeOddsMovements(keepDays.oddsMovements),
    promptShadowRepo.purgePromptShadowRuns(keepDays.promptShadow),
    pipelineRunsRepo.purgePipelineRuns(keepDays.pipelineRuns),
    deliveriesRepo.purgeOldDeliveries(keepDays.deliveries),
    recommendationsRepo.slimOldRecommendations(keepDays.recommendationsSlim),
    aiPerfRepo.aggregateAndPurgeOldAiPerformance(keepDays.aiPerformance),
  ]);

  const aiPerfAggregated = aiPerfResult.aggregated;
  const aiPerfDeleted = aiPerfResult.deleted;

  const totalDeleted =
    auditDeleted
    + matchesHistoryDeleted
    + providerStatsDeleted
    + providerOddsDeleted
    + matchSnapshotsDeleted
    + oddsMovementsDeleted
    + promptShadowDeleted
    + pipelineRunsDeleted
    + deliveriesDeleted
    + aiPerfDeleted;

  if (totalDeleted > 0 || recommendationsSlimmed > 0) {
    console.log(
      `[purgeAuditJob] Housekeeping: deleted=${totalDeleted} slimmed=${recommendationsSlimmed} ` +
      `(audit=${auditDeleted}, history=${matchesHistoryDeleted}, providerStats=${providerStatsDeleted}, ` +
      `providerOdds=${providerOddsDeleted}, snapshots=${matchSnapshotsDeleted}, oddsMovements=${oddsMovementsDeleted}, ` +
      `promptShadow=${promptShadowDeleted}, pipelineRuns=${pipelineRunsDeleted}, ` +
      `deliveries=${deliveriesDeleted}, aiPerf=${aiPerfDeleted} aiPerfAgg=${aiPerfAggregated})`,
    );

    // VACUUM ANALYZE high-churn tables after significant purges to reclaim bloat
    if (totalDeleted > 1000) {
      await query('VACUUM ANALYZE audit_logs, matches_history, user_recommendation_deliveries, ai_performance, pipeline_runs');
    }
  }

  return {
    auditDeleted,
    matchesHistoryDeleted,
    providerStatsDeleted,
    providerOddsDeleted,
    matchSnapshotsDeleted,
    oddsMovementsDeleted,
    promptShadowDeleted,
    pipelineRunsDeleted,
    deliveriesDeleted,
    recommendationsSlimmed,
    aiPerfAggregated,
    aiPerfDeleted,
    totalDeleted,
    keepDays,
  };
}

export const housekeepingJob = purgeAuditJob;
