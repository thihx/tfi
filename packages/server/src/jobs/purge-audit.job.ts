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
import {
  resolveHousekeepingRetentionPolicy,
  type HousekeepingRetentionPolicy,
} from '../lib/retention-policy.js';
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
  policyWarnings: string[];
  safetyChecks: {
    protectedTablesVerified: boolean;
    protectedTableCounts: Record<string, number>;
  };
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

export interface HousekeepingPreviewRow {
  label: string;
  tableName: string;
  retentionClass: string;
  strategy: string;
  keepDays: number;
  candidateCount: number;
  oldestCandidateAt: string | null;
  newestCandidateAt: string | null;
}

export interface HousekeepingPreviewResult {
  keepDays: HousekeepingResult['keepDays'];
  policyWarnings: string[];
  protectedTables: string[];
  rows: HousekeepingPreviewRow[];
}

async function getProtectedTableCounts(tableNames: readonly string[]): Promise<Record<string, number>> {
  const entries = await Promise.all(
    tableNames.map(async (tableName) => {
      const result = await query<{ count: string }>(`SELECT COUNT(*)::text AS count FROM ${tableName}`);
      return [tableName, Number(result.rows[0]?.count ?? 0)] as const;
    }),
  );
  return Object.fromEntries(entries);
}

function isProtectedTableCountsEqual(
  before: Record<string, number>,
  after: Record<string, number>,
): boolean {
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  for (const key of keys) {
    if ((before[key] ?? 0) !== (after[key] ?? 0)) return false;
  }
  return true;
}

async function buildHousekeepingPreview(policy: HousekeepingRetentionPolicy): Promise<HousekeepingPreviewRow[]> {
  const previewSpecs = [
    { label: 'Audit Logs', tableName: 'audit_logs', timestampColumn: 'timestamp', key: 'audit' as const, retentionClass: 'operational_log', strategy: 'delete' },
    { label: 'Job Run History', tableName: 'job_run_history', timestampColumn: 'started_at', key: 'jobRunHistory' as const, retentionClass: 'operational_log', strategy: 'delete' },
    { label: 'Pipeline Runs', tableName: 'pipeline_runs', timestampColumn: 'started_at', key: 'pipelineRuns' as const, retentionClass: 'operational_log', strategy: 'delete' },
    { label: 'Prompt Shadow Runs', tableName: 'prompt_shadow_runs', timestampColumn: 'captured_at', key: 'promptShadow' as const, retentionClass: 'operational_log', strategy: 'delete' },
    { label: 'Match Snapshots', tableName: 'match_snapshots', timestampColumn: 'captured_at', key: 'matchSnapshots' as const, retentionClass: 'operational_log', strategy: 'delete' },
    { label: 'Odds Movements', tableName: 'odds_movements', timestampColumn: 'captured_at', key: 'oddsMovements' as const, retentionClass: 'operational_log', strategy: 'delete' },
    { label: 'Provider Stats Samples', tableName: 'provider_stats_samples', timestampColumn: 'captured_at', key: 'providerSamples' as const, retentionClass: 'support_sample', strategy: 'delete' },
    { label: 'Provider Odds Samples', tableName: 'provider_odds_samples', timestampColumn: 'captured_at', key: 'providerSamples' as const, retentionClass: 'support_sample', strategy: 'delete' },
    { label: 'Provider Odds Cache', tableName: 'provider_odds_cache', timestampColumn: 'cached_at', key: 'providerCache' as const, retentionClass: 'support_cache', strategy: 'delete' },
    { label: 'Provider Fixture Cache', tableName: 'provider_fixture_cache', timestampColumn: 'cached_at', key: 'providerCache' as const, retentionClass: 'support_cache', strategy: 'delete' },
    { label: 'Provider Fixture Stats Cache', tableName: 'provider_fixture_stats_cache', timestampColumn: 'cached_at', key: 'providerCache' as const, retentionClass: 'support_cache', strategy: 'delete' },
    { label: 'Provider Fixture Events Cache', tableName: 'provider_fixture_events_cache', timestampColumn: 'cached_at', key: 'providerCache' as const, retentionClass: 'support_cache', strategy: 'delete' },
    { label: 'Provider Fixture Lineups Cache', tableName: 'provider_fixture_lineups_cache', timestampColumn: 'cached_at', key: 'providerCache' as const, retentionClass: 'support_cache', strategy: 'delete' },
    { label: 'Provider Fixture Prediction Cache', tableName: 'provider_fixture_prediction_cache', timestampColumn: 'cached_at', key: 'providerCache' as const, retentionClass: 'support_cache', strategy: 'delete' },
    { label: 'Provider League Standings Cache', tableName: 'provider_league_standings_cache', timestampColumn: 'cached_at', key: 'providerCache' as const, retentionClass: 'support_cache', strategy: 'delete' },
    { label: 'Recommendation Deliveries', tableName: 'user_recommendation_deliveries', timestampColumn: 'created_at', key: 'recommendationDeliveries' as const, retentionClass: 'delivery_trace', strategy: 'delete' },
  ] as const;

  const rows = await Promise.all(
    previewSpecs
      .filter((spec) => policy.keepDays[spec.key] > 0)
      .map(async (spec) => {
        const keepDays = policy.keepDays[spec.key];
        const result = await query<{
          candidate_count: string;
          oldest_candidate_at: string | null;
          newest_candidate_at: string | null;
        }>(
          `SELECT
             COUNT(*)::text AS candidate_count,
             MIN(${spec.timestampColumn})::text AS oldest_candidate_at,
             MAX(${spec.timestampColumn})::text AS newest_candidate_at
           FROM ${spec.tableName}
           WHERE ${spec.timestampColumn} < NOW() - INTERVAL '1 day' * $1`,
          [keepDays],
        );
        const row = result.rows[0];
        return {
          label: spec.label,
          tableName: spec.tableName,
          retentionClass: spec.retentionClass,
          strategy: spec.strategy,
          keepDays,
          candidateCount: Number(row?.candidate_count ?? 0),
          oldestCandidateAt: row?.oldest_candidate_at ?? null,
          newestCandidateAt: row?.newest_candidate_at ?? null,
        } satisfies HousekeepingPreviewRow;
      }),
  );

  return rows;
}

export async function previewHousekeepingImpact(): Promise<HousekeepingPreviewResult> {
  const policy = resolveHousekeepingRetentionPolicy(config);
  return {
    keepDays: policy.keepDays,
    policyWarnings: policy.warnings,
    protectedTables: policy.protectedTables,
    rows: await buildHousekeepingPreview(policy),
  };
}

/**
 * Daily housekeeping job.
 *
 * Delivery history retention is opt-in. Default keepDays=0 disables global
 * purge unless the deployment explicitly accepts age-based retention.
 */
export async function housekeepingJob(): Promise<HousekeepingResult> {
  const policy = resolveHousekeepingRetentionPolicy(config);
  const { keepDays } = policy;

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

  for (const warning of policy.warnings) {
    console.warn(`[housekeepingJob] retention warning: ${warning}`);
  }

  const protectedTableCountsBefore = await getProtectedTableCounts(policy.protectedTables);

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

  const protectedTableCountsAfter = await getProtectedTableCounts(policy.protectedTables);
  const protectedTablesVerified = isProtectedTableCountsEqual(protectedTableCountsBefore, protectedTableCountsAfter);
  if (!protectedTablesVerified) {
    recordFailure('protected-table-invariants', {
      before: protectedTableCountsBefore,
      after: protectedTableCountsAfter,
    });
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
    policyWarnings: policy.warnings,
    safetyChecks: {
      protectedTablesVerified,
      protectedTableCounts: protectedTableCountsAfter,
    },
    keepDays,
  };
}

/** @deprecated Use housekeepingJob */
export const purgeAuditJob = housekeepingJob;
