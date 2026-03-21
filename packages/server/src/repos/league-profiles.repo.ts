import { query } from '../db/pool.js';

export type LeagueProfileTier5 = 'very_low' | 'low' | 'balanced' | 'high' | 'very_high';
export type LeagueProfileTier3 = 'low' | 'medium' | 'high';
export type LeagueProfileHomeAdvantageTier = 'low' | 'normal' | 'high';

export interface LeagueProfileRow {
  league_id: number;
  tempo_tier: LeagueProfileTier5;
  goal_tendency: LeagueProfileTier5;
  home_advantage_tier: LeagueProfileHomeAdvantageTier;
  corners_tendency: LeagueProfileTier5;
  cards_tendency: LeagueProfileTier5;
  volatility_tier: LeagueProfileTier3;
  data_reliability_tier: LeagueProfileTier3;
  avg_goals: number | null;
  over_2_5_rate: number | null;
  btts_rate: number | null;
  late_goal_rate_75_plus: number | null;
  avg_corners: number | null;
  avg_cards: number | null;
  notes_en: string;
  notes_vi: string;
  created_at: string;
  updated_at: string;
}

export interface LeagueProfileListRow extends LeagueProfileRow {
  league_name: string;
  country: string;
  tier: string;
  type: string;
  logo: string;
}

export interface LeagueProfileInput {
  tempo_tier: LeagueProfileTier5;
  goal_tendency: LeagueProfileTier5;
  home_advantage_tier: LeagueProfileHomeAdvantageTier;
  corners_tendency: LeagueProfileTier5;
  cards_tendency: LeagueProfileTier5;
  volatility_tier: LeagueProfileTier3;
  data_reliability_tier: LeagueProfileTier3;
  avg_goals: number | null;
  over_2_5_rate: number | null;
  btts_rate: number | null;
  late_goal_rate_75_plus: number | null;
  avg_corners: number | null;
  avg_cards: number | null;
  notes_en: string;
  notes_vi: string;
}

export async function getAllLeagueProfiles(): Promise<LeagueProfileListRow[]> {
  const result = await query<LeagueProfileListRow>(
    `SELECT
       lp.*,
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
  payload: LeagueProfileInput,
): Promise<LeagueProfileRow> {
  const result = await query<LeagueProfileRow>(
    `INSERT INTO league_profiles (
       league_id,
       tempo_tier,
       goal_tendency,
       home_advantage_tier,
       corners_tendency,
       cards_tendency,
       volatility_tier,
       data_reliability_tier,
       avg_goals,
       over_2_5_rate,
       btts_rate,
       late_goal_rate_75_plus,
       avg_corners,
       avg_cards,
       notes_en,
       notes_vi,
       updated_at
     )
     VALUES (
       $1, $2, $3, $4, $5, $6, $7, $8,
       $9, $10, $11, $12, $13, $14, $15, $16, NOW()
     )
     ON CONFLICT (league_id) DO UPDATE SET
       tempo_tier = EXCLUDED.tempo_tier,
       goal_tendency = EXCLUDED.goal_tendency,
       home_advantage_tier = EXCLUDED.home_advantage_tier,
       corners_tendency = EXCLUDED.corners_tendency,
       cards_tendency = EXCLUDED.cards_tendency,
       volatility_tier = EXCLUDED.volatility_tier,
       data_reliability_tier = EXCLUDED.data_reliability_tier,
       avg_goals = EXCLUDED.avg_goals,
       over_2_5_rate = EXCLUDED.over_2_5_rate,
       btts_rate = EXCLUDED.btts_rate,
       late_goal_rate_75_plus = EXCLUDED.late_goal_rate_75_plus,
       avg_corners = EXCLUDED.avg_corners,
       avg_cards = EXCLUDED.avg_cards,
       notes_en = EXCLUDED.notes_en,
       notes_vi = EXCLUDED.notes_vi,
       updated_at = NOW()
     RETURNING *`,
    [
      leagueId,
      payload.tempo_tier,
      payload.goal_tendency,
      payload.home_advantage_tier,
      payload.corners_tendency,
      payload.cards_tendency,
      payload.volatility_tier,
      payload.data_reliability_tier,
      payload.avg_goals,
      payload.over_2_5_rate,
      payload.btts_rate,
      payload.late_goal_rate_75_plus,
      payload.avg_corners,
      payload.avg_cards,
      payload.notes_en,
      payload.notes_vi,
    ],
  );
  return result.rows[0]!;
}

export async function deleteLeagueProfile(leagueId: number): Promise<boolean> {
  const result = await query('DELETE FROM league_profiles WHERE league_id = $1', [leagueId]);
  return (result.rowCount ?? 0) > 0;
}
