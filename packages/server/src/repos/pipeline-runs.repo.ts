// ============================================================
// Pipeline Runs Repository
// ============================================================

import { query } from '../db/pool.js';

export interface PipelineRunRow {
  id: number;
  started_at: string;
  finished_at: string | null;
  triggered_by: string;
  status: string;
  matches_count: number;
  analyzed: number;
  notified: number;
  saved: number;
  error: string | null;
}

export async function createRun(triggeredBy: string = 'manual'): Promise<PipelineRunRow> {
  const r = await query<PipelineRunRow>(
    `INSERT INTO pipeline_runs (triggered_by) VALUES ($1) RETURNING *`,
    [triggeredBy],
  );
  return r.rows[0]!;
}

export async function completeRun(
  id: number,
  stats: { matches_count: number; analyzed: number; notified: number; saved: number },
): Promise<PipelineRunRow> {
  const r = await query<PipelineRunRow>(
    `UPDATE pipeline_runs
     SET status = 'complete', finished_at = NOW(),
         matches_count = $2, analyzed = $3, notified = $4, saved = $5
     WHERE id = $1 RETURNING *`,
    [id, stats.matches_count, stats.analyzed, stats.notified, stats.saved],
  );
  return r.rows[0]!;
}

export async function failRun(id: number, error: string): Promise<PipelineRunRow> {
  const r = await query<PipelineRunRow>(
    `UPDATE pipeline_runs
     SET status = 'error', finished_at = NOW(), error = $2
     WHERE id = $1 RETURNING *`,
    [id, error],
  );
  return r.rows[0]!;
}

export async function getRecentRuns(limit: number = 20): Promise<PipelineRunRow[]> {
  const r = await query<PipelineRunRow>(
    'SELECT * FROM pipeline_runs ORDER BY started_at DESC LIMIT $1',
    [limit],
  );
  return r.rows;
}
