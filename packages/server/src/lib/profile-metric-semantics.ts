import {
  flattenLeagueProfileData,
  isLeagueProfileStoredData,
  type LeagueProfileStoredData,
} from '../repos/league-profiles.repo.js';
import {
  flattenTeamProfileData,
  isTeamProfileStoredData,
  type TeamProfileStoredData,
} from '../repos/team-profiles.repo.js';

interface SemanticMetricEntry {
  raw_key: string;
  semantic_name: string;
  value: string | number | null;
  unit: string;
  definition: string;
  interpretation: string;
  caveat?: string;
}

interface SemanticWindowMeta {
  lookback_days: number | null;
  sample_matches: number | null;
  sample_home_matches?: number | null;
  sample_away_matches?: number | null;
  event_summary_matches?: number | null;
  event_coverage?: number | null;
  source_mode?: string | null;
}

interface SemanticProfileBlock {
  profile_type: 'league_profile' | 'team_profile';
  side?: 'home' | 'away';
  window: SemanticWindowMeta;
  metrics: SemanticMetricEntry[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function asObject(value: unknown): Record<string, unknown> | null {
  return isRecord(value) ? value : null;
}

function round(value: number | null, digits = 3): number | null {
  if (value == null || !Number.isFinite(value)) return null;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function asPercent01(value: number | null): number | null {
  if (value == null) return null;
  return round(value * 100, 1);
}

function extractLeagueStoredProfile(value: unknown): LeagueProfileStoredData | null {
  const record = asObject(value);
  if (!record) return null;
  const payload = asObject(record.profile) ?? record;
  return isLeagueProfileStoredData(payload) ? payload : null;
}

function extractTeamStoredProfile(value: unknown): TeamProfileStoredData | null {
  const record = asObject(value);
  if (!record) return null;
  const payload = asObject(record.profile) ?? record;
  return isTeamProfileStoredData(payload) ? payload : null;
}

function buildLeagueWindow(value: unknown): SemanticWindowMeta {
  const stored = extractLeagueStoredProfile(value);
  return {
    lookback_days: stored?.window.lookback_days ?? null,
    sample_matches: stored?.window.sample_matches ?? null,
    event_summary_matches: stored?.window.event_summary_matches ?? null,
    event_coverage: stored?.window.event_coverage ?? null,
    source_mode: stored?.source_mode ?? null,
  };
}

function buildTeamWindow(value: unknown): SemanticWindowMeta {
  const stored = extractTeamStoredProfile(value);
  return {
    lookback_days: stored?.window.lookback_days ?? null,
    sample_matches: stored?.window.sample_matches ?? null,
    sample_home_matches: stored?.window.sample_home_matches ?? null,
    sample_away_matches: stored?.window.sample_away_matches ?? null,
    event_summary_matches: stored?.window.event_summary_matches ?? null,
    event_coverage: stored?.window.event_coverage ?? null,
    source_mode: stored?.tactical_overlay.source_mode ?? stored?.source_mode ?? null,
  };
}

function buildLeagueMetrics(value: unknown): SemanticMetricEntry[] {
  const flat = flattenLeagueProfileData(asObject(value)?.profile ?? value);
  const entries: SemanticMetricEntry[] = [
    {
      raw_key: 'tempo_tier',
      semantic_name: 'league_match_pace_tier',
      value: flat.tempo_tier,
      unit: 'tier',
      definition: 'Competition-level pace prior derived from settled match totals.',
      interpretation: 'Higher means the league more often produces faster, more open match environments.',
    },
    {
      raw_key: 'goal_tendency',
      semantic_name: 'league_goal_environment_tier',
      value: flat.goal_tendency,
      unit: 'tier',
      definition: 'Competition-level scoring tendency derived from league settled matches.',
      interpretation: 'Higher means a more goal-friendly environment on average.',
    },
    {
      raw_key: 'home_advantage_tier',
      semantic_name: 'league_home_edge_tier',
      value: flat.home_advantage_tier,
      unit: 'tier',
      definition: 'Competition-level home advantage prior derived from home versus away result imbalance.',
      interpretation: 'Higher means home sides tend to outperform away sides more strongly in this league.',
    },
    {
      raw_key: 'corners_tendency',
      semantic_name: 'league_corners_environment_tier',
      value: flat.corners_tendency,
      unit: 'tier',
      definition: 'Competition-level corners tendency derived from average total corners per match.',
      interpretation: 'Higher means league matches more often generate corner-heavy environments.',
    },
    {
      raw_key: 'cards_tendency',
      semantic_name: 'league_cards_environment_tier',
      value: flat.cards_tendency,
      unit: 'tier',
      definition: 'Competition-level cards tendency derived from average total cards per match.',
      interpretation: 'Higher means league matches are usually more card-heavy.',
    },
    {
      raw_key: 'volatility_tier',
      semantic_name: 'league_outcome_volatility_tier',
      value: flat.volatility_tier,
      unit: 'tier',
      definition: 'Competition-level goal variance prior derived from the spread of settled scorelines.',
      interpretation: 'Higher means wider outcome dispersion and less stable score environments.',
    },
    {
      raw_key: 'data_reliability_tier',
      semantic_name: 'league_profile_reliability_tier',
      value: flat.data_reliability_tier,
      unit: 'tier',
      definition: 'Reliability of the league profile based on sample depth and data quality.',
      interpretation: 'Lower means use the league prior more cautiously.',
    },
    {
      raw_key: 'avg_goals',
      semantic_name: 'league_avg_total_goals_per_match',
      value: flat.avg_goals,
      unit: 'goals_per_match_both_teams',
      definition: 'League-wide average total goals per settled match, counting both teams combined.',
      interpretation: 'Higher values support a stronger baseline scoring environment.',
    },
    {
      raw_key: 'over_2_5_rate',
      semantic_name: 'league_over_2_5_match_rate',
      value: asPercent01(flat.over_2_5_rate),
      unit: 'percent_of_matches',
      definition: 'Share of league matches finishing with more than 2.5 total goals.',
      interpretation: 'Higher values indicate a stronger historical over-2.5 environment.',
    },
    {
      raw_key: 'btts_rate',
      semantic_name: 'league_match_btts_rate',
      value: asPercent01(flat.btts_rate),
      unit: 'percent_of_matches',
      definition: 'Share of league matches in which both teams scored.',
      interpretation: 'Higher values indicate a stronger league-wide BTTS environment.',
    },
    {
      raw_key: 'late_goal_rate_75_plus',
      semantic_name: 'league_late_goal_match_rate',
      value: asPercent01(flat.late_goal_rate_75_plus),
      unit: 'percent_of_matches',
      definition: 'Share of league matches with at least one goal after minute 75.',
      interpretation: 'Higher values indicate a stronger late-goal environment.',
      caveat: 'Event-summary dependent. Treat cautiously if event_coverage is low.',
    },
    {
      raw_key: 'avg_corners',
      semantic_name: 'league_avg_total_corners_per_match',
      value: flat.avg_corners,
      unit: 'corners_per_match_both_teams',
      definition: 'League-wide average total corners per settled match, counting both teams combined.',
      interpretation: 'Higher values indicate a more corner-active competition environment.',
    },
    {
      raw_key: 'avg_cards',
      semantic_name: 'league_avg_total_cards_per_match',
      value: flat.avg_cards,
      unit: 'cards_per_match_both_teams',
      definition: 'League-wide average total cards per settled match, counting both teams combined.',
      interpretation: 'Higher values indicate a more card-heavy competition environment.',
    },
  ];

  return entries.filter((entry) => entry.value != null && entry.value !== '');
}

function buildTeamMetrics(value: unknown): SemanticMetricEntry[] {
  const flat = flattenTeamProfileData(asObject(value)?.profile ?? value);
  const stored = extractTeamStoredProfile(value);
  const tacticalSourceMode = stored?.tactical_overlay.source_mode ?? 'default_neutral';
  const tacticalCaveat = tacticalSourceMode === 'default_neutral'
    ? 'Neutral default tactical overlay. Do not treat this as hard evidence.'
    : `Tactical overlay source_mode=${tacticalSourceMode}.`;

  const entries: SemanticMetricEntry[] = [
    {
      raw_key: 'attack_style',
      semantic_name: 'team_attack_style_overlay',
      value: flat.attack_style,
      unit: 'categorical',
      definition: 'High-level tactical attacking style label for the team.',
      interpretation: 'Use only as soft tactical context, not as a quantitative edge by itself.',
      caveat: tacticalCaveat,
    },
    {
      raw_key: 'defensive_line',
      semantic_name: 'team_defensive_line_overlay',
      value: flat.defensive_line,
      unit: 'categorical',
      definition: 'High-level label for how high or low the team tends to defend.',
      interpretation: 'Use only as soft tactical context, not as standalone proof.',
      caveat: tacticalCaveat,
    },
    {
      raw_key: 'pressing_intensity',
      semantic_name: 'team_pressing_intensity_overlay',
      value: flat.pressing_intensity,
      unit: 'categorical',
      definition: 'High-level label for how aggressively the team tends to press.',
      interpretation: 'Use only as soft tactical context, not as standalone proof.',
      caveat: tacticalCaveat,
    },
    {
      raw_key: 'squad_depth',
      semantic_name: 'team_squad_depth_overlay',
      value: flat.squad_depth,
      unit: 'categorical',
      definition: 'High-level label for squad rotation depth and bench coverage.',
      interpretation: 'Use mainly for rotation resilience context, not as direct match value.',
      caveat: tacticalCaveat,
    },
    {
      raw_key: 'set_piece_threat',
      semantic_name: 'team_set_piece_threat_tier',
      value: flat.set_piece_threat,
      unit: 'tier',
      definition: 'Heuristic tier derived from set-piece related quantitative profile signals.',
      interpretation: 'Higher means the team more often creates threat through corners and dead-ball volume.',
    },
    {
      raw_key: 'home_strength',
      semantic_name: 'team_home_strength_tier',
      value: flat.home_strength,
      unit: 'tier',
      definition: 'Tier derived from this team\'s home points profile inside the sample window.',
      interpretation: 'Higher means the team historically performs better at home in the sampled matches.',
      caveat: 'Only meaningful for home-context calibration, not for away matches.',
    },
    {
      raw_key: 'form_consistency',
      semantic_name: 'team_form_consistency_tier',
      value: flat.form_consistency,
      unit: 'tier',
      definition: 'Tier derived from variance in match results across the sampled matches.',
      interpretation: 'More consistent means outcomes fluctuate less from match to match.',
    },
    {
      raw_key: 'data_reliability_tier',
      semantic_name: 'team_profile_reliability_tier',
      value: flat.data_reliability_tier,
      unit: 'tier',
      definition: 'Reliability of the team profile based on sample depth and usable data coverage.',
      interpretation: 'Lower means team priors should be down-weighted.',
    },
    {
      raw_key: 'avg_goals_scored',
      semantic_name: 'team_avg_goals_scored_per_match',
      value: flat.avg_goals_scored,
      unit: 'goals_per_match_team_only',
      definition: 'Average goals scored by this team per sampled match.',
      interpretation: 'Higher values support a stronger scoring baseline for this team.',
    },
    {
      raw_key: 'avg_goals_conceded',
      semantic_name: 'team_avg_goals_conceded_per_match',
      value: flat.avg_goals_conceded,
      unit: 'goals_per_match_team_only',
      definition: 'Average goals conceded by this team per sampled match.',
      interpretation: 'Higher values indicate the team more often allows goals.',
    },
    {
      raw_key: 'clean_sheet_rate',
      semantic_name: 'team_clean_sheet_match_rate',
      value: asPercent01(flat.clean_sheet_rate),
      unit: 'percent_of_matches',
      definition: 'Share of this team\'s sampled matches in which it conceded zero goals.',
      interpretation: 'Higher values support a stronger defensive-clean-sheet baseline.',
    },
    {
      raw_key: 'btts_rate',
      semantic_name: 'team_match_btts_rate',
      value: asPercent01(flat.btts_rate),
      unit: 'percent_of_matches',
      definition: 'Share of this team\'s sampled matches in which both teams scored.',
      interpretation: 'Higher values indicate this team tends to participate in BTTS environments.',
      caveat: 'This is a match-environment metric, not a standalone attacking-strength metric.',
    },
    {
      raw_key: 'over_2_5_rate',
      semantic_name: 'team_match_over_2_5_rate',
      value: asPercent01(flat.over_2_5_rate),
      unit: 'percent_of_matches',
      definition: 'Share of this team\'s sampled matches finishing with more than 2.5 total goals.',
      interpretation: 'Higher values indicate the team more often participates in high-total matches.',
      caveat: 'This is a match-environment metric, not a pure team attack metric.',
    },
    {
      raw_key: 'avg_corners_for',
      semantic_name: 'team_avg_corners_for_per_match',
      value: flat.avg_corners_for,
      unit: 'corners_per_match_team_only',
      definition: 'Average corners won by this team per sampled match.',
      interpretation: 'Higher values indicate stronger territorial pressure or crossing volume.',
    },
    {
      raw_key: 'avg_corners_against',
      semantic_name: 'team_avg_corners_against_per_match',
      value: flat.avg_corners_against,
      unit: 'corners_per_match_team_only',
      definition: 'Average corners conceded by this team per sampled match.',
      interpretation: 'Higher values indicate the opponent often forces this team into defending corners.',
    },
    {
      raw_key: 'avg_cards',
      semantic_name: 'team_avg_cards_per_match',
      value: flat.avg_cards,
      unit: 'cards_per_match_team_only',
      definition: 'Average cards received by this team per sampled match.',
      interpretation: 'Higher values indicate a stronger disciplinary-risk baseline.',
    },
    {
      raw_key: 'first_goal_rate',
      semantic_name: 'team_scored_first_rate',
      value: asPercent01(flat.first_goal_rate),
      unit: 'percent_of_matches',
      definition: 'Share of sampled matches in which this team scored the first goal.',
      interpretation: 'Higher values indicate the team more often starts matches on the front foot.',
      caveat: 'Event-summary dependent. Treat cautiously if event_coverage is low.',
    },
    {
      raw_key: 'late_goal_rate',
      semantic_name: 'team_late_goal_involvement_rate',
      value: asPercent01(flat.late_goal_rate),
      unit: 'percent_of_matches',
      definition: 'Share of sampled matches involving this team that contained at least one goal after minute 75.',
      interpretation: 'Higher values indicate the team more often participates in late-goal environments.',
      caveat: 'This is match-level late-goal involvement, not necessarily goals scored by this team.',
    },
  ];

  return entries.filter((entry) => entry.value != null && entry.value !== '');
}

export function buildProfileMetricSemantics(
  leagueProfile: unknown,
  homeTeamProfile: unknown,
  awayTeamProfile: unknown,
): SemanticProfileBlock[] {
  const blocks: SemanticProfileBlock[] = [];

  if (leagueProfile && isRecord(leagueProfile)) {
    const metrics = buildLeagueMetrics(leagueProfile);
    if (metrics.length > 0) {
      blocks.push({
        profile_type: 'league_profile',
        window: buildLeagueWindow(leagueProfile),
        metrics,
      });
    }
  }

  if (homeTeamProfile && isRecord(homeTeamProfile)) {
    const metrics = buildTeamMetrics(homeTeamProfile);
    if (metrics.length > 0) {
      blocks.push({
        profile_type: 'team_profile',
        side: 'home',
        window: buildTeamWindow(homeTeamProfile),
        metrics,
      });
    }
  }

  if (awayTeamProfile && isRecord(awayTeamProfile)) {
    const metrics = buildTeamMetrics(awayTeamProfile);
    if (metrics.length > 0) {
      blocks.push({
        profile_type: 'team_profile',
        side: 'away',
        window: buildTeamWindow(awayTeamProfile),
        metrics,
      });
    }
  }

  return blocks;
}

export function buildProfileMetricSemanticsSection(
  leagueProfile: unknown,
  homeTeamProfile: unknown,
  awayTeamProfile: unknown,
  compact = false,
): string {
  const blocks = buildProfileMetricSemantics(leagueProfile, homeTeamProfile, awayTeamProfile);
  if (blocks.length === 0) return '';

  const payload = compact
    ? JSON.stringify(blocks)
    : JSON.stringify(blocks, null, 2);

  return compact
    ? `========================
PROFILE METRIC SEMANTICS
========================
${payload}
PROFILE METRIC RULES:
- Use semantic_name, definition, unit, and caveat as the authoritative meaning of each profile metric.
- Do NOT reinterpret raw_key names loosely. If a caveat says a metric is match-environment only, do not treat it as a pure team-strength signal.
- Respect window.sample_matches and window.event_coverage before trusting a metric strongly.

`
    : `============================================================
PROFILE METRIC SEMANTICS
============================================================
${payload}
PROFILE METRIC RULES:
- The JSON above defines the authoritative meaning of each profile metric.
- semantic_name and definition override any ambiguous intuition from raw_key names.
- A metric with a caveat must be used with that caveat explicitly in mind.
- Team BTTS / Over / late-goal rates are team-involvement environment metrics, not standalone attack-strength metrics.
- Team tactical overlay fields are soft context only, especially when source_mode is default_neutral.
- Always use window.sample_matches and window.event_coverage to judge how much weight the profile deserves.

`;
}
