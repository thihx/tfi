// ============================================================
// Leagues Repository
// ============================================================

import { query, transaction } from '../db/pool.js';

export interface LeagueRow {
  league_id: number;
  league_name: string;
  country: string;
  tier: string;
  active: boolean;
  top_league: boolean;
  type: string;
  logo: string;
  last_updated: string;
}

export async function getAllLeagues(): Promise<LeagueRow[]> {
  const result = await query<LeagueRow>(
    'SELECT * FROM leagues ORDER BY country, tier, league_name',
  );
  return result.rows;
}

export async function getActiveLeagues(): Promise<LeagueRow[]> {
  const result = await query<LeagueRow>(
    'SELECT * FROM leagues WHERE active = TRUE ORDER BY country, tier, league_name',
  );
  return result.rows;
}

export async function getLeagueById(leagueId: number): Promise<LeagueRow | null> {
  const result = await query<LeagueRow>('SELECT * FROM leagues WHERE league_id = $1', [
    leagueId,
  ]);
  return result.rows[0] ?? null;
}

export async function getTopLeagues(): Promise<LeagueRow[]> {
  const result = await query<LeagueRow>(
    'SELECT * FROM leagues WHERE top_league = TRUE AND active = TRUE ORDER BY country, tier, league_name',
  );
  return result.rows;
}

export async function upsertLeagues(leagues: Partial<LeagueRow>[]): Promise<number> {
  return transaction(async (client) => {
    let count = 0;
    for (const l of leagues) {
      if (l.league_id == null) continue;
      await client.query(
        `INSERT INTO leagues (league_id, league_name, country, tier, active, top_league, type, logo, last_updated)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
         ON CONFLICT (league_id) DO UPDATE SET
           league_name = COALESCE(NULLIF($2,''), leagues.league_name),
           country = COALESCE(NULLIF($3,''), leagues.country),
           tier = COALESCE(NULLIF($4,''), leagues.tier),
           active = $5,
           top_league = COALESCE($6, leagues.top_league),
           type = COALESCE(NULLIF($7,''), leagues.type),
           logo = COALESCE(NULLIF($8,''), leagues.logo),
           last_updated = NOW()`,
        [
          l.league_id,
          l.league_name ?? '',
          l.country ?? '',
          l.tier ?? '',
          l.active ?? false,
          l.top_league ?? null,
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
