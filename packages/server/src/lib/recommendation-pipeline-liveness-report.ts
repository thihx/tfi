import { query } from '../db/pool.js';
import { LIVE_ANALYSIS_PROMPT_VERSION } from './live-analysis-prompt.js';

export interface RecommendationPipelineLivenessOptions {
  lookbackHours: number;
  maxRecentRows: number;
  jobName?: string;
}

export interface LivenessJobSummary {
  jobName: string;
  totalRuns: number;
  successRuns: number;
  failureRuns: number;
  skippedRuns: number;
  degradedRuns: number;
  latestStartedAt: string | null;
  latestCompletedAt: string | null;
  latestCompletedAgeHours: number | null;
  latestStatus: string | null;
  latestError: string | null;
}

export interface LivenessJobRunRow {
  id: number;
  jobName: string;
  startedAt: string;
  completedAt: string | null;
  status: string;
  skipReason: string | null;
  degradedLocking: boolean;
  durationMs: number | null;
  error: string | null;
  summary: Record<string, unknown>;
}

export interface LivenessPipelineAuditSummary {
  totalEvents: number;
  completeEvents: number;
  latestCompleteAt: string | null;
  latestCompleteAgeHours: number | null;
  matchAnalyzedEvents: number;
  matchSkippedEvents: number;
  matchErrorEvents: number;
  savedFromMatchAnalyzedEvents: number;
  latestCompleteMetadata: Record<string, unknown> | null;
}

export interface LivenessPipelineActionRow {
  action: string;
  outcome: string;
  count: number;
  latestAt: string | null;
}

export interface LivenessAuditPromptVersionRow {
  action: string;
  promptVersion: string;
  count: number;
  latestAt: string | null;
}

export interface LivenessRecommendationSummary {
  totalRows: number;
  latestRowAt: string | null;
  latestRowAgeHours: number | null;
  officialPromptRows: number;
  latestOfficialPromptRowAt: string | null;
  latestOfficialPromptRowAgeHours: number | null;
  nonOfficialPromptRows: number;
}

export interface RecommendationPipelineLivenessReport {
  generatedAt: string;
  lookbackHours: number;
  jobName: string;
  officialPromptVersion: string;
  job: LivenessJobSummary;
  recentJobRuns: LivenessJobRunRow[];
  pipelineAudit: LivenessPipelineAuditSummary;
  pipelineActions: LivenessPipelineActionRow[];
  auditPromptVersions: LivenessAuditPromptVersionRow[];
  recommendations: LivenessRecommendationSummary;
  diagnosis: {
    jobHasRecentRuns: boolean;
    pipelineHasRecentComplete: boolean;
    recommendationsHaveRecentRows: boolean;
    officialPromptObserved: boolean;
  };
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

function nullableNumber(value: unknown): number | null {
  if (value == null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function parseJsonRecord(value: unknown): Record<string, unknown> {
  if (value == null) return {};
  if (typeof value === 'string') {
    try {
      return asRecord(JSON.parse(value)) ?? {};
    } catch {
      return {};
    }
  }
  return asRecord(value) ?? {};
}

export async function buildRecommendationPipelineLivenessReport(
  options: RecommendationPipelineLivenessOptions,
): Promise<RecommendationPipelineLivenessReport> {
  const lookbackHours = clampPositiveInt(options.lookbackHours, 1, 24 * 365);
  const maxRecentRows = clampPositiveInt(options.maxRecentRows, 1, 200);
  const jobName = options.jobName?.trim() || 'check-live-trigger';
  const official = LIVE_ANALYSIS_PROMPT_VERSION;

  const [
    jobSummaryResult,
    recentJobRunsResult,
    pipelineSummaryResult,
    pipelineActionsResult,
    auditPromptVersionsResult,
    recommendationSummaryResult,
  ] = await Promise.all([
    query<{
      total_runs: string;
      success_runs: string;
      failure_runs: string;
      skipped_runs: string;
      degraded_runs: string;
      latest_started_at: Date | string | null;
      latest_completed_at: Date | string | null;
      latest_completed_age_hours: string | null;
      latest_status: string | null;
      latest_error: string | null;
    }>(
      `WITH filtered AS (
         SELECT *
         FROM job_run_history
         WHERE job_name = $2
           AND started_at >= NOW() - ($1::int * INTERVAL '1 hour')
       ),
       aggregate_rows AS (
         SELECT
           COUNT(*)::text AS total_runs,
           COUNT(*) FILTER (WHERE status = 'success')::text AS success_runs,
           COUNT(*) FILTER (WHERE status = 'failure')::text AS failure_runs,
           COUNT(*) FILTER (WHERE status = 'skipped')::text AS skipped_runs,
           COUNT(*) FILTER (WHERE degraded_locking)::text AS degraded_runs,
           MAX(started_at) AS latest_started_at,
           MAX(completed_at) AS latest_completed_at,
           EXTRACT(EPOCH FROM (NOW() - MAX(completed_at))) / 3600 AS latest_completed_age_hours
         FROM filtered
       )
       SELECT
         aggregate_rows.*,
         latest.status AS latest_status,
         latest.error AS latest_error
       FROM aggregate_rows
       LEFT JOIN LATERAL (
         SELECT status, error
         FROM filtered
         ORDER BY started_at DESC, id DESC
         LIMIT 1
       ) latest ON TRUE`,
      [lookbackHours, jobName],
    ),
    query<{
      id: string;
      job_name: string;
      started_at: Date | string;
      completed_at: Date | string | null;
      status: string;
      skip_reason: string | null;
      degraded_locking: boolean;
      duration_ms: number | null;
      error: string | null;
      summary: Record<string, unknown> | string | null;
    }>(
      `SELECT
         id::text,
         job_name,
         started_at,
         completed_at,
         status,
         skip_reason,
         degraded_locking,
         duration_ms,
         error,
         summary
       FROM job_run_history
       WHERE job_name = $2
         AND started_at >= NOW() - ($1::int * INTERVAL '1 hour')
       ORDER BY started_at DESC, id DESC
       LIMIT $3`,
      [lookbackHours, jobName, maxRecentRows],
    ),
    query<{
      total_events: string;
      complete_events: string;
      latest_complete_at: Date | string | null;
      latest_complete_age_hours: string | null;
      analyzed_events: string;
      skipped_events: string;
      error_events: string;
      saved_from_analyzed_events: string;
      latest_complete_metadata: Record<string, unknown> | string | null;
    }>(
      `WITH filtered AS (
         SELECT *
         FROM audit_logs
         WHERE category = 'PIPELINE'
           AND timestamp >= NOW() - ($1::int * INTERVAL '1 hour')
       ),
       latest_complete AS (
         SELECT timestamp, metadata
         FROM filtered
         WHERE action = 'PIPELINE_COMPLETE'
         ORDER BY timestamp DESC, id DESC
         LIMIT 1
       )
       SELECT
         COUNT(*)::text AS total_events,
         COUNT(*) FILTER (WHERE action = 'PIPELINE_COMPLETE')::text AS complete_events,
         MAX(timestamp) FILTER (WHERE action = 'PIPELINE_COMPLETE') AS latest_complete_at,
         EXTRACT(EPOCH FROM (NOW() - MAX(timestamp) FILTER (WHERE action = 'PIPELINE_COMPLETE'))) / 3600 AS latest_complete_age_hours,
         COUNT(*) FILTER (WHERE action = 'PIPELINE_MATCH_ANALYZED')::text AS analyzed_events,
         COUNT(*) FILTER (WHERE action = 'PIPELINE_MATCH_SKIPPED')::text AS skipped_events,
         COUNT(*) FILTER (WHERE action = 'PIPELINE_MATCH_ERROR')::text AS error_events,
         COUNT(*) FILTER (
           WHERE action = 'PIPELINE_MATCH_ANALYZED'
             AND metadata->>'saved' = 'true'
         )::text AS saved_from_analyzed_events,
         (SELECT metadata FROM latest_complete) AS latest_complete_metadata
       FROM filtered`,
      [lookbackHours],
    ),
    query<{
      action: string;
      outcome: string;
      count: string;
      latest_at: Date | string | null;
    }>(
      `SELECT
         action,
         outcome,
         COUNT(*)::text AS count,
         MAX(timestamp) AS latest_at
       FROM audit_logs
       WHERE category = 'PIPELINE'
         AND timestamp >= NOW() - ($1::int * INTERVAL '1 hour')
       GROUP BY action, outcome
       ORDER BY COUNT(*) DESC, action, outcome
       LIMIT 25`,
      [lookbackHours],
    ),
    query<{
      action: string;
      prompt_version: string;
      count: string;
      latest_at: Date | string | null;
    }>(
      `SELECT
         action,
         COALESCE(NULLIF(metadata->>'promptVersion', ''), '(empty)') AS prompt_version,
         COUNT(*)::text AS count,
         MAX(timestamp) AS latest_at
       FROM audit_logs
       WHERE category = 'PIPELINE'
         AND action IN (
           'LLM_CALL_STARTED',
           'LLM_CALL_COMPLETED',
           'LLM_CALL_BLOCKED',
           'LLM_PARSE_DIAGNOSTIC',
           'PIPELINE_MATCH_ANALYZED'
         )
         AND timestamp >= NOW() - ($1::int * INTERVAL '1 hour')
       GROUP BY action, COALESCE(NULLIF(metadata->>'promptVersion', ''), '(empty)')
       ORDER BY COUNT(*) DESC, action, prompt_version
       LIMIT 50`,
      [lookbackHours],
    ),
    query<{
      total_rows: string;
      latest_row_at: Date | string | null;
      latest_row_age_hours: string | null;
      official_prompt_rows: string;
      latest_official_prompt_row_at: Date | string | null;
      latest_official_prompt_row_age_hours: string | null;
      non_official_prompt_rows: string;
    }>(
      `SELECT
         COUNT(*)::text AS total_rows,
         MAX(timestamp) AS latest_row_at,
         EXTRACT(EPOCH FROM (NOW() - MAX(timestamp))) / 3600 AS latest_row_age_hours,
         COUNT(*) FILTER (
           WHERE COALESCE(NULLIF(prompt_version, ''), '') = $2
         )::text AS official_prompt_rows,
         MAX(timestamp) FILTER (
           WHERE COALESCE(NULLIF(prompt_version, ''), '') = $2
         ) AS latest_official_prompt_row_at,
         EXTRACT(EPOCH FROM (NOW() - MAX(timestamp) FILTER (
           WHERE COALESCE(NULLIF(prompt_version, ''), '') = $2
         ))) / 3600 AS latest_official_prompt_row_age_hours,
         COUNT(*) FILTER (
           WHERE COALESCE(NULLIF(prompt_version, ''), '') NOT IN ('', $2)
         )::text AS non_official_prompt_rows
       FROM recommendations
       WHERE timestamp >= NOW() - ($1::int * INTERVAL '1 hour')`,
      [lookbackHours, official],
    ),
  ]);

  const jobRow = jobSummaryResult.rows[0];
  const pipelineRow = pipelineSummaryResult.rows[0];
  const recommendationRow = recommendationSummaryResult.rows[0];

  const job: LivenessJobSummary = {
    jobName,
    totalRuns: Number(jobRow?.total_runs ?? 0),
    successRuns: Number(jobRow?.success_runs ?? 0),
    failureRuns: Number(jobRow?.failure_runs ?? 0),
    skippedRuns: Number(jobRow?.skipped_runs ?? 0),
    degradedRuns: Number(jobRow?.degraded_runs ?? 0),
    latestStartedAt: nullableIso(jobRow?.latest_started_at),
    latestCompletedAt: nullableIso(jobRow?.latest_completed_at),
    latestCompletedAgeHours: nullableNumber(jobRow?.latest_completed_age_hours),
    latestStatus: jobRow?.latest_status ?? null,
    latestError: jobRow?.latest_error ?? null,
  };
  const pipelineAudit: LivenessPipelineAuditSummary = {
    totalEvents: Number(pipelineRow?.total_events ?? 0),
    completeEvents: Number(pipelineRow?.complete_events ?? 0),
    latestCompleteAt: nullableIso(pipelineRow?.latest_complete_at),
    latestCompleteAgeHours: nullableNumber(pipelineRow?.latest_complete_age_hours),
    matchAnalyzedEvents: Number(pipelineRow?.analyzed_events ?? 0),
    matchSkippedEvents: Number(pipelineRow?.skipped_events ?? 0),
    matchErrorEvents: Number(pipelineRow?.error_events ?? 0),
    savedFromMatchAnalyzedEvents: Number(pipelineRow?.saved_from_analyzed_events ?? 0),
    latestCompleteMetadata: pipelineRow?.latest_complete_metadata == null
      ? null
      : parseJsonRecord(pipelineRow.latest_complete_metadata),
  };
  const recommendations: LivenessRecommendationSummary = {
    totalRows: Number(recommendationRow?.total_rows ?? 0),
    latestRowAt: nullableIso(recommendationRow?.latest_row_at),
    latestRowAgeHours: nullableNumber(recommendationRow?.latest_row_age_hours),
    officialPromptRows: Number(recommendationRow?.official_prompt_rows ?? 0),
    latestOfficialPromptRowAt: nullableIso(recommendationRow?.latest_official_prompt_row_at),
    latestOfficialPromptRowAgeHours: nullableNumber(recommendationRow?.latest_official_prompt_row_age_hours),
    nonOfficialPromptRows: Number(recommendationRow?.non_official_prompt_rows ?? 0),
  };

  return {
    generatedAt: new Date().toISOString(),
    lookbackHours,
    jobName,
    officialPromptVersion: official,
    job,
    recentJobRuns: recentJobRunsResult.rows.map((row) => ({
      id: Number(row.id),
      jobName: row.job_name,
      startedAt: nullableIso(row.started_at) ?? String(row.started_at),
      completedAt: nullableIso(row.completed_at),
      status: row.status,
      skipReason: row.skip_reason,
      degradedLocking: row.degraded_locking,
      durationMs: row.duration_ms,
      error: row.error,
      summary: parseJsonRecord(row.summary),
    })),
    pipelineAudit,
    pipelineActions: pipelineActionsResult.rows.map((row) => ({
      action: row.action,
      outcome: row.outcome,
      count: Number(row.count),
      latestAt: nullableIso(row.latest_at),
    })),
    auditPromptVersions: auditPromptVersionsResult.rows.map((row) => ({
      action: row.action,
      promptVersion: row.prompt_version,
      count: Number(row.count),
      latestAt: nullableIso(row.latest_at),
    })),
    recommendations,
    diagnosis: {
      jobHasRecentRuns: job.totalRuns > 0,
      pipelineHasRecentComplete: pipelineAudit.completeEvents > 0,
      recommendationsHaveRecentRows: recommendations.totalRows > 0,
      officialPromptObserved: recommendations.officialPromptRows > 0,
    },
  };
}

export function formatRecommendationPipelineLivenessMarkdown(
  report: RecommendationPipelineLivenessReport,
): string {
  const lines: string[] = [
    '# Recommendation Pipeline Liveness Report',
    '',
    `- Generated: ${report.generatedAt}`,
    `- Lookback hours: ${report.lookbackHours}`,
    `- Job: ${report.jobName}`,
    `- Official prompt version: ${report.officialPromptVersion}`,
    '',
    '## Diagnosis',
    '',
    `- Job has recent runs: ${report.diagnosis.jobHasRecentRuns ? 'yes' : 'no'}`,
    `- Pipeline has recent complete audit: ${report.diagnosis.pipelineHasRecentComplete ? 'yes' : 'no'}`,
    `- Recommendations have recent rows: ${report.diagnosis.recommendationsHaveRecentRows ? 'yes' : 'no'}`,
    `- Official prompt observed: ${report.diagnosis.officialPromptObserved ? 'yes' : 'no'}`,
    '',
    '## Job',
    '',
    `- Total runs: ${report.job.totalRuns}`,
    `- Success runs: ${report.job.successRuns}`,
    `- Failure runs: ${report.job.failureRuns}`,
    `- Skipped runs: ${report.job.skippedRuns}`,
    `- Degraded runs: ${report.job.degradedRuns}`,
    `- Latest started at: ${report.job.latestStartedAt ?? '(none)'}`,
    `- Latest completed at: ${report.job.latestCompletedAt ?? '(none)'}`,
    `- Latest completed age hours: ${report.job.latestCompletedAgeHours ?? '(none)'}`,
    `- Latest status: ${report.job.latestStatus ?? '(none)'}`,
    `- Latest error: ${report.job.latestError ?? '(none)'}`,
    '',
    '## Pipeline Audit',
    '',
    `- Total events: ${report.pipelineAudit.totalEvents}`,
    `- Complete events: ${report.pipelineAudit.completeEvents}`,
    `- Latest complete at: ${report.pipelineAudit.latestCompleteAt ?? '(none)'}`,
    `- Latest complete age hours: ${report.pipelineAudit.latestCompleteAgeHours ?? '(none)'}`,
    `- Match analyzed events: ${report.pipelineAudit.matchAnalyzedEvents}`,
    `- Match skipped events: ${report.pipelineAudit.matchSkippedEvents}`,
    `- Match error events: ${report.pipelineAudit.matchErrorEvents}`,
    `- Saved from analyzed events: ${report.pipelineAudit.savedFromMatchAnalyzedEvents}`,
    '',
    '## Recommendations',
    '',
    `- Total rows: ${report.recommendations.totalRows}`,
    `- Latest row at: ${report.recommendations.latestRowAt ?? '(none)'}`,
    `- Latest row age hours: ${report.recommendations.latestRowAgeHours ?? '(none)'}`,
    `- Official prompt rows: ${report.recommendations.officialPromptRows}`,
    `- Latest official prompt row at: ${report.recommendations.latestOfficialPromptRowAt ?? '(none)'}`,
    `- Latest official prompt row age hours: ${report.recommendations.latestOfficialPromptRowAgeHours ?? '(none)'}`,
    `- Non-official prompt rows: ${report.recommendations.nonOfficialPromptRows}`,
    '',
    '## Pipeline Actions',
    '',
    '| Action | Outcome | Count | Latest at |',
    '| --- | --- | ---: | --- |',
  ];
  if (report.pipelineActions.length === 0) {
    lines.push('| (none) |  | 0 |  |');
  } else {
    for (const row of report.pipelineActions) {
      lines.push(`| ${row.action} | ${row.outcome} | ${row.count} | ${row.latestAt ?? ''} |`);
    }
  }

  lines.push('', '## Audit Prompt Versions', '', '| Action | Prompt version | Count | Latest at |', '| --- | --- | ---: | --- |');
  if (report.auditPromptVersions.length === 0) {
    lines.push('| (none) |  | 0 |  |');
  } else {
    for (const row of report.auditPromptVersions) {
      lines.push(`| ${row.action} | ${row.promptVersion} | ${row.count} | ${row.latestAt ?? ''} |`);
    }
  }

  lines.push('', '## Recent Job Runs', '', '| ID | Started at | Completed at | Status | Duration ms | Summary |', '| ---: | --- | --- | --- | ---: | --- |');
  if (report.recentJobRuns.length === 0) {
    lines.push('|  | (none) |  |  |  |  |');
  } else {
    for (const row of report.recentJobRuns.slice(0, 25)) {
      lines.push(
        `| ${row.id} | ${row.startedAt} | ${row.completedAt ?? ''} | ${row.status} | ${row.durationMs ?? ''} | ${JSON.stringify(row.summary)} |`,
      );
    }
  }
  lines.push('');
  return `${lines.join('\n')}\n`;
}
