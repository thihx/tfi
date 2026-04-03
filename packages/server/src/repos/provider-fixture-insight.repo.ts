import { query } from '../db/pool.js';

export interface ProviderFixtureCacheRow {
  match_id: string;
  fixture_payload: unknown;
  fixture_fetched_at: string | null;
  cached_at: string;
  match_status: string;
  match_minute: number | null;
  freshness: string;
  degraded: boolean;
  last_refresh_error: string;
}

export interface ProviderFixtureStatsCacheRow {
  match_id: string;
  statistics_payload: unknown;
  coverage_flags: Record<string, unknown>;
  stats_fetched_at: string | null;
  cached_at: string;
  match_status: string;
  match_minute: number | null;
  freshness: string;
  degraded: boolean;
  last_refresh_error: string;
}

export interface ProviderFixtureEventsCacheRow {
  match_id: string;
  events_payload: unknown;
  coverage_flags: Record<string, unknown>;
  events_fetched_at: string | null;
  cached_at: string;
  match_status: string;
  match_minute: number | null;
  freshness: string;
  degraded: boolean;
  last_refresh_error: string;
}

export interface ProviderFixtureLineupsCacheRow {
  match_id: string;
  lineups_payload: unknown;
  coverage_flags: Record<string, unknown>;
  lineups_fetched_at: string | null;
  cached_at: string;
  match_status: string;
  match_minute: number | null;
  freshness: string;
  degraded: boolean;
  last_refresh_error: string;
}

export interface ProviderFixturePredictionCacheRow {
  match_id: string;
  prediction_payload: unknown;
  prediction_fetched_at: string | null;
  cached_at: string;
  match_status: string;
  freshness: string;
  degraded: boolean;
  last_refresh_error: string;
}

export interface ProviderLeagueStandingsCacheRow {
  league_id: number;
  season: number;
  standings_payload: unknown;
  standings_fetched_at: string | null;
  cached_at: string;
  freshness: string;
  degraded: boolean;
  last_refresh_error: string;
}

export interface UpsertProviderFixtureCacheInput {
  match_id: string;
  fixture_payload: unknown;
  fixture_fetched_at?: string | null;
  cached_at?: string | null;
  match_status?: string;
  match_minute?: number | null;
  freshness?: string;
  degraded?: boolean;
  last_refresh_error?: string;
}

export interface UpsertProviderFixtureStatsCacheInput {
  match_id: string;
  statistics_payload: unknown[];
  coverage_flags?: Record<string, unknown>;
  stats_fetched_at?: string | null;
  cached_at?: string | null;
  match_status?: string;
  match_minute?: number | null;
  freshness?: string;
  degraded?: boolean;
  last_refresh_error?: string;
}

export interface UpsertProviderFixtureEventsCacheInput {
  match_id: string;
  events_payload: unknown[];
  coverage_flags?: Record<string, unknown>;
  events_fetched_at?: string | null;
  cached_at?: string | null;
  match_status?: string;
  match_minute?: number | null;
  freshness?: string;
  degraded?: boolean;
  last_refresh_error?: string;
}

export interface UpsertProviderFixtureLineupsCacheInput {
  match_id: string;
  lineups_payload: unknown[];
  coverage_flags?: Record<string, unknown>;
  lineups_fetched_at?: string | null;
  cached_at?: string | null;
  match_status?: string;
  match_minute?: number | null;
  freshness?: string;
  degraded?: boolean;
  last_refresh_error?: string;
}

export interface UpsertProviderFixturePredictionCacheInput {
  match_id: string;
  prediction_payload: unknown;
  prediction_fetched_at?: string | null;
  cached_at?: string | null;
  match_status?: string;
  freshness?: string;
  degraded?: boolean;
  last_refresh_error?: string;
}

export interface UpsertProviderLeagueStandingsCacheInput {
  league_id: number;
  season: number;
  standings_payload: unknown[];
  standings_fetched_at?: string | null;
  cached_at?: string | null;
  freshness?: string;
  degraded?: boolean;
  last_refresh_error?: string;
}

export async function getProviderFixtureCache(matchId: string): Promise<ProviderFixtureCacheRow | null> {
  const result = await query<ProviderFixtureCacheRow>(
    `SELECT * FROM provider_fixture_cache
     WHERE match_id = $1`,
    [matchId],
  );
  return result.rows[0] ?? null;
}

export async function getProviderFixtureCaches(matchIds: string[]): Promise<ProviderFixtureCacheRow[]> {
  if (matchIds.length === 0) return [];
  const result = await query<ProviderFixtureCacheRow>(
    `SELECT * FROM provider_fixture_cache
     WHERE match_id = ANY($1)`,
    [matchIds],
  );
  return result.rows;
}

export async function upsertProviderFixtureCache(input: UpsertProviderFixtureCacheInput): Promise<ProviderFixtureCacheRow> {
  const result = await query<ProviderFixtureCacheRow>(
    `INSERT INTO provider_fixture_cache (
       match_id, fixture_payload, fixture_fetched_at, cached_at,
       match_status, match_minute, freshness, degraded, last_refresh_error
     )
     VALUES (
       $1, $2::jsonb, $3::timestamptz, COALESCE($4::timestamptz, NOW()),
       $5, $6, $7, $8, $9
     )
     ON CONFLICT (match_id)
     DO UPDATE SET
       fixture_payload = EXCLUDED.fixture_payload,
       fixture_fetched_at = EXCLUDED.fixture_fetched_at,
       cached_at = EXCLUDED.cached_at,
       match_status = EXCLUDED.match_status,
       match_minute = EXCLUDED.match_minute,
       freshness = EXCLUDED.freshness,
       degraded = EXCLUDED.degraded,
       last_refresh_error = EXCLUDED.last_refresh_error
     RETURNING *`,
    [
      input.match_id,
      JSON.stringify(input.fixture_payload ?? {}),
      input.fixture_fetched_at ?? null,
      input.cached_at ?? null,
      input.match_status ?? '',
      input.match_minute ?? null,
      input.freshness ?? 'fresh',
      input.degraded ?? false,
      input.last_refresh_error ?? '',
    ],
  );
  return result.rows[0]!;
}

export async function getProviderFixtureStatsCache(matchId: string): Promise<ProviderFixtureStatsCacheRow | null> {
  const result = await query<ProviderFixtureStatsCacheRow>(
    `SELECT * FROM provider_fixture_stats_cache
     WHERE match_id = $1`,
    [matchId],
  );
  return result.rows[0] ?? null;
}

export async function getProviderFixtureStatsCaches(matchIds: string[]): Promise<ProviderFixtureStatsCacheRow[]> {
  if (matchIds.length === 0) return [];
  const result = await query<ProviderFixtureStatsCacheRow>(
    `SELECT * FROM provider_fixture_stats_cache
     WHERE match_id = ANY($1)`,
    [matchIds],
  );
  return result.rows;
}

export async function upsertProviderFixtureStatsCache(input: UpsertProviderFixtureStatsCacheInput): Promise<ProviderFixtureStatsCacheRow> {
  const result = await query<ProviderFixtureStatsCacheRow>(
    `INSERT INTO provider_fixture_stats_cache (
       match_id, statistics_payload, coverage_flags, stats_fetched_at, cached_at,
       match_status, match_minute, freshness, degraded, last_refresh_error
     )
     VALUES (
       $1, $2::jsonb, $3::jsonb, $4::timestamptz, COALESCE($5::timestamptz, NOW()),
       $6, $7, $8, $9, $10
     )
     ON CONFLICT (match_id)
     DO UPDATE SET
       statistics_payload = EXCLUDED.statistics_payload,
       coverage_flags = EXCLUDED.coverage_flags,
       stats_fetched_at = EXCLUDED.stats_fetched_at,
       cached_at = EXCLUDED.cached_at,
       match_status = EXCLUDED.match_status,
       match_minute = EXCLUDED.match_minute,
       freshness = EXCLUDED.freshness,
       degraded = EXCLUDED.degraded,
       last_refresh_error = EXCLUDED.last_refresh_error
     RETURNING *`,
    [
      input.match_id,
      JSON.stringify(input.statistics_payload ?? []),
      JSON.stringify(input.coverage_flags ?? {}),
      input.stats_fetched_at ?? null,
      input.cached_at ?? null,
      input.match_status ?? '',
      input.match_minute ?? null,
      input.freshness ?? 'fresh',
      input.degraded ?? false,
      input.last_refresh_error ?? '',
    ],
  );
  return result.rows[0]!;
}

export async function getProviderFixtureEventsCache(matchId: string): Promise<ProviderFixtureEventsCacheRow | null> {
  const result = await query<ProviderFixtureEventsCacheRow>(
    `SELECT * FROM provider_fixture_events_cache
     WHERE match_id = $1`,
    [matchId],
  );
  return result.rows[0] ?? null;
}

export async function upsertProviderFixtureEventsCache(input: UpsertProviderFixtureEventsCacheInput): Promise<ProviderFixtureEventsCacheRow> {
  const result = await query<ProviderFixtureEventsCacheRow>(
    `INSERT INTO provider_fixture_events_cache (
       match_id, events_payload, coverage_flags, events_fetched_at, cached_at,
       match_status, match_minute, freshness, degraded, last_refresh_error
     )
     VALUES (
       $1, $2::jsonb, $3::jsonb, $4::timestamptz, COALESCE($5::timestamptz, NOW()),
       $6, $7, $8, $9, $10
     )
     ON CONFLICT (match_id)
     DO UPDATE SET
       events_payload = EXCLUDED.events_payload,
       coverage_flags = EXCLUDED.coverage_flags,
       events_fetched_at = EXCLUDED.events_fetched_at,
       cached_at = EXCLUDED.cached_at,
       match_status = EXCLUDED.match_status,
       match_minute = EXCLUDED.match_minute,
       freshness = EXCLUDED.freshness,
       degraded = EXCLUDED.degraded,
       last_refresh_error = EXCLUDED.last_refresh_error
     RETURNING *`,
    [
      input.match_id,
      JSON.stringify(input.events_payload ?? []),
      JSON.stringify(input.coverage_flags ?? {}),
      input.events_fetched_at ?? null,
      input.cached_at ?? null,
      input.match_status ?? '',
      input.match_minute ?? null,
      input.freshness ?? 'fresh',
      input.degraded ?? false,
      input.last_refresh_error ?? '',
    ],
  );
  return result.rows[0]!;
}

export async function getProviderFixtureLineupsCache(matchId: string): Promise<ProviderFixtureLineupsCacheRow | null> {
  const result = await query<ProviderFixtureLineupsCacheRow>(
    `SELECT * FROM provider_fixture_lineups_cache
     WHERE match_id = $1`,
    [matchId],
  );
  return result.rows[0] ?? null;
}

export async function upsertProviderFixtureLineupsCache(input: UpsertProviderFixtureLineupsCacheInput): Promise<ProviderFixtureLineupsCacheRow> {
  const result = await query<ProviderFixtureLineupsCacheRow>(
    `INSERT INTO provider_fixture_lineups_cache (
       match_id, lineups_payload, coverage_flags, lineups_fetched_at, cached_at,
       match_status, match_minute, freshness, degraded, last_refresh_error
     )
     VALUES (
       $1, $2::jsonb, $3::jsonb, $4::timestamptz, COALESCE($5::timestamptz, NOW()),
       $6, $7, $8, $9, $10
     )
     ON CONFLICT (match_id)
     DO UPDATE SET
       lineups_payload = EXCLUDED.lineups_payload,
       coverage_flags = EXCLUDED.coverage_flags,
       lineups_fetched_at = EXCLUDED.lineups_fetched_at,
       cached_at = EXCLUDED.cached_at,
       match_status = EXCLUDED.match_status,
       match_minute = EXCLUDED.match_minute,
       freshness = EXCLUDED.freshness,
       degraded = EXCLUDED.degraded,
       last_refresh_error = EXCLUDED.last_refresh_error
     RETURNING *`,
    [
      input.match_id,
      JSON.stringify(input.lineups_payload ?? []),
      JSON.stringify(input.coverage_flags ?? {}),
      input.lineups_fetched_at ?? null,
      input.cached_at ?? null,
      input.match_status ?? '',
      input.match_minute ?? null,
      input.freshness ?? 'fresh',
      input.degraded ?? false,
      input.last_refresh_error ?? '',
    ],
  );
  return result.rows[0]!;
}

export async function getProviderFixturePredictionCache(matchId: string): Promise<ProviderFixturePredictionCacheRow | null> {
  const result = await query<ProviderFixturePredictionCacheRow>(
    `SELECT * FROM provider_fixture_prediction_cache
     WHERE match_id = $1`,
    [matchId],
  );
  return result.rows[0] ?? null;
}

export async function upsertProviderFixturePredictionCache(input: UpsertProviderFixturePredictionCacheInput): Promise<ProviderFixturePredictionCacheRow> {
  const result = await query<ProviderFixturePredictionCacheRow>(
    `INSERT INTO provider_fixture_prediction_cache (
       match_id, prediction_payload, prediction_fetched_at, cached_at,
       match_status, freshness, degraded, last_refresh_error
     )
     VALUES (
       $1, $2::jsonb, $3::timestamptz, COALESCE($4::timestamptz, NOW()),
       $5, $6, $7, $8
     )
     ON CONFLICT (match_id)
     DO UPDATE SET
       prediction_payload = EXCLUDED.prediction_payload,
       prediction_fetched_at = EXCLUDED.prediction_fetched_at,
       cached_at = EXCLUDED.cached_at,
       match_status = EXCLUDED.match_status,
       freshness = EXCLUDED.freshness,
       degraded = EXCLUDED.degraded,
       last_refresh_error = EXCLUDED.last_refresh_error
    RETURNING *`,
    [
      input.match_id,
      JSON.stringify(input.prediction_payload ?? null),
      input.prediction_fetched_at ?? null,
      input.cached_at ?? null,
      input.match_status ?? '',
      input.freshness ?? 'fresh',
      input.degraded ?? false,
      input.last_refresh_error ?? '',
    ],
  );
  return result.rows[0]!;
}

export async function getProviderLeagueStandingsCache(leagueId: number, season: number): Promise<ProviderLeagueStandingsCacheRow | null> {
  const result = await query<ProviderLeagueStandingsCacheRow>(
    `SELECT * FROM provider_league_standings_cache
     WHERE league_id = $1 AND season = $2`,
    [leagueId, season],
  );
  return result.rows[0] ?? null;
}

export async function upsertProviderLeagueStandingsCache(input: UpsertProviderLeagueStandingsCacheInput): Promise<ProviderLeagueStandingsCacheRow> {
  const result = await query<ProviderLeagueStandingsCacheRow>(
    `INSERT INTO provider_league_standings_cache (
       league_id, season, standings_payload, standings_fetched_at, cached_at,
       freshness, degraded, last_refresh_error
     )
     VALUES (
       $1, $2, $3::jsonb, $4::timestamptz, COALESCE($5::timestamptz, NOW()),
       $6, $7, $8
     )
     ON CONFLICT (league_id, season)
     DO UPDATE SET
       standings_payload = EXCLUDED.standings_payload,
       standings_fetched_at = EXCLUDED.standings_fetched_at,
       cached_at = EXCLUDED.cached_at,
       freshness = EXCLUDED.freshness,
       degraded = EXCLUDED.degraded,
       last_refresh_error = EXCLUDED.last_refresh_error
     RETURNING *`,
    [
      input.league_id,
      input.season,
      JSON.stringify(input.standings_payload ?? []),
      input.standings_fetched_at ?? null,
      input.cached_at ?? null,
      input.freshness ?? 'fresh',
      input.degraded ?? false,
      input.last_refresh_error ?? '',
    ],
  );
  return result.rows[0]!;
}

export interface PurgeProviderFixtureCachesResult {
  fixtureDeleted: number;
  statsDeleted: number;
  eventsDeleted: number;
  lineupsDeleted: number;
  predictionDeleted: number;
  standingsDeleted: number;
  totalDeleted: number;
}

export async function purgeProviderFixtureCaches(keepDays: number): Promise<PurgeProviderFixtureCachesResult> {
  if (keepDays <= 0) {
    return {
      fixtureDeleted: 0,
      statsDeleted: 0,
      eventsDeleted: 0,
      lineupsDeleted: 0,
      predictionDeleted: 0,
      standingsDeleted: 0,
      totalDeleted: 0,
    };
  }

  const [
    fixtureResult,
    statsResult,
    eventsResult,
    lineupsResult,
    predictionResult,
    standingsResult,
  ] = await Promise.all([
    query(`DELETE FROM provider_fixture_cache WHERE cached_at < NOW() - INTERVAL '1 day' * $1`, [keepDays]),
    query(`DELETE FROM provider_fixture_stats_cache WHERE cached_at < NOW() - INTERVAL '1 day' * $1`, [keepDays]),
    query(`DELETE FROM provider_fixture_events_cache WHERE cached_at < NOW() - INTERVAL '1 day' * $1`, [keepDays]),
    query(`DELETE FROM provider_fixture_lineups_cache WHERE cached_at < NOW() - INTERVAL '1 day' * $1`, [keepDays]),
    query(`DELETE FROM provider_fixture_prediction_cache WHERE cached_at < NOW() - INTERVAL '1 day' * $1`, [keepDays]),
    query(`DELETE FROM provider_league_standings_cache WHERE cached_at < NOW() - INTERVAL '1 day' * $1`, [keepDays]),
  ]);

  const fixtureDeleted = fixtureResult.rowCount ?? 0;
  const statsDeleted = statsResult.rowCount ?? 0;
  const eventsDeleted = eventsResult.rowCount ?? 0;
  const lineupsDeleted = lineupsResult.rowCount ?? 0;
  const predictionDeleted = predictionResult.rowCount ?? 0;
  const standingsDeleted = standingsResult.rowCount ?? 0;

  return {
    fixtureDeleted,
    statsDeleted,
    eventsDeleted,
    lineupsDeleted,
    predictionDeleted,
    standingsDeleted,
    totalDeleted:
      fixtureDeleted
      + statsDeleted
      + eventsDeleted
      + lineupsDeleted
      + predictionDeleted
      + standingsDeleted,
  };
}
