// ============================================================
// Job: Housekeeping
// Legacy file / job name preserved as purge-audit for scheduler
// compatibility, but the cleanup now covers multiple high-growth
// tables with separate retention windows.
// ============================================================

import { config } from '../config.js';
import * as auditRepo from '../repos/audit-logs.repo.js';
import * as historyRepo from '../repos/matches-history.repo.js';
import * as providerStatsRepo from '../repos/provider-stats-samples.repo.js';
import * as providerOddsRepo from '../repos/provider-odds-samples.repo.js';
import * as snapshotsRepo from '../repos/match-snapshots.repo.js';
import * as oddsMovementsRepo from '../repos/odds-movements.repo.js';
import * as promptShadowRepo from '../repos/prompt-shadow-runs.repo.js';
import { reportJobProgress } from './job-progress.js';

export interface HousekeepingResult {
  auditDeleted: number;
  matchesHistoryDeleted: number;
  providerStatsDeleted: number;
  providerOddsDeleted: number;
  matchSnapshotsDeleted: number;
  oddsMovementsDeleted: number;
  promptShadowDeleted: number;
  totalDeleted: number;
  keepDays: {
    audit: number;
    matchesHistory: number;
    providerSamples: number;
    matchSnapshots: number;
    oddsMovements: number;
    promptShadow: number;
  };
}

export async function purgeAuditJob(): Promise<HousekeepingResult> {
  const keepDays = {
    audit: config.auditKeepDays,
    matchesHistory: config.matchesHistoryKeepDays,
    providerSamples: config.providerSamplesKeepDays,
    matchSnapshots: config.matchSnapshotsKeepDays,
    oddsMovements: config.oddsMovementsKeepDays,
    promptShadow: config.promptShadowKeepDays,
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
  ] = await Promise.all([
    auditRepo.purgeAuditLogs(keepDays.audit),
    historyRepo.purgeHistoricalMatches(keepDays.matchesHistory),
    providerStatsRepo.purgeProviderStatsSamples(keepDays.providerSamples),
    providerOddsRepo.purgeProviderOddsSamples(keepDays.providerSamples),
    snapshotsRepo.purgeMatchSnapshots(keepDays.matchSnapshots),
    oddsMovementsRepo.purgeOddsMovements(keepDays.oddsMovements),
    promptShadowRepo.purgePromptShadowRuns(keepDays.promptShadow),
  ]);

  const totalDeleted =
    auditDeleted
    + matchesHistoryDeleted
    + providerStatsDeleted
    + providerOddsDeleted
    + matchSnapshotsDeleted
    + oddsMovementsDeleted
    + promptShadowDeleted;

  if (totalDeleted > 0) {
    console.log(
      `[purgeAuditJob] Housekeeping deleted ${totalDeleted} rows ` +
      `(audit=${auditDeleted}, history=${matchesHistoryDeleted}, providerStats=${providerStatsDeleted}, ` +
      `providerOdds=${providerOddsDeleted}, snapshots=${matchSnapshotsDeleted}, oddsMovements=${oddsMovementsDeleted}, ` +
      `promptShadow=${promptShadowDeleted})`,
    );
  }

  return {
    auditDeleted,
    matchesHistoryDeleted,
    providerStatsDeleted,
    providerOddsDeleted,
    matchSnapshotsDeleted,
    oddsMovementsDeleted,
    promptShadowDeleted,
    totalDeleted,
    keepDays,
  };
}

export const housekeepingJob = purgeAuditJob;
