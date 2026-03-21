import { query } from '../db/pool.js';

export interface ProviderOddsSampleRow {
  id: number;
  match_id: string;
  captured_at: string;
  match_minute: number | null;
  match_status: string;
  provider: string;
  source: string;
  consumer: string;
  success: boolean;
  usable: boolean;
  latency_ms: number | null;
  status_code: number | null;
  error: string;
  raw_payload: unknown;
  normalized_payload: unknown;
  coverage_flags: unknown;
}

export interface CreateProviderOddsSampleInput {
  match_id: string;
  match_minute?: number | null;
  match_status?: string;
  provider: string;
  source?: string;
  consumer?: string;
  success: boolean;
  usable: boolean;
  latency_ms?: number | null;
  status_code?: number | null;
  error?: string;
  raw_payload?: unknown;
  normalized_payload?: unknown;
  coverage_flags?: unknown;
}

export async function createProviderOddsSample(
  sample: CreateProviderOddsSampleInput,
): Promise<ProviderOddsSampleRow> {
  const result = await query<ProviderOddsSampleRow>(
    `INSERT INTO provider_odds_samples
       (match_id, match_minute, match_status, provider, source, consumer, success, usable, latency_ms, status_code,
        error, raw_payload, normalized_payload, coverage_flags)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
     RETURNING *`,
    [
      sample.match_id,
      sample.match_minute ?? null,
      sample.match_status ?? '',
      sample.provider,
      sample.source ?? '',
      sample.consumer ?? 'unknown',
      sample.success,
      sample.usable,
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

export async function getProviderOddsSamplesByMatch(
  matchId: string,
  limit = 100,
): Promise<ProviderOddsSampleRow[]> {
  const result = await query<ProviderOddsSampleRow>(
    `SELECT * FROM provider_odds_samples
     WHERE match_id = $1
     ORDER BY captured_at DESC
     LIMIT $2`,
    [matchId, limit],
  );
  return result.rows;
}

export async function purgeProviderOddsSamples(keepDays: number): Promise<number> {
  if (keepDays <= 0) return 0;
  const result = await query(
    `DELETE FROM provider_odds_samples
     WHERE captured_at < NOW() - INTERVAL '1 day' * $1`,
    [keepDays],
  );
  return result.rowCount ?? 0;
}
