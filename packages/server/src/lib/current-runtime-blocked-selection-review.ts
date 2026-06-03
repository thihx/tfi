import { query } from '../db/pool.js';
import { LIVE_ANALYSIS_PROMPT_VERSION } from './live-analysis-prompt.js';
import { normalizeMarket } from './normalize-market.js';
import { settleByRule } from './settle-rules.js';
import {
  calcSettlementPnl,
  isFinalSettlementResult,
  type FinalSettlementResult,
} from './settle-types.js';
import { parseStoredSettlementStats } from './settlement-stat-cache.js';

export interface CurrentRuntimeBlockedSelectionReviewOptions {
  lookbackHours: number;
  maxRows: number;
  stakePercent: number;
}

interface BlockedSelectionDbRow {
  id: number;
  timestamp: string;
  audit_match_id: string | null;
  metadata: Record<string, unknown> | null;
  history_match_id: string | null;
  final_status: string | null;
  home_score: number | null;
  away_score: number | null;
  regular_home_score: number | null;
  regular_away_score: number | null;
  halftime_home: number | null;
  halftime_away: number | null;
  settlement_stats: unknown;
}

export interface CurrentRuntimeBlockedSelectionRow {
  auditLogId: number;
  timestamp: string;
  matchId: string;
  matchDisplay: string;
  canonicalMarket: string;
  selection: string;
  betMarket: string;
  minute: number | null;
  status: string;
  score: string;
  evidenceMode: string;
  confidence: number | null;
  odds: number | null;
  saved: boolean | null;
  shouldPush: boolean | null;
  policyBlocked: boolean | null;
  llmDecisionDiagnostic: string;
  marketResolutionStatus: string;
  saveIntegrityStatus: string;
  policyWarnings: string[];
  warnings: string[];
  metadataGaps: string[];
  settlementStatus: 'settled_rules' | 'missing_match_history' | 'unresolved_by_rules';
  result: FinalSettlementResult | null;
  pnlPercent: number | null;
  settlementExplanation: string;
}

export interface CurrentRuntimeBlockedSelectionSummaryRow {
  key: string;
  total: number;
  settled: number;
  wins: number;
  losses: number;
  pushLike: number;
  totalStakedPercent: number;
  totalPnlPercent: number;
  roiOnStaked: number;
}

export interface CurrentRuntimeBlockedSelectionReview {
  generatedAt: string;
  lookbackHours: number;
  maxRows: number;
  stakePercent: number;
  officialPromptVersion: string;
  totalSelections: number;
  uniqueMatches: number;
  settledRows: number;
  unresolvedRows: number;
  wins: number;
  losses: number;
  pushLike: number;
  totalStakedPercent: number;
  totalPnlPercent: number;
  roiOnStaked: number;
  metadataCompleteness: {
    missingLlmDecisionDiagnostic: number;
    missingMarketResolutionStatus: number;
    missingSaveIntegrityStatus: number;
    missingEvidenceMode: number;
  };
  byCanonicalMarket: CurrentRuntimeBlockedSelectionSummaryRow[];
  byPolicyWarning: CurrentRuntimeBlockedSelectionSummaryRow[];
  byEvidenceMode: CurrentRuntimeBlockedSelectionSummaryRow[];
  byConfidenceBand: CurrentRuntimeBlockedSelectionSummaryRow[];
  byMatch: CurrentRuntimeBlockedSelectionSummaryRow[];
  rows: CurrentRuntimeBlockedSelectionRow[];
}

function clampPositiveInt(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(Math.max(Math.floor(value), min), max);
}

function clampStakePercent(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.max(0, Math.min(value, 10));
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function asString(value: unknown): string {
  return String(value ?? '').trim();
}

function nullableIso(value: unknown): string | null {
  if (value == null) return null;
  if (value instanceof Date) return value.toISOString();
  const date = new Date(String(value));
  return Number.isNaN(date.getTime()) ? String(value) : date.toISOString();
}

function toNumber(value: unknown): number | null {
  if (value == null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function toBoolean(value: unknown): boolean | null {
  if (value === true || value === 'true') return true;
  if (value === false || value === 'false') return false;
  return null;
}

function toStringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((item) => asString(item)).filter(Boolean);
  if (typeof value === 'string' && value.trim()) {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed.map((item) => asString(item)).filter(Boolean) : [value];
    } catch {
      return [value];
    }
  }
  return [];
}

function parseOddsFromSelection(selection: string): number | null {
  const match = selection.match(/@\s*(\d+(?:\.\d+)?)/);
  if (!match) return null;
  const odds = Number(match[1]);
  return Number.isFinite(odds) ? odds : null;
}

function round(value: number): number {
  return Math.round(value * 10000) / 10000;
}

function isWin(result: FinalSettlementResult | null): boolean {
  return result === 'win' || result === 'half_win';
}

function isLoss(result: FinalSettlementResult | null): boolean {
  return result === 'loss' || result === 'half_loss';
}

function isPushLike(result: FinalSettlementResult | null): boolean {
  return result === 'push' || result === 'void';
}

function confidenceBand(value: number | null): string {
  if (value == null) return 'unknown';
  if (value >= 8) return '8+';
  if (value >= 7) return '7';
  if (value >= 6) return '6';
  return '<6';
}

function buildBlockedSelectionRow(
  row: BlockedSelectionDbRow,
  stakePercent: number,
): CurrentRuntimeBlockedSelectionRow {
  const metadata = asRecord(row.metadata);
  const matchId = asString(metadata.matchId ?? row.audit_match_id ?? row.history_match_id);
  const selection = asString(metadata.selection);
  const betMarket = asString(metadata.betMarket);
  const canonicalMarket = normalizeMarket(selection, betMarket);
  const odds = toNumber(metadata.odds) ?? parseOddsFromSelection(selection);
  const confidence = toNumber(metadata.confidence);
  const llmDecisionDiagnostic = asString(metadata.llmDecisionDiagnostic) || 'unknown';
  const marketResolutionStatus = asString(metadata.marketResolutionStatus) || 'unknown';
  const saveIntegrityStatus = asString(metadata.saveIntegrityStatus) || 'unknown';
  const evidenceMode = asString(metadata.evidenceMode) || 'unknown';
  const metadataGaps = [
    llmDecisionDiagnostic === 'unknown' ? 'missing_llm_decision_diagnostic' : '',
    marketResolutionStatus === 'unknown' ? 'missing_market_resolution_status' : '',
    saveIntegrityStatus === 'unknown' ? 'missing_save_integrity_status' : '',
    evidenceMode === 'unknown' ? 'missing_evidence_mode' : '',
  ].filter(Boolean);

  const base = {
    auditLogId: row.id,
    timestamp: nullableIso(row.timestamp) ?? String(row.timestamp),
    matchId,
    matchDisplay: asString(metadata.matchDisplay),
    canonicalMarket,
    selection,
    betMarket,
    minute: toNumber(metadata.minute),
    status: asString(metadata.status) || 'unknown',
    score: asString(metadata.score),
    evidenceMode,
    confidence,
    odds,
    saved: toBoolean(metadata.saved),
    shouldPush: toBoolean(metadata.shouldPush),
    policyBlocked: toBoolean(metadata.policyBlocked),
    llmDecisionDiagnostic,
    marketResolutionStatus,
    saveIntegrityStatus,
    policyWarnings: toStringArray(metadata.policyWarnings),
    warnings: toStringArray(metadata.warnings),
    metadataGaps,
  };

  if (!row.history_match_id) {
    return {
      ...base,
      settlementStatus: 'missing_match_history',
      result: null,
      pnlPercent: null,
      settlementExplanation: 'No matches_history row yet for this blocked current-runtime selection.',
    };
  }

  const homeScore = row.regular_home_score ?? row.home_score;
  const awayScore = row.regular_away_score ?? row.away_score;
  if (homeScore == null || awayScore == null) {
    return {
      ...base,
      settlementStatus: 'unresolved_by_rules',
      result: null,
      pnlPercent: null,
      settlementExplanation: 'Historical match exists but final score is incomplete.',
    };
  }

  const rule = settleByRule({
    market: betMarket || canonicalMarket,
    selection,
    homeScore,
    awayScore,
    htHomeScore: row.halftime_home ?? undefined,
    htAwayScore: row.halftime_away ?? undefined,
    statistics: parseStoredSettlementStats(row.settlement_stats),
  });
  const finalResult = rule && isFinalSettlementResult(rule.result) ? rule.result : null;

  return {
    ...base,
    settlementStatus: finalResult ? 'settled_rules' : 'unresolved_by_rules',
    result: finalResult,
    pnlPercent: finalResult && odds != null ? calcSettlementPnl(finalResult, odds, stakePercent) : null,
    settlementExplanation: finalResult
      ? rule?.explanation ?? ''
      : 'Deterministic settlement rules could not resolve this blocked current-runtime selection.',
  };
}

function summarizeGroup(
  key: string,
  rows: CurrentRuntimeBlockedSelectionRow[],
  stakePercent: number,
): CurrentRuntimeBlockedSelectionSummaryRow {
  const settled = rows.filter((row) => row.settlementStatus === 'settled_rules' && row.result != null);
  const pnlPercent = round(settled.reduce((sum, row) => sum + (row.pnlPercent ?? 0), 0));
  const stakedPercent = round(settled.reduce((sum, row) => sum + (row.odds == null ? 0 : stakePercent), 0));
  return {
    key,
    total: rows.length,
    settled: settled.length,
    wins: settled.filter((row) => isWin(row.result)).length,
    losses: settled.filter((row) => isLoss(row.result)).length,
    pushLike: settled.filter((row) => isPushLike(row.result)).length,
    totalStakedPercent: stakedPercent,
    totalPnlPercent: pnlPercent,
    roiOnStaked: stakedPercent > 0 ? round(pnlPercent / stakedPercent) : 0,
  };
}

function summarizeBy(
  rows: CurrentRuntimeBlockedSelectionRow[],
  stakePercent: number,
  keysForRow: (row: CurrentRuntimeBlockedSelectionRow) => string[],
): CurrentRuntimeBlockedSelectionSummaryRow[] {
  const map = new Map<string, CurrentRuntimeBlockedSelectionRow[]>();
  for (const row of rows) {
    for (const key of keysForRow(row)) {
      const normalized = asString(key) || 'unknown';
      map.set(normalized, [...(map.get(normalized) ?? []), row]);
    }
  }
  return [...map.entries()]
    .map(([key, group]) => summarizeGroup(key, group, stakePercent))
    .sort((a, b) => b.total - a.total || a.key.localeCompare(b.key));
}

export async function buildCurrentRuntimeBlockedSelectionReview(
  options: CurrentRuntimeBlockedSelectionReviewOptions,
): Promise<CurrentRuntimeBlockedSelectionReview> {
  const lookbackHours = clampPositiveInt(options.lookbackHours, 1, 24 * 365);
  const maxRows = clampPositiveInt(options.maxRows, 1, 10000);
  const stakePercent = clampStakePercent(options.stakePercent);
  const official = LIVE_ANALYSIS_PROMPT_VERSION;

  const result = await query<BlockedSelectionDbRow>(
    `SELECT
       a.id,
       a.timestamp,
       a.match_id AS audit_match_id,
       a.metadata,
       mh.match_id AS history_match_id,
       mh.final_status,
       mh.home_score,
       mh.away_score,
       mh.regular_home_score,
       mh.regular_away_score,
       mh.halftime_home,
       mh.halftime_away,
       mh.settlement_stats
     FROM audit_logs a
     LEFT JOIN matches_history mh
       ON mh.match_id = COALESCE(NULLIF(a.metadata->>'matchId', ''), a.match_id)
     WHERE a.category = 'PIPELINE'
       AND a.actor = 'auto-pipeline'
       AND a.action = 'PIPELINE_MATCH_ANALYZED'
       AND a.metadata->>'promptVersion' = $2
       AND COALESCE(NULLIF(a.metadata->>'selection', ''), '') <> ''
       AND COALESCE(NULLIF(a.metadata->>'saved', ''), 'false') <> 'true'
       AND COALESCE(NULLIF(a.metadata->>'shouldPush', ''), 'false') <> 'true'
       AND a.timestamp >= NOW() - ($1::int * INTERVAL '1 hour')
     ORDER BY a.timestamp DESC, a.id DESC
     LIMIT $3`,
    [lookbackHours, official, maxRows],
  );

  const rows = result.rows.map((row) => buildBlockedSelectionRow(row, stakePercent));
  const settledRows = rows.filter((row) => row.settlementStatus === 'settled_rules' && row.result != null);
  const totalStakedPercent = round(settledRows.reduce((sum, row) => sum + (row.odds == null ? 0 : stakePercent), 0));
  const totalPnlPercent = round(settledRows.reduce((sum, row) => sum + (row.pnlPercent ?? 0), 0));

  return {
    generatedAt: new Date().toISOString(),
    lookbackHours,
    maxRows,
    stakePercent,
    officialPromptVersion: official,
    totalSelections: rows.length,
    uniqueMatches: new Set(rows.map((row) => row.matchId).filter(Boolean)).size,
    settledRows: settledRows.length,
    unresolvedRows: rows.length - settledRows.length,
    wins: settledRows.filter((row) => isWin(row.result)).length,
    losses: settledRows.filter((row) => isLoss(row.result)).length,
    pushLike: settledRows.filter((row) => isPushLike(row.result)).length,
    totalStakedPercent,
    totalPnlPercent,
    roiOnStaked: totalStakedPercent > 0 ? round(totalPnlPercent / totalStakedPercent) : 0,
    metadataCompleteness: {
      missingLlmDecisionDiagnostic: rows.filter((row) => row.metadataGaps.includes('missing_llm_decision_diagnostic')).length,
      missingMarketResolutionStatus: rows.filter((row) => row.metadataGaps.includes('missing_market_resolution_status')).length,
      missingSaveIntegrityStatus: rows.filter((row) => row.metadataGaps.includes('missing_save_integrity_status')).length,
      missingEvidenceMode: rows.filter((row) => row.metadataGaps.includes('missing_evidence_mode')).length,
    },
    byCanonicalMarket: summarizeBy(rows, stakePercent, (row) => [row.canonicalMarket]),
    byPolicyWarning: summarizeBy(rows, stakePercent, (row) => row.policyWarnings.length > 0 ? row.policyWarnings : ['none']),
    byEvidenceMode: summarizeBy(rows, stakePercent, (row) => [row.evidenceMode]),
    byConfidenceBand: summarizeBy(rows, stakePercent, (row) => [confidenceBand(row.confidence)]),
    byMatch: summarizeBy(rows, stakePercent, (row) => [row.matchDisplay || row.matchId || 'unknown']),
    rows,
  };
}

function formatSummaryTable(title: string, rows: CurrentRuntimeBlockedSelectionSummaryRow[]): string[] {
  const lines = [
    `## ${title}`,
    '',
    '| Key | Total | Settled | Wins | Losses | Push-like | Staked % | P/L % | ROI |',
    '| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |',
  ];
  if (rows.length === 0) {
    lines.push('| (none) | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |');
  } else {
    for (const row of rows) {
      lines.push(`| ${row.key} | ${row.total} | ${row.settled} | ${row.wins} | ${row.losses} | ${row.pushLike} | ${row.totalStakedPercent} | ${row.totalPnlPercent} | ${row.roiOnStaked} |`);
    }
  }
  lines.push('');
  return lines;
}

export function formatCurrentRuntimeBlockedSelectionReviewMarkdown(
  report: CurrentRuntimeBlockedSelectionReview,
): string {
  const lines: string[] = [
    '# Current Runtime Blocked Selection Review',
    '',
    `- Generated: ${report.generatedAt}`,
    `- Lookback hours: ${report.lookbackHours}`,
    `- Official prompt version: ${report.officialPromptVersion}`,
    `- Max rows scanned: ${report.maxRows}`,
    `- Counterfactual stake % per settled row: ${report.stakePercent}`,
    `- Blocked selections: ${report.totalSelections}`,
    `- Unique matches: ${report.uniqueMatches}`,
    `- Settled rows: ${report.settledRows}`,
    `- Unresolved rows: ${report.unresolvedRows}`,
    `- Wins / losses / push-like: ${report.wins} / ${report.losses} / ${report.pushLike}`,
    `- Total staked %: ${report.totalStakedPercent}`,
    `- Total P/L %: ${report.totalPnlPercent}`,
    `- ROI on staked: ${report.roiOnStaked}`,
    `- Metadata gaps: llm=${report.metadataCompleteness.missingLlmDecisionDiagnostic}, market=${report.metadataCompleteness.missingMarketResolutionStatus}, save=${report.metadataCompleteness.missingSaveIntegrityStatus}, evidence=${report.metadataCompleteness.missingEvidenceMode}`,
    '',
    ...formatSummaryTable('By Canonical Market', report.byCanonicalMarket),
    ...formatSummaryTable('By Policy Warning', report.byPolicyWarning),
    ...formatSummaryTable('By Evidence Mode', report.byEvidenceMode),
    ...formatSummaryTable('By Confidence Band', report.byConfidenceBand),
    ...formatSummaryTable('By Match', report.byMatch),
    '## Rows',
    '',
    '| Timestamp | Match | Market | Selection | Minute | Confidence | Odds | Result | P/L % | Status | Warnings |',
    '| --- | --- | --- | --- | ---: | ---: | ---: | --- | ---: | --- | --- |',
  ];
  if (report.rows.length === 0) {
    lines.push('| (none) |  |  |  |  |  |  |  |  |  |  |');
  } else {
    for (const row of report.rows.slice(0, 75)) {
      lines.push([
        row.timestamp,
        row.matchDisplay || row.matchId,
        row.canonicalMarket,
        row.selection,
        row.minute ?? '',
        row.confidence ?? '',
        row.odds ?? '',
        row.result ?? '',
        row.pnlPercent ?? '',
        row.settlementStatus,
        row.policyWarnings.slice(0, 4).join('; '),
      ].join(' | ').replace(/^/, '| ').replace(/$/, ' |'));
    }
  }
  lines.push('');
  return `${lines.join('\n')}\n`;
}
