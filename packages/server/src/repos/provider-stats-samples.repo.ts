import { query } from '../db/pool.js';

export interface ProviderStatsSampleRow {
  id: number;
  match_id: string;
  captured_at: string;
  match_minute: number | null;
  match_status: string;
  provider: string;
  consumer: string;
  success: boolean;
  latency_ms: number | null;
  status_code: number | null;
  error: string;
  raw_payload: unknown;
  normalized_payload: unknown;
  coverage_flags: unknown;
}

export interface CreateProviderStatsSampleInput {
  match_id: string;
  match_minute?: number | null;
  match_status?: string;
  provider: string;
  consumer?: string;
  success: boolean;
  latency_ms?: number | null;
  status_code?: number | null;
  error?: string;
  raw_payload?: unknown;
  normalized_payload?: unknown;
  coverage_flags?: unknown;
}

export async function createProviderStatsSample(
  sample: CreateProviderStatsSampleInput,
): Promise<ProviderStatsSampleRow> {
  const result = await query<ProviderStatsSampleRow>(
    `INSERT INTO provider_stats_samples
       (match_id, match_minute, match_status, provider, consumer, success, latency_ms, status_code, error,
        raw_payload, normalized_payload, coverage_flags)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
     RETURNING *`,
    [
      sample.match_id,
      sample.match_minute ?? null,
      sample.match_status ?? '',
      sample.provider,
      sample.consumer ?? 'unknown',
      sample.success,
      sample.latency_ms ?? null,
      sample.status_code ?? null,
      sample.error ?? '',
      JSON.stringify(sample.raw_payload ?? {}),
      JSON.stringify(sample.normalized_payload ?? {}),
      JSON.stringify(sample.coverage_flags ?? {}),
    ],
  );
  return result.rows[0]!;
}

export async function getProviderStatsSamplesByMatch(
  matchId: string,
  limit = 100,
): Promise<ProviderStatsSampleRow[]> {
  const result = await query<ProviderStatsSampleRow>(
    `SELECT * FROM provider_stats_samples
     WHERE match_id = $1
     ORDER BY captured_at DESC
     LIMIT $2`,
    [matchId, limit],
  );
  return result.rows;
}

export async function purgeProviderStatsSamples(keepDays: number): Promise<number> {
  if (keepDays <= 0) return 0;
  const result = await query(
    `DELETE FROM provider_stats_samples
     WHERE captured_at < NOW() - INTERVAL '1 day' * $1`,
    [keepDays],
  );
  return result.rowCount ?? 0;
}
