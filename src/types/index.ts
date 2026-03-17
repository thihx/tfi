// ==================== Core Domain Types ====================

export interface Match {
  match_id: string;
  date: string;
  kickoff: string;
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
}

export interface WatchlistItem {
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
  added_at?: string;
  prediction?: string;
  recommended_custom_condition?: string;
  recommended_condition_reason_vi?: string;
}

export interface Recommendation {
  match_id?: string;
  match_display: string;
  home_team?: string;
  away_team?: string;
  bet_type: string;
  selection: string;
  odds: number | string;
  confidence: number | string;
  stake_amount: number | string;
  result: string;
  pnl: number | string;
  created_at?: string;
}

export interface ApprovedLeague {
  league_id: number;
  league_name: string;
  country: string;
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

export type TabName = 'dashboard' | 'matches' | 'watchlist' | 'recommendations' | 'live-monitor' | 'settings';
