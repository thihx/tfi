import { query } from '../db/pool.js';

export type LeagueTier = 'low' | 'balanced' | 'high';
export type LeagueProfileSourceMode = 'auto_derived' | 'manual_override';

export interface LeagueProfileData {
  tempo_tier: LeagueTier;
  goal_tendency: LeagueTier;
  home_advantage_tier: LeagueTier;
  corners_tendency: LeagueTier;
  cards_tendency: LeagueTier;
  volatility_tier: LeagueTier;
  data_reliability_tier: LeagueTier;
  avg_goals: number | null;
  over_2_5_rate: number | null;
  btts_rate: number | null;
  late_goal_rate_75_plus: number | null;
  avg_corners: number | null;
  avg_cards: number | null;
}

export interface LeagueProfileWindowMeta {
  lookback_days: number | null;
  sample_matches: number | null;
  event_summary_matches: number | null;
  event_coverage: number | null;
  top_league_only: boolean;
  computed_at: string | null;
  updated_at: string | null;
}

export interface LeagueProfileStoredData {
  version: 2;
  source_mode: LeagueProfileSourceMode;
  window: LeagueProfileWindowMeta;
  core: {
    tempo_tier: LeagueTier;
    goal_tendency: LeagueTier;
    home_advantage_tier: LeagueTier;
    corners_tendency: LeagueTier;
    cards_tendency: LeagueTier;
    volatility_tier: LeagueTier;
    data_reliability_tier: LeagueTier;
  };
  quantitative: {
    avg_goals: number | null;
    over_2_5_rate: number | null;
    btts_rate: number | null;
    late_goal_rate_75_plus: number | null;
    avg_corners: number | null;
    avg_cards: number | null;
  };
}

export interface BuildLeagueProfileWindowMetaInput {
  lookback_days: number;
  sample_matches: number;
  event_summary_matches: number;
  event_coverage: number | null;
  top_league_only: boolean;
  computed_at: string;
}

export interface LeagueProfileRow {
  league_id: number;
  profile: LeagueProfileStoredData;
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function readNullableNumber(value: unknown): number | null {
  if (value == null || value === '') return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function readTier(value: unknown, fallback: LeagueTier): LeagueTier {
  const raw = String(value ?? '').trim().toLowerCase();
  if (raw === 'low' || raw === 'balanced' || raw === 'high') {
    return raw;
  }
  if (raw === 'medium' || raw === 'normal') return 'balanced';
  return fallback;
}

function createDefaultWindowMeta(): LeagueProfileWindowMeta {
  return {
    lookback_days: null,
    sample_matches: null,
    event_summary_matches: null,
    event_coverage: null,
    top_league_only: true,
    computed_at: null,
    updated_at: null,
  };
}

function flattenLegacyLeagueProfile(value: Record<string, unknown>): LeagueProfileData {
  return {
    tempo_tier: readTier(value.tempo_tier, 'balanced'),
    goal_tendency: readTier(value.goal_tendency, 'balanced'),
    home_advantage_tier: readTier(value.home_advantage_tier, 'balanced'),
    corners_tendency: readTier(value.corners_tendency, 'balanced'),
    cards_tendency: readTier(value.cards_tendency, 'balanced'),
    volatility_tier: readTier(value.volatility_tier, 'balanced'),
    data_reliability_tier: readTier(value.data_reliability_tier, 'balanced'),
    avg_goals: readNullableNumber(value.avg_goals),
    over_2_5_rate: readNullableNumber(value.over_2_5_rate),
    btts_rate: readNullableNumber(value.btts_rate),
    late_goal_rate_75_plus: readNullableNumber(value.late_goal_rate_75_plus),
    avg_corners: readNullableNumber(value.avg_corners),
    avg_cards: readNullableNumber(value.avg_cards),
  };
}

export function isLeagueProfileStoredData(value: unknown): value is LeagueProfileStoredData {
  if (!isRecord(value)) return false;
  return value.version === 2
    && isRecord(value.core)
    && isRecord(value.quantitative)
    && isRecord(value.window);
}

export function flattenLeagueProfileData(value: unknown): LeagueProfileData {
  if (isLeagueProfileStoredData(value)) {
    return {
      tempo_tier: readTier(value.core.tempo_tier, 'balanced'),
      goal_tendency: readTier(value.core.goal_tendency, 'balanced'),
      home_advantage_tier: readTier(value.core.home_advantage_tier, 'balanced'),
      corners_tendency: readTier(value.core.corners_tendency, 'balanced'),
      cards_tendency: readTier(value.core.cards_tendency, 'balanced'),
      volatility_tier: readTier(value.core.volatility_tier, 'balanced'),
      data_reliability_tier: readTier(value.core.data_reliability_tier, 'balanced'),
      avg_goals: readNullableNumber(value.quantitative.avg_goals),
      over_2_5_rate: readNullableNumber(value.quantitative.over_2_5_rate),
      btts_rate: readNullableNumber(value.quantitative.btts_rate),
      late_goal_rate_75_plus: readNullableNumber(value.quantitative.late_goal_rate_75_plus),
      avg_corners: readNullableNumber(value.quantitative.avg_corners),
      avg_cards: readNullableNumber(value.quantitative.avg_cards),
    };
  }

  if (isRecord(value)) return flattenLegacyLeagueProfile(value);

  return flattenLegacyLeagueProfile({});
}

function normalizeWindowMeta(
  value: unknown,
  existing: LeagueProfileStoredData | null,
): LeagueProfileWindowMeta {
  const record = isRecord(value) ? value : {};
  const previous = existing?.window ?? createDefaultWindowMeta();
  return {
    lookback_days: readNullableNumber(record.lookback_days) ?? previous.lookback_days,
    sample_matches: readNullableNumber(record.sample_matches) ?? previous.sample_matches,
    event_summary_matches: readNullableNumber(record.event_summary_matches) ?? previous.event_summary_matches,
    event_coverage: readNullableNumber(record.event_coverage) ?? previous.event_coverage,
    top_league_only: typeof record.top_league_only === 'boolean' ? record.top_league_only : previous.top_league_only,
    computed_at: typeof record.computed_at === 'string' ? record.computed_at : previous.computed_at,
    updated_at: typeof record.updated_at === 'string' ? record.updated_at : previous.updated_at,
  };
}

export function buildAutoDerivedLeagueProfileData(
  profile: LeagueProfileData,
  meta: BuildLeagueProfileWindowMetaInput,
): LeagueProfileStoredData {
  return {
    version: 2,
    source_mode: 'auto_derived',
    window: {
      lookback_days: meta.lookback_days,
      sample_matches: meta.sample_matches,
      event_summary_matches: meta.event_summary_matches,
      event_coverage: meta.event_coverage,
      top_league_only: meta.top_league_only,
      computed_at: meta.computed_at,
      updated_at: meta.computed_at,
    },
    core: {
      tempo_tier: profile.tempo_tier,
      goal_tendency: profile.goal_tendency,
      home_advantage_tier: profile.home_advantage_tier,
      corners_tendency: profile.corners_tendency,
      cards_tendency: profile.cards_tendency,
      volatility_tier: profile.volatility_tier,
      data_reliability_tier: profile.data_reliability_tier,
    },
    quantitative: {
      avg_goals: profile.avg_goals,
      over_2_5_rate: profile.over_2_5_rate,
      btts_rate: profile.btts_rate,
      late_goal_rate_75_plus: profile.late_goal_rate_75_plus,
      avg_corners: profile.avg_corners,
      avg_cards: profile.avg_cards,
    },
  };
}

export function normalizeLeagueProfileData(
  value: unknown,
  existing: LeagueProfileStoredData | null = null,
): LeagueProfileStoredData {
  if (isLeagueProfileStoredData(value)) {
    const flattened = flattenLeagueProfileData(value);
    return {
      version: 2,
      source_mode: value.source_mode === 'auto_derived' ? 'auto_derived' : 'manual_override',
      window: normalizeWindowMeta(value.window, existing),
      core: {
        tempo_tier: flattened.tempo_tier,
        goal_tendency: flattened.goal_tendency,
        home_advantage_tier: flattened.home_advantage_tier,
        corners_tendency: flattened.corners_tendency,
        cards_tendency: flattened.cards_tendency,
        volatility_tier: flattened.volatility_tier,
        data_reliability_tier: flattened.data_reliability_tier,
      },
      quantitative: {
        avg_goals: flattened.avg_goals,
        over_2_5_rate: flattened.over_2_5_rate,
        btts_rate: flattened.btts_rate,
        late_goal_rate_75_plus: flattened.late_goal_rate_75_plus,
        avg_corners: flattened.avg_corners,
        avg_cards: flattened.avg_cards,
      },
    };
  }

  const flattened = flattenLeagueProfileData(value);
  return {
    version: 2,
    source_mode: existing?.source_mode ?? 'manual_override',
    window: existing?.window ?? createDefaultWindowMeta(),
    core: {
      tempo_tier: flattened.tempo_tier,
      goal_tendency: flattened.goal_tendency,
      home_advantage_tier: flattened.home_advantage_tier,
      corners_tendency: flattened.corners_tendency,
      cards_tendency: flattened.cards_tendency,
      volatility_tier: flattened.volatility_tier,
      data_reliability_tier: flattened.data_reliability_tier,
    },
    quantitative: {
      avg_goals: flattened.avg_goals,
      over_2_5_rate: flattened.over_2_5_rate,
      btts_rate: flattened.btts_rate,
      late_goal_rate_75_plus: flattened.late_goal_rate_75_plus,
      avg_corners: flattened.avg_corners,
      avg_cards: flattened.avg_cards,
    },
  };
}

export function flattenLeagueProfileRow<T extends { profile?: unknown; notes_en?: string; notes_vi?: string }>(
  row: T,
): Omit<T, 'profile'> & { profile: LeagueProfileData } {
  const source = row.profile ?? row;
  return {
    ...row,
    profile: flattenLeagueProfileData(source),
  };
}

function mapLeagueProfileRow<T extends LeagueProfileRow>(row: T): T {
  return {
    ...row,
    profile: normalizeLeagueProfileData(row.profile),
  } as T;
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
  return result.rows.map(mapLeagueProfileRow);
}

export async function getLeagueProfileByLeagueId(leagueId: number): Promise<LeagueProfileRow | null> {
  const result = await query<LeagueProfileRow>(
    'SELECT * FROM league_profiles WHERE league_id = $1',
    [leagueId],
  );
  const row = result.rows[0];
  return row ? mapLeagueProfileRow(row) : null;
}

export async function upsertLeagueProfile(
  leagueId: number,
  profile: LeagueProfileData | LeagueProfileStoredData,
  notes_en: string,
  notes_vi: string,
): Promise<LeagueProfileRow> {
  const existing = await query<LeagueProfileRow>(
    'SELECT * FROM league_profiles WHERE league_id = $1',
    [leagueId],
  );
  const normalizedProfile = normalizeLeagueProfileData(profile, existing.rows[0] ? normalizeLeagueProfileData(existing.rows[0].profile) : null);
  const result = await query<LeagueProfileRow>(
    `INSERT INTO league_profiles (league_id, profile, notes_en, notes_vi, updated_at)
     VALUES ($1, $2, $3, $4, NOW())
     ON CONFLICT (league_id) DO UPDATE SET
       profile    = EXCLUDED.profile,
       notes_en   = EXCLUDED.notes_en,
       notes_vi   = EXCLUDED.notes_vi,
       updated_at = NOW()
     RETURNING *`,
    [leagueId, JSON.stringify(normalizedProfile), notes_en, notes_vi],
  );
  return mapLeagueProfileRow(result.rows[0]!);
}

export async function deleteLeagueProfile(leagueId: number): Promise<boolean> {
  const result = await query('DELETE FROM league_profiles WHERE league_id = $1', [leagueId]);
  return (result.rowCount ?? 0) > 0;
}
