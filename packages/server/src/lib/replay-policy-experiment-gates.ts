import type { ReplayPolicyExperimentId, ReplayPolicyExperimentReport } from './replay-policy-experiment.js';

export interface ReplayPolicyExperimentGateConfig {
  /** Path relative to packages/server or absolute when used by the CLI. */
  policyExperimentPath: string;
  minTotalCases?: number;
  minTrustedCounterfactualCandidates?: number;
  minCombinedSelectedCount?: number;
  minCombinedPnlPercent?: number;
  minCombinedRoiOnStaked?: number;
  minOriginalWinsRescued?: number;
  maxCombinedLossCount?: number;
  maxOriginalLossesReintroduced?: number;
  requiredExperiments?: Array<{
    id: ReplayPolicyExperimentId;
    minSelectedCount?: number;
    minWinCount?: number;
    minOriginalWinsRescued?: number;
    minTotalPnlPercent?: number;
    maxLossCount?: number;
    maxOriginalLossesReintroduced?: number;
    minRoiOnStaked?: number;
  }>;
}

export interface ReplayPolicyExperimentGateResult {
  ok: boolean;
  failures: string[];
  metrics: {
    totalCases: number;
    trustedCounterfactualCandidates: number;
    combinedSelectedCount: number;
    combinedLossCount: number;
    combinedPnlPercent: number;
    combinedRoiOnStaked: number;
    originalWinsRescued: number;
    originalLossesReintroduced: number;
  };
}

export function evaluateReplayPolicyExperimentGates(
  config: ReplayPolicyExperimentGateConfig,
  report: ReplayPolicyExperimentReport,
): ReplayPolicyExperimentGateResult {
  const failures: string[] = [];
  const combined = report.combined;
  const metrics = {
    totalCases: report.totalCases,
    trustedCounterfactualCandidates: report.trustedCounterfactualCandidates,
    combinedSelectedCount: combined.selectedCount,
    combinedLossCount: combined.lossCount,
    combinedPnlPercent: combined.totalPnlPercent,
    combinedRoiOnStaked: combined.roiOnStaked,
    originalWinsRescued: combined.originalWinsRescued,
    originalLossesReintroduced: combined.originalLossesReintroduced,
  };

  if (config.minTotalCases != null && metrics.totalCases < config.minTotalCases) {
    failures.push(`totalCases ${metrics.totalCases} < minTotalCases ${config.minTotalCases}`);
  }
  if (
    config.minTrustedCounterfactualCandidates != null
    && metrics.trustedCounterfactualCandidates < config.minTrustedCounterfactualCandidates
  ) {
    failures.push(
      `trustedCounterfactualCandidates ${metrics.trustedCounterfactualCandidates} < minTrustedCounterfactualCandidates ${config.minTrustedCounterfactualCandidates}`,
    );
  }
  if (config.minCombinedSelectedCount != null && metrics.combinedSelectedCount < config.minCombinedSelectedCount) {
    failures.push(
      `combined.selectedCount ${metrics.combinedSelectedCount} < minCombinedSelectedCount ${config.minCombinedSelectedCount}`,
    );
  }
  if (config.minCombinedPnlPercent != null && metrics.combinedPnlPercent < config.minCombinedPnlPercent) {
    failures.push(
      `combined.totalPnlPercent ${metrics.combinedPnlPercent} < minCombinedPnlPercent ${config.minCombinedPnlPercent}`,
    );
  }
  if (config.minCombinedRoiOnStaked != null && metrics.combinedRoiOnStaked < config.minCombinedRoiOnStaked) {
    failures.push(
      `combined.roiOnStaked ${metrics.combinedRoiOnStaked} < minCombinedRoiOnStaked ${config.minCombinedRoiOnStaked}`,
    );
  }
  if (config.minOriginalWinsRescued != null && metrics.originalWinsRescued < config.minOriginalWinsRescued) {
    failures.push(
      `combined.originalWinsRescued ${metrics.originalWinsRescued} < minOriginalWinsRescued ${config.minOriginalWinsRescued}`,
    );
  }
  if (config.maxCombinedLossCount != null && metrics.combinedLossCount > config.maxCombinedLossCount) {
    failures.push(`combined.lossCount ${metrics.combinedLossCount} > maxCombinedLossCount ${config.maxCombinedLossCount}`);
  }
  if (
    config.maxOriginalLossesReintroduced != null
    && metrics.originalLossesReintroduced > config.maxOriginalLossesReintroduced
  ) {
    failures.push(
      `combined.originalLossesReintroduced ${metrics.originalLossesReintroduced} > maxOriginalLossesReintroduced ${config.maxOriginalLossesReintroduced}`,
    );
  }

  for (const rule of config.requiredExperiments ?? []) {
    const experiment = report.experiments.find((row) => row.id === rule.id);
    if (!experiment) {
      failures.push(`required experiment ${rule.id} missing`);
      continue;
    }
    if (rule.minSelectedCount != null && experiment.selectedCount < rule.minSelectedCount) {
      failures.push(
        `${rule.id}.selectedCount ${experiment.selectedCount} < minSelectedCount ${rule.minSelectedCount}`,
      );
    }
    if (rule.minWinCount != null && experiment.winCount < rule.minWinCount) {
      failures.push(`${rule.id}.winCount ${experiment.winCount} < minWinCount ${rule.minWinCount}`);
    }
    if (rule.minOriginalWinsRescued != null && experiment.originalWinsRescued < rule.minOriginalWinsRescued) {
      failures.push(
        `${rule.id}.originalWinsRescued ${experiment.originalWinsRescued} < minOriginalWinsRescued ${rule.minOriginalWinsRescued}`,
      );
    }
    if (rule.minTotalPnlPercent != null && experiment.totalPnlPercent < rule.minTotalPnlPercent) {
      failures.push(
        `${rule.id}.totalPnlPercent ${experiment.totalPnlPercent} < minTotalPnlPercent ${rule.minTotalPnlPercent}`,
      );
    }
    if (rule.maxLossCount != null && experiment.lossCount > rule.maxLossCount) {
      failures.push(`${rule.id}.lossCount ${experiment.lossCount} > maxLossCount ${rule.maxLossCount}`);
    }
    if (
      rule.maxOriginalLossesReintroduced != null
      && experiment.originalLossesReintroduced > rule.maxOriginalLossesReintroduced
    ) {
      failures.push(
        `${rule.id}.originalLossesReintroduced ${experiment.originalLossesReintroduced} > maxOriginalLossesReintroduced ${rule.maxOriginalLossesReintroduced}`,
      );
    }
    if (rule.minRoiOnStaked != null && experiment.roiOnStaked < rule.minRoiOnStaked) {
      failures.push(`${rule.id}.roiOnStaked ${experiment.roiOnStaked} < minRoiOnStaked ${rule.minRoiOnStaked}`);
    }
  }

  return {
    ok: failures.length === 0,
    failures,
    metrics,
  };
}
