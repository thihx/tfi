import type { LeagueInfo, StatusBadgeInfo } from '@/types';

// ==================== LEAGUE CODE MAPPING ====================
export const LEAGUE_CODES: Record<number, string> = {
  39: 'ENG D1', 40: 'ENG D2', 140: 'ESP D1', 135: 'ITA D1',
  78: 'GER D1', 61: 'FRA D1', 2: 'UCL', 3: 'UEL', 848: 'UECL',
  12: 'CAF CL', 94: 'POR D1', 88: 'NED D1', 144: 'BEL D1',
  203: 'TUR D1', 113: 'SWE D1', 119: 'DEN D1', 106: 'POL D1',
  103: 'NOR D1', 210: 'CRO D1', 283: 'ROM D1', 345: 'CZE D1',
  286: 'SRB D1', 307: 'SAU D1', 564: 'UAE D1', 202: 'QAT D1',
  274: 'IND D1', 292: 'KOR D1', 252: 'JPN D1', 188: 'AUS D1',
  266: 'CHN D1', 271: 'THA D1', 289: 'VIE D1', 71: 'BRA D1',
  128: 'ARG D1', 262: 'MEX D1', 253: 'USA D1', 242: 'COL D1',
  235: 'RUS D1', 218: 'UKR D1',
};

// ==================== TOP LEAGUES CONFIGURATION ====================
export const TOP_LEAGUES: Record<number, LeagueInfo> = {
  39: { name: 'Premier League', country: 'England', tier: 1 },
  140: { name: 'La Liga', country: 'Spain', tier: 1 },
  135: { name: 'Serie A', country: 'Italy', tier: 1 },
  78: { name: 'Bundesliga', country: 'Germany', tier: 1 },
  61: { name: 'Ligue 1', country: 'France', tier: 1 },
  2: { name: 'UEFA Champions League', country: 'Europe', tier: 1 },
  3: { name: 'UEFA Europa League', country: 'Europe', tier: 1 },
  94: { name: 'Primeira Liga', country: 'Portugal', tier: 2 },
  88: { name: 'Eredivisie', country: 'Netherlands', tier: 2 },
  144: { name: 'Jupiler Pro League', country: 'Belgium', tier: 2 },
  203: { name: 'Süper Lig', country: 'Turkey', tier: 2 },
  71: { name: 'Serie A', country: 'Brazil', tier: 2 },
  128: { name: 'Liga Profesional', country: 'Argentina', tier: 2 },
  848: { name: 'UEFA Conference League', country: 'Europe', tier: 2 },
  262: { name: 'Liga MX', country: 'Mexico', tier: 3 },
  253: { name: 'Major League Soccer', country: 'USA', tier: 3 },
  307: { name: 'Pro League', country: 'Saudi Arabia', tier: 3 },
  252: { name: 'J1 League', country: 'Japan', tier: 3 },
  235: { name: 'Premier League', country: 'Russia', tier: 3 },
};

export const LEAGUE_TIERS: Record<string, number[]> = {
  tier1: [39, 140, 135, 78, 61, 2, 3],
  tier2: [94, 88, 144, 203, 71, 128, 848],
  tier3: [262, 253, 307, 252, 235],
};

// ==================== STATUS BADGES ====================
export const STATUS_BADGES: Record<string, StatusBadgeInfo> = {
  NS: { label: 'Not Started', class: 'badge-ns' },
  FT: { label: 'Finished', class: 'badge-ft' },
  '1H': { label: '', class: 'badge-live', hidden: true },
  '2H': { label: '', class: 'badge-live', hidden: true },
  HT: { label: 'HT', class: 'badge-pending' },
  ET: { label: '', class: 'badge-live', hidden: true },
  P: { label: '', class: 'badge-live', hidden: true },
  BT: { label: '', class: 'badge-live', hidden: true },
  LIVE: { label: '', class: 'badge-live', hidden: true },
  INT: { label: 'Interrupted', class: 'badge-pending' },
  PST: { label: 'Postponed', class: 'badge-pending' },
  CANC: { label: 'Cancelled', class: 'badge-pending' },
  ABD: { label: 'Abandoned', class: 'badge-pending' },
  SUSP: { label: 'Suspended', class: 'badge-pending' },
  AWD: { label: 'Awarded', class: 'badge-ft' },
  // Recommendation result statuses
  WIN: { label: 'Won', class: 'badge-won' },
  LOSS: { label: 'Lost', class: 'badge-lost' },
  HALF_WIN: { label: 'Half Won', class: 'badge-won' },
  HALF_LOSS: { label: 'Half Lost', class: 'badge-lost' },
  PUSH: { label: 'Push', class: 'badge-pending' },
  VOID: { label: 'Void', class: 'badge-pending' },
};

export const LIVE_STATUSES = ['1H', '2H', 'HT', 'ET', 'BT', 'P', 'LIVE', 'INT'];

// ==================== MARKET COLORS ====================
export const MARKET_COLORS: Record<string, string> = {
  '1x2':            '#10b981',
  'Over/Under':     '#3b82f6',
  'Asian Handicap': '#8b5cf6',
  'BTTS':           '#f59e0b',
  'Double Chance':  '#06b6d4',
  Other:            '#6b7280',
};

// ==================== BET RESULT BADGES ====================
export const BET_RESULT_BADGES: Record<string, { cls: string; label: string }> = {
  win:     { cls: 'badge-won',     label: 'Won' },
  loss:    { cls: 'badge-lost',    label: 'Lost' },
  half_win:{ cls: 'badge-won',     label: 'Half Won' },
  half_loss:{ cls: 'badge-lost',   label: 'Half Lost' },
  push:    { cls: 'badge-pending', label: 'Push' },
  void:    { cls: 'badge-pending', label: 'Void' },
  pending: { cls: 'badge-ns',      label: 'Pending' },
};

// ==================== SVG PLACEHOLDERS ====================
export const PLACEHOLDER_HOME = "data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%2224%22 height=%2224%22%3E%3Crect fill=%22%23e5e7eb%22 width=%2224%22 height=%2224%22 rx=%224%22/%3E%3Ctext x=%2250%25%22 y=%2250%25%22 dominant-baseline=%22middle%22 text-anchor=%22middle%22 font-size=%2212%22 font-weight=%22bold%22 fill=%22%23374151%22%3EH%3C/text%3E%3C/svg%3E";
export const PLACEHOLDER_AWAY = "data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%2224%22 height=%2224%22%3E%3Crect fill=%22%23e5e7eb%22 width=%2224%22 height=%2224%22 rx=%224%22/%3E%3Ctext x=%2250%25%22 y=%2250%25%22 dominant-baseline=%22middle%22 text-anchor=%22middle%22 font-size=%2212%22 font-weight=%22bold%22 fill=%22%23374151%22%3EA%3C/text%3E%3C/svg%3E";
