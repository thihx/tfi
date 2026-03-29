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
import * as snapshotsRepo from '../repos/match-snapshots.repo.js';
import * as oddsMovementsRepo from '../repos/odds-movements.repo.js';
import * as promptShadowRepo from '../repos/prompt-shadow-runs.repo.js';
import * as pipelineRunsRepo from '../repos/pipeline-runs.repo.js';
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
    recommendationsSlim: number;
    aiPerformance: number;
  };
}

/**
 * Daily housekeeping job.
 *
 * NOTE — user_recommendation_deliveries is intentionally NOT purged here.
 * Each row is per-user financial history; blanket age-based deletion would
 * treat all users identically which is wrong in a multi-user system.
 * Delivery records should be cleaned up as part of account lifecycle
 * management (account deletion / GDPR erasure), not a global time window.
 */
export async function housekeepingJob(): Promise<HousekeepingResult> {
  const keepDays = {
    audit: config.auditKeepDays,
    matchesHistory: config.matchesHistoryKeepDays,
    matchesHistoryHardDelete: config.matchesHistoryHardDeleteDays,
    providerSamples: config.providerSamplesKeepDays,
    matchSnapshots: config.matchSnapshotsKeepDays,
    oddsMovements: config.oddsMovementsKeepDays,
    promptShadow: config.promptShadowKeepDays,
    pipelineRuns: config.pipelineRunsKeepDays,
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
    + aiPerfDeleted;

  if (totalDeleted > 0 || recommendationsSlimmed > 0) {
    console.log(
      `[housekeepingJob] deleted=${totalDeleted} slimmed=${recommendationsSlimmed} ` +
      `(audit=${auditDeleted}, history=${matchesHistoryDeleted}, providerStats=${providerStatsDeleted}, ` +
      `providerOdds=${providerOddsDeleted}, snapshots=${matchSnapshotsDeleted}, oddsMovements=${oddsMovementsDeleted}, ` +
      `promptShadow=${promptShadowDeleted}, pipelineRuns=${pipelineRunsDeleted}, ` +
      `aiPerf=${aiPerfDeleted} aiPerfAgg=${aiPerfAggregated})`,
    );

    // VACUUM ANALYZE high-churn tables after significant purges to reclaim bloat
    if (totalDeleted > 1000) {
      await query('VACUUM ANALYZE audit_logs, matches_history, ai_performance, pipeline_runs');
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
    recommendationsSlimmed,
    aiPerfAggregated,
    aiPerfDeleted,
    totalDeleted,
    keepDays,
  };
}

/** @deprecated Use housekeepingJob */
export const purgeAuditJob = housekeepingJob;
