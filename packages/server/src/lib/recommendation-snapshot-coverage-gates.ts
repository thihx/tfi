import type { RecommendationSnapshotCoverageReport } from './recommendation-snapshot-coverage.js';

export interface RecommendationSnapshotCoverageGateConfig {
  /** Path relative to packages/server or absolute when used by the CLI. */
  coveragePath: string;
  officialPromptVersion?: string;
  minExportEligible?: number;
  minCurrentRuntimeReady?: number;
  minCurrentRuntimeReadyRate?: number;
  maxEmptyDecisionContextRate?: number;
  maxEmptyPromptVersionRate?: number;
  maxNonOfficialPromptRate?: number;
}

export interface RecommendationSnapshotCoverageGateResult {
  ok: boolean;
  failures: string[];
  metrics: {
    exportEligible: number;
    officialPrompt: number;
    currentRuntimeReady: number;
    currentRuntimeReadyRate: number;
    emptyDecisionContext: number;
    emptyDecisionContextRate: number;
    emptyPromptVersion: number;
    emptyPromptVersionRate: number;
    nonOfficialPrompt: number;
    nonOfficialPromptRate: number;
  };
}

function ratio(count: number, total: number): number {
  return total > 0 ? count / total : 0;
}

export function evaluateRecommendationSnapshotCoverageGates(
  config: RecommendationSnapshotCoverageGateConfig,
  report: RecommendationSnapshotCoverageReport,
): RecommendationSnapshotCoverageGateResult {
  const failures: string[] = [];
  const runtime = report.currentRuntime?.amongExportEligible;
  const exportEligible = runtime?.total ?? report.totals.exportEligible ?? 0;
  const officialPrompt = runtime?.officialPrompt ?? 0;
  const currentRuntimeReady = runtime?.currentRuntimeReady ?? 0;
  const emptyDecisionContext = runtime?.emptyDecisionContext ?? report.snapshotQuality.amongExportEligible.emptyDecisionContext ?? 0;
  const emptyPromptVersion = runtime?.emptyPromptVersion ?? 0;
  const nonOfficialPrompt = runtime?.nonOfficialPrompt ?? 0;

  const currentRuntimeReadyRate = ratio(currentRuntimeReady, exportEligible);
  const emptyDecisionContextRate = ratio(emptyDecisionContext, exportEligible);
  const emptyPromptVersionRate = ratio(emptyPromptVersion, exportEligible);
  const nonOfficialPromptRate = ratio(nonOfficialPrompt, exportEligible);

  if (config.officialPromptVersion && report.currentRuntime?.officialPromptVersion !== config.officialPromptVersion) {
    failures.push(
      `officialPromptVersion ${report.currentRuntime?.officialPromptVersion ?? '(missing)'} !== expected ${config.officialPromptVersion}`,
    );
  }
  if (config.minExportEligible != null && exportEligible < config.minExportEligible) {
    failures.push(`exportEligible ${exportEligible} < minExportEligible ${config.minExportEligible}`);
  }
  if (config.minCurrentRuntimeReady != null && currentRuntimeReady < config.minCurrentRuntimeReady) {
    failures.push(
      `currentRuntimeReady ${currentRuntimeReady} < minCurrentRuntimeReady ${config.minCurrentRuntimeReady}`,
    );
  }
  if (config.minCurrentRuntimeReadyRate != null && currentRuntimeReadyRate < config.minCurrentRuntimeReadyRate) {
    failures.push(
      `currentRuntimeReady rate ${currentRuntimeReadyRate.toFixed(4)} < minCurrentRuntimeReadyRate ${config.minCurrentRuntimeReadyRate}`,
    );
  }
  if (config.maxEmptyDecisionContextRate != null && emptyDecisionContextRate > config.maxEmptyDecisionContextRate) {
    failures.push(
      `emptyDecisionContext rate ${emptyDecisionContextRate.toFixed(4)} > maxEmptyDecisionContextRate ${config.maxEmptyDecisionContextRate}`,
    );
  }
  if (config.maxEmptyPromptVersionRate != null && emptyPromptVersionRate > config.maxEmptyPromptVersionRate) {
    failures.push(
      `emptyPromptVersion rate ${emptyPromptVersionRate.toFixed(4)} > maxEmptyPromptVersionRate ${config.maxEmptyPromptVersionRate}`,
    );
  }
  if (config.maxNonOfficialPromptRate != null && nonOfficialPromptRate > config.maxNonOfficialPromptRate) {
    failures.push(
      `nonOfficialPrompt rate ${nonOfficialPromptRate.toFixed(4)} > maxNonOfficialPromptRate ${config.maxNonOfficialPromptRate}`,
    );
  }

  return {
    ok: failures.length === 0,
    failures,
    metrics: {
      exportEligible,
      officialPrompt,
      currentRuntimeReady,
      currentRuntimeReadyRate,
      emptyDecisionContext,
      emptyDecisionContextRate,
      emptyPromptVersion,
      emptyPromptVersionRate,
      nonOfficialPrompt,
      nonOfficialPromptRate,
    },
  };
}
