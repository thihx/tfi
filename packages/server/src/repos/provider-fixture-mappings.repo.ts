import { query } from '../db/pool.js';

export interface ProviderFixtureMappingRow {
  id: string;
  match_id: string;
  provider: string;
  provider_fixture_id: string;
  confidence: string;
  mapping_method: string;
  evidence: Record<string, unknown>;
  first_seen_at: string;
  last_seen_at: string;
}

export interface UpsertProviderFixtureMappingInput {
  match_id: string;
  provider: string;
  provider_fixture_id: string;
  confidence: string;
  mapping_method: string;
  evidence?: Record<string, unknown>;
}

export async function getProviderFixtureMapping(
  matchId: string,
  provider: string,
): Promise<ProviderFixtureMappingRow | null> {
  const result = await query<ProviderFixtureMappingRow>(
    `SELECT *
     FROM provider_fixture_mappings
     WHERE match_id = $1 AND provider = $2`,
    [matchId, provider],
  );
  return result.rows[0] ?? null;
}

export async function upsertProviderFixtureMapping(
  input: UpsertProviderFixtureMappingInput,
): Promise<ProviderFixtureMappingRow> {
  const result = await query<ProviderFixtureMappingRow>(
    `INSERT INTO provider_fixture_mappings (
       match_id, provider, provider_fixture_id, confidence, mapping_method, evidence
     )
     VALUES ($1, $2, $3, $4, $5, $6::jsonb)
     ON CONFLICT (match_id, provider)
     DO UPDATE SET
       provider_fixture_id = EXCLUDED.provider_fixture_id,
       confidence = EXCLUDED.confidence,
       mapping_method = EXCLUDED.mapping_method,
       evidence = EXCLUDED.evidence,
       last_seen_at = NOW()
     RETURNING *`,
    [
      input.match_id,
      input.provider,
      input.provider_fixture_id,
      input.confidence,
      input.mapping_method,
      JSON.stringify(input.evidence ?? {}),
    ],
  );
  return result.rows[0]!;
}
