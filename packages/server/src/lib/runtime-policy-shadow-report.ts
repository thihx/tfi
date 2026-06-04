import { query } from '../db/pool.js';

export interface RuntimePolicyShadowReportOptions {
  lookbackDays: number;
  maxRows: number;
}

export interface RuntimePolicyShadowAuditRow {
  id: number;
  timestamp: string;
  match_id: string | null;
  metadata: Record<string, unknown> | null;
}

export interface RuntimePolicyShadowSummaryRow {
  key: string;
  count: number;
  avgOdds: number | null;
  minOdds: number | null;
  maxOdds: number | null;
}

export interface RuntimePolicyShadowRecentRow {
  id: number;
  timestamp: string;
  matchId: string;
  matchDisplay: string;
  pocketIds: string[];
  canonicalMarket: string;
  minute: number | null;
  minuteBand: string;
  score: string;
  scoreState: string;
  odds: number | null;
  confidence: number | null;
  valuePercent: number | null;
  valueBand: string;
  riskLevel: string;
  stakePercent: number | null;
  watchSignalKey: string;
  watchSignalLabel: string;
  evidenceMode: string;
  marketResolutionStatus: string;
  prematchStrength: string;
  marketAvailabilityBucket: string;
  policyWarnings: string[];
}

export interface RuntimePolicyShadowReport {
  generatedAt: string;
  lookbackDays: number;
  maxRows: number;
  totalEvents: number;
  totalPocketMatches: number;
  uniqueMatches: number;
  byPocket: RuntimePolicyShadowSummaryRow[];
  byCanonicalMarket: RuntimePolicyShadowSummaryRow[];
  byMinuteBand: RuntimePolicyShadowSummaryRow[];
  byScoreState: RuntimePolicyShadowSummaryRow[];
  byConfidenceBand: RuntimePolicyShadowSummaryRow[];
  byValueBand: RuntimePolicyShadowSummaryRow[];
  byRiskLevel: RuntimePolicyShadowSummaryRow[];
  byWatchSignal: RuntimePolicyShadowSummaryRow[];
  byMarketResolutionStatus: RuntimePolicyShadowSummaryRow[];
  byMarketAvailabilityBucket: RuntimePolicyShadowSummaryRow[];
  recent: RuntimePolicyShadowRecentRow[];
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

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item ?? '').trim()).filter(Boolean);
}

function confidenceBand(value: number | null): string {
  if (value == null) return 'unknown';
  if (value >= 8) return '8+';
  if (value >= 7) return '7';
  if (value >= 6) return '6';
  return '<6';
}

function valueBand(value: number | null): string {
  if (value == null) return 'unknown';
  if (value < 0) return '<0';
  if (value < 5) return '0-4';
  if (value < 6) return '5';
  if (value < 8) return '6-7';
  return '8+';
}

function pocketIds(metadata: Record<string, unknown>): string[] {
  const raw = metadata.matchedPockets;
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item) => String(asRecord(item).id ?? '').trim())
    .filter(Boolean);
}

function normalizeRecentRow(row: RuntimePolicyShadowAuditRow): RuntimePolicyShadowRecentRow {
  const metadata = asRecord(row.metadata);
  return {
    id: row.id,
    timestamp: row.timestamp,
    matchId: String(metadata.matchId ?? row.match_id ?? '').trim(),
    matchDisplay: String(metadata.matchDisplay ?? '').trim(),
    pocketIds: pocketIds(metadata),
    canonicalMarket: String(metadata.canonicalMarket ?? 'unknown').trim() || 'unknown',
    minute: toNumber(metadata.minute),
    minuteBand: String(metadata.minuteBand ?? 'unknown').trim() || 'unknown',
    score: String(metadata.score ?? '').trim(),
    scoreState: String(metadata.scoreState ?? 'unknown').trim() || 'unknown',
    odds: toNumber(metadata.odds),
    confidence: toNumber(metadata.confidence),
    valuePercent: toNumber(metadata.valuePercent),
    valueBand: String(metadata.valueBand ?? valueBand(toNumber(metadata.valuePercent))).trim() || 'unknown',
    riskLevel: String(metadata.riskLevel ?? 'unknown').trim() || 'unknown',
    stakePercent: toNumber(metadata.stakePercent),
    watchSignalKey: String(metadata.watchSignalKey ?? 'none').trim() || 'none',
    watchSignalLabel: String(metadata.watchSignalLabel ?? 'none').trim() || 'none',
    evidenceMode: String(metadata.evidenceMode ?? 'unknown').trim() || 'unknown',
    marketResolutionStatus: String(metadata.marketResolutionStatus ?? 'unknown').trim() || 'unknown',
    prematchStrength: String(metadata.prematchStrength ?? 'unknown').trim() || 'unknown',
    marketAvailabilityBucket: String(metadata.marketAvailabilityBucket ?? 'unknown').trim() || 'unknown',
    policyWarnings: toStringArray(metadata.policyWarnings),
  };
}

function summarizeBy(
  rows: RuntimePolicyShadowRecentRow[],
  keysForRow: (row: RuntimePolicyShadowRecentRow) => string[],
): RuntimePolicyShadowSummaryRow[] {
  const map = new Map<string, { count: number; odds: number[] }>();
  for (const row of rows) {
    for (const key of keysForRow(row)) {
      const normalizedKey = String(key || 'unknown').trim() || 'unknown';
      const bucket = map.get(normalizedKey) ?? { count: 0, odds: [] };
      bucket.count += 1;
      if (row.odds != null) bucket.odds.push(row.odds);
      map.set(normalizedKey, bucket);
    }
  }

  return [...map.entries()]
    .map(([key, value]) => {
      const totalOdds = value.odds.reduce((sum, odds) => sum + odds, 0);
      return {
        key,
        count: value.count,
        avgOdds: value.odds.length > 0 ? round(totalOdds / value.odds.length) : null,
        minOdds: value.odds.length > 0 ? round(Math.min(...value.odds)) : null,
        maxOdds: value.odds.length > 0 ? round(Math.max(...value.odds)) : null,
      };
    })
    .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
}

function round(value: number): number {
  return Math.round(value * 10000) / 10000;
}

export async function buildRuntimePolicyShadowReport(
  options: RuntimePolicyShadowReportOptions,
): Promise<RuntimePolicyShadowReport> {
  const lookbackDays = clampPositiveInt(options.lookbackDays, 1, 3650);
  const maxRows = clampPositiveInt(options.maxRows, 1, 10000);
  const result = await query<RuntimePolicyShadowAuditRow>(
    `SELECT id, timestamp, match_id, metadata
     FROM audit_logs
     WHERE category = 'PIPELINE'
       AND action = 'PIPELINE_POLICY_SHADOW_CANDIDATE'
       AND timestamp >= NOW() - ($1::int * INTERVAL '1 day')
     ORDER BY timestamp DESC
     LIMIT $2`,
    [lookbackDays, maxRows],
  );
  const recent = result.rows.map(normalizeRecentRow);
  const uniqueMatches = new Set(recent.map((row) => row.matchId).filter(Boolean)).size;
  const totalPocketMatches = recent.reduce((sum, row) => sum + row.pocketIds.length, 0);

  return {
    generatedAt: new Date().toISOString(),
    lookbackDays,
    maxRows,
    totalEvents: recent.length,
    totalPocketMatches,
    uniqueMatches,
    byPocket: summarizeBy(recent, (row) => row.pocketIds.length > 0 ? row.pocketIds : ['unknown']),
    byCanonicalMarket: summarizeBy(recent, (row) => [row.canonicalMarket]),
    byMinuteBand: summarizeBy(recent, (row) => [row.minuteBand]),
    byScoreState: summarizeBy(recent, (row) => [row.scoreState]),
    byConfidenceBand: summarizeBy(recent, (row) => [confidenceBand(row.confidence)]),
    byValueBand: summarizeBy(recent, (row) => [row.valueBand]),
    byRiskLevel: summarizeBy(recent, (row) => [row.riskLevel]),
    byWatchSignal: summarizeBy(recent, (row) => [row.watchSignalKey]),
    byMarketResolutionStatus: summarizeBy(recent, (row) => [row.marketResolutionStatus]),
    byMarketAvailabilityBucket: summarizeBy(recent, (row) => [row.marketAvailabilityBucket]),
    recent: recent.slice(0, 100),
  };
}

function formatSummaryTable(title: string, rows: RuntimePolicyShadowSummaryRow[]): string[] {
  const lines = [`## ${title}`, '', '| Key | Count | Avg odds | Min odds | Max odds |', '| --- | ---: | ---: | ---: | ---: |'];
  if (rows.length === 0) {
    lines.push('| (none) | 0 |  |  |  |');
    lines.push('');
    return lines;
  }
  for (const row of rows) {
    lines.push(`| ${row.key} | ${row.count} | ${row.avgOdds ?? ''} | ${row.minOdds ?? ''} | ${row.maxOdds ?? ''} |`);
  }
  lines.push('');
  return lines;
}

export function formatRuntimePolicyShadowReportMarkdown(report: RuntimePolicyShadowReport): string {
  const lines: string[] = [
    '# Runtime Policy Shadow Report',
    '',
    `- Generated: ${report.generatedAt}`,
    `- Lookback days: ${report.lookbackDays}`,
    `- Max rows scanned: ${report.maxRows}`,
    `- Shadow audit events: ${report.totalEvents}`,
    `- Pocket matches: ${report.totalPocketMatches}`,
    `- Unique matches: ${report.uniqueMatches}`,
    '',
    ...formatSummaryTable('By Pocket', report.byPocket),
    ...formatSummaryTable('By Canonical Market', report.byCanonicalMarket),
    ...formatSummaryTable('By Minute Band', report.byMinuteBand),
    ...formatSummaryTable('By Score State', report.byScoreState),
    ...formatSummaryTable('By Confidence Band', report.byConfidenceBand),
    ...formatSummaryTable('By Value Band', report.byValueBand),
    ...formatSummaryTable('By Risk Level', report.byRiskLevel),
    ...formatSummaryTable('By Watch Signal', report.byWatchSignal),
    ...formatSummaryTable('By Market Resolution', report.byMarketResolutionStatus),
    ...formatSummaryTable('By Market Availability', report.byMarketAvailabilityBucket),
    '## Recent',
    '',
    '| Timestamp | Match | Pockets | Market | Minute | Score | Odds | Confidence | Value | Risk | Stake | Watch Signal | Resolution | Evidence | Prematch | Availability |',
    '| --- | --- | --- | --- | ---: | --- | ---: | ---: | ---: | --- | ---: | --- | --- | --- | --- | --- |',
  ];

  if (report.recent.length === 0) {
    lines.push('| (none) |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |');
  } else {
    for (const row of report.recent.slice(0, 25)) {
      lines.push([
        row.timestamp,
        row.matchDisplay || row.matchId,
        row.pocketIds.join(', '),
        row.canonicalMarket,
        row.minute ?? '',
        row.score,
        row.odds ?? '',
        row.confidence ?? '',
        row.valuePercent ?? '',
        row.riskLevel,
        row.stakePercent ?? '',
        row.watchSignalKey,
        row.marketResolutionStatus,
        row.evidenceMode,
        row.prematchStrength,
        row.marketAvailabilityBucket,
      ].join(' | ').replace(/^/, '| ').replace(/$/, ' |'));
    }
  }
  lines.push('');
  return `${lines.join('\n')}\n`;
}
