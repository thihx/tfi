import { query } from '../db/pool.js';

export type PromptShadowExecutionRole = 'active' | 'shadow';

export interface PromptShadowRunRow {
  id: number;
  analysis_run_id: string;
  match_id: string;
  captured_at: string;
  execution_role: PromptShadowExecutionRole;
  active_prompt_version: string;
  prompt_version: string;
  analysis_mode: string;
  evidence_mode: string;
  success: boolean;
  error: string;
  should_push: boolean;
  ai_should_push: boolean;
  selection: string;
  bet_market: string;
  confidence: number;
  warnings: unknown;
  odds_source: string;
  stats_source: string;
  prompt_estimated_tokens: number | null;
  response_estimated_tokens: number | null;
  llm_latency_ms: number | null;
  total_latency_ms: number | null;
}

export interface CreatePromptShadowRunInput {
  analysis_run_id: string;
  match_id: string;
  execution_role: PromptShadowExecutionRole;
  active_prompt_version: string;
  prompt_version: string;
  analysis_mode?: string;
  evidence_mode?: string;
  success?: boolean;
  error?: string;
  should_push?: boolean;
  ai_should_push?: boolean;
  selection?: string;
  bet_market?: string;
  confidence?: number;
  warnings?: unknown;
  odds_source?: string;
  stats_source?: string;
  prompt_estimated_tokens?: number | null;
  response_estimated_tokens?: number | null;
  llm_latency_ms?: number | null;
  total_latency_ms?: number | null;
}

export async function createPromptShadowRun(
  row: CreatePromptShadowRunInput,
): Promise<PromptShadowRunRow> {
  const result = await query<PromptShadowRunRow>(
    `INSERT INTO prompt_shadow_runs (
       analysis_run_id, match_id, execution_role, active_prompt_version, prompt_version,
       analysis_mode, evidence_mode, success, error, should_push, ai_should_push,
       selection, bet_market, confidence, warnings, odds_source, stats_source,
       prompt_estimated_tokens, response_estimated_tokens, llm_latency_ms, total_latency_ms
     )
     VALUES (
       $1, $2, $3, $4, $5,
       $6, $7, $8, $9, $10, $11,
       $12, $13, $14, $15::jsonb, $16, $17,
       $18, $19, $20, $21
     )
     RETURNING *`,
    [
      row.analysis_run_id,
      row.match_id,
      row.execution_role,
      row.active_prompt_version,
      row.prompt_version,
      row.analysis_mode ?? '',
      row.evidence_mode ?? '',
      row.success ?? true,
      row.error ?? '',
      row.should_push ?? false,
      row.ai_should_push ?? false,
      row.selection ?? '',
      row.bet_market ?? '',
      row.confidence ?? 0,
      JSON.stringify(row.warnings ?? []),
      row.odds_source ?? '',
      row.stats_source ?? '',
      row.prompt_estimated_tokens ?? null,
      row.response_estimated_tokens ?? null,
      row.llm_latency_ms ?? null,
      row.total_latency_ms ?? null,
    ],
  );
  return result.rows[0]!;
}

export async function purgePromptShadowRuns(keepDays: number): Promise<number> {
  if (keepDays <= 0) return 0;
  const result = await query(
    `DELETE FROM prompt_shadow_runs
     WHERE captured_at < NOW() - INTERVAL '1 day' * $1`,
    [keepDays],
  );
  return result.rowCount ?? 0;
}
