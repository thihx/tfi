// ============================================================
// Favorite Teams Repository
// ============================================================

import { query } from '../db/pool.js';

export interface FavoriteTeam {
  team_id: string;
  team_name: string;
  team_logo: string;
  added_at: string;
}

export async function getFavoriteTeams(): Promise<FavoriteTeam[]> {
  const r = await query<FavoriteTeam>(
    `SELECT team_id, team_name, team_logo, added_at
     FROM favorite_teams
     ORDER BY team_name`,
  );
  return r.rows;
}

export async function getFavoriteTeamIds(): Promise<Set<string>> {
  const r = await query<{ team_id: string }>('SELECT team_id FROM favorite_teams');
  return new Set(r.rows.map(row => row.team_id));
}

export async function addFavoriteTeam(team: Omit<FavoriteTeam, 'added_at'>): Promise<void> {
  await query(
    `INSERT INTO favorite_teams (team_id, team_name, team_logo)
     VALUES ($1, $2, $3)
     ON CONFLICT (team_id) DO UPDATE SET team_name = $2, team_logo = $3`,
    [team.team_id, team.team_name, team.team_logo],
  );
}

export async function removeFavoriteTeam(teamId: string): Promise<void> {
  await query('DELETE FROM favorite_teams WHERE team_id = $1', [teamId]);
}
