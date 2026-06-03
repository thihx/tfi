import type { SegmentPolicyActionPlan } from './segment-policy-action-plan.js';

export interface DataDrivenQualityGateConfig {
  /** Path relative to packages/server or absolute when used by the CLI. */
  actionPlanPath: string;
  promptVersion?: string;
  minTotalCases?: number;
  maxProviderCoverageCount?: number;
  maxProviderCoverageRate?: number;
  maxReplayContextGapRate?: number;
  maxHardPolicyGateRate?: number;
  maxModelPolicyMismatchRate?: number;
  maxEmptyLlmDecisionDiagnosticCount?: number;
  maxEmptyLlmDecisionDiagnosticRate?: number;
  maxEmptyMarketResolutionStatusCount?: number;
  maxEmptyMarketResolutionStatusRate?: number;
}

export interface DataDrivenQualityGateResult {
  ok: boolean;
  failures: string[];
  metrics: {
    totalCases: number;
    providerCoverageCount: number;
    providerCoverageRate: number;
    replayContextGapCount: number;
    replayContextGapRate: number;
    hardPolicyGateCount: number;
    hardPolicyGateRate: number;
    modelPolicyMismatchCount: number;
    modelPolicyMismatchRate: number;
    emptyLlmDecisionDiagnosticCount: number;
    emptyLlmDecisionDiagnosticRate: number;
    emptyMarketResolutionStatusCount: number;
    emptyMarketResolutionStatusRate: number;
  };
}

function countByKey(rows: Array<{ key: string; count: number }> | undefined, key: string): number {
  return rows?.find((row) => row.key === key)?.count ?? 0;
}

function ratio(count: number, total: number): number {
  return total > 0 ? count / total : 0;
}

export function evaluateDataDrivenQualityGates(
  config: DataDrivenQualityGateConfig,
  actionPlan: SegmentPolicyActionPlan,
): DataDrivenQualityGateResult {
  const failures: string[] = [];
  if (config.promptVersion && actionPlan.promptVersion !== config.promptVersion) {
    failures.push(`promptVersion ${actionPlan.promptVersion} !== expected ${config.promptVersion}`);
  }

  const totalCases = actionPlan.qualityBlockers?.totalCases ?? actionPlan.totalCases ?? 0;
  if (config.minTotalCases != null && totalCases < config.minTotalCases) {
    failures.push(`totalCases ${totalCases} < minTotalCases ${config.minTotalCases}`);
  }

  const attributionRows = actionPlan.qualityBlockers?.byReplayQualityAttribution ?? [];
  const providerCoverageCount = countByKey(attributionRows, 'provider_coverage');
  const replayContextGapCount = countByKey(attributionRows, 'replay_context_gap');
  const hardPolicyGateCount = countByKey(attributionRows, 'hard_policy_gate');
  const modelPolicyMismatchCount = countByKey(attributionRows, 'model_policy_mismatch');
  const diagnosticRows = actionPlan.qualityBlockers?.byLlmDecisionDiagnostic ?? [];
  const marketResolutionRows = actionPlan.qualityBlockers?.byMarketResolutionStatus ?? [];
  const emptyLlmDecisionDiagnosticCount = countByKey(diagnosticRows, '(empty)');
  const emptyMarketResolutionStatusCount = countByKey(marketResolutionRows, '(empty)');
  const providerCoverageRate = ratio(providerCoverageCount, totalCases);
  const replayContextGapRate = ratio(replayContextGapCount, totalCases);
  const hardPolicyGateRate = ratio(hardPolicyGateCount, totalCases);
  const modelPolicyMismatchRate = ratio(modelPolicyMismatchCount, totalCases);
  const emptyLlmDecisionDiagnosticRate = ratio(emptyLlmDecisionDiagnosticCount, totalCases);
  const emptyMarketResolutionStatusRate = ratio(emptyMarketResolutionStatusCount, totalCases);

  if (config.maxProviderCoverageCount != null && providerCoverageCount > config.maxProviderCoverageCount) {
    failures.push(
      `provider_coverage count ${providerCoverageCount} > maxProviderCoverageCount ${config.maxProviderCoverageCount}`,
    );
  }
  if (config.maxProviderCoverageRate != null && providerCoverageRate > config.maxProviderCoverageRate) {
    failures.push(
      `provider_coverage rate ${providerCoverageRate.toFixed(4)} > maxProviderCoverageRate ${config.maxProviderCoverageRate}`,
    );
  }
  if (config.maxReplayContextGapRate != null && replayContextGapRate > config.maxReplayContextGapRate) {
    failures.push(
      `replay_context_gap rate ${replayContextGapRate.toFixed(4)} > maxReplayContextGapRate ${config.maxReplayContextGapRate}`,
    );
  }
  if (config.maxHardPolicyGateRate != null && hardPolicyGateRate > config.maxHardPolicyGateRate) {
    failures.push(
      `hard_policy_gate rate ${hardPolicyGateRate.toFixed(4)} > maxHardPolicyGateRate ${config.maxHardPolicyGateRate}`,
    );
  }
  if (config.maxModelPolicyMismatchRate != null && modelPolicyMismatchRate > config.maxModelPolicyMismatchRate) {
    failures.push(
      `model_policy_mismatch rate ${modelPolicyMismatchRate.toFixed(4)} > maxModelPolicyMismatchRate ${config.maxModelPolicyMismatchRate}`,
    );
  }
  if (
    config.maxEmptyLlmDecisionDiagnosticCount != null
    && emptyLlmDecisionDiagnosticCount > config.maxEmptyLlmDecisionDiagnosticCount
  ) {
    failures.push(
      `empty llmDecisionDiagnostic count ${emptyLlmDecisionDiagnosticCount} > maxEmptyLlmDecisionDiagnosticCount ${config.maxEmptyLlmDecisionDiagnosticCount}`,
    );
  }
  if (
    config.maxEmptyLlmDecisionDiagnosticRate != null
    && emptyLlmDecisionDiagnosticRate > config.maxEmptyLlmDecisionDiagnosticRate
  ) {
    failures.push(
      `empty llmDecisionDiagnostic rate ${emptyLlmDecisionDiagnosticRate.toFixed(4)} > maxEmptyLlmDecisionDiagnosticRate ${config.maxEmptyLlmDecisionDiagnosticRate}`,
    );
  }
  if (
    config.maxEmptyMarketResolutionStatusCount != null
    && emptyMarketResolutionStatusCount > config.maxEmptyMarketResolutionStatusCount
  ) {
    failures.push(
      `empty marketResolutionStatus count ${emptyMarketResolutionStatusCount} > maxEmptyMarketResolutionStatusCount ${config.maxEmptyMarketResolutionStatusCount}`,
    );
  }
  if (
    config.maxEmptyMarketResolutionStatusRate != null
    && emptyMarketResolutionStatusRate > config.maxEmptyMarketResolutionStatusRate
  ) {
    failures.push(
      `empty marketResolutionStatus rate ${emptyMarketResolutionStatusRate.toFixed(4)} > maxEmptyMarketResolutionStatusRate ${config.maxEmptyMarketResolutionStatusRate}`,
    );
  }

  return {
    ok: failures.length === 0,
    failures,
    metrics: {
      totalCases,
      providerCoverageCount,
      providerCoverageRate,
      replayContextGapCount,
      replayContextGapRate,
      hardPolicyGateCount,
      hardPolicyGateRate,
      modelPolicyMismatchCount,
      modelPolicyMismatchRate,
      emptyLlmDecisionDiagnosticCount,
      emptyLlmDecisionDiagnosticRate,
      emptyMarketResolutionStatusCount,
      emptyMarketResolutionStatusRate,
    },
  };
}
