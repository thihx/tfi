import type {
  RuntimePolicyShadowSettlementReport,
  RuntimePolicyShadowSettlementSummaryRow,
} from './runtime-policy-shadow-settlement-report.js';

export interface RuntimePolicyShadowSettlementPocketGate {
  id: string;
  minTotalRows?: number;
  minSettledRows?: number;
  minSettledRate?: number;
  minWins?: number;
  maxLosses?: number;
  maxUnresolvedRows?: number;
  minTotalPnlPercent?: number;
  minRoiOnStaked?: number;
}

export interface RuntimePolicyShadowSettlementGateConfig {
  /** Path relative to packages/server or absolute when used by the CLI. */
  settlementReportPath: string;
  minTotalPocketRows?: number;
  minSettledRows?: number;
  minSettledRate?: number;
  minWins?: number;
  maxLosses?: number;
  maxUnresolvedRows?: number;
  minTotalPnlPercent?: number;
  minRoiOnStaked?: number;
  requiredPockets?: RuntimePolicyShadowSettlementPocketGate[];
}

export interface RuntimePolicyShadowSettlementGateMetrics {
  totalPocketRows: number;
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

export interface RuntimePolicyShadowSettlementGateResult {
  ok: boolean;
  failures: string[];
  metrics: RuntimePolicyShadowSettlementGateMetrics;
}

function round(value: number): number {
  return Math.round(value * 10000) / 10000;
}

function settledRate(totalRows: number, settledRows: number): number {
  return totalRows > 0 ? round(settledRows / totalRows) : 0;
}

function metricsFromReport(report: RuntimePolicyShadowSettlementReport): RuntimePolicyShadowSettlementGateMetrics {
  return {
    totalPocketRows: report.totalPocketRows,
    settledRows: report.settledRows,
    unresolvedRows: report.unresolvedRows,
    settledRate: settledRate(report.totalPocketRows, report.settledRows),
    wins: report.wins,
    losses: report.losses,
    pushLike: report.pushLike,
    totalStakedPercent: report.totalStakedPercent,
    totalPnlPercent: report.totalPnlPercent,
    roiOnStaked: report.roiOnStaked,
  };
}

function metricsFromSummaryRow(row: RuntimePolicyShadowSettlementSummaryRow): RuntimePolicyShadowSettlementGateMetrics {
  return {
    totalPocketRows: row.total,
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
  metrics: RuntimePolicyShadowSettlementGateMetrics,
  failures: string[],
): void {
  const label = prefix ? `${prefix}.` : '';
  if (gate.minTotalRows != null && metrics.totalPocketRows < gate.minTotalRows) {
    failures.push(`${label}totalPocketRows ${metrics.totalPocketRows} < minTotalRows ${gate.minTotalRows}`);
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

export function evaluateRuntimePolicyShadowSettlementGates(
  config: RuntimePolicyShadowSettlementGateConfig,
  report: RuntimePolicyShadowSettlementReport,
): RuntimePolicyShadowSettlementGateResult {
  const failures: string[] = [];
  const metrics = metricsFromReport(report);

  evaluateMetricGates(
    '',
    {
      minTotalRows: config.minTotalPocketRows,
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

  for (const rule of config.requiredPockets ?? []) {
    const pocket = report.byPocket.find((row) => row.key === rule.id);
    if (!pocket) {
      failures.push(`required pocket ${rule.id} missing`);
      continue;
    }
    evaluateMetricGates(
      rule.id,
      {
        minTotalRows: rule.minTotalRows,
        minSettledRows: rule.minSettledRows,
        minSettledRate: rule.minSettledRate,
        minWins: rule.minWins,
        maxLosses: rule.maxLosses,
        maxUnresolvedRows: rule.maxUnresolvedRows,
        minTotalPnlPercent: rule.minTotalPnlPercent,
        minRoiOnStaked: rule.minRoiOnStaked,
      },
      metricsFromSummaryRow(pocket),
      failures,
    );
  }

  return {
    ok: failures.length === 0,
    failures,
    metrics,
  };
}
