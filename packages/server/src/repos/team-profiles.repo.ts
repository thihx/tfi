import { query } from '../db/pool.js';
import { classifyTacticalOverlayCompetition, type TacticalOverlayCompetitionClassification } from '../lib/tactical-overlay-eligibility.js';

export interface TeamProfileData {
  attack_style: 'counter' | 'direct' | 'possession' | 'mixed';
  defensive_line: 'low' | 'medium' | 'high';
  pressing_intensity: 'low' | 'medium' | 'high';
  set_piece_threat: 'low' | 'medium' | 'high';
  home_strength: 'weak' | 'normal' | 'strong';
  form_consistency: 'volatile' | 'inconsistent' | 'consistent';
  squad_depth: 'shallow' | 'medium' | 'deep';
  avg_goals_scored: number | null;
  avg_goals_conceded: number | null;
  clean_sheet_rate: number | null;
  btts_rate: number | null;
  over_2_5_rate: number | null;
  avg_corners_for: number | null;
  avg_corners_against: number | null;
  avg_cards: number | null;
  first_goal_rate: number | null;
  late_goal_rate: number | null;
  data_reliability_tier: 'low' | 'medium' | 'high';
}

export interface TeamProfileWindowMeta {
  lookback_days: number | null;
  sample_matches: number | null;
  sample_home_matches: number | null;
  sample_away_matches: number | null;
  event_summary_matches: number | null;
  event_coverage: number | null;
  top_league_only: boolean;
  computed_at: string | null;
  updated_at: string | null;
}

export interface TeamProfileQuantitativeCore {
  set_piece_threat: 'low' | 'medium' | 'high';
  home_strength: 'weak' | 'normal' | 'strong';
  form_consistency: 'volatile' | 'inconsistent' | 'consistent';
  avg_goals_scored: number | null;
  avg_goals_conceded: number | null;
  clean_sheet_rate: number | null;
  btts_rate: number | null;
  over_2_5_rate: number | null;
  avg_corners_for: number | null;
  avg_corners_against: number | null;
  avg_cards: number | null;
  first_goal_rate: number | null;
  late_goal_rate: number | null;
  data_reliability_tier: 'low' | 'medium' | 'high';
}

export interface TeamProfileTacticalOverlay {
  attack_style: 'counter' | 'direct' | 'possession' | 'mixed';
  defensive_line: 'low' | 'medium' | 'high';
  pressing_intensity: 'low' | 'medium' | 'high';
  squad_depth: 'shallow' | 'medium' | 'deep';
  source_mode: 'default_neutral' | 'curated' | 'llm_assisted' | 'manual_override';
  source_confidence: 'low' | 'medium' | 'high' | null;
  source_urls: string[];
  source_season: string | null;
  updated_at: string | null;
}

export interface TeamProfileStoredData {
  version: 2;
  source_mode: 'hybrid';
  window: TeamProfileWindowMeta;
  quantitative_core: TeamProfileQuantitativeCore;
  tactical_overlay: TeamProfileTacticalOverlay;
}

export interface BuildTeamProfileWindowMetaInput {
  lookback_days: number;
  sample_matches: number;
  sample_home_matches: number;
  sample_away_matches: number;
  event_summary_matches: number;
  event_coverage: number | null;
  top_league_only: boolean;
  computed_at: string;
}

export interface TeamProfileRow {
  team_id: string;
  profile: TeamProfileStoredData;
  notes_en: string;
  notes_vi: string;
  created_at: string;
  updated_at: string;
}

export interface TeamProfileListRow extends TeamProfileRow {
  team_name: string;
  team_logo: string;
}

export interface TacticalOverlayRefreshCandidateRow extends TeamProfileRow {
  team_name: string;
  team_logo: string;
  league_id: number;
  league_name: string;
  league_country: string;
  league_type: string;
  league_season: number | null;
  top_league?: boolean;
}

export interface TeamProfileInput {
  profile: TeamProfileData | TeamProfileStoredData;
  notes_en: string;
  notes_vi: string;
  overlay_metadata?: TeamProfileOverlayMetadataInput;
}

export interface TeamProfileOverlayMetadataInput {
  source_mode?: TeamProfileTacticalOverlay['source_mode'];
  source_confidence?: TeamProfileTacticalOverlay['source_confidence'];
  source_urls?: string[];
  source_season?: string | null;
}

export interface TacticalOverlayEligibilityContext {
  leagueId: number;
  leagueName: string;
  leagueCountry: string;
  leagueType: string;
  topLeague: boolean;
  classification: TacticalOverlayCompetitionClassification;
}

export interface TacticalOverlayEligibilityResult {
  eligible: boolean;
  policy: TacticalOverlayCompetitionClassification['policy'];
  reason: string;
  context: TacticalOverlayEligibilityContext | null;
  contexts: TacticalOverlayEligibilityContext[];
}

const ATTACK_STYLES = new Set(['counter', 'direct', 'possession', 'mixed']);
const TIER3 = new Set(['low', 'medium', 'high']);
const HOME_STRENGTH = new Set(['weak', 'normal', 'strong']);
const FORM_CONSISTENCY = new Set(['volatile', 'inconsistent', 'consistent']);
const SQUAD_DEPTH = new Set(['shallow', 'medium', 'deep']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function readEnum<T extends string>(value: unknown, allowed: Set<string>, fallback: T): T {
  return allowed.has(value as string) ? (value as T) : fallback;
}

function readNullableNum(v: unknown): number | null {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function readNullableText(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const trimmed = v.trim();
  return trimmed ? trimmed : null;
}

function readSourceMode(
  value: unknown,
  fallback: TeamProfileTacticalOverlay['source_mode'],
): TeamProfileTacticalOverlay['source_mode'] {
  return value === 'default_neutral'
    || value === 'curated'
    || value === 'llm_assisted'
    || value === 'manual_override'
    ? value
    : fallback;
}

function normalizeSourceUrls(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return Array.from(
    new Set(
      value
        .map((entry) => typeof entry === 'string' ? entry.trim() : '')
        .filter(Boolean),
    ),
  ).slice(0, 12);
}

function flattenLegacyTeamProfile(value: Record<string, unknown>): TeamProfileData {
  return {
    attack_style: readEnum(value.attack_style, ATTACK_STYLES, 'mixed'),
    defensive_line: readEnum(value.defensive_line, TIER3, 'medium'),
    pressing_intensity: readEnum(value.pressing_intensity, TIER3, 'medium'),
    set_piece_threat: readEnum(value.set_piece_threat, TIER3, 'medium'),
    home_strength: readEnum(value.home_strength, HOME_STRENGTH, 'normal'),
    form_consistency: readEnum(value.form_consistency, FORM_CONSISTENCY, 'inconsistent'),
    squad_depth: readEnum(value.squad_depth, SQUAD_DEPTH, 'medium'),
    avg_goals_scored: readNullableNum(value.avg_goals_scored),
    avg_goals_conceded: readNullableNum(value.avg_goals_conceded),
    clean_sheet_rate: readNullableNum(value.clean_sheet_rate),
    btts_rate: readNullableNum(value.btts_rate),
    over_2_5_rate: readNullableNum(value.over_2_5_rate),
    avg_corners_for: readNullableNum(value.avg_corners_for),
    avg_corners_against: readNullableNum(value.avg_corners_against),
    avg_cards: readNullableNum(value.avg_cards),
    first_goal_rate: readNullableNum(value.first_goal_rate),
    late_goal_rate: readNullableNum(value.late_goal_rate),
    data_reliability_tier: readEnum(value.data_reliability_tier, TIER3, 'medium'),
  };
}

export function isTeamProfileStoredData(value: unknown): value is TeamProfileStoredData {
  if (!isRecord(value)) return false;
  return value.version === 2
    && value.source_mode === 'hybrid'
    && isRecord(value.window)
    && isRecord(value.quantitative_core)
    && isRecord(value.tactical_overlay);
}

export function flattenTeamProfileData(value: unknown): TeamProfileData {
  if (isTeamProfileStoredData(value)) {
    return {
      attack_style: readEnum(value.tactical_overlay.attack_style, ATTACK_STYLES, 'mixed'),
      defensive_line: readEnum(value.tactical_overlay.defensive_line, TIER3, 'medium'),
      pressing_intensity: readEnum(value.tactical_overlay.pressing_intensity, TIER3, 'medium'),
      set_piece_threat: readEnum(value.quantitative_core.set_piece_threat, TIER3, 'medium'),
      home_strength: readEnum(value.quantitative_core.home_strength, HOME_STRENGTH, 'normal'),
      form_consistency: readEnum(value.quantitative_core.form_consistency, FORM_CONSISTENCY, 'inconsistent'),
      squad_depth: readEnum(value.tactical_overlay.squad_depth, SQUAD_DEPTH, 'medium'),
      avg_goals_scored: readNullableNum(value.quantitative_core.avg_goals_scored),
      avg_goals_conceded: readNullableNum(value.quantitative_core.avg_goals_conceded),
      clean_sheet_rate: readNullableNum(value.quantitative_core.clean_sheet_rate),
      btts_rate: readNullableNum(value.quantitative_core.btts_rate),
      over_2_5_rate: readNullableNum(value.quantitative_core.over_2_5_rate),
      avg_corners_for: readNullableNum(value.quantitative_core.avg_corners_for),
      avg_corners_against: readNullableNum(value.quantitative_core.avg_corners_against),
      avg_cards: readNullableNum(value.quantitative_core.avg_cards),
      first_goal_rate: readNullableNum(value.quantitative_core.first_goal_rate),
      late_goal_rate: readNullableNum(value.quantitative_core.late_goal_rate),
      data_reliability_tier: readEnum(value.quantitative_core.data_reliability_tier, TIER3, 'medium'),
    };
  }

  if (isRecord(value)) return flattenLegacyTeamProfile(value);

  return flattenLegacyTeamProfile({});
}

function createDefaultWindowMeta(): TeamProfileWindowMeta {
  return {
    lookback_days: null,
    sample_matches: null,
    sample_home_matches: null,
    sample_away_matches: null,
    event_summary_matches: null,
    event_coverage: null,
    top_league_only: true,
    computed_at: null,
    updated_at: null,
  };
}

function createDefaultTacticalOverlay(existing: TeamProfileStoredData | null = null): TeamProfileTacticalOverlay {
  if (existing?.tactical_overlay) {
    return {
      attack_style: readEnum(existing.tactical_overlay.attack_style, ATTACK_STYLES, 'mixed'),
      defensive_line: readEnum(existing.tactical_overlay.defensive_line, TIER3, 'medium'),
      pressing_intensity: readEnum(existing.tactical_overlay.pressing_intensity, TIER3, 'medium'),
      squad_depth: readEnum(existing.tactical_overlay.squad_depth, SQUAD_DEPTH, 'medium'),
      source_mode: existing.tactical_overlay.source_mode,
      source_confidence: existing.tactical_overlay.source_confidence,
      source_urls: normalizeSourceUrls(existing.tactical_overlay.source_urls),
      source_season: readNullableText(existing.tactical_overlay.source_season),
      updated_at: existing.tactical_overlay.updated_at,
    };
  }

  return {
    attack_style: 'mixed',
    defensive_line: 'medium',
    pressing_intensity: 'medium',
    squad_depth: 'medium',
    source_mode: 'default_neutral',
    source_confidence: null,
    source_urls: [],
    source_season: null,
    updated_at: null,
  };
}

function mergeOverlayMetadata(
  current: TeamProfileTacticalOverlay,
  overlayMetadata: TeamProfileOverlayMetadataInput | undefined,
): TeamProfileTacticalOverlay {
  if (!overlayMetadata) return current;
  const nextSourceMode = readSourceMode(overlayMetadata.source_mode, current.source_mode);
  const resetToNeutral = nextSourceMode === 'default_neutral';
  const nextSourceConfidence = resetToNeutral
    ? null
    : overlayMetadata.source_confidence === 'low'
      || overlayMetadata.source_confidence === 'medium'
      || overlayMetadata.source_confidence === 'high'
      ? overlayMetadata.source_confidence
      : current.source_confidence;
  const nextSourceUrls = resetToNeutral
    ? []
    : overlayMetadata.source_urls
      ? normalizeSourceUrls(overlayMetadata.source_urls)
      : current.source_urls;
  const nextSourceSeason = resetToNeutral
    ? null
    : overlayMetadata.source_season !== undefined
    ? readNullableText(overlayMetadata.source_season)
    : current.source_season;
  const changed =
    nextSourceMode !== current.source_mode
    || nextSourceConfidence !== current.source_confidence
    || JSON.stringify(nextSourceUrls) !== JSON.stringify(current.source_urls)
    || nextSourceSeason !== current.source_season;
  return {
    ...current,
    source_mode: nextSourceMode,
    source_confidence: nextSourceConfidence,
    source_urls: nextSourceUrls,
    source_season: nextSourceSeason,
    updated_at: changed ? new Date().toISOString() : current.updated_at,
  };
}

function normalizeWindowMeta(
  value: unknown,
  existing: TeamProfileStoredData | null,
): TeamProfileWindowMeta {
  const record = isRecord(value) ? value : {};
  const previous = existing?.window ?? createDefaultWindowMeta();
  return {
    lookback_days: readNullableNum(record.lookback_days) ?? previous.lookback_days,
    sample_matches: readNullableNum(record.sample_matches) ?? previous.sample_matches,
    sample_home_matches: readNullableNum(record.sample_home_matches) ?? previous.sample_home_matches,
    sample_away_matches: readNullableNum(record.sample_away_matches) ?? previous.sample_away_matches,
    event_summary_matches: readNullableNum(record.event_summary_matches) ?? previous.event_summary_matches,
    event_coverage: readNullableNum(record.event_coverage) ?? previous.event_coverage,
    top_league_only: typeof record.top_league_only === 'boolean' ? record.top_league_only : previous.top_league_only,
    computed_at: typeof record.computed_at === 'string' ? record.computed_at : previous.computed_at,
    updated_at: typeof record.updated_at === 'string' ? record.updated_at : previous.updated_at,
  };
}

export function buildAutoDerivedTeamProfileData(
  profile: TeamProfileData,
  meta: BuildTeamProfileWindowMetaInput,
  existing: TeamProfileStoredData | null = null,
): TeamProfileStoredData {
  return {
    version: 2,
    source_mode: 'hybrid',
    window: {
      lookback_days: meta.lookback_days,
      sample_matches: meta.sample_matches,
      sample_home_matches: meta.sample_home_matches,
      sample_away_matches: meta.sample_away_matches,
      event_summary_matches: meta.event_summary_matches,
      event_coverage: meta.event_coverage,
      top_league_only: meta.top_league_only,
      computed_at: meta.computed_at,
      updated_at: meta.computed_at,
    },
    quantitative_core: {
      set_piece_threat: profile.set_piece_threat,
      home_strength: profile.home_strength,
      form_consistency: profile.form_consistency,
      avg_goals_scored: profile.avg_goals_scored,
      avg_goals_conceded: profile.avg_goals_conceded,
      clean_sheet_rate: profile.clean_sheet_rate,
      btts_rate: profile.btts_rate,
      over_2_5_rate: profile.over_2_5_rate,
      avg_corners_for: profile.avg_corners_for,
      avg_corners_against: profile.avg_corners_against,
      avg_cards: profile.avg_cards,
      first_goal_rate: profile.first_goal_rate,
      late_goal_rate: profile.late_goal_rate,
      data_reliability_tier: profile.data_reliability_tier,
    },
    tactical_overlay: createDefaultTacticalOverlay(existing),
  };
}

export function normalizeTeamProfileData(
  value: unknown,
  existing: TeamProfileStoredData | null = null,
  overlayMetadata?: TeamProfileOverlayMetadataInput,
): TeamProfileStoredData {
  if (isTeamProfileStoredData(value)) {
    const flattened = flattenTeamProfileData(value);
    return {
      version: 2,
      source_mode: 'hybrid',
      window: normalizeWindowMeta(value.window, existing),
      quantitative_core: {
        set_piece_threat: readEnum(value.quantitative_core.set_piece_threat, TIER3, flattened.set_piece_threat),
        home_strength: readEnum(value.quantitative_core.home_strength, HOME_STRENGTH, flattened.home_strength),
        form_consistency: readEnum(value.quantitative_core.form_consistency, FORM_CONSISTENCY, flattened.form_consistency),
        avg_goals_scored: flattened.avg_goals_scored,
        avg_goals_conceded: flattened.avg_goals_conceded,
        clean_sheet_rate: flattened.clean_sheet_rate,
        btts_rate: flattened.btts_rate,
        over_2_5_rate: flattened.over_2_5_rate,
        avg_corners_for: flattened.avg_corners_for,
        avg_corners_against: flattened.avg_corners_against,
        avg_cards: flattened.avg_cards,
        first_goal_rate: flattened.first_goal_rate,
        late_goal_rate: flattened.late_goal_rate,
        data_reliability_tier: flattened.data_reliability_tier,
      },
      tactical_overlay: mergeOverlayMetadata({
        ...createDefaultTacticalOverlay(existing),
        attack_style: readEnum(value.tactical_overlay.attack_style, ATTACK_STYLES, flattened.attack_style),
        defensive_line: readEnum(value.tactical_overlay.defensive_line, TIER3, flattened.defensive_line),
        pressing_intensity: readEnum(value.tactical_overlay.pressing_intensity, TIER3, flattened.pressing_intensity),
        squad_depth: readEnum(value.tactical_overlay.squad_depth, SQUAD_DEPTH, flattened.squad_depth),
        source_mode: readSourceMode(value.tactical_overlay.source_mode, createDefaultTacticalOverlay(existing).source_mode),
        source_confidence: value.tactical_overlay.source_confidence === 'low'
          || value.tactical_overlay.source_confidence === 'medium'
          || value.tactical_overlay.source_confidence === 'high'
          ? value.tactical_overlay.source_confidence
          : createDefaultTacticalOverlay(existing).source_confidence,
        source_urls: normalizeSourceUrls(value.tactical_overlay.source_urls),
        source_season: readNullableText(value.tactical_overlay.source_season),
        updated_at: value.tactical_overlay.updated_at,
      }, overlayMetadata),
    };
  }

  const flattened = flattenTeamProfileData(value);
  const previous = existing ?? null;
  return {
    version: 2,
    source_mode: 'hybrid',
    window: previous?.window ?? createDefaultWindowMeta(),
    quantitative_core: {
      set_piece_threat: flattened.set_piece_threat,
      home_strength: flattened.home_strength,
      form_consistency: flattened.form_consistency,
      avg_goals_scored: flattened.avg_goals_scored,
      avg_goals_conceded: flattened.avg_goals_conceded,
      clean_sheet_rate: flattened.clean_sheet_rate,
      btts_rate: flattened.btts_rate,
      over_2_5_rate: flattened.over_2_5_rate,
      avg_corners_for: flattened.avg_corners_for,
      avg_corners_against: flattened.avg_corners_against,
      avg_cards: flattened.avg_cards,
      first_goal_rate: flattened.first_goal_rate,
      late_goal_rate: flattened.late_goal_rate,
      data_reliability_tier: flattened.data_reliability_tier,
    },
    tactical_overlay: mergeOverlayMetadata({
      ...createDefaultTacticalOverlay(previous),
      attack_style: flattened.attack_style,
      defensive_line: flattened.defensive_line,
      pressing_intensity: flattened.pressing_intensity,
      squad_depth: flattened.squad_depth,
      source_mode: previous?.tactical_overlay.source_mode === 'curated' || previous?.tactical_overlay.source_mode === 'llm_assisted'
        ? previous.tactical_overlay.source_mode
        : 'manual_override',
      updated_at: previous?.tactical_overlay.updated_at ?? null,
      source_confidence: previous?.tactical_overlay.source_confidence ?? null,
      source_urls: previous?.tactical_overlay.source_urls ?? [],
      source_season: previous?.tactical_overlay.source_season ?? null,
    }, overlayMetadata),
  };
}

export function flattenTeamProfileRow<T extends { profile?: unknown }>(
  row: T,
): Omit<T, 'profile'> & {
  profile: TeamProfileData;
  tactical_overlay_source_mode?: TeamProfileTacticalOverlay['source_mode'];
  tactical_overlay_source_confidence?: TeamProfileTacticalOverlay['source_confidence'];
  tactical_overlay_source_urls?: string[];
  tactical_overlay_source_season?: string | null;
  tactical_overlay_updated_at?: string | null;
} {
  const source = row.profile ?? row;
  const stored = isTeamProfileStoredData(source) ? source : null;
  return {
    ...row,
    profile: flattenTeamProfileData(source),
    tactical_overlay_source_mode: stored?.tactical_overlay.source_mode,
    tactical_overlay_source_confidence: stored?.tactical_overlay.source_confidence,
    tactical_overlay_source_urls: stored?.tactical_overlay.source_urls ?? [],
    tactical_overlay_source_season: stored?.tactical_overlay.source_season ?? null,
    tactical_overlay_updated_at: stored?.tactical_overlay.updated_at ?? null,
  };
}

function mapTeamProfileRow<T extends TeamProfileRow>(row: T): T {
  return {
    ...row,
    profile: normalizeTeamProfileData(row.profile),
  } as T;
}

export async function getAllTeamProfiles(): Promise<TeamProfileListRow[]> {
  const result = await query<TeamProfileListRow>(
    `SELECT tp.*,
            COALESCE(t.team_name, tp.team_id) AS team_name,
            COALESCE(t.team_logo, '') AS team_logo
     FROM team_profiles tp
     LEFT JOIN teams t ON t.team_id::text = tp.team_id
     ORDER BY COALESCE(t.team_name, tp.team_id)`,
  );
  return result.rows.map(mapTeamProfileRow);
}

export async function getTeamProfileByTeamId(teamId: string): Promise<TeamProfileRow | null> {
  const result = await query<TeamProfileRow>(
    'SELECT * FROM team_profiles WHERE team_id = $1',
    [teamId],
  );
  const row = result.rows[0];
  return row ? mapTeamProfileRow(row) : null;
}

export async function upsertTeamProfile(
  teamId: string,
  payload: TeamProfileInput,
): Promise<TeamProfileRow> {
  const existing = await query<TeamProfileRow>(
    'SELECT * FROM team_profiles WHERE team_id = $1',
    [teamId],
  );
  const normalizedProfile = normalizeTeamProfileData(
    payload.profile,
    existing.rows[0] ? normalizeTeamProfileData(existing.rows[0].profile) : null,
    payload.overlay_metadata,
  );
  const result = await query<TeamProfileRow>(
    `INSERT INTO team_profiles (team_id, profile, notes_en, notes_vi, updated_at)
     VALUES ($1, $2::jsonb, $3, $4, NOW())
     ON CONFLICT (team_id) DO UPDATE SET
       profile   = EXCLUDED.profile,
       notes_en  = EXCLUDED.notes_en,
       notes_vi  = EXCLUDED.notes_vi,
       updated_at = NOW()
     RETURNING *`,
    [teamId, JSON.stringify(normalizedProfile), payload.notes_en, payload.notes_vi],
  );
  return mapTeamProfileRow(result.rows[0]!);
}

export async function deleteTeamProfile(teamId: string): Promise<boolean> {
  const result = await query('DELETE FROM team_profiles WHERE team_id = $1', [teamId]);
  return (result.rowCount ?? 0) > 0;
}

export async function getTeamIdsWithProfile(): Promise<Set<string>> {
  const result = await query<{ team_id: string }>('SELECT team_id FROM team_profiles');
  return new Set(result.rows.map((r) => r.team_id));
}

export async function isTopLeagueTeam(teamId: string): Promise<boolean> {
  const result = await query<{ exists: boolean }>(
    `SELECT EXISTS (
       SELECT 1
       FROM league_team_directory ltd
       JOIN leagues l ON l.league_id = ltd.league_id
       WHERE ltd.team_id::text = $1
         AND l.top_league = TRUE
         AND l.active = TRUE
     ) AS exists`,
    [teamId],
  );
  return result.rows[0]?.exists === true;
}

export async function getTacticalOverlayEligibilityForTeam(teamId: string): Promise<TacticalOverlayEligibilityResult> {
  const result = await query<{
    league_id: number;
    league_name: string;
    league_country: string;
    league_type: string;
    top_league: boolean;
  }>(
    `SELECT DISTINCT
        l.league_id,
        l.league_name,
        l.country AS league_country,
        l.type AS league_type,
        l.top_league
      FROM league_team_directory ltd
      JOIN leagues l ON l.league_id = ltd.league_id
      WHERE ltd.team_id::text = $1
        AND l.active = TRUE`,
    [teamId],
  );

  const contexts = result.rows
    .map((row) => ({
      leagueId: row.league_id,
      leagueName: row.league_name,
      leagueCountry: row.league_country,
      leagueType: row.league_type,
      topLeague: row.top_league,
      classification: classifyTacticalOverlayCompetition({
        leagueName: row.league_name,
        country: row.league_country,
        type: row.league_type,
        topLeague: row.top_league,
      }),
    }))
    .sort((left, right) =>
      right.classification.sortRank - left.classification.sortRank
      || left.leagueName.localeCompare(right.leagueName));

  const best = contexts.find((context) => context.classification.eligible) ?? null;
  return {
    eligible: !!best,
    policy: best?.classification.policy ?? 'ineligible',
    reason: best?.classification.reason ?? 'competition_not_approved',
    context: best,
    contexts,
  };
}

export async function getTopLeagueTacticalOverlayRefreshCandidates(): Promise<TacticalOverlayRefreshCandidateRow[]> {
  const result = await query<TacticalOverlayRefreshCandidateRow>(
    `SELECT DISTINCT ON (tp.team_id, l.league_id)
        tp.*,
        COALESCE(t.team_name, tp.team_id) AS team_name,
        COALESCE(t.team_logo, '') AS team_logo,
        l.league_id,
        l.league_name,
        l.country AS league_country,
        l.type AS league_type,
        l.top_league,
        ltd.season AS league_season
      FROM team_profiles tp
      JOIN league_team_directory ltd ON ltd.team_id::text = tp.team_id
      JOIN leagues l ON l.league_id = ltd.league_id
      LEFT JOIN teams t ON t.team_id::text = tp.team_id
      WHERE l.active = TRUE
      ORDER BY
        tp.team_id,
        l.league_id,
        CASE WHEN lower(coalesce(l.type, '')) = 'league' THEN 0 ELSE 1 END,
        l.country,
        l.league_name`,
  );
  return result.rows.map(mapTeamProfileRow);
}
