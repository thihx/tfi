import { query } from '../db/pool.js';

export type JobRunStatus = 'success' | 'failure' | 'skipped';

export interface JobRunHistoryRow {
  id: number;
  job_name: string;
  scheduled_at: string;
  started_at: string;
  completed_at: string | null;
  status: JobRunStatus;
  skip_reason: string | null;
  lock_policy: string;
  degraded_locking: boolean;
  instance_id: string;
  lag_ms: number | null;
  duration_ms: number | null;
  error: string | null;
  summary: Record<string, unknown>;
  created_at: string;
}

export interface JobRunRecordInput {
  jobName: string;
  scheduledAt: string;
  startedAt: string;
  completedAt?: string | null;
  status: JobRunStatus;
  skipReason?: string | null;
  lockPolicy: string;
  degradedLocking: boolean;
  instanceId: string;
  lagMs?: number | null;
  durationMs?: number | null;
  error?: string | null;
  summary?: Record<string, unknown>;
}

export interface JobRunOverviewRow {
  jobName: string;
  totalRuns: number;
  successRuns: number;
  failureRuns: number;
  skippedRuns: number;
  degradedRuns: number;
  avgLagMs: number | null;
  avgDurationMs: number | null;
  lastStartedAt: string | null;
  lastCompletedAt: string | null;
  lastStatus: JobRunStatus | null;
}

export async function recordJobRun(input: JobRunRecordInput): Promise<void> {
  await query(
    `INSERT INTO job_run_history (
        job_name,
        scheduled_at,
        started_at,
        completed_at,
        status,
        skip_reason,
        lock_policy,
        degraded_locking,
        instance_id,
        lag_ms,
        duration_ms,
        error,
        summary
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::jsonb)`,
    [
      input.jobName,
      input.scheduledAt,
      input.startedAt,
      input.completedAt ?? null,
      input.status,
      input.skipReason ?? null,
      input.lockPolicy,
      input.degradedLocking,
      input.instanceId,
      input.lagMs ?? null,
      input.durationMs ?? null,
      input.error ?? null,
      JSON.stringify(input.summary ?? {}),
    ],
  );
}

export async function getRecentJobRuns(limit = 50, jobName?: string): Promise<JobRunHistoryRow[]> {
  const safeLimit = Math.min(Math.max(limit, 1), 200);
  const result = jobName
    ? await query<JobRunHistoryRow>(
      `SELECT *
         FROM job_run_history
        WHERE job_name = $1
        ORDER BY started_at DESC, id DESC
        LIMIT $2`,
      [jobName, safeLimit],
    )
    : await query<JobRunHistoryRow>(
      `SELECT *
         FROM job_run_history
        ORDER BY started_at DESC, id DESC
        LIMIT $1`,
      [safeLimit],
    );
  return result.rows;
}

export async function getJobRunOverview(windowHours = 24): Promise<JobRunOverviewRow[]> {
  const safeWindowHours = Math.max(windowHours, 1);
  const result = await query<{
    job_name: string;
    total_runs: string;
    success_runs: string;
    failure_runs: string;
    skipped_runs: string;
    degraded_runs: string;
    avg_lag_ms: string | null;
    avg_duration_ms: string | null;
    last_started_at: string | null;
    last_completed_at: string | null;
    last_status: JobRunStatus | null;
  }>(
    `WITH filtered AS (
       SELECT *
       FROM job_run_history
       WHERE started_at >= NOW() - INTERVAL '1 hour' * $1
     ),
     aggregate_rows AS (
       SELECT
         job_name,
         COUNT(*)::int AS total_runs,
         COUNT(*) FILTER (WHERE status = 'success')::int AS success_runs,
         COUNT(*) FILTER (WHERE status = 'failure')::int AS failure_runs,
         COUNT(*) FILTER (WHERE status = 'skipped')::int AS skipped_runs,
         COUNT(*) FILTER (WHERE degraded_locking)::int AS degraded_runs,
         ROUND(AVG(lag_ms)::numeric, 1)::text AS avg_lag_ms,
         ROUND(AVG(duration_ms)::numeric, 1)::text AS avg_duration_ms,
         MAX(started_at)::text AS last_started_at
       FROM filtered
       GROUP BY job_name
     )
     SELECT
       aggregate_rows.job_name,
       aggregate_rows.total_runs,
       aggregate_rows.success_runs,
       aggregate_rows.failure_runs,
       aggregate_rows.skipped_runs,
       aggregate_rows.degraded_runs,
       aggregate_rows.avg_lag_ms,
       aggregate_rows.avg_duration_ms,
       aggregate_rows.last_started_at,
       latest.completed_at::text AS last_completed_at,
       latest.status AS last_status
     FROM aggregate_rows
     LEFT JOIN LATERAL (
       SELECT status, completed_at
       FROM filtered
       WHERE filtered.job_name = aggregate_rows.job_name
       ORDER BY started_at DESC, id DESC
       LIMIT 1
     ) latest ON TRUE
     ORDER BY aggregate_rows.job_name`,
    [safeWindowHours],
  );

  return result.rows.map((row) => ({
    jobName: row.job_name,
    totalRuns: Number(row.total_runs),
    successRuns: Number(row.success_runs),
    failureRuns: Number(row.failure_runs),
    skippedRuns: Number(row.skipped_runs),
    degradedRuns: Number(row.degraded_runs),
    avgLagMs: row.avg_lag_ms == null ? null : Number(row.avg_lag_ms),
    avgDurationMs: row.avg_duration_ms == null ? null : Number(row.avg_duration_ms),
    lastStartedAt: row.last_started_at,
    lastCompletedAt: row.last_completed_at,
    lastStatus: row.last_status,
  }));
}

export async function purgeJobRuns(keepDays: number): Promise<number> {
  if (keepDays <= 0) return 0;
  const result = await query(
    `DELETE FROM job_run_history
     WHERE started_at < NOW() - INTERVAL '1 day' * $1`,
    [keepDays],
  );
  return result.rowCount ?? 0;
}
