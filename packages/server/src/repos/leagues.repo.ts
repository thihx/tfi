// ============================================================
// Approved Leagues Repository
// ============================================================

import { query, transaction } from '../db/pool.js';

export interface LeagueRow {
  league_id: number;
  league_name: string;
  country: string;
  tier: string;
  active: boolean;
  type: string;
  logo: string;
  last_updated: string;
}

export async function getAllLeagues(): Promise<LeagueRow[]> {
  const result = await query<LeagueRow>(
    'SELECT * FROM approved_leagues ORDER BY country, tier, league_name',
  );
  return result.rows;
}

export async function getActiveLeagues(): Promise<LeagueRow[]> {
  const result = await query<LeagueRow>(
    'SELECT * FROM approved_leagues WHERE active = TRUE ORDER BY country, tier, league_name',
  );
  return result.rows;
}

export async function getLeagueById(leagueId: number): Promise<LeagueRow | null> {
  const result = await query<LeagueRow>('SELECT * FROM approved_leagues WHERE league_id = $1', [
    leagueId,
  ]);
  return result.rows[0] ?? null;
}

export async function upsertLeagues(leagues: Partial<LeagueRow>[]): Promise<number> {
  return transaction(async (client) => {
    let count = 0;
    for (const l of leagues) {
      if (l.league_id == null) continue;
      await client.query(
        `INSERT INTO approved_leagues (league_id, league_name, country, tier, active, type, logo, last_updated)
         VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
         ON CONFLICT (league_id) DO UPDATE SET
           league_name = COALESCE(NULLIF($2,''), approved_leagues.league_name),
           country = COALESCE(NULLIF($3,''), approved_leagues.country),
           tier = COALESCE(NULLIF($4,''), approved_leagues.tier),
           active = $5,
           type = COALESCE(NULLIF($6,''), approved_leagues.type),
           logo = COALESCE(NULLIF($7,''), approved_leagues.logo),
           last_updated = NOW()`,
        [
          l.league_id,
          l.league_name ?? '',
          l.country ?? '',
          l.tier ?? '',
          l.active ?? false,
          l.type ?? '',
          l.logo ?? '',
        ],
      );
      count++;
    }
    return count;
  });
}

export async function updateLeagueActive(leagueId: number, active: boolean): Promise<boolean> {
  const result = await query(
    'UPDATE approved_leagues SET active = $1, last_updated = NOW() WHERE league_id = $2',
    [active, leagueId],
  );
  return (result.rowCount ?? 0) > 0;
}

export async function bulkSetActive(leagueIds: number[], active: boolean): Promise<number> {
  if (leagueIds.length === 0) return 0;
  const result = await query(
    'UPDATE approved_leagues SET active = $1, last_updated = NOW() WHERE league_id = ANY($2)',
    [active, leagueIds],
  );
  return result.rowCount ?? 0;
}
