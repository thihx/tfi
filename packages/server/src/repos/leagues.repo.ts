// ============================================================
// Leagues Repository
// ============================================================

import { query, transaction } from '../db/pool.js';

export interface LeagueRow {
  league_id: number;
  league_name: string;
  /** Optional UI override; provider name stays in `league_name`. */
  display_name: string | null;
  country: string;
  tier: string;
  active: boolean;
  top_league: boolean;
  type: string;
  logo: string;
  last_updated: string;
  /** Lower sorts first; set via reorder API. */
  sort_order: number;
  provider_synced_at?: string | null;
  has_profile?: boolean;
  profile_updated_at?: string | null;
  profile_volatility_tier?: string | null;
  profile_data_reliability_tier?: string | null;
}

export async function getAllLeagues(): Promise<LeagueRow[]> {
  const result = await query<LeagueRow>(
    `SELECT
       l.*,
       (lp.league_id IS NOT NULL) AS has_profile,
       lp.updated_at AS profile_updated_at,
       (lp.profile->>'volatility_tier') AS profile_volatility_tier,
       (lp.profile->>'data_reliability_tier') AS profile_data_reliability_tier
     FROM leagues l
     LEFT JOIN league_profiles lp ON lp.league_id = l.league_id
     ORDER BY l.sort_order ASC, l.league_name ASC`,
  );
  return result.rows;
}

export async function getActiveLeagues(): Promise<LeagueRow[]> {
  const result = await query<LeagueRow>(
    `SELECT
       l.*,
       (lp.league_id IS NOT NULL) AS has_profile,
       lp.updated_at AS profile_updated_at,
       (lp.profile->>'volatility_tier') AS profile_volatility_tier,
       (lp.profile->>'data_reliability_tier') AS profile_data_reliability_tier
     FROM leagues l
     LEFT JOIN league_profiles lp ON lp.league_id = l.league_id
     WHERE l.active = TRUE
     ORDER BY l.sort_order ASC, l.league_name ASC`,
  );
  return result.rows;
}

export async function getLeagueById(leagueId: number): Promise<LeagueRow | null> {
  const result = await query<LeagueRow>(
    `SELECT
       l.*,
       (lp.league_id IS NOT NULL) AS has_profile,
       lp.updated_at AS profile_updated_at,
       (lp.profile->>'volatility_tier') AS profile_volatility_tier,
       (lp.profile->>'data_reliability_tier') AS profile_data_reliability_tier
     FROM leagues l
     LEFT JOIN league_profiles lp ON lp.league_id = l.league_id
     WHERE l.league_id = $1`,
    [leagueId],
  );
  return result.rows[0] ?? null;
}

export async function getTopLeagues(): Promise<LeagueRow[]> {
  const result = await query<LeagueRow>(
    `SELECT
       l.*,
       (lp.league_id IS NOT NULL) AS has_profile,
       lp.updated_at AS profile_updated_at,
       (lp.profile->>'volatility_tier') AS profile_volatility_tier,
       (lp.profile->>'data_reliability_tier') AS profile_data_reliability_tier
     FROM leagues l
     LEFT JOIN league_profiles lp ON lp.league_id = l.league_id
     WHERE l.top_league = TRUE AND l.active = TRUE
     ORDER BY l.sort_order ASC, l.league_name ASC`,
  );
  return result.rows;
}

export async function upsertLeagues(
  leagues: Partial<LeagueRow>[],
  options: { touchProviderSyncAt?: boolean } = {},
): Promise<number> {
  return transaction(async (client) => {
    let count = 0;
    for (const l of leagues) {
      if (l.league_id == null) continue;
      await client.query(
        `INSERT INTO leagues (league_id, league_name, country, tier, active, top_league, type, logo, last_updated, provider_synced_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), CASE WHEN $9 THEN NOW() ELSE NULL END)
         ON CONFLICT (league_id) DO UPDATE SET
           league_name = COALESCE(NULLIF($2,''), leagues.league_name),
           country = COALESCE(NULLIF($3,''), leagues.country),
           tier = COALESCE(NULLIF($4,''), leagues.tier),
           active = $5,
           top_league = COALESCE($6, leagues.top_league),
           type = COALESCE(NULLIF($7,''), leagues.type),
           logo = COALESCE(NULLIF($8,''), leagues.logo),
           last_updated = NOW(),
           provider_synced_at = CASE WHEN $9 THEN NOW() ELSE leagues.provider_synced_at END`,
        [
          l.league_id,
          l.league_name ?? '',
          l.country ?? '',
          l.tier ?? '',
          l.active ?? false,
          l.top_league ?? null,
          l.type ?? '',
          l.logo ?? '',
          options.touchProviderSyncAt === true,
        ],
      );
      count++;
    }
    return count;
  });
}

export async function updateLeagueActive(leagueId: number, active: boolean): Promise<boolean> {
  const result = await query(
    'UPDATE leagues SET active = $1, last_updated = NOW() WHERE league_id = $2',
    [active, leagueId],
  );
  return (result.rowCount ?? 0) > 0;
}

export async function bulkSetActive(leagueIds: number[], active: boolean): Promise<number> {
  if (leagueIds.length === 0) return 0;
  const result = await query(
    'UPDATE leagues SET active = $1, last_updated = NOW() WHERE league_id = ANY($2)',
    [active, leagueIds],
  );
  return result.rowCount ?? 0;
}

export async function updateLeagueTopLeague(leagueId: number, topLeague: boolean): Promise<boolean> {
  const result = await query(
    'UPDATE leagues SET top_league = $1, last_updated = NOW() WHERE league_id = $2',
    [topLeague, leagueId],
  );
  return (result.rowCount ?? 0) > 0;
}

export async function bulkSetTopLeague(leagueIds: number[], topLeague: boolean): Promise<number> {
  if (leagueIds.length === 0) return 0;
  const result = await query(
    'UPDATE leagues SET top_league = $1, last_updated = NOW() WHERE league_id = ANY($2)',
    [topLeague, leagueIds],
  );
  return result.rowCount ?? 0;
}

/** Set optional display label; `null` or empty clears override (use provider `league_name`). */
export async function updateLeagueDisplayName(leagueId: number, displayName: string | null): Promise<boolean> {
  const normalized = displayName?.trim() ? displayName.trim() : null;
  const result = await query(
    'UPDATE leagues SET display_name = $1, last_updated = NOW() WHERE league_id = $2',
    [normalized, leagueId],
  );
  return (result.rowCount ?? 0) > 0;
}

/** Full ordered list of league IDs — assigns sort_order = (index+1)*10. Single statement (scales to ~1500+ rows). */
export async function reorderLeagues(orderedIds: number[]): Promise<number> {
  if (orderedIds.length === 0) return 0;
  const sortOrders = orderedIds.map((_, i) => (i + 1) * 10);
  const result = await query(
    `UPDATE leagues AS l
     SET sort_order = m.sort_ord, last_updated = NOW()
     FROM unnest($1::integer[], $2::integer[]) AS m(league_id, sort_ord)
     WHERE l.league_id = m.league_id`,
    [orderedIds, sortOrders],
  );
  return result.rowCount ?? 0;
}
