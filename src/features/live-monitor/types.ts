// ============================================================
// Live Monitor Pipeline Types
// 1:1 mapping from n8n "TFI - Live Monitor" workflow
// ============================================================

// ==================== Pipeline Config ====================

export interface LiveMonitorConfig {
  SPREADSHEET_ID: string;
  SHEET_IDS: {
    Watchlist: number;
    Recommendations: number;
    Matches: number;
    ApprovedLeagues: number;
  };
  TIMEZONE: string;
  MATCH_STARTED_THRESHOLD_MINUTES: number;
  MATCH_NOT_YET_STARTED_BUFFER_MINUTES: number;
  MIN_CONFIDENCE: number;
  MIN_ODDS: number;
  LATE_PHASE_MINUTE: number;
  VERY_LATE_PHASE_MINUTE: number;
  ENDGAME_MINUTE: number;
  AI_PROVIDER: 'gemini' | 'claude';
  AI_MODEL: string;
  EMAIL_TO: string;
  TELEGRAM_CHAT_ID: string;
  MANUAL_PUSH_MATCH_IDS: string[];
  NOTIFICATION_LANGUAGE: 'en' | 'vi' | 'both';
  UI_LANGUAGE?: 'en' | 'vi';
  TELEGRAM_ENABLED?: boolean;
  ZALO_ENABLED?: boolean;
  WEB_PUSH_ENABLED?: boolean;
  AUTO_APPLY_RECOMMENDED_CONDITION?: boolean;
  MIN_MINUTE?: number;
  MAX_MINUTE?: number;
  SECOND_HALF_START_MINUTE?: number;
  BATCH_SIZE?: number;
}

// ==================== Watchlist ====================

export interface WatchlistMatch {
  match_id: string;
  date: string;
  league: string;
  league_id?: number;
  league_name?: string;
  home_team: string;
  away_team: string;
  kickoff: string;
  mode: string;
  priority: number;
  custom_conditions: string;
  status: string;
  match_status?: string;
  added_at?: string;
  prediction?: string;
  recommended_custom_condition?: string;
  recommended_condition_reason?: string;
  recommended_condition_reason_vi?: string;
  auto_apply_recommended_condition?: boolean;
  pre_match_prediction_summary?: string;
  pre_match_prediction?: PreMatchPrediction | null;
  strategic_context?: unknown;
}

export interface FilteredMatch extends WatchlistMatch {
  force_analyze: boolean;
  is_manual_push: boolean;
}

// ==================== Football API Types ====================

export interface FixtureBatch {
  match_ids: string[];
}

export interface FootballApiFixture {
  fixture: {
    id: number;
    referee: string | null;
    timezone: string;
    date: string;
    timestamp: number;
    periods: { first: number | null; second: number | null };
    venue: { id: number | null; name: string | null; city: string | null };
    status: {
      long: string;
      short: string; // 1H, 2H, HT, FT, NS, etc.
      elapsed: number | null;
    };
  };
  league: {
    id: number;
    name: string;
    country: string;
    logo: string;
    flag: string | null;
    season: number;
    round: string;
  };
  teams: {
    home: { id: number; name: string; logo: string; winner: boolean | null };
    away: { id: number; name: string; logo: string; winner: boolean | null };
  };
  goals: {
    home: number | null;
    away: number | null;
  };
  score: {
    halftime: { home: number | null; away: number | null };
    fulltime: { home: number | null; away: number | null };
    extratime: { home: number | null; away: number | null };
    penalty: { home: number | null; away: number | null };
  };
  events: FootballApiEvent[];
  statistics: FootballApiStatistic[];
  // statistics[0] is home team, statistics[1] is away team
  // Each entry has .team and .statistics (array of {type, value})
  // predictions are optional
  predictions?: FootballApiPrediction;
}

export interface FootballApiEvent {
  time: { elapsed: number; extra: number | null };
  team: { id: number; name: string; logo: string };
  player: { id: number; name: string };
  assist: { id: number | null; name: string | null };
  type: string; // 'Goal', 'Card', 'subst', etc.
  detail: string; // 'Normal Goal', 'Yellow Card', 'Red Card', etc.
  comments: string | null;
}

export interface FootballApiStatistic {
  team: { id: number; name: string; logo: string };
  statistics: Array<{ type: string; value: number | string | null }>;
}

export interface FootballApiPrediction {
  predictions?: {
    winner?: { id: number | null; name: string | null; comment: string | null };
    win_or_draw?: boolean | null;
    under_over?: string | null;
    goals?: { home: string | null; away: string | null };
    advice?: string | null;
    percent?: { home: string | null; draw: string | null; away: string | null };
  };
  comparison?: {
    form?: { home: string | null; away: string | null };
    att?: { home: string | null; away: string | null };
    def?: { home: string | null; away: string | null };
    poisson_distribution?: { home: string | null; away: string | null };
    h2h?: { home: string | null; away: string | null };
    goals?: { home: string | null; away: string | null };
    total?: { home: string | null; away: string | null };
  };
}

// ==================== Live Odds Types ====================

export interface FootballApiOddsResponse {
  odds_source?: 'live' | 'pre-match' | 'the-odds-api';
  response: Array<{
    fixture: { id: number };
    update: string;
    league: { id: number; name: string; country: string; logo: string; flag: string; season: number };
    bookmakers: Array<{
      id: number;
      name: string;
      bets: Array<{
        id: number;
        name: string;
        values: Array<{
          value: string;
          odd: string;
          handicap?: string;
        }>;
      }>;
    }>;
  }>;
}

export interface OddsCanonical {
  '1x2'?: { home: number | null; draw: number | null; away: number | null };
  ou?: { line: number | null; over: number | null; under: number | null };
  ah?: { line: number | null; home: number | null; away: number | null };
  btts?: { yes: number | null; no: number | null };
  corners_ou?: { line: number | null; over: number | null; under: number | null };
}

// ==================== Pre-match Prediction ====================

export interface PreMatchPrediction {
  predictions?: {
    winner?: { name: string | null };
    win_or_draw?: boolean | null;
    goals?: { home: string | null; away: string | null };
    percent?: { home: string | null; draw: string | null; away: string | null };
  };
  comparison?: {
    form?: { home: string | null; away: string | null };
    total?: { home: string | null; away: string | null };
  };
}

export interface PreMatchCompact {
  pre_favourite: string | null;
  pre_win_or_draw: boolean | null;
  pre_handicap_home: string | null;
  pre_handicap_away: string | null;
  pre_percent: { home: string | null; draw: string | null; away: string | null } | null;
  pre_form: { home: string | null; away: string | null } | null;
  pre_total_rating: { home: string | null; away: string | null } | null;
}

// ==================== Merged Match Data ====================

export interface StatsCompact {
  possession?: { home: number | string | null; away: number | string | null };
  shots?: { home: number | string | null; away: number | string | null };
  shots_on_target?: { home: number | string | null; away: number | string | null };
  corners?: { home: number | string | null; away: number | string | null };
  fouls?: { home: number | string | null; away: number | string | null };
  offsides?: { home: number | string | null; away: number | string | null };
  yellow_cards?: { home: number | string | null; away: number | string | null };
  red_cards?: { home: number | string | null; away: number | string | null };
  goalkeeper_saves?: { home: number | string | null; away: number | string | null };
  blocked_shots?: { home: number | string | null; away: number | string | null };
  total_passes?: { home: number | string | null; away: number | string | null };
  passes_accurate?: { home: number | string | null; away: number | string | null };
}

export interface EventCompact {
  minute: number;
  extra: number | null;
  team: string;
  type: string;
  detail: string;
  player: string;
}

export interface StatsMeta {
  stats_quality?: string;
  missing_fields?: string[];
}

export interface DerivedMatchInsights {
  goal_tempo: number;
  btts_status: boolean;
  home_goals_timeline: number[];
  away_goals_timeline: number[];
  last_goal_minute: number | null;
  total_cards: number;
  home_cards: number;
  away_cards: number;
  home_reds: number;
  away_reds: number;
  home_subs: number;
  away_subs: number;
  momentum: 'home' | 'away' | 'neutral';
  intensity: 'low' | 'medium' | 'high';
  source: 'events';
}

export interface MergedMatchData {
  match_id: string;
  config: LiveMonitorConfig;
  match: {
    id: string;
    home: string;
    away: string;
    league: string;
    minute: number | string;
    score: string;
    status: string;
  };
  league: string;
  home_team: string;
  away_team: string;
  league_country?: string | null;
  kickoff_timestamp?: number | null;
  minute: number | string;
  score: string;
  status: string;
  mode: string;
  custom_conditions: string;
  recommended_custom_condition: string;
  recommended_condition_reason: string;
  recommended_condition_reason_vi: string;
  force_analyze: boolean;
  is_manual_push: boolean;
  skipped_filters: string[];
  original_would_proceed: boolean;
  stats_compact: StatsCompact;
  stats_available: boolean;
  stats_meta: StatsMeta;
  stats: {
    possession: string;
    shots: string;
    shots_on_target: string;
    corners: string;
    fouls: string;
  };
  events_compact: EventCompact[];
  events_summary: string;
  current_total_goals: number;
  odds_canonical: OddsCanonical;
  odds_available: boolean;
  odds_sanity_warnings: string[];
  odds_suspicious: boolean;
  odds_source?: 'live' | 'pre-match' | 'the-odds-api';
  derived_insights?: DerivedMatchInsights | null;
  pre_match_prediction: PreMatchPrediction | null;
  pre_match_prediction_summary: string;
  strategic_context: unknown;
}

// ==================== AI Prompt Context ====================

export interface PreviousRecommendation {
  minute: number | null;
  selection: string;
  bet_market: string;
  confidence: number | null;
  odds: number | null;
  reasoning: string;
  result: string;
  timestamp: string;
}

export interface MatchTimelineSnapshot {
  minute: number;
  score: string;
  possession: string;
  shots: string;
  shots_on_target: string;
  corners: string;
  fouls: string;
  yellow_cards: string;
  red_cards: string;
  goalkeeper_saves: string;
  status: string;
}

export interface AiPromptContext {
  previousRecommendations: PreviousRecommendation[];
  matchTimeline: MatchTimelineSnapshot[];
  historicalPerformance?: HistoricalPerformanceSummary | null;
  noHistoricalContext?: boolean;
}

export interface HistoricalPerformanceSummary {
  overall: { settled: number; correct: number; accuracy: number };
  byMarket: Array<{ market: string; settled: number; correct: number; accuracy: number }>;
  byConfidenceBand: Array<{ band: string; settled: number; correct: number; accuracy: number }>;
  byMinuteBand: Array<{ band: string; settled: number; correct: number; accuracy: number }>;
  byOddsRange: Array<{ range: string; settled: number; correct: number; accuracy: number }>;
  byLeague: Array<{ league: string; settled: number; correct: number; accuracy: number }>;
}

// ==================== Should Proceed ====================

export interface ProceedCheckResult {
  should_proceed: boolean;
  reason?: string;
  skipped_filters: string[];
}

// ==================== AI Analysis ====================

export interface AiAnalysisResult {
  should_push: boolean;
  selection: string;
  bet_market: string;
  market_chosen_reason: string;
  confidence: number;
  reasoning_en: string;
  reasoning_vi: string;
  warnings: string[];
  value_percent: number;
  risk_level: 'LOW' | 'MEDIUM' | 'HIGH';
  stake_percent: number;

  custom_condition_matched: boolean;
  custom_condition_status: 'none' | 'evaluated' | 'parse_error';
  custom_condition_summary_en: string;
  custom_condition_summary_vi: string;
  custom_condition_reason_en: string;
  custom_condition_reason_vi: string;

  condition_triggered_suggestion: string;
  condition_triggered_reasoning_en: string;
  condition_triggered_reasoning_vi: string;
  condition_triggered_confidence: number;
  condition_triggered_stake: number;
}

export interface ParsedAiResponse extends AiAnalysisResult {
  ai_should_push: boolean;
  system_should_bet: boolean;
  final_should_bet: boolean;
  ai_selection: string;
  ai_confidence: number;
  ai_odd_raw: number | null;
  ai_warnings: string[];
  usable_odd: number | null;
  mapped_odd: number | null;
  odds_for_display: number | string | null;
  condition_triggered_should_push: boolean;
}

// ==================== Recommendation ====================

export interface RecommendationData {
  unique_key: string;
  match_id: string;
  timestamp: string;
  match_display: string;
  league: string;
  home_team: string;
  away_team: string;
  minute: number | string | null;
  score: string;
  status: string;
  bet_type: string;
  selection: string;
  bet_market: string;
  odds: number | string | null;
  confidence: number;
  value_percent: number;
  risk_level: string;
  stake_percent: number;
  reasoning: string;
  key_factors: string;
  warnings: string;
  custom_condition_matched: boolean;
  custom_condition_raw: string;
  condition_triggered_suggestion: string;
  pre_match_prediction_summary: string;
  stats_snapshot: string;
  odds_snapshot: string;
  ai_model: string;
  mode: string;
  notified: string;
  notification_channels: string;
  execution_id: string;
  result: string;
  actual_outcome: string;
  pnl: number | null;
  settled_at: string | null;
}

// ==================== Notification ====================

export interface EmailPayload {
  email_to: string;
  email_subject: string;
  email_body_html: string;
}

export interface TelegramPayload {
  chat_id: string;
  text: string;
  parse_mode: 'HTML';
  /** When set, sends a sendPhoto with chart image; text becomes the caption */
  photo_url?: string;
}

// ==================== Pipeline ====================

export type PipelineStage =
  | 'idle'
  | 'loading-watchlist'
  | 'filtering'
  | 'fetching-live-data'
  | 'merging-data'
  | 'checking-proceed'
  | 'fetching-odds'
  | 'merging-odds'
  | 'checking-staleness'
  | 'fetching-context'
  | 'building-prompt'
  | 'ai-analysis'
  | 'parsing-response'
  | 'preparing-recommendation'
  | 'saving'
  | 'notifying'
  | 'complete'
  | 'error';

export interface PipelineContext {
  config: LiveMonitorConfig;
  stage: PipelineStage;
  startedAt: string;
  triggeredBy: 'manual' | 'scheduled' | 'webhook' | 'ask-ai';
  webhookMatchIds?: string[];
  error?: string;
  results: PipelineMatchResult[];
}

export interface PipelineMatchResult {
  matchId: string;
  matchDisplay: string;
  stage: PipelineStage;
  proceeded: boolean;
  recommendation?: RecommendationData;
  parsedAi?: ParsedAiResponse;
  notified: boolean;
  saved: boolean;
  skippedStale?: boolean;
  error?: string;
}

// ==================== Proxy Service ====================

export interface ProxyRequest {
  resource: string;
  action: string;
  data?: unknown;
  params?: Record<string, string>;
}

export interface ProxyResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
}
