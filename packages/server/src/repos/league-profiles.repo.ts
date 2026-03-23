import { query } from '../db/pool.js';

export type LeagueTier = 'low' | 'balanced' | 'high';

export interface LeagueProfileData {
  tempo_tier:            LeagueTier;
  goal_tendency:         LeagueTier;
  home_advantage_tier:   LeagueTier;
  corners_tendency:      LeagueTier;
  cards_tendency:        LeagueTier;
  volatility_tier:       LeagueTier;
  data_reliability_tier: LeagueTier;
  avg_goals:             number | null;
  over_2_5_rate:         number | null;
  btts_rate:             number | null;
  late_goal_rate_75_plus: number | null;
  avg_corners:           number | null;
  avg_cards:             number | null;
}

export interface LeagueProfileRow {
  league_id:  number;
  profile:    LeagueProfileData;
  notes_en:   string;
  notes_vi:   string;
  created_at: string;
  updated_at: string;
}

export interface LeagueProfileListRow extends LeagueProfileRow {
  league_name: string;
  country:     string;
  tier:        string;
  type:        string;
  logo:        string;
}

export async function getAllLeagueProfiles(): Promise<LeagueProfileListRow[]> {
  const result = await query<LeagueProfileListRow>(
    `SELECT
       lp.league_id,
       lp.profile,
       lp.notes_en,
       lp.notes_vi,
       lp.created_at,
       lp.updated_at,
       l.league_name,
       l.country,
       l.tier,
       l.type,
       l.logo
     FROM league_profiles lp
     JOIN leagues l ON l.league_id = lp.league_id
     ORDER BY l.country, l.tier, l.league_name`,
  );
  return result.rows;
}

export async function getLeagueProfileByLeagueId(leagueId: number): Promise<LeagueProfileRow | null> {
  const result = await query<LeagueProfileRow>(
    'SELECT * FROM league_profiles WHERE league_id = $1',
    [leagueId],
  );
  return result.rows[0] ?? null;
}

export async function upsertLeagueProfile(
  leagueId: number,
  profile: LeagueProfileData,
  notes_en: string,
  notes_vi: string,
): Promise<LeagueProfileRow> {
  const result = await query<LeagueProfileRow>(
    `INSERT INTO league_profiles (league_id, profile, notes_en, notes_vi, updated_at)
     VALUES ($1, $2, $3, $4, NOW())
     ON CONFLICT (league_id) DO UPDATE SET
       profile    = EXCLUDED.profile,
       notes_en   = EXCLUDED.notes_en,
       notes_vi   = EXCLUDED.notes_vi,
       updated_at = NOW()
     RETURNING *`,
    [leagueId, JSON.stringify(profile), notes_en, notes_vi],
  );
  return result.rows[0]!;
}

export async function deleteLeagueProfile(leagueId: number): Promise<boolean> {
  const result = await query('DELETE FROM league_profiles WHERE league_id = $1', [leagueId]);
  return (result.rowCount ?? 0) > 0;
}
