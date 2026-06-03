import type { RecommendationPromptAdoptionReport } from './recommendation-prompt-adoption-report.js';

export interface RecommendationPromptAdoptionGateConfig {
  /** Path relative to packages/server or absolute when used by the CLI. */
  adoptionPath: string;
  officialPromptVersion?: string;
  minTotalRows?: number;
  minActionableRows?: number;
  minOfficialPromptRows?: number;
  minOfficialPromptRate?: number;
  minOfficialPromptWithDecisionContext?: number;
  minOfficialPromptWithDecisionContextRate?: number;
  maxNonOfficialPromptRate?: number;
  maxEmptyPromptVersionRate?: number;
  maxEmptyDecisionContextRate?: number;
  maxLatestRowAgeHours?: number;
  maxLatestOfficialPromptRowAgeHours?: number;
}

export interface RecommendationPromptAdoptionGateResult {
  ok: boolean;
  failures: string[];
  metrics: {
    totalRows: number;
    actionableRows: number;
    officialPromptRows: number;
    officialPromptRate: number;
    officialPromptWithDecisionContext: number;
    officialPromptWithDecisionContextRate: number;
    nonOfficialPromptRows: number;
    nonOfficialPromptRate: number;
    emptyPromptVersionRows: number;
    emptyPromptVersionRate: number;
    emptyDecisionContextRows: number;
    emptyDecisionContextRate: number;
    latestRowAgeHours: number | null;
    latestOfficialPromptRowAgeHours: number | null;
  };
}

function ratio(count: number, total: number): number {
  return total > 0 ? count / total : 0;
}

function failBelow(name: string, actual: number, min: number, configName: string, failures: string[]): void {
  if (actual < min) failures.push(`${name} ${actual} < ${configName} ${min}`);
}

function failRateBelow(name: string, actual: number, min: number, configName: string, failures: string[]): void {
  if (actual < min) failures.push(`${name} ${actual.toFixed(4)} < ${configName} ${min}`);
}

function failRateAbove(name: string, actual: number, max: number, configName: string, failures: string[]): void {
  if (actual > max) failures.push(`${name} ${actual.toFixed(4)} > ${configName} ${max}`);
}

export function evaluateRecommendationPromptAdoptionGates(
  config: RecommendationPromptAdoptionGateConfig,
  report: RecommendationPromptAdoptionReport,
): RecommendationPromptAdoptionGateResult {
  const failures: string[] = [];
  const totalRows = report.totals.totalRows ?? 0;
  const actionableRows = report.totals.actionableRows ?? 0;
  const officialPromptRows = report.totals.officialPromptRows ?? 0;
  const officialPromptWithDecisionContext = report.totals.officialPromptWithDecisionContext ?? 0;
  const nonOfficialPromptRows = report.totals.nonOfficialPromptRows ?? 0;
  const emptyPromptVersionRows = report.totals.emptyPromptVersionRows ?? 0;
  const emptyDecisionContextRows = report.totals.emptyDecisionContextRows ?? 0;
  const latestRowAgeHours = report.activity?.latestRowAgeHours ?? null;
  const latestOfficialPromptRowAgeHours = report.activity?.latestOfficialPromptRowAgeHours ?? null;

  const officialPromptRate = ratio(officialPromptRows, totalRows);
  const officialPromptWithDecisionContextRate = ratio(officialPromptWithDecisionContext, totalRows);
  const nonOfficialPromptRate = ratio(nonOfficialPromptRows, totalRows);
  const emptyPromptVersionRate = ratio(emptyPromptVersionRows, totalRows);
  const emptyDecisionContextRate = ratio(emptyDecisionContextRows, totalRows);

  if (config.officialPromptVersion && report.officialPromptVersion !== config.officialPromptVersion) {
    failures.push(`officialPromptVersion ${report.officialPromptVersion || '(missing)'} !== expected ${config.officialPromptVersion}`);
  }
  if (config.minTotalRows != null) {
    failBelow('totalRows', totalRows, config.minTotalRows, 'minTotalRows', failures);
  }
  if (config.minActionableRows != null) {
    failBelow('actionableRows', actionableRows, config.minActionableRows, 'minActionableRows', failures);
  }
  if (config.minOfficialPromptRows != null) {
    failures.push(
      ...(officialPromptRows < config.minOfficialPromptRows
        ? [`officialPromptRows ${officialPromptRows} < minOfficialPromptRows ${config.minOfficialPromptRows}`]
        : []),
    );
  }
  if (config.minOfficialPromptRate != null) {
    failRateBelow('officialPromptRate', officialPromptRate, config.minOfficialPromptRate, 'minOfficialPromptRate', failures);
  }
  if (
    config.minOfficialPromptWithDecisionContext != null
    && officialPromptWithDecisionContext < config.minOfficialPromptWithDecisionContext
  ) {
    failures.push(
      `officialPromptWithDecisionContext ${officialPromptWithDecisionContext} < minOfficialPromptWithDecisionContext ${config.minOfficialPromptWithDecisionContext}`,
    );
  }
  if (config.minOfficialPromptWithDecisionContextRate != null) {
    failRateBelow(
      'officialPromptWithDecisionContextRate',
      officialPromptWithDecisionContextRate,
      config.minOfficialPromptWithDecisionContextRate,
      'minOfficialPromptWithDecisionContextRate',
      failures,
    );
  }
  if (config.maxNonOfficialPromptRate != null) {
    failRateAbove('nonOfficialPromptRate', nonOfficialPromptRate, config.maxNonOfficialPromptRate, 'maxNonOfficialPromptRate', failures);
  }
  if (config.maxEmptyPromptVersionRate != null) {
    failRateAbove('emptyPromptVersionRate', emptyPromptVersionRate, config.maxEmptyPromptVersionRate, 'maxEmptyPromptVersionRate', failures);
  }
  if (config.maxEmptyDecisionContextRate != null) {
    failRateAbove('emptyDecisionContextRate', emptyDecisionContextRate, config.maxEmptyDecisionContextRate, 'maxEmptyDecisionContextRate', failures);
  }
  if (config.maxLatestRowAgeHours != null) {
    if (latestRowAgeHours == null) {
      failures.push(`latestRowAgeHours (missing) > maxLatestRowAgeHours ${config.maxLatestRowAgeHours}`);
    } else if (latestRowAgeHours > config.maxLatestRowAgeHours) {
      failures.push(`latestRowAgeHours ${latestRowAgeHours.toFixed(2)} > maxLatestRowAgeHours ${config.maxLatestRowAgeHours}`);
    }
  }
  if (config.maxLatestOfficialPromptRowAgeHours != null) {
    if (latestOfficialPromptRowAgeHours == null) {
      failures.push(
        `latestOfficialPromptRowAgeHours (missing) > maxLatestOfficialPromptRowAgeHours ${config.maxLatestOfficialPromptRowAgeHours}`,
      );
    } else if (latestOfficialPromptRowAgeHours > config.maxLatestOfficialPromptRowAgeHours) {
      failures.push(
        `latestOfficialPromptRowAgeHours ${latestOfficialPromptRowAgeHours.toFixed(2)} > maxLatestOfficialPromptRowAgeHours ${config.maxLatestOfficialPromptRowAgeHours}`,
      );
    }
  }

  return {
    ok: failures.length === 0,
    failures,
    metrics: {
      totalRows,
      actionableRows,
      officialPromptRows,
      officialPromptRate,
      officialPromptWithDecisionContext,
      officialPromptWithDecisionContextRate,
      nonOfficialPromptRows,
      nonOfficialPromptRate,
      emptyPromptVersionRows,
      emptyPromptVersionRate,
      emptyDecisionContextRows,
      emptyDecisionContextRate,
      latestRowAgeHours,
      latestOfficialPromptRowAgeHours,
    },
  };
}
