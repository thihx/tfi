import { query } from '../db/pool.js';

// ── Profile data shape (stored as JSONB) ─────────────────────────────────────

export interface TeamProfileData {
  // Tactical identity
  attack_style:       'counter' | 'direct' | 'possession' | 'mixed';
  defensive_line:     'low' | 'medium' | 'high';
  pressing_intensity: 'low' | 'medium' | 'high';
  set_piece_threat:   'low' | 'medium' | 'high';
  // Results / psychology
  home_strength:      'weak' | 'normal' | 'strong';
  form_consistency:   'volatile' | 'inconsistent' | 'consistent';
  squad_depth:        'shallow' | 'medium' | 'deep';
  // Quantitative stats (per-match season averages)
  avg_goals_scored:    number | null;  // goals scored / match
  avg_goals_conceded:  number | null;  // goals conceded / match
  clean_sheet_rate:    number | null;  // % matches — 0 conceded
  btts_rate:           number | null;  // % both teams score
  over_2_5_rate:       number | null;  // % matches Over 2.5
  avg_corners_for:     number | null;  // corners won / match
  avg_corners_against: number | null;  // corners conceded / match
  avg_cards:           number | null;  // yellow cards / match
  first_goal_rate:     number | null;  // % matches team scores first (AH indicator)
  late_goal_rate:      number | null;  // % matches with a goal ≥76' (live betting)
  // Meta
  data_reliability_tier: 'low' | 'medium' | 'high';
}

// ── Row types ────────────────────────────────────────────────────────────────

export interface TeamProfileRow {
  team_id:    string;
  profile:    TeamProfileData;
  notes_en:   string;
  notes_vi:   string;
  created_at: string;
  updated_at: string;
}

export interface TeamProfileListRow extends TeamProfileRow {
  team_name: string;
  team_logo: string;
}

export interface TeamProfileInput {
  profile:  TeamProfileData;
  notes_en: string;
  notes_vi: string;
}

// ── Queries ──────────────────────────────────────────────────────────────────

export async function getAllTeamProfiles(): Promise<TeamProfileListRow[]> {
  const result = await query<TeamProfileListRow>(
    `SELECT tp.*,
            COALESCE(t.team_name, fav.team_name, tp.team_id) AS team_name,
            COALESCE(t.team_logo, fav.team_logo, '') AS team_logo
     FROM team_profiles tp
     LEFT JOIN teams t ON t.team_id::text = tp.team_id
     LEFT JOIN LATERAL (
       SELECT ft.team_name, ft.team_logo
       FROM favorite_teams ft
       WHERE ft.team_id = tp.team_id
       ORDER BY ft.added_at DESC, ft.user_id
       LIMIT 1
     ) fav ON TRUE
     ORDER BY COALESCE(t.team_name, fav.team_name, tp.team_id)`,
  );
  return result.rows;
}

export async function getTeamProfileByTeamId(teamId: string): Promise<TeamProfileRow | null> {
  const result = await query<TeamProfileRow>(
    'SELECT * FROM team_profiles WHERE team_id = $1',
    [teamId],
  );
  return result.rows[0] ?? null;
}

export async function upsertTeamProfile(
  teamId: string,
  payload: TeamProfileInput,
): Promise<TeamProfileRow> {
  const result = await query<TeamProfileRow>(
    `INSERT INTO team_profiles (team_id, profile, notes_en, notes_vi, updated_at)
     VALUES ($1, $2::jsonb, $3, $4, NOW())
     ON CONFLICT (team_id) DO UPDATE SET
       profile   = EXCLUDED.profile,
       notes_en  = EXCLUDED.notes_en,
       notes_vi  = EXCLUDED.notes_vi,
       updated_at = NOW()
     RETURNING *`,
    [teamId, JSON.stringify(payload.profile), payload.notes_en, payload.notes_vi],
  );
  return result.rows[0]!;
}

export async function deleteTeamProfile(teamId: string): Promise<boolean> {
  const result = await query('DELETE FROM team_profiles WHERE team_id = $1', [teamId]);
  return (result.rowCount ?? 0) > 0;
}

/** Returns a Set of team_ids that have a profile — used for UI badge display */
export async function getTeamIdsWithProfile(): Promise<Set<string>> {
  const result = await query<{ team_id: string }>('SELECT team_id FROM team_profiles');
  return new Set(result.rows.map((r) => r.team_id));
}
