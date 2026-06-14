import { query } from '../db/pool.js';

export interface ProviderRequestLedgerInput {
  provider: string;
  jobName?: string | null;
  consumer?: string | null;
  endpoint: string;
  params?: Record<string, unknown>;
  attempt: number;
  success: boolean;
  rateLimited?: boolean;
  statusCode?: number | null;
  latencyMs?: number | null;
  resultCount?: number | null;
  quotaCurrent?: number | null;
  quotaLimit?: number | null;
  error?: string | null;
  responseMeta?: Record<string, unknown>;
}

export async function recordProviderRequest(input: ProviderRequestLedgerInput): Promise<void> {
  await query(
    `INSERT INTO provider_request_ledger (
       provider, job_name, consumer, endpoint, params, attempt, success, rate_limited,
       status_code, latency_ms, result_count, quota_current, quota_limit, error, response_meta
     )
     VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15::jsonb)`,
    [
      input.provider,
      input.jobName ?? null,
      input.consumer ?? null,
      input.endpoint,
      JSON.stringify(input.params ?? {}),
      input.attempt,
      input.success,
      input.rateLimited === true,
      input.statusCode ?? null,
      input.latencyMs ?? null,
      input.resultCount ?? null,
      input.quotaCurrent ?? null,
      input.quotaLimit ?? null,
      input.error ? input.error.slice(0, 1000) : '',
      JSON.stringify(input.responseMeta ?? {}),
    ],
  );
}

export async function recordProviderRequestSafe(input: ProviderRequestLedgerInput): Promise<void> {
  try {
    await recordProviderRequest(input);
  } catch (err) {
    console.warn('[provider-request-ledger] Failed to record request:', err instanceof Error ? err.message : err);
  }
}
