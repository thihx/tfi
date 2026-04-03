import { query } from '../db/pool.js';

export interface ProviderOddsCacheRow {
  match_id: string;
  odds_source: string;
  provider_source: string;
  response: unknown;
  coverage_flags: Record<string, unknown>;
  provider_trace: Record<string, unknown>;
  odds_fetched_at: string | null;
  cached_at: string;
  match_status: string;
  match_minute: number | null;
  freshness: string;
  degraded: boolean;
  last_refresh_error: string;
  has_1x2: boolean;
  has_ou: boolean;
  has_ah: boolean;
  has_btts: boolean;
}

export interface UpsertProviderOddsCacheInput {
  match_id: string;
  odds_source: string;
  provider_source?: string;
  response: unknown[];
  coverage_flags?: Record<string, unknown>;
  provider_trace?: Record<string, unknown>;
  odds_fetched_at?: string | null;
  cached_at?: string;
  match_status?: string;
  match_minute?: number | null;
  freshness?: string;
  degraded?: boolean;
  last_refresh_error?: string;
  has_1x2?: boolean;
  has_ou?: boolean;
  has_ah?: boolean;
  has_btts?: boolean;
}

export async function getProviderOddsCache(matchId: string): Promise<ProviderOddsCacheRow | null> {
  const result = await query<ProviderOddsCacheRow>(
    `SELECT * FROM provider_odds_cache
     WHERE match_id = $1`,
    [matchId],
  );
  return result.rows[0] ?? null;
}

export async function upsertProviderOddsCache(input: UpsertProviderOddsCacheInput): Promise<ProviderOddsCacheRow> {
  const result = await query<ProviderOddsCacheRow>(
    `INSERT INTO provider_odds_cache (
       match_id, odds_source, provider_source, response, coverage_flags, provider_trace,
       odds_fetched_at, cached_at, match_status, match_minute, freshness, degraded,
       last_refresh_error, has_1x2, has_ou, has_ah, has_btts
     )
     VALUES (
       $1, $2, $3, $4, $5, $6,
       $7::timestamptz, COALESCE($8::timestamptz, NOW()), $9, $10, $11, $12,
       $13, $14, $15, $16, $17
     )
     ON CONFLICT (match_id)
     DO UPDATE SET
       odds_source = EXCLUDED.odds_source,
       provider_source = EXCLUDED.provider_source,
       response = EXCLUDED.response,
       coverage_flags = EXCLUDED.coverage_flags,
       provider_trace = EXCLUDED.provider_trace,
       odds_fetched_at = EXCLUDED.odds_fetched_at,
       cached_at = EXCLUDED.cached_at,
       match_status = EXCLUDED.match_status,
       match_minute = EXCLUDED.match_minute,
       freshness = EXCLUDED.freshness,
       degraded = EXCLUDED.degraded,
       last_refresh_error = EXCLUDED.last_refresh_error,
       has_1x2 = EXCLUDED.has_1x2,
       has_ou = EXCLUDED.has_ou,
       has_ah = EXCLUDED.has_ah,
       has_btts = EXCLUDED.has_btts
     RETURNING *`,
    [
      input.match_id,
      input.odds_source,
      input.provider_source ?? 'none',
      JSON.stringify(input.response ?? []),
      JSON.stringify(input.coverage_flags ?? {}),
      JSON.stringify(input.provider_trace ?? {}),
      input.odds_fetched_at ?? null,
      input.cached_at ?? null,
      input.match_status ?? '',
      input.match_minute ?? null,
      input.freshness ?? 'missing',
      input.degraded ?? false,
      input.last_refresh_error ?? '',
      input.has_1x2 ?? false,
      input.has_ou ?? false,
      input.has_ah ?? false,
      input.has_btts ?? false,
    ],
  );
  return result.rows[0]!;
}

export async function purgeProviderOddsCache(keepDays: number): Promise<number> {
  if (keepDays <= 0) return 0;
  const result = await query(
    `DELETE FROM provider_odds_cache
     WHERE cached_at < NOW() - INTERVAL '1 day' * $1`,
    [keepDays],
  );
  return result.rowCount ?? 0;
}
