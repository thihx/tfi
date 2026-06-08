import type {
  RuntimePolicyShadowRecentRow,
  RuntimePolicyShadowReport,
} from './runtime-policy-shadow-report.js';
import type {
  RuntimePolicyShadowSkippedRecentRow,
  RuntimePolicyShadowSkippedReport,
} from './runtime-policy-shadow-skipped-report.js';
import type {
  RuntimePolicyShadowSettlementReport,
  RuntimePolicyShadowSettlementRow,
} from './runtime-policy-shadow-settlement-report.js';
import type {
  RuntimePolicyShadowSkippedSettlementReport,
  RuntimePolicyShadowSkippedSettlementRow,
} from './runtime-policy-shadow-skipped-settlement-report.js';

export type RuntimePolicyShadowReadinessSource =
  | 'matched_pocket'
  | 'skipped_market'
  | 'skipped_reason';

export interface RuntimePolicyShadowReadinessCandidateGate {
  id: string;
  label?: string;
  source: RuntimePolicyShadowReadinessSource;
  key: string;
  expectedEvidenceModes?: string[];
  minTelemetryEvents?: number;
  minUniqueMatches?: number;
  minSettlementRows?: number;
  minSettledRows?: number;
  minSettledRate?: number;
  maxLosses?: number;
  maxUnresolvedRows?: number;
  minTotalPnlPercent?: number;
  minRoiOnStaked?: number;
  maxTopMatchShare?: number;
  maxTopLeagueShare?: number;
  maxTopTeamShare?: number;
  maxTopMarketShare?: number;
  maxMarketUnresolvedRate?: number;
  maxEvidenceContaminationRate?: number;
}

export interface RuntimePolicyShadowReadinessGateConfig {
  matchedReportPath?: string;
  skippedReportPath?: string;
  matchedSettlementReportPath?: string;
  skippedSettlementReportPath?: string;
  candidates: RuntimePolicyShadowReadinessCandidateGate[];
}

export interface RuntimePolicyShadowReadinessCandidateResult {
  id: string;
  label: string;
  source: RuntimePolicyShadowReadinessSource;
  key: string;
  status: 'ready_for_human_review' | 'observe_only';
  hardNoPromoteReasons: string[];
  metrics: {
    telemetryEvents: number;
    uniqueMatches: number;
    settlementRows: number;
    settledRows: number;
    unresolvedRows: number;
    settledRate: number;
    wins: number;
    losses: number;
    pushLike: number;
    totalStakedPercent: number;
    totalPnlPercent: number;
    roiOnStaked: number;
    topMatchShare: number;
    topLeagueShare: number;
    topTeamShare: number;
    topMarketShare: number;
    marketUnresolvedRate: number;
    evidenceContaminationRate: number;
  };
  breakdowns: {
    evidenceModes: Record<string, number>;
    canonicalMarkets: Record<string, number>;
    matchIds: Record<string, number>;
    leagueSegments: Record<string, number>;
    teamSegments: Record<string, number>;
    marketResolutionStatuses: Record<string, number>;
  };
}

export interface RuntimePolicyShadowReadinessGateResult {
  ok: boolean;
  generatedAt: string;
  candidates: RuntimePolicyShadowReadinessCandidateResult[];
}

type TelemetryRow = RuntimePolicyShadowRecentRow | RuntimePolicyShadowSkippedRecentRow;
type SettlementRow = RuntimePolicyShadowSettlementRow | RuntimePolicyShadowSkippedSettlementRow;
interface SegmentCarrier {
  leagueSegmentKey?: unknown;
  teamSegmentKeys?: unknown;
  homeTeamSegmentKey?: unknown;
  awayTeamSegmentKey?: unknown;
}

function round(value: number): number {
  return Math.round(value * 10000) / 10000;
}

function ratio(numerator: number, denominator: number): number {
  return denominator > 0 ? round(numerator / denominator) : 0;
}

function increment(map: Record<string, number>, key: string): void {
  const normalized = key.trim() || 'unknown';
  map[normalized] = (map[normalized] ?? 0) + 1;
}

function maxShare(map: Record<string, number>): number {
  const denominator = Object.values(map).reduce((sum, value) => sum + value, 0);
  if (denominator <= 0) return 0;
  const max = Object.values(map).reduce((largest, value) => Math.max(largest, value), 0);
  return ratio(max, denominator);
}

function leagueSegmentKey(row: SegmentCarrier): string {
  return String(row.leagueSegmentKey ?? 'league:unknown').trim() || 'league:unknown';
}

function teamSegmentKeys(row: SegmentCarrier): string[] {
  const explicit = Array.isArray(row.teamSegmentKeys)
    ? row.teamSegmentKeys.map((key) => String(key ?? '').trim()).filter(Boolean)
    : [];
  const sideKeys = [
    String(row.homeTeamSegmentKey ?? '').trim(),
    String(row.awayTeamSegmentKey ?? '').trim(),
  ].filter(Boolean);
  const keys = explicit.length > 0 ? explicit : sideKeys;
  return keys.length > 0 ? Array.from(new Set(keys)) : ['team:unknown'];
}

function isWin(result: SettlementRow['result']): boolean {
  return result === 'win' || result === 'half_win';
}

function isLoss(result: SettlementRow['result']): boolean {
  return result === 'loss' || result === 'half_loss';
}

function isPushLike(result: SettlementRow['result']): boolean {
  return result === 'push' || result === 'void';
}

function telemetryRowsForCandidate(
  gate: RuntimePolicyShadowReadinessCandidateGate,
  matchedReport: RuntimePolicyShadowReport,
  skippedReport: RuntimePolicyShadowSkippedReport,
): TelemetryRow[] {
  if (gate.source === 'matched_pocket') {
    return matchedReport.recent.filter((row) => row.pocketIds.includes(gate.key));
  }
  if (gate.source === 'skipped_market') {
    return skippedReport.recent.filter((row) => row.canonicalMarket === gate.key);
  }
  return skippedReport.recent.filter((row) => row.skippedReason === gate.key);
}

function settlementRowsForCandidate(
  gate: RuntimePolicyShadowReadinessCandidateGate,
  matchedSettlement: RuntimePolicyShadowSettlementReport,
  skippedSettlement: RuntimePolicyShadowSkippedSettlementReport,
): SettlementRow[] {
  if (gate.source === 'matched_pocket') {
    return matchedSettlement.rows.filter((row) => row.pocketId === gate.key);
  }
  if (gate.source === 'skipped_market') {
    return skippedSettlement.rows.filter((row) => row.canonicalMarket === gate.key);
  }
  return skippedSettlement.rows.filter((row) => row.skippedReason === gate.key);
}

function emptyMatchedReport(): RuntimePolicyShadowReport {
  return {
    generatedAt: new Date(0).toISOString(),
    lookbackDays: 0,
    maxRows: 0,
    totalEvents: 0,
    totalPocketMatches: 0,
    uniqueMatches: 0,
    byPocket: [],
    byCanonicalMarket: [],
    byMinuteBand: [],
    byScoreState: [],
    byConfidenceBand: [],
    byValueBand: [],
    byRiskLevel: [],
    byWatchSignal: [],
    byMarketResolutionStatus: [],
    byMarketAvailabilityBucket: [],
    byLeagueSegment: [],
    byTeamSegment: [],
    recent: [],
  };
}

function emptySkippedReport(): RuntimePolicyShadowSkippedReport {
  return {
    generatedAt: new Date(0).toISOString(),
    lookbackDays: 0,
    maxRows: 0,
    totalEvents: 0,
    uniqueMatches: 0,
    byCanonicalMarket: [],
    byMinuteBand: [],
    byScoreState: [],
    byConfidenceBand: [],
    byValueBand: [],
    byRiskLevel: [],
    byWatchSignal: [],
    byMarketResolutionStatus: [],
    byMarketAvailabilityBucket: [],
    bySkippedReason: [],
    byLeagueSegment: [],
    byTeamSegment: [],
    recent: [],
  };
}

function emptyMatchedSettlementReport(): RuntimePolicyShadowSettlementReport {
  return {
    generatedAt: new Date(0).toISOString(),
    lookbackDays: 0,
    maxRows: 0,
    totalEvents: 0,
    totalPocketRows: 0,
    settledRows: 0,
    unresolvedRows: 0,
    wins: 0,
    losses: 0,
    pushLike: 0,
    totalStakedPercent: 0,
    totalPnlPercent: 0,
    roiOnStaked: 0,
    byPocket: [],
    byCanonicalMarket: [],
    byLeagueSegment: [],
    byTeamSegment: [],
    rows: [],
  };
}

function emptySkippedSettlementReport(): RuntimePolicyShadowSkippedSettlementReport {
  return {
    generatedAt: new Date(0).toISOString(),
    lookbackDays: 0,
    maxRows: 0,
    stakePercent: 0,
    totalEvents: 0,
    settledRows: 0,
    unresolvedRows: 0,
    wins: 0,
    losses: 0,
    pushLike: 0,
    totalStakedPercent: 0,
    totalPnlPercent: 0,
    roiOnStaked: 0,
    byCanonicalMarket: [],
    bySkippedReason: [],
    byLeagueSegment: [],
    byTeamSegment: [],
    rows: [],
  };
}

export function evaluateRuntimePolicyShadowReadinessGates(
  config: RuntimePolicyShadowReadinessGateConfig,
  reports: {
    matchedReport?: RuntimePolicyShadowReport;
    skippedReport?: RuntimePolicyShadowSkippedReport;
    matchedSettlement?: RuntimePolicyShadowSettlementReport;
    skippedSettlement?: RuntimePolicyShadowSkippedSettlementReport;
  },
): RuntimePolicyShadowReadinessGateResult {
  const matchedReport = reports.matchedReport ?? emptyMatchedReport();
  const skippedReport = reports.skippedReport ?? emptySkippedReport();
  const matchedSettlement = reports.matchedSettlement ?? emptyMatchedSettlementReport();
  const skippedSettlement = reports.skippedSettlement ?? emptySkippedSettlementReport();

  const candidates = config.candidates.map((gate): RuntimePolicyShadowReadinessCandidateResult => {
    const telemetryRows = telemetryRowsForCandidate(gate, matchedReport, skippedReport);
    const settlementRows = settlementRowsForCandidate(gate, matchedSettlement, skippedSettlement);
    const settledRows = settlementRows.filter((row) => row.status === 'settled_rules' && row.result != null);
    const evidenceModes: Record<string, number> = {};
    const canonicalMarkets: Record<string, number> = {};
    const matchIds: Record<string, number> = {};
    const leagueSegments: Record<string, number> = {};
    const teamSegments: Record<string, number> = {};
    const marketResolutionStatuses: Record<string, number> = {};

    for (const row of telemetryRows) {
      increment(evidenceModes, row.evidenceMode);
      increment(canonicalMarkets, row.canonicalMarket);
      increment(matchIds, row.matchId || row.matchDisplay || 'unknown');
      increment(leagueSegments, leagueSegmentKey(row));
      for (const key of teamSegmentKeys(row)) increment(teamSegments, key);
      increment(marketResolutionStatuses, row.marketResolutionStatus);
    }
    for (const row of settlementRows) {
      increment(canonicalMarkets, row.canonicalMarket);
      increment(matchIds, row.matchId || row.matchDisplay || 'unknown');
      increment(leagueSegments, leagueSegmentKey(row));
      for (const key of teamSegmentKeys(row)) increment(teamSegments, key);
    }

    const totalStakedPercent = round(settledRows.reduce((sum, row) => sum + row.stakePercent, 0));
    const totalPnlPercent = round(settledRows.reduce((sum, row) => sum + (row.pnlPercent ?? 0), 0));
    const unresolvedMarketRows = telemetryRows.filter((row) => {
      const status = row.marketResolutionStatus.trim().toLowerCase();
      return status !== 'resolved' && status !== 'mapped';
    }).length;
    const expectedEvidenceModes = new Set(gate.expectedEvidenceModes ?? []);
    const contaminatedEvidenceRows = expectedEvidenceModes.size === 0
      ? 0
      : telemetryRows.filter((row) => !expectedEvidenceModes.has(row.evidenceMode)).length;
    const metrics = {
      telemetryEvents: telemetryRows.length,
      uniqueMatches: new Set(telemetryRows.map((row) => row.matchId).filter(Boolean)).size,
      settlementRows: settlementRows.length,
      settledRows: settledRows.length,
      unresolvedRows: settlementRows.length - settledRows.length,
      settledRate: ratio(settledRows.length, settlementRows.length),
      wins: settledRows.filter((row) => isWin(row.result)).length,
      losses: settledRows.filter((row) => isLoss(row.result)).length,
      pushLike: settledRows.filter((row) => isPushLike(row.result)).length,
      totalStakedPercent,
      totalPnlPercent,
      roiOnStaked: totalStakedPercent > 0 ? round(totalPnlPercent / totalStakedPercent) : 0,
      topMatchShare: maxShare(matchIds),
      topLeagueShare: maxShare(leagueSegments),
      topTeamShare: maxShare(teamSegments),
      topMarketShare: maxShare(canonicalMarkets),
      marketUnresolvedRate: ratio(unresolvedMarketRows, telemetryRows.length),
      evidenceContaminationRate: ratio(contaminatedEvidenceRows, telemetryRows.length),
    };
    const failures: string[] = [];

    if (gate.minTelemetryEvents != null && metrics.telemetryEvents < gate.minTelemetryEvents) {
      failures.push(`telemetryEvents ${metrics.telemetryEvents} < minTelemetryEvents ${gate.minTelemetryEvents}`);
    }
    if (gate.minUniqueMatches != null && metrics.uniqueMatches < gate.minUniqueMatches) {
      failures.push(`uniqueMatches ${metrics.uniqueMatches} < minUniqueMatches ${gate.minUniqueMatches}`);
    }
    if (gate.minSettlementRows != null && metrics.settlementRows < gate.minSettlementRows) {
      failures.push(`settlementRows ${metrics.settlementRows} < minSettlementRows ${gate.minSettlementRows}`);
    }
    if (gate.minSettledRows != null && metrics.settledRows < gate.minSettledRows) {
      failures.push(`settledRows ${metrics.settledRows} < minSettledRows ${gate.minSettledRows}`);
    }
    if (gate.minSettledRate != null && metrics.settledRate < gate.minSettledRate) {
      failures.push(`settledRate ${metrics.settledRate} < minSettledRate ${gate.minSettledRate}`);
    }
    if (gate.maxLosses != null && metrics.losses > gate.maxLosses) {
      failures.push(`losses ${metrics.losses} > maxLosses ${gate.maxLosses}`);
    }
    if (gate.maxUnresolvedRows != null && metrics.unresolvedRows > gate.maxUnresolvedRows) {
      failures.push(`unresolvedRows ${metrics.unresolvedRows} > maxUnresolvedRows ${gate.maxUnresolvedRows}`);
    }
    if (gate.minTotalPnlPercent != null && metrics.totalPnlPercent < gate.minTotalPnlPercent) {
      failures.push(`totalPnlPercent ${metrics.totalPnlPercent} < minTotalPnlPercent ${gate.minTotalPnlPercent}`);
    }
    if (gate.minRoiOnStaked != null && metrics.roiOnStaked < gate.minRoiOnStaked) {
      failures.push(`roiOnStaked ${metrics.roiOnStaked} < minRoiOnStaked ${gate.minRoiOnStaked}`);
    }
    if (gate.maxTopMatchShare != null && metrics.topMatchShare > gate.maxTopMatchShare) {
      failures.push(`topMatchShare ${metrics.topMatchShare} > maxTopMatchShare ${gate.maxTopMatchShare}`);
    }
    if (gate.maxTopLeagueShare != null && metrics.topLeagueShare > gate.maxTopLeagueShare) {
      failures.push(`topLeagueShare ${metrics.topLeagueShare} > maxTopLeagueShare ${gate.maxTopLeagueShare}`);
    }
    if (gate.maxTopTeamShare != null && metrics.topTeamShare > gate.maxTopTeamShare) {
      failures.push(`topTeamShare ${metrics.topTeamShare} > maxTopTeamShare ${gate.maxTopTeamShare}`);
    }
    if (gate.maxTopMarketShare != null && metrics.topMarketShare > gate.maxTopMarketShare) {
      failures.push(`topMarketShare ${metrics.topMarketShare} > maxTopMarketShare ${gate.maxTopMarketShare}`);
    }
    if (gate.maxMarketUnresolvedRate != null && metrics.marketUnresolvedRate > gate.maxMarketUnresolvedRate) {
      failures.push(`marketUnresolvedRate ${metrics.marketUnresolvedRate} > maxMarketUnresolvedRate ${gate.maxMarketUnresolvedRate}`);
    }
    if (gate.maxEvidenceContaminationRate != null && metrics.evidenceContaminationRate > gate.maxEvidenceContaminationRate) {
      failures.push(`evidenceContaminationRate ${metrics.evidenceContaminationRate} > maxEvidenceContaminationRate ${gate.maxEvidenceContaminationRate}`);
    }

    return {
      id: gate.id,
      label: gate.label ?? gate.id,
      source: gate.source,
      key: gate.key,
      status: failures.length === 0 ? 'ready_for_human_review' : 'observe_only',
      hardNoPromoteReasons: failures,
      metrics,
      breakdowns: {
        evidenceModes,
        canonicalMarkets,
        matchIds,
        leagueSegments,
        teamSegments,
        marketResolutionStatuses,
      },
    };
  });

  return {
    ok: candidates.every((candidate) => candidate.status === 'ready_for_human_review'),
    generatedAt: new Date().toISOString(),
    candidates,
  };
}

export function formatRuntimePolicyShadowReadinessMarkdown(
  result: RuntimePolicyShadowReadinessGateResult,
): string {
  const lines = [
    '# Runtime Policy Shadow Readiness Gates',
    '',
    `- Generated: ${result.generatedAt}`,
    `- Overall status: ${result.ok ? 'ready_for_human_review' : 'observe_only'}`,
    '',
    '| Candidate | Source | Key | Status | Telemetry | Settled | ROI | Top match | Top league | Top team | Hard no-promote reasons |',
    '| --- | --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |',
  ];
  for (const candidate of result.candidates) {
    lines.push([
      candidate.label,
      candidate.source,
      candidate.key,
      candidate.status,
      candidate.metrics.telemetryEvents,
      candidate.metrics.settledRows,
      candidate.metrics.roiOnStaked,
      candidate.metrics.topMatchShare,
      candidate.metrics.topLeagueShare,
      candidate.metrics.topTeamShare,
      candidate.hardNoPromoteReasons.join('; ') || 'none',
    ].join(' | ').replace(/^/, '| ').replace(/$/, ' |'));
  }
  lines.push('');
  return `${lines.join('\n')}\n`;
}
