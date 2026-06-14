import { query } from '../db/pool.js';

export interface ProviderFixtureSampleRow {
  id: number;
  match_id: string | null;
  provider_fixture_id: string;
  captured_at: string;
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

export interface CreateProviderFixtureSampleInput {
  match_id?: string | null;
  provider_fixture_id: string;
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

export async function createProviderFixtureSample(
  sample: CreateProviderFixtureSampleInput,
): Promise<ProviderFixtureSampleRow> {
  const result = await query<ProviderFixtureSampleRow>(
    `INSERT INTO provider_fixture_samples
       (match_id, provider_fixture_id, provider, consumer, success, latency_ms, status_code, error,
        raw_payload, normalized_payload, coverage_flags)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10::jsonb, $11::jsonb)
     RETURNING *`,
    [
      sample.match_id ?? null,
      sample.provider_fixture_id,
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

export interface ProviderEventSampleRow {
  id: number;
  match_id: string | null;
  provider_fixture_id: string;
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

export interface CreateProviderEventSampleInput {
  match_id?: string | null;
  provider_fixture_id: string;
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

export async function createProviderEventSample(
  sample: CreateProviderEventSampleInput,
): Promise<ProviderEventSampleRow> {
  const result = await query<ProviderEventSampleRow>(
    `INSERT INTO provider_event_samples
       (match_id, provider_fixture_id, match_minute, match_status, provider, consumer, success, latency_ms,
        status_code, error, raw_payload, normalized_payload, coverage_flags)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12::jsonb, $13::jsonb)
     RETURNING *`,
    [
      sample.match_id ?? null,
      sample.provider_fixture_id,
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
