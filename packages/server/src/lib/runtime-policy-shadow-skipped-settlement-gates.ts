import type {
  RuntimePolicyShadowSkippedSettlementReport,
  RuntimePolicyShadowSkippedSettlementSummaryRow,
} from './runtime-policy-shadow-skipped-settlement-report.js';

export interface RuntimePolicyShadowSkippedSettlementGroupGate {
  key: string;
  minTotalRows?: number;
  minSettledRows?: number;
  minSettledRate?: number;
  minWins?: number;
  maxLosses?: number;
  maxUnresolvedRows?: number;
  minTotalPnlPercent?: number;
  minRoiOnStaked?: number;
}

export interface RuntimePolicyShadowSkippedSettlementGateConfig {
  /** Path relative to packages/server or absolute when used by the CLI. */
  skippedSettlementReportPath: string;
  minTotalEvents?: number;
  minSettledRows?: number;
  minSettledRate?: number;
  minWins?: number;
  maxLosses?: number;
  maxUnresolvedRows?: number;
  minTotalPnlPercent?: number;
  minRoiOnStaked?: number;
  requiredMarkets?: RuntimePolicyShadowSkippedSettlementGroupGate[];
  requiredSkippedReasons?: RuntimePolicyShadowSkippedSettlementGroupGate[];
}

export interface RuntimePolicyShadowSkippedSettlementGateMetrics {
  totalEvents: number;
  settledRows: number;
  unresolvedRows: number;
  settledRate: number;
  wins: number;
  losses: number;
  pushLike: number;
  totalStakedPercent: number;
  totalPnlPercent: number;
  roiOnStaked: number;
}

export interface RuntimePolicyShadowSkippedSettlementGateResult {
  ok: boolean;
  failures: string[];
  metrics: RuntimePolicyShadowSkippedSettlementGateMetrics;
}

function round(value: number): number {
  return Math.round(value * 10000) / 10000;
}

function settledRate(totalRows: number, settledRows: number): number {
  return totalRows > 0 ? round(settledRows / totalRows) : 0;
}

function metricsFromReport(
  report: RuntimePolicyShadowSkippedSettlementReport,
): RuntimePolicyShadowSkippedSettlementGateMetrics {
  return {
    totalEvents: report.totalEvents,
    settledRows: report.settledRows,
    unresolvedRows: report.unresolvedRows,
    settledRate: settledRate(report.totalEvents, report.settledRows),
    wins: report.wins,
    losses: report.losses,
    pushLike: report.pushLike,
    totalStakedPercent: report.totalStakedPercent,
    totalPnlPercent: report.totalPnlPercent,
    roiOnStaked: report.roiOnStaked,
  };
}

function metricsFromSummaryRow(
  row: RuntimePolicyShadowSkippedSettlementSummaryRow,
): RuntimePolicyShadowSkippedSettlementGateMetrics {
  return {
    totalEvents: row.total,
    settledRows: row.settled,
    unresolvedRows: row.total - row.settled,
    settledRate: settledRate(row.total, row.settled),
    wins: row.wins,
    losses: row.losses,
    pushLike: row.pushLike,
    totalStakedPercent: row.totalStakedPercent,
    totalPnlPercent: row.totalPnlPercent,
    roiOnStaked: row.roiOnStaked,
  };
}

function evaluateMetricGates(
  prefix: string,
  gate: {
    minTotalRows?: number;
    minSettledRows?: number;
    minSettledRate?: number;
    minWins?: number;
    maxLosses?: number;
    maxUnresolvedRows?: number;
    minTotalPnlPercent?: number;
    minRoiOnStaked?: number;
  },
  metrics: RuntimePolicyShadowSkippedSettlementGateMetrics,
  failures: string[],
): void {
  const label = prefix ? `${prefix}.` : '';
  if (gate.minTotalRows != null && metrics.totalEvents < gate.minTotalRows) {
    failures.push(`${label}totalEvents ${metrics.totalEvents} < minTotalRows ${gate.minTotalRows}`);
  }
  if (gate.minSettledRows != null && metrics.settledRows < gate.minSettledRows) {
    failures.push(`${label}settledRows ${metrics.settledRows} < minSettledRows ${gate.minSettledRows}`);
  }
  if (gate.minSettledRate != null && metrics.settledRate < gate.minSettledRate) {
    failures.push(`${label}settledRate ${metrics.settledRate} < minSettledRate ${gate.minSettledRate}`);
  }
  if (gate.minWins != null && metrics.wins < gate.minWins) {
    failures.push(`${label}wins ${metrics.wins} < minWins ${gate.minWins}`);
  }
  if (gate.maxLosses != null && metrics.losses > gate.maxLosses) {
    failures.push(`${label}losses ${metrics.losses} > maxLosses ${gate.maxLosses}`);
  }
  if (gate.maxUnresolvedRows != null && metrics.unresolvedRows > gate.maxUnresolvedRows) {
    failures.push(`${label}unresolvedRows ${metrics.unresolvedRows} > maxUnresolvedRows ${gate.maxUnresolvedRows}`);
  }
  if (gate.minTotalPnlPercent != null && metrics.totalPnlPercent < gate.minTotalPnlPercent) {
    failures.push(`${label}totalPnlPercent ${metrics.totalPnlPercent} < minTotalPnlPercent ${gate.minTotalPnlPercent}`);
  }
  if (gate.minRoiOnStaked != null && metrics.roiOnStaked < gate.minRoiOnStaked) {
    failures.push(`${label}roiOnStaked ${metrics.roiOnStaked} < minRoiOnStaked ${gate.minRoiOnStaked}`);
  }
}

function evaluateRequiredGroups(
  label: 'market' | 'skippedReason',
  rows: RuntimePolicyShadowSkippedSettlementSummaryRow[],
  rules: RuntimePolicyShadowSkippedSettlementGroupGate[] | undefined,
  failures: string[],
): void {
  for (const rule of rules ?? []) {
    const row = rows.find((candidate) => candidate.key === rule.key);
    if (!row) {
      failures.push(`required ${label} ${rule.key} missing`);
      continue;
    }
    evaluateMetricGates(`${label}:${rule.key}`, rule, metricsFromSummaryRow(row), failures);
  }
}

export function evaluateRuntimePolicyShadowSkippedSettlementGates(
  config: RuntimePolicyShadowSkippedSettlementGateConfig,
  report: RuntimePolicyShadowSkippedSettlementReport,
): RuntimePolicyShadowSkippedSettlementGateResult {
  const failures: string[] = [];
  const metrics = metricsFromReport(report);

  evaluateMetricGates(
    '',
    {
      minTotalRows: config.minTotalEvents,
      minSettledRows: config.minSettledRows,
      minSettledRate: config.minSettledRate,
      minWins: config.minWins,
      maxLosses: config.maxLosses,
      maxUnresolvedRows: config.maxUnresolvedRows,
      minTotalPnlPercent: config.minTotalPnlPercent,
      minRoiOnStaked: config.minRoiOnStaked,
    },
    metrics,
    failures,
  );
  evaluateRequiredGroups('market', report.byCanonicalMarket, config.requiredMarkets, failures);
  evaluateRequiredGroups('skippedReason', report.bySkippedReason, config.requiredSkippedReasons, failures);

  return {
    ok: failures.length === 0,
    failures,
    metrics,
  };
}
