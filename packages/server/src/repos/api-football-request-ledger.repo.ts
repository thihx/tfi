import { query } from '../db/pool.js';

export interface ApiFootballRequestLedgerInput {
  jobName?: string | null;
  consumer?: string | null;
  endpoint: string;
  params?: Record<string, string>;
  attempt: number;
  success: boolean;
  dailyLimit?: boolean;
  statusCode?: number | null;
  latencyMs?: number | null;
  resultCount?: number | null;
  quotaCurrent?: number | null;
  quotaLimit?: number | null;
  error?: string | null;
}

export async function recordApiFootballRequest(input: ApiFootballRequestLedgerInput): Promise<void> {
  await query(
    `INSERT INTO api_football_request_ledger (
       job_name, consumer, endpoint, params, attempt, success, daily_limit,
       status_code, latency_ms, result_count, quota_current, quota_limit, error
     )
     VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
    [
      input.jobName ?? null,
      input.consumer ?? null,
      input.endpoint,
      JSON.stringify(input.params ?? {}),
      input.attempt,
      input.success,
      input.dailyLimit === true,
      input.statusCode ?? null,
      input.latencyMs ?? null,
      input.resultCount ?? null,
      input.quotaCurrent ?? null,
      input.quotaLimit ?? null,
      input.error ? input.error.slice(0, 1000) : '',
    ],
  );
}

export async function recordApiFootballRequestSafe(input: ApiFootballRequestLedgerInput): Promise<void> {
  try {
    await recordApiFootballRequest(input);
  } catch (err) {
    console.warn('[api-football-ledger] Failed to record request:', err instanceof Error ? err.message : err);
  }
}
