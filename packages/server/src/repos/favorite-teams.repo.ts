// ============================================================
// Favorite Teams Repository
// ============================================================

import { query } from '../db/pool.js';

export interface FavoriteTeam {
  user_id?: string;
  team_id: string;
  team_name: string;
  team_logo: string;
  added_at: string;
}

export interface FavoriteTeamOwner {
  userId: string;
  teamId: string;
}

export async function getFavoriteTeams(userId: string): Promise<FavoriteTeam[]> {
  const r = await query<FavoriteTeam>(
    `SELECT user_id, team_id, team_name, team_logo, added_at
     FROM favorite_teams
     WHERE user_id = $1
     ORDER BY team_name`,
    [userId],
  );
  return r.rows;
}

export async function getFavoriteTeamIds(): Promise<Set<string>> {
  const r = await query<{ team_id: string }>('SELECT DISTINCT team_id FROM favorite_teams');
  return new Set(r.rows.map(row => row.team_id));
}

export async function getFavoriteTeamOwnersByTeamIds(teamIds: string[]): Promise<FavoriteTeamOwner[]> {
  if (teamIds.length === 0) return [];

  const r = await query<{ user_id: string; team_id: string }>(
    `SELECT user_id, team_id
       FROM favorite_teams
      WHERE team_id = ANY($1)`,
    [teamIds],
  );

  return r.rows.map((row) => ({
    userId: row.user_id,
    teamId: row.team_id,
  }));
}

export async function addFavoriteTeam(userId: string, team: Omit<FavoriteTeam, 'added_at' | 'user_id'>): Promise<void> {
  await query(
    `INSERT INTO favorite_teams (user_id, team_id, team_name, team_logo)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (user_id, team_id) DO UPDATE SET team_name = $3, team_logo = $4`,
    [userId, team.team_id, team.team_name, team.team_logo],
  );
}

export async function removeFavoriteTeam(userId: string, teamId: string): Promise<void> {
  await query('DELETE FROM favorite_teams WHERE user_id = $1 AND team_id = $2', [userId, teamId]);
}
