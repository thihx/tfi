import { query } from '../db/pool.js';
import { settleByRule } from './settle-rules.js';
import {
  calcSettlementPnl,
  isFinalSettlementResult,
  type FinalSettlementResult,
} from './settle-types.js';
import { parseStoredSettlementStats } from './settlement-stat-cache.js';
import {
  readRuntimeShadowSegmentMetadata,
  type RuntimeShadowSegmentMetadata,
} from './runtime-shadow-segments.js';

export interface RuntimePolicyShadowSettlementOptions {
  lookbackDays: number;
  maxRows: number;
}

interface ShadowSettlementDbRow {
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

export interface RuntimePolicyShadowSettlementRow extends RuntimeShadowSegmentMetadata {
  auditLogId: number;
  timestamp: string;
  matchId: string;
  matchDisplay: string;
  pocketId: string;
  canonicalMarket: string;
  selection: string;
  betMarket: string;
  minute: number | null;
  minuteBand: string;
  score: string;
  odds: number | null;
  stakePercent: number;
  status: 'settled_rules' | 'missing_match_history' | 'unresolved_by_rules';
  result: FinalSettlementResult | null;
  pnlPercent: number | null;
  explanation: string;
}

export interface RuntimePolicyShadowSettlementSummaryRow {
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

export interface RuntimePolicyShadowSettlementReport {
  generatedAt: string;
  lookbackDays: number;
  maxRows: number;
  totalEvents: number;
  totalPocketRows: number;
  settledRows: number;
  unresolvedRows: number;
  wins: number;
  losses: number;
  pushLike: number;
  totalStakedPercent: number;
  totalPnlPercent: number;
  roiOnStaked: number;
  byPocket: RuntimePolicyShadowSettlementSummaryRow[];
  byCanonicalMarket: RuntimePolicyShadowSettlementSummaryRow[];
  byLeagueSegment: RuntimePolicyShadowSettlementSummaryRow[];
  byTeamSegment: RuntimePolicyShadowSettlementSummaryRow[];
  rows: RuntimePolicyShadowSettlementRow[];
}

function clampPositiveInt(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(Math.max(Math.floor(value), min), max);
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function toNumber(value: unknown): number | null {
  if (value == null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function round(value: number): number {
  return Math.round(value * 10000) / 10000;
}

function pocketRows(metadata: Record<string, unknown>): Array<{ id: string; stakeCapPercent: number }> {
  const raw = metadata.matchedPockets;
  if (!Array.isArray(raw)) return [{ id: 'unknown', stakeCapPercent: 1 }];
  const rows = raw
    .map((item) => {
      const record = asRecord(item);
      return {
        id: String(record.id ?? '').trim(),
        stakeCapPercent: Math.max(0, toNumber(record.stakeCapPercent) ?? 1),
      };
    })
    .filter((row) => row.id);
  return rows.length > 0 ? rows : [{ id: 'unknown', stakeCapPercent: 1 }];
}

function buildRowsForDbRow(row: ShadowSettlementDbRow): RuntimePolicyShadowSettlementRow[] {
  const metadata = asRecord(row.metadata);
  const matchId = String(metadata.matchId ?? row.audit_match_id ?? row.history_match_id ?? '').trim();
  const selection = String(metadata.selection ?? '').trim();
  const betMarket = String(metadata.betMarket ?? metadata.canonicalMarket ?? '').trim();
  const canonicalMarket = String(metadata.canonicalMarket ?? betMarket ?? 'unknown').trim() || 'unknown';
  const odds = toNumber(metadata.odds);
  const segments = readRuntimeShadowSegmentMetadata({
    ...metadata,
    matchId,
  });
  const base = {
    auditLogId: row.id,
    timestamp: row.timestamp,
    matchId,
    matchDisplay: String(metadata.matchDisplay ?? '').trim(),
    ...segments,
    canonicalMarket,
    selection,
    betMarket,
    minute: toNumber(metadata.minute),
    minuteBand: String(metadata.minuteBand ?? 'unknown').trim() || 'unknown',
    score: String(metadata.score ?? '').trim(),
    odds,
  };

  const pockets = pocketRows(metadata);
  if (!row.history_match_id) {
    return pockets.map((pocket) => ({
      ...base,
      pocketId: pocket.id,
      stakePercent: pocket.stakeCapPercent,
      status: 'missing_match_history',
      result: null,
      pnlPercent: null,
      explanation: 'No matches_history row yet for this shadow candidate.',
    }));
  }

  const homeScore = row.regular_home_score ?? row.home_score;
  const awayScore = row.regular_away_score ?? row.away_score;
  if (homeScore == null || awayScore == null) {
    return pockets.map((pocket) => ({
      ...base,
      pocketId: pocket.id,
      stakePercent: pocket.stakeCapPercent,
      status: 'unresolved_by_rules',
      result: null,
      pnlPercent: null,
      explanation: 'Historical match exists but final score is incomplete.',
    }));
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
  const finalExplanation = finalResult ? rule?.explanation ?? '' : '';

  return pockets.map((pocket) => ({
    ...base,
    pocketId: pocket.id,
    stakePercent: pocket.stakeCapPercent,
    status: finalResult ? 'settled_rules' : 'unresolved_by_rules',
    result: finalResult,
    pnlPercent: finalResult && odds != null ? calcSettlementPnl(finalResult, odds, pocket.stakeCapPercent) : null,
    explanation: finalResult ? finalExplanation : 'Deterministic settlement rules could not resolve this shadow candidate.',
  }));
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

function summarizeBy(
  rows: RuntimePolicyShadowSettlementRow[],
  keyForRow: (row: RuntimePolicyShadowSettlementRow) => string,
): RuntimePolicyShadowSettlementSummaryRow[] {
  const map = new Map<string, RuntimePolicyShadowSettlementRow[]>();
  for (const row of rows) {
    const key = keyForRow(row) || 'unknown';
    map.set(key, [...(map.get(key) ?? []), row]);
  }
  return [...map.entries()]
    .map(([key, group]) => summarizeGroup(key, group))
    .sort((a, b) => b.total - a.total || a.key.localeCompare(b.key));
}

function summarizeByMany(
  rows: RuntimePolicyShadowSettlementRow[],
  keysForRow: (row: RuntimePolicyShadowSettlementRow) => string[],
): RuntimePolicyShadowSettlementSummaryRow[] {
  const map = new Map<string, RuntimePolicyShadowSettlementRow[]>();
  for (const row of rows) {
    for (const rawKey of keysForRow(row)) {
      const key = rawKey || 'unknown';
      map.set(key, [...(map.get(key) ?? []), row]);
    }
  }
  return [...map.entries()]
    .map(([key, group]) => summarizeGroup(key, group))
    .sort((a, b) => b.total - a.total || a.key.localeCompare(b.key));
}

function summarizeGroup(key: string, rows: RuntimePolicyShadowSettlementRow[]): RuntimePolicyShadowSettlementSummaryRow {
  const settled = rows.filter((row) => row.status === 'settled_rules' && row.result != null);
  const totalStakedPercent = round(settled.reduce((sum, row) => sum + row.stakePercent, 0));
  const totalPnlPercent = round(settled.reduce((sum, row) => sum + (row.pnlPercent ?? 0), 0));
  return {
    key,
    total: rows.length,
    settled: settled.length,
    wins: settled.filter((row) => isWin(row.result)).length,
    losses: settled.filter((row) => isLoss(row.result)).length,
    pushLike: settled.filter((row) => isPushLike(row.result)).length,
    totalStakedPercent,
    totalPnlPercent,
    roiOnStaked: totalStakedPercent > 0 ? round(totalPnlPercent / totalStakedPercent) : 0,
  };
}

export async function buildRuntimePolicyShadowSettlementReport(
  options: RuntimePolicyShadowSettlementOptions,
): Promise<RuntimePolicyShadowSettlementReport> {
  const lookbackDays = clampPositiveInt(options.lookbackDays, 1, 3650);
  const maxRows = clampPositiveInt(options.maxRows, 1, 10000);
  const result = await query<ShadowSettlementDbRow>(
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
       AND a.action = 'PIPELINE_POLICY_SHADOW_CANDIDATE'
       AND a.timestamp >= NOW() - ($1::int * INTERVAL '1 day')
     ORDER BY a.timestamp DESC
     LIMIT $2`,
    [lookbackDays, maxRows],
  );
  const rows = result.rows.flatMap(buildRowsForDbRow);
  const settledRows = rows.filter((row) => row.status === 'settled_rules' && row.result != null);
  const totalStakedPercent = round(settledRows.reduce((sum, row) => sum + row.stakePercent, 0));
  const totalPnlPercent = round(settledRows.reduce((sum, row) => sum + (row.pnlPercent ?? 0), 0));

  return {
    generatedAt: new Date().toISOString(),
    lookbackDays,
    maxRows,
    totalEvents: result.rows.length,
    totalPocketRows: rows.length,
    settledRows: settledRows.length,
    unresolvedRows: rows.length - settledRows.length,
    wins: settledRows.filter((row) => isWin(row.result)).length,
    losses: settledRows.filter((row) => isLoss(row.result)).length,
    pushLike: settledRows.filter((row) => isPushLike(row.result)).length,
    totalStakedPercent,
    totalPnlPercent,
    roiOnStaked: totalStakedPercent > 0 ? round(totalPnlPercent / totalStakedPercent) : 0,
    byPocket: summarizeBy(rows, (row) => row.pocketId),
    byCanonicalMarket: summarizeBy(rows, (row) => row.canonicalMarket),
    byLeagueSegment: summarizeBy(rows, (row) => row.leagueSegmentKey),
    byTeamSegment: summarizeByMany(rows, (row) => row.teamSegmentKeys),
    rows,
  };
}

function formatSummaryRows(title: string, rows: RuntimePolicyShadowSettlementSummaryRow[]): string[] {
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

export function formatRuntimePolicyShadowSettlementMarkdown(
  report: RuntimePolicyShadowSettlementReport,
): string {
  const lines: string[] = [
    '# Runtime Policy Shadow Settlement Report',
    '',
    `- Generated: ${report.generatedAt}`,
    `- Lookback days: ${report.lookbackDays}`,
    `- Max rows scanned: ${report.maxRows}`,
    `- Shadow audit events: ${report.totalEvents}`,
    `- Pocket rows: ${report.totalPocketRows}`,
    `- Settled rows: ${report.settledRows}`,
    `- Unresolved rows: ${report.unresolvedRows}`,
    `- Wins / losses / push-like: ${report.wins} / ${report.losses} / ${report.pushLike}`,
    `- Total staked %: ${report.totalStakedPercent}`,
    `- Total P/L %: ${report.totalPnlPercent}`,
    `- ROI on staked: ${report.roiOnStaked}`,
    '',
    ...formatSummaryRows('By Pocket', report.byPocket),
    ...formatSummaryRows('By Canonical Market', report.byCanonicalMarket),
    ...formatSummaryRows('By League Segment', report.byLeagueSegment),
    ...formatSummaryRows('By Team Segment', report.byTeamSegment),
    '## Rows',
    '',
    '| Timestamp | Match | League Segment | Team Segments | Pocket | Market | Selection | Score | Odds | Result | P/L % | Status |',
    '| --- | --- | --- | --- | --- | --- | --- | --- | ---: | --- | ---: | --- |',
  ];
  if (report.rows.length === 0) {
    lines.push('| (none) |  |  |  |  |  |  |  |  |  |  |  |');
  } else {
    for (const row of report.rows.slice(0, 50)) {
      lines.push([
        row.timestamp,
        row.matchDisplay || row.matchId,
        row.leagueSegmentKey,
        row.teamSegmentKeys.join(', '),
        row.pocketId,
        row.canonicalMarket,
        row.selection,
        row.score,
        row.odds ?? '',
        row.result ?? '',
        row.pnlPercent ?? '',
        row.status,
      ].join(' | ').replace(/^/, '| ').replace(/$/, ' |'));
    }
  }
  lines.push('');
  return `${lines.join('\n')}\n`;
}
