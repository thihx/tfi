// ==================== Core Domain Types ====================

export interface Match {
  match_id: string;
  date: string;
  kickoff: string;
  kickoff_at_utc?: string | null;
  league_id: number;
  league_name: string;
  league?: string;
  home_team: string;
  away_team: string;
  home_logo: string;
  away_logo: string;
  home_score: string | number | null;
  away_score: string | number | null;
  status: string;
  current_minute?: string;
  prediction?: string;
  // Enriched from /fixtures (free)
  home_team_id?: number | null;
  away_team_id?: number | null;
  round?: string | null;
  halftime_home?: number | null;
  halftime_away?: number | null;
  referee?: string | null;
  // Enriched from /fixtures/statistics (live matches)
  home_reds?: number | null;
  away_reds?: number | null;
  home_yellows?: number | null;
  away_yellows?: number | null;
}

export interface StrategicContext {
  home_motivation: string;
  away_motivation: string;
  league_positions: string;
  fixture_congestion: string;
  home_fixture_congestion?: string;
  away_fixture_congestion?: string;
  rotation_risk: string;
  key_absences: string;
  home_key_absences?: string;
  away_key_absences?: string;
  h2h_narrative: string;
  summary: string;
  searched_at: string;
  competition_type?: string;
  ai_condition?: string;
  ai_condition_blueprint?: {
    alert_window_start: number | null;
    alert_window_end: number | null;
    preferred_score_state: 'any' | 'draw' | 'home_leading' | 'away_leading' | 'not_home_leading' | 'not_away_leading';
    preferred_goal_state: 'any' | 'goals_lte_0' | 'goals_lte_1' | 'goals_lte_2' | 'goals_gte_1' | 'goals_gte_2' | 'goals_gte_3';
    favoured_side: 'home' | 'away' | 'none';
    alert_rationale_en: string;
    alert_rationale_vi: string;
  } | null;
  ai_condition_reason?: string;
  ai_condition_reason_vi?: string;
  version?: 2;
  home_motivation_vi?: string;
  away_motivation_vi?: string;
  league_positions_vi?: string;
  fixture_congestion_vi?: string;
  home_fixture_congestion_vi?: string;
  away_fixture_congestion_vi?: string;
  rotation_risk_vi?: string;
  key_absences_vi?: string;
  home_key_absences_vi?: string;
  away_key_absences_vi?: string;
  h2h_narrative_vi?: string;
  summary_vi?: string;
  qualitative?: {
    en: {
      home_motivation: string;
      away_motivation: string;
      league_positions: string;
      fixture_congestion: string;
      home_fixture_congestion?: string;
      away_fixture_congestion?: string;
      rotation_risk: string;
      key_absences: string;
      home_key_absences?: string;
      away_key_absences?: string;
      h2h_narrative: string;
      summary: string;
    };
    vi: {
      home_motivation: string;
      away_motivation: string;
      league_positions: string;
      fixture_congestion: string;
      home_fixture_congestion?: string;
      away_fixture_congestion?: string;
      rotation_risk: string;
      key_absences: string;
      home_key_absences?: string;
      away_key_absences?: string;
      h2h_narrative: string;
      summary: string;
    };
  };
  quantitative?: {
    home_last5_points: number | null;
    away_last5_points: number | null;
    home_last5_goals_for: number | null;
    away_last5_goals_for: number | null;
    home_last5_goals_against: number | null;
    away_last5_goals_against: number | null;
    home_home_goals_avg: number | null;
    away_away_goals_avg: number | null;
    home_over_2_5_rate_last10: number | null;
    away_over_2_5_rate_last10: number | null;
    home_btts_rate_last10: number | null;
    away_btts_rate_last10: number | null;
    home_clean_sheet_rate_last10: number | null;
    away_clean_sheet_rate_last10: number | null;
    home_failed_to_score_rate_last10: number | null;
    away_failed_to_score_rate_last10: number | null;
  };
  source_meta?: {
    search_quality: 'high' | 'medium' | 'low' | 'unknown';
    web_search_queries: string[];
    sources: Array<{
      title: string;
      url: string;
      domain: string;
      publisher: string;
      language: 'en' | 'vi' | 'unknown';
      source_type: 'official' | 'major_news' | 'stats_reference' | 'aggregator' | 'unknown' | 'rejected';
      trust_tier: 'tier_1' | 'tier_2' | 'tier_3' | 'rejected';
    }>;
    trusted_source_count: number;
    rejected_source_count: number;
    rejected_domains: string[];
  };
  _meta?: {
    refresh_status?: 'good' | 'poor' | 'failed';
    failure_count?: number;
    last_attempt_at?: string;
    retry_after?: string | null;
    last_error?: string;
  };
}

export interface WatchlistItem {
  id?: number;
  match_id: string;
  date: string;
  kickoff_at_utc?: string | null;
  league: string;
  league_id?: number;
  league_name?: string;
  home_team: string;
  away_team: string;
  home_logo?: string;
  away_logo?: string;
  kickoff: string;
  mode: string;
  priority: number;
  custom_conditions: string;
  status: string;
  added_at?: string;
  prediction?: string;
  recommended_custom_condition?: string;
  recommended_condition_reason?: string;
  recommended_condition_reason_vi?: string;
  auto_apply_recommended_condition?: boolean;
  strategic_context?: StrategicContext | null;
  strategic_context_at?: string | null;
}

export interface Recommendation {
  id?: number;
  match_id?: string;
  match_display: string;
  home_team?: string;
  away_team?: string;
  league?: string;
  timestamp?: string;
  minute?: number | null;
  score?: string;
  actual_outcome?: string;
  bet_type: string;
  bet_market?: string;
  selection: string;
  odds: number | string;
  confidence: number | string;
  value_percent?: number | string | null;
  risk_level?: string;
  stake_percent?: number | string | null;
  stake_amount: number | string;
  reasoning?: string;
  reasoning_vi?: string;
  key_factors?: string;
  warnings?: string;
  ai_model?: string;
  result: string;
  pnl: number | string;
  ft_score?: string | null;
  settled_at?: string | null;
  settlement_status?: string;
  settlement_method?: string;
  settle_prompt_version?: string;
  settlement_note?: string;
  created_at?: string;
}

export interface RecommendationDelivery {
  id: number;
  user_id: string;
  recommendation_id: number;
  match_id: string;
  matched_condition: boolean;
  eligibility_status: string;
  delivery_status: string;
  delivery_channels: unknown[];
  delivered_at: string | null;
  hidden: boolean;
  dismissed: boolean;
  metadata: Record<string, unknown>;
  created_at: string;
  recommendation_timestamp: string | null;
  recommendation_minute: number | null;
  recommendation_score: string | null;
  recommendation_bet_type: string | null;
  recommendation_selection: string | null;
  recommendation_bet_market: string | null;
  recommendation_odds: number | null;
  recommendation_confidence: number | null;
  recommendation_value_percent: number | null;
  recommendation_risk_level: string | null;
  recommendation_stake_percent: number | null;
  recommendation_reasoning: string | null;
  recommendation_reasoning_vi: string | null;
  recommendation_key_factors: string | null;
  recommendation_warnings: string | null;
  recommendation_home_team: string | null;
  recommendation_away_team: string | null;
  recommendation_league: string | null;
  recommendation_result: string | null;
  recommendation_settlement_status: string | null;
  recommendation_settlement_note: string | null;
  recommendation_actual_outcome: string | null;
  recommendation_pnl: number | null;
}

export type NotificationChannelType = 'telegram' | 'zalo' | 'web_push' | 'email';
export type NotificationChannelStatus = 'draft' | 'pending' | 'verified' | 'disabled';

export interface NotificationChannelConfig {
  channelType: NotificationChannelType;
  enabled: boolean;
  status: NotificationChannelStatus;
  address: string | null;
  config: Record<string, unknown>;
  metadata: Record<string, unknown>;
}

export type LeagueTier = 'low' | 'balanced' | 'high';

export interface LeagueProfileData {
  tempo_tier:           LeagueTier;
  goal_tendency:        LeagueTier;
  home_advantage_tier:  LeagueTier;
  corners_tendency:     LeagueTier;
  cards_tendency:       LeagueTier;
  volatility_tier:      LeagueTier;
  data_reliability_tier: LeagueTier;
  avg_goals:            number | null;
  over_2_5_rate:        number | null;
  btts_rate:            number | null;
  late_goal_rate_75_plus: number | null;
  avg_corners:          number | null;
  avg_cards:            number | null;
}

export interface LeagueProfile {
  league_id:  number;
  profile:    LeagueProfileData;
  notes_en:   string;
  notes_vi:   string;
  created_at: string;
  updated_at: string;
}

export interface TeamProfileData {
  attack_style:          'counter' | 'direct' | 'possession' | 'mixed';
  defensive_line:        'low' | 'medium' | 'high';
  pressing_intensity:    'low' | 'medium' | 'high';
  set_piece_threat:      'low' | 'medium' | 'high';
  home_strength:         'weak' | 'normal' | 'strong';
  form_consistency:      'volatile' | 'inconsistent' | 'consistent';
  squad_depth:           'shallow' | 'medium' | 'deep';
  avg_goals_scored:      number | null;
  avg_goals_conceded:    number | null;
  clean_sheet_rate:      number | null;
  btts_rate:             number | null;
  over_2_5_rate:         number | null;
  avg_corners_for:       number | null;
  avg_corners_against:   number | null;
  avg_cards:             number | null;
  first_goal_rate:       number | null;
  late_goal_rate:        number | null;
  data_reliability_tier: 'low' | 'medium' | 'high';
}

export interface TeamProfile {
  team_id:    string;
  profile:    TeamProfileData;
  notes_en:   string;
  notes_vi:   string;
  tactical_overlay_source_mode?: 'default_neutral' | 'curated' | 'llm_assisted' | 'manual_override';
  tactical_overlay_source_confidence?: 'low' | 'medium' | 'high' | null;
  tactical_overlay_source_urls?: string[];
  tactical_overlay_source_season?: string | null;
  tactical_overlay_updated_at?: string | null;
  created_at: string;
  updated_at: string;
}

export interface League {
  league_id: number;
  league_name: string;
  country: string;
  tier: string;
  active: boolean;
  top_league: boolean;
  type: string;
  logo: string;
  last_updated: string;
  has_profile?: boolean;
  profile_updated_at?: string | null;
  profile_volatility_tier?: string | null;
  profile_data_reliability_tier?: string | null;
}

export interface TopLeagueProfileCoverageSummary {
  topLeagues: number;
  topLeagueProfiles: number;
  topLeagueTeams: number;
  topLeagueTeamsWithProfile: number;
  teamProfileCoverage: number | null;
  fullCoverageLeagues: number;
  partialCoverageLeagues: number;
  missingCoverageLeagues: number;
}

export interface TopLeagueProfileCoverageRow {
  leagueId: number;
  leagueName: string;
  country: string;
  hasLeagueProfile: boolean;
  candidateTeams: number;
  profiledTeams: number;
  missingTeamProfiles: number;
  teamProfileCoverage: number | null;
  missingTeamNames: string[];
}

export interface TopLeagueProfileCoverage {
  summary: TopLeagueProfileCoverageSummary;
  leagues: TopLeagueProfileCoverageRow[];
}

/** @deprecated Use League instead */
export type ApprovedLeague = League;

export interface LeagueFixture {
  fixture: {
    id: number;
    date: string;
    timestamp: number;
    venue: { name: string | null; city: string | null };
    status: { long: string; short: string; elapsed: number | null };
    referee: string | null;
  };
  league: { id: number; name: string; country: string; round: string; season: number };
  teams: {
    home: { id: number; name: string; logo: string; winner: boolean | null };
    away: { id: number; name: string; logo: string; winner: boolean | null };
  };
  goals: { home: number | null; away: number | null };
}

export interface LeagueInfo {
  name: string;
  country: string;
  tier: number;
}

export interface StatusBadgeInfo {
  label: string;
  class: string;
}

export interface SortState {
  column: string;
  order: 'asc' | 'desc';
}

export interface AppConfig {
  defaultMode: string;
  apiUrl: string;
}

// API response types
export interface ApiResponse<T> {
  resource: string;
  action: string;
  items?: T[];
  insertedCount?: number;
  updatedCount?: number;
  deletedCount?: number;
  ids?: string[];
}

export type TabName = 'dashboard' | 'matches' | 'leagues' | 'watchlist' | 'recommendations' | 'bet-tracker' | 'live-monitor' | 'reports' | 'settings';
