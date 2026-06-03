import { query } from '../db/pool.js';
import { LIVE_ANALYSIS_PROMPT_VERSION } from './live-analysis-prompt.js';

export interface CurrentRuntimeNoSaveDiagnosticsOptions {
  lookbackHours: number;
  maxSamples: number;
}

export interface RuntimeNoSaveBreakdownRow {
  key: string;
  count: number;
  latestAt: string | null;
}

export interface RuntimeNoSaveCrossRow {
  llmDecisionDiagnostic: string;
  marketResolutionStatus: string;
  policyBlocked: string;
  evidenceMode: string;
  count: number;
  latestAt: string | null;
}

export interface RuntimeNoSavePipelineOutcomeRow {
  saved: string;
  shouldPush: string;
  saveIntegrityStatus: string;
  saveProviderCoverageStatus: string;
  llmDecisionDiagnostic: string;
  count: number;
  latestAt: string | null;
}

export interface RuntimeNoSaveSampleRow {
  id: number;
  timestamp: string;
  action: string;
  outcome: string;
  matchId: string;
  matchDisplay: string;
  minute: string;
  status: string;
  evidenceMode: string;
  llmDecisionDiagnostic: string;
  marketResolutionStatus: string;
  policyBlocked: string;
  selection: string;
  betMarket: string;
  confidence: string;
  saveIntegrityStatus: string;
  saveBlockedReason: string;
  saveProviderCoverageStatus: string;
  policyWarnings: string[];
  warnings: string[];
  aiTextSample: string;
}

export interface CurrentRuntimeNoSaveDiagnosticsReport {
  generatedAt: string;
  lookbackHours: number;
  officialPromptVersion: string;
  totals: {
    parseDiagnostics: number;
    parseActionable: number;
    parseSkipped: number;
    matchAnalyzed: number;
    matchAnalyzedSaved: number;
    matchAnalyzedShouldPush: number;
    matchAnalyzedSaveBlocked: number;
  };
  llmDecisionDiagnostics: RuntimeNoSaveBreakdownRow[];
  marketResolutionStatuses: RuntimeNoSaveBreakdownRow[];
  evidenceModes: RuntimeNoSaveBreakdownRow[];
  policyWarningKeys: RuntimeNoSaveBreakdownRow[];
  parseCrossBreakdown: RuntimeNoSaveCrossRow[];
  pipelineOutcomeBreakdown: RuntimeNoSavePipelineOutcomeRow[];
  recentSamples: RuntimeNoSaveSampleRow[];
}

function clampPositiveInt(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(Math.max(Math.floor(value), min), max);
}

function nullableIso(value: unknown): string | null {
  if (value == null) return null;
  if (value instanceof Date) return value.toISOString();
  const date = new Date(String(value));
  return Number.isNaN(date.getTime()) ? String(value) : date.toISOString();
}

function parseStringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((entry) => String(entry));
  if (typeof value === 'string' && value.trim()) {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed.map((entry) => String(entry)) : [value];
    } catch {
      return [value];
    }
  }
  return [];
}

function truncate(value: string, max = 700): string {
  return value.length <= max ? value : `${value.slice(0, max)}...`;
}

export async function buildCurrentRuntimeNoSaveDiagnosticsReport(
  options: CurrentRuntimeNoSaveDiagnosticsOptions,
): Promise<CurrentRuntimeNoSaveDiagnosticsReport> {
  const lookbackHours = clampPositiveInt(options.lookbackHours, 1, 24 * 365);
  const maxSamples = clampPositiveInt(options.maxSamples, 1, 200);
  const official = LIVE_ANALYSIS_PROMPT_VERSION;

  const [
    totalsResult,
    diagnosticResult,
    marketResult,
    evidenceResult,
    warningResult,
    crossResult,
    outcomeResult,
    sampleResult,
  ] = await Promise.all([
    query<{
      parse_diagnostics: string;
      parse_actionable: string;
      parse_skipped: string;
      match_analyzed: string;
      match_analyzed_saved: string;
      match_analyzed_should_push: string;
      match_analyzed_save_blocked: string;
    }>(
      `SELECT
         COUNT(*) FILTER (WHERE action = 'LLM_PARSE_DIAGNOSTIC')::text AS parse_diagnostics,
         COUNT(*) FILTER (
           WHERE action = 'LLM_PARSE_DIAGNOSTIC'
             AND outcome = 'SUCCESS'
         )::text AS parse_actionable,
         COUNT(*) FILTER (
           WHERE action = 'LLM_PARSE_DIAGNOSTIC'
             AND outcome = 'SKIPPED'
         )::text AS parse_skipped,
         COUNT(*) FILTER (WHERE action = 'PIPELINE_MATCH_ANALYZED')::text AS match_analyzed,
         COUNT(*) FILTER (
           WHERE action = 'PIPELINE_MATCH_ANALYZED'
             AND metadata->>'saved' = 'true'
         )::text AS match_analyzed_saved,
         COUNT(*) FILTER (
           WHERE action = 'PIPELINE_MATCH_ANALYZED'
             AND metadata->>'shouldPush' = 'true'
         )::text AS match_analyzed_should_push,
         COUNT(*) FILTER (
           WHERE action = 'PIPELINE_MATCH_ANALYZED'
             AND COALESCE(NULLIF(metadata->>'saveIntegrityStatus', ''), 'unknown') = 'blocked'
         )::text AS match_analyzed_save_blocked
       FROM audit_logs
       WHERE category = 'PIPELINE'
         AND actor = 'auto-pipeline'
         AND metadata->>'promptVersion' = $2
         AND action IN ('LLM_PARSE_DIAGNOSTIC', 'PIPELINE_MATCH_ANALYZED')
         AND timestamp >= NOW() - ($1::int * INTERVAL '1 hour')`,
      [lookbackHours, official],
    ),
    query<{ key: string; count: string; latest_at: Date | string | null }>(
      `SELECT
         COALESCE(NULLIF(metadata->>'llmDecisionDiagnostic', ''), 'unknown') AS key,
         COUNT(*)::text AS count,
         MAX(timestamp) AS latest_at
       FROM audit_logs
       WHERE category = 'PIPELINE'
         AND actor = 'auto-pipeline'
         AND action = 'LLM_PARSE_DIAGNOSTIC'
         AND metadata->>'promptVersion' = $2
         AND timestamp >= NOW() - ($1::int * INTERVAL '1 hour')
       GROUP BY 1
       ORDER BY COUNT(*) DESC, key`,
      [lookbackHours, official],
    ),
    query<{ key: string; count: string; latest_at: Date | string | null }>(
      `SELECT
         COALESCE(NULLIF(metadata->>'marketResolutionStatus', ''), 'unknown') AS key,
         COUNT(*)::text AS count,
         MAX(timestamp) AS latest_at
       FROM audit_logs
       WHERE category = 'PIPELINE'
         AND actor = 'auto-pipeline'
         AND action = 'LLM_PARSE_DIAGNOSTIC'
         AND metadata->>'promptVersion' = $2
         AND timestamp >= NOW() - ($1::int * INTERVAL '1 hour')
       GROUP BY 1
       ORDER BY COUNT(*) DESC, key`,
      [lookbackHours, official],
    ),
    query<{ key: string; count: string; latest_at: Date | string | null }>(
      `SELECT
         COALESCE(NULLIF(metadata->>'evidenceMode', ''), 'unknown') AS key,
         COUNT(*)::text AS count,
         MAX(timestamp) AS latest_at
       FROM audit_logs
       WHERE category = 'PIPELINE'
         AND actor = 'auto-pipeline'
         AND action IN ('LLM_PARSE_DIAGNOSTIC', 'PIPELINE_MATCH_ANALYZED')
         AND metadata->>'promptVersion' = $2
         AND timestamp >= NOW() - ($1::int * INTERVAL '1 hour')
       GROUP BY 1
       ORDER BY COUNT(*) DESC, key`,
      [lookbackHours, official],
    ),
    query<{ key: string; count: string; latest_at: Date | string | null }>(
      `SELECT
         COALESCE(NULLIF(warning.value, ''), 'none') AS key,
         COUNT(*)::text AS count,
         MAX(a.timestamp) AS latest_at
       FROM audit_logs a
       CROSS JOIN LATERAL jsonb_array_elements_text(
         CASE
           WHEN jsonb_typeof(a.metadata->'policyWarnings') = 'array' THEN a.metadata->'policyWarnings'
           ELSE '[]'::jsonb
         END
       ) AS warning(value)
       WHERE a.category = 'PIPELINE'
         AND a.actor = 'auto-pipeline'
         AND a.action IN ('LLM_PARSE_DIAGNOSTIC', 'PIPELINE_MATCH_ANALYZED')
         AND a.metadata->>'promptVersion' = $2
         AND a.timestamp >= NOW() - ($1::int * INTERVAL '1 hour')
       GROUP BY 1
       ORDER BY COUNT(*) DESC, key
       LIMIT 25`,
      [lookbackHours, official],
    ),
    query<{
      llm_decision_diagnostic: string;
      market_resolution_status: string;
      policy_blocked: string;
      evidence_mode: string;
      count: string;
      latest_at: Date | string | null;
    }>(
      `SELECT
         COALESCE(NULLIF(metadata->>'llmDecisionDiagnostic', ''), 'unknown') AS llm_decision_diagnostic,
         COALESCE(NULLIF(metadata->>'marketResolutionStatus', ''), 'unknown') AS market_resolution_status,
         COALESCE(NULLIF(metadata->>'policyBlocked', ''), 'unknown') AS policy_blocked,
         COALESCE(NULLIF(metadata->>'evidenceMode', ''), 'unknown') AS evidence_mode,
         COUNT(*)::text AS count,
         MAX(timestamp) AS latest_at
       FROM audit_logs
       WHERE category = 'PIPELINE'
         AND actor = 'auto-pipeline'
         AND action = 'LLM_PARSE_DIAGNOSTIC'
         AND metadata->>'promptVersion' = $2
         AND timestamp >= NOW() - ($1::int * INTERVAL '1 hour')
       GROUP BY 1, 2, 3, 4
       ORDER BY COUNT(*) DESC, latest_at DESC
       LIMIT 30`,
      [lookbackHours, official],
    ),
    query<{
      saved: string;
      should_push: string;
      save_integrity_status: string;
      save_provider_coverage_status: string;
      llm_decision_diagnostic: string;
      count: string;
      latest_at: Date | string | null;
    }>(
      `SELECT
         COALESCE(NULLIF(metadata->>'saved', ''), 'unknown') AS saved,
         COALESCE(NULLIF(metadata->>'shouldPush', ''), 'unknown') AS should_push,
         COALESCE(NULLIF(metadata->>'saveIntegrityStatus', ''), 'unknown') AS save_integrity_status,
         COALESCE(NULLIF(metadata->>'saveProviderCoverageStatus', ''), 'unknown') AS save_provider_coverage_status,
         COALESCE(NULLIF(metadata->>'llmDecisionDiagnostic', ''), 'unknown') AS llm_decision_diagnostic,
         COUNT(*)::text AS count,
         MAX(timestamp) AS latest_at
       FROM audit_logs
       WHERE category = 'PIPELINE'
         AND actor = 'auto-pipeline'
         AND action = 'PIPELINE_MATCH_ANALYZED'
         AND metadata->>'promptVersion' = $2
         AND timestamp >= NOW() - ($1::int * INTERVAL '1 hour')
       GROUP BY 1, 2, 3, 4, 5
       ORDER BY COUNT(*) DESC, latest_at DESC
       LIMIT 30`,
      [lookbackHours, official],
    ),
    query<{
      id: string;
      timestamp: Date | string;
      action: string;
      outcome: string;
      match_id: string | null;
      metadata: Record<string, unknown> | string | null;
    }>(
      `SELECT
         id::text,
         timestamp,
         action,
         outcome,
         match_id,
         metadata
       FROM audit_logs
       WHERE category = 'PIPELINE'
         AND actor = 'auto-pipeline'
         AND action IN ('LLM_PARSE_DIAGNOSTIC', 'PIPELINE_MATCH_ANALYZED')
         AND metadata->>'promptVersion' = $2
         AND timestamp >= NOW() - ($1::int * INTERVAL '1 hour')
       ORDER BY timestamp DESC, id DESC
       LIMIT $3`,
      [lookbackHours, official, maxSamples],
    ),
  ]);

  const totals = totalsResult.rows[0];
  const toBreakdown = (rows: { key: string; count: string; latest_at: Date | string | null }[]): RuntimeNoSaveBreakdownRow[] =>
    rows.map((row) => ({ key: row.key, count: Number(row.count), latestAt: nullableIso(row.latest_at) }));
  const parseMetadata = (value: unknown): Record<string, unknown> => {
    if (!value) return {};
    if (typeof value === 'string') {
      try {
        const parsed = JSON.parse(value);
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
      } catch {
        return {};
      }
    }
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
  };
  const asText = (value: unknown): string => value == null || value === '' ? '(empty)' : String(value);

  return {
    generatedAt: new Date().toISOString(),
    lookbackHours,
    officialPromptVersion: official,
    totals: {
      parseDiagnostics: Number(totals?.parse_diagnostics ?? 0),
      parseActionable: Number(totals?.parse_actionable ?? 0),
      parseSkipped: Number(totals?.parse_skipped ?? 0),
      matchAnalyzed: Number(totals?.match_analyzed ?? 0),
      matchAnalyzedSaved: Number(totals?.match_analyzed_saved ?? 0),
      matchAnalyzedShouldPush: Number(totals?.match_analyzed_should_push ?? 0),
      matchAnalyzedSaveBlocked: Number(totals?.match_analyzed_save_blocked ?? 0),
    },
    llmDecisionDiagnostics: toBreakdown(diagnosticResult.rows),
    marketResolutionStatuses: toBreakdown(marketResult.rows),
    evidenceModes: toBreakdown(evidenceResult.rows),
    policyWarningKeys: toBreakdown(warningResult.rows),
    parseCrossBreakdown: crossResult.rows.map((row) => ({
      llmDecisionDiagnostic: row.llm_decision_diagnostic,
      marketResolutionStatus: row.market_resolution_status,
      policyBlocked: row.policy_blocked,
      evidenceMode: row.evidence_mode,
      count: Number(row.count),
      latestAt: nullableIso(row.latest_at),
    })),
    pipelineOutcomeBreakdown: outcomeResult.rows.map((row) => ({
      saved: row.saved,
      shouldPush: row.should_push,
      saveIntegrityStatus: row.save_integrity_status,
      saveProviderCoverageStatus: row.save_provider_coverage_status,
      llmDecisionDiagnostic: row.llm_decision_diagnostic,
      count: Number(row.count),
      latestAt: nullableIso(row.latest_at),
    })),
    recentSamples: sampleResult.rows.map((row) => {
      const metadata = parseMetadata(row.metadata);
      return {
        id: Number(row.id),
        timestamp: nullableIso(row.timestamp) ?? String(row.timestamp),
        action: row.action,
        outcome: row.outcome,
        matchId: asText(metadata['matchId'] ?? row.match_id),
        matchDisplay: asText(metadata['matchDisplay']),
        minute: asText(metadata['minute']),
        status: asText(metadata['status']),
        evidenceMode: asText(metadata['evidenceMode']),
        llmDecisionDiagnostic: asText(metadata['llmDecisionDiagnostic']),
        marketResolutionStatus: asText(metadata['marketResolutionStatus']),
        policyBlocked: asText(metadata['policyBlocked']),
        selection: asText(metadata['selection']),
        betMarket: asText(metadata['betMarket']),
        confidence: asText(metadata['confidence']),
        saveIntegrityStatus: asText(metadata['saveIntegrityStatus']),
        saveBlockedReason: asText(metadata['saveBlockedReason']),
        saveProviderCoverageStatus: asText(metadata['saveProviderCoverageStatus']),
        policyWarnings: parseStringArray(metadata['policyWarnings']),
        warnings: parseStringArray(metadata['warnings']),
        aiTextSample: truncate(asText(metadata['aiTextSample'])),
      };
    }),
  };
}

export function formatCurrentRuntimeNoSaveDiagnosticsMarkdown(
  report: CurrentRuntimeNoSaveDiagnosticsReport,
): string {
  const lines: string[] = [
    '# Current Runtime No-Save Diagnostics',
    '',
    `- Generated: ${report.generatedAt}`,
    `- Lookback hours: ${report.lookbackHours}`,
    `- Official prompt version: ${report.officialPromptVersion}`,
    `- Parse diagnostics: ${report.totals.parseDiagnostics}`,
    `- Parse actionable: ${report.totals.parseActionable}`,
    `- Parse skipped: ${report.totals.parseSkipped}`,
    `- Match analyzed: ${report.totals.matchAnalyzed}`,
    `- Match analyzed saved: ${report.totals.matchAnalyzedSaved}`,
    `- Match analyzed should push: ${report.totals.matchAnalyzedShouldPush}`,
    `- Match analyzed save blocked: ${report.totals.matchAnalyzedSaveBlocked}`,
    '',
    '## LLM Decision Diagnostics',
    '',
    '| Diagnostic | Count | Latest at |',
    '| --- | ---: | --- |',
  ];
  const addBreakdown = (rows: RuntimeNoSaveBreakdownRow[]) => {
    if (rows.length === 0) {
      lines.push('| (none) | 0 |  |');
    } else {
      for (const row of rows) lines.push(`| ${row.key} | ${row.count} | ${row.latestAt ?? ''} |`);
    }
  };
  addBreakdown(report.llmDecisionDiagnostics);
  lines.push('', '## Market Resolution', '', '| Status | Count | Latest at |', '| --- | ---: | --- |');
  addBreakdown(report.marketResolutionStatuses);
  lines.push('', '## Evidence Modes', '', '| Mode | Count | Latest at |', '| --- | ---: | --- |');
  addBreakdown(report.evidenceModes);
  lines.push('', '## Policy Warnings', '', '| Warning | Count | Latest at |', '| --- | ---: | --- |');
  addBreakdown(report.policyWarningKeys);

  lines.push('', '## Parse Cross Breakdown', '', '| Diagnostic | Market status | Policy blocked | Evidence mode | Count | Latest at |', '| --- | --- | --- | --- | ---: | --- |');
  if (report.parseCrossBreakdown.length === 0) {
    lines.push('| (none) |  |  |  | 0 |  |');
  } else {
    for (const row of report.parseCrossBreakdown) {
      lines.push(`| ${row.llmDecisionDiagnostic} | ${row.marketResolutionStatus} | ${row.policyBlocked} | ${row.evidenceMode} | ${row.count} | ${row.latestAt ?? ''} |`);
    }
  }

  lines.push('', '## Pipeline Outcome Breakdown', '', '| Saved | Should push | Save integrity | Provider coverage | Diagnostic | Count | Latest at |', '| --- | --- | --- | --- | --- | ---: | --- |');
  if (report.pipelineOutcomeBreakdown.length === 0) {
    lines.push('| (none) |  |  |  |  | 0 |  |');
  } else {
    for (const row of report.pipelineOutcomeBreakdown) {
      lines.push(`| ${row.saved} | ${row.shouldPush} | ${row.saveIntegrityStatus} | ${row.saveProviderCoverageStatus} | ${row.llmDecisionDiagnostic} | ${row.count} | ${row.latestAt ?? ''} |`);
    }
  }

  lines.push('', '## Recent Samples', '', '| ID | Timestamp | Action | Match | Diagnostic | Market status | Policy blocked | Selection | Warnings |', '| ---: | --- | --- | --- | --- | --- | --- | --- | --- |');
  if (report.recentSamples.length === 0) {
    lines.push('|  | (none) |  |  |  |  |  |  |  |');
  } else {
    for (const row of report.recentSamples.slice(0, 50)) {
      const warnings = [...row.policyWarnings, ...row.warnings].slice(0, 6).join('; ');
      lines.push(`| ${row.id} | ${row.timestamp} | ${row.action} | ${row.matchDisplay || row.matchId} | ${row.llmDecisionDiagnostic} | ${row.marketResolutionStatus} | ${row.policyBlocked} | ${row.selection} | ${warnings} |`);
    }
  }
  lines.push('');
  return `${lines.join('\n')}\n`;
}
