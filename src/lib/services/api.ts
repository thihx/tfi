import type { AppConfig, Match, WatchlistItem, Recommendation, ApprovedLeague, ApiResponse } from '@/types';

// ==================== PG BACKEND (Fastify) ====================

async function pgFetch<T>(config: AppConfig, path: string): Promise<T> {
  const response = await fetch(`${config.apiUrl}${path}`, {
    method: 'GET',
    headers: { Accept: 'application/json' },
  });
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`HTTP ${response.status}: ${errorText.substring(0, 200)}`);
  }
  return response.json();
}

async function pgPost<T>(config: AppConfig, path: string, body: unknown): Promise<T> {
  const response = await fetch(`${config.apiUrl}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`HTTP ${response.status}: ${errorText.substring(0, 200)}`);
  }
  return response.json();
}

async function pgPut<T>(config: AppConfig, path: string, body: unknown): Promise<T> {
  const response = await fetch(`${config.apiUrl}${path}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`HTTP ${response.status}: ${errorText.substring(0, 200)}`);
  }
  return response.json();
}

async function pgDelete<T>(config: AppConfig, path: string, body?: unknown): Promise<T> {
  const response = await fetch(`${config.apiUrl}${path}`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`HTTP ${response.status}: ${errorText.substring(0, 200)}`);
  }
  return response.json();
}

// ==================== PUBLIC API ====================

export async function fetchMatches(config: AppConfig): Promise<Match[]> {
  return pgFetch<Match[]>(config, '/api/matches');
}

export async function fetchWatchlist(config: AppConfig): Promise<WatchlistItem[]> {
  return pgFetch<WatchlistItem[]>(config, '/api/watchlist');
}

export async function fetchRecommendations(config: AppConfig): Promise<Recommendation[]> {
  // Initial load: fetch recent 200 for state (lightweight)
  const data = await pgFetch<{ rows: Recommendation[]; total: number }>(config, '/api/recommendations?limit=200');
  return data.rows;
}

export interface PaginatedRecommendations {
  rows: Recommendation[];
  total: number;
}

export interface RecommendationQueryParams {
  limit?: number;
  offset?: number;
  result?: string;
  bet_type?: string;
  search?: string;
  sort_by?: string;
  sort_dir?: string;
}

export async function fetchRecommendationsPaginated(
  config: AppConfig,
  params: RecommendationQueryParams,
): Promise<PaginatedRecommendations> {
  const qs = new URLSearchParams();
  if (params.limit) qs.set('limit', String(params.limit));
  if (params.offset) qs.set('offset', String(params.offset));
  if (params.result && params.result !== 'all') qs.set('result', params.result);
  if (params.bet_type && params.bet_type !== 'all') qs.set('bet_type', params.bet_type);
  if (params.search) qs.set('search', params.search);
  if (params.sort_by) qs.set('sort_by', params.sort_by);
  if (params.sort_dir) qs.set('sort_dir', params.sort_dir);
  return pgFetch<PaginatedRecommendations>(config, `/api/recommendations?${qs.toString()}`);
}

export interface DashboardSummary {
  totalBets: number;
  wins: number;
  losses: number;
  pushes: number;
  pending: number;
  winRate: number;
  totalPnl: number;
  totalStaked: number;
  roi: number;
  streak: string;
  matchCount: number;
  watchlistCount: number;
  recCount: number;
  pnlTrend: Array<{ date: string; pnl: number; cumulative: number }>;
  recentRecs: Recommendation[];
}

export async function fetchDashboardSummary(config: AppConfig): Promise<DashboardSummary> {
  return pgFetch<DashboardSummary>(config, '/api/recommendations/dashboard');
}

export async function fetchBetTypes(config: AppConfig): Promise<string[]> {
  return pgFetch<string[]>(config, '/api/recommendations/bet-types');
}

export async function fetchApprovedLeagues(config: AppConfig): Promise<ApprovedLeague[]> {
  return pgFetch<ApprovedLeague[]>(config, '/api/leagues');
}

export async function createWatchlistItems(
  config: AppConfig,
  items: Partial<WatchlistItem>[],
): Promise<ApiResponse<WatchlistItem>> {
  const results: WatchlistItem[] = [];
  for (const item of items) {
    const created = await pgPost<WatchlistItem>(config, '/api/watchlist', item);
    results.push(created);
  }
  return { resource: 'watchlist', action: 'create', items: results, insertedCount: results.length };
}

export async function updateWatchlistItems(
  config: AppConfig,
  items: Partial<WatchlistItem>[],
): Promise<ApiResponse<WatchlistItem>> {
  const results: WatchlistItem[] = [];
  for (const item of items) {
    if (!item.match_id) continue;
    const updated = await pgPut<WatchlistItem>(config, `/api/watchlist/${item.match_id}`, item);
    results.push(updated);
  }
  return { resource: 'watchlist', action: 'update', items: results, updatedCount: results.length };
}

export async function deleteWatchlistItems(
  config: AppConfig,
  matchIds: string[],
): Promise<ApiResponse<WatchlistItem>> {
  for (const id of matchIds) {
    await pgDelete<{ deleted: boolean }>(config, `/api/watchlist/${id}`);
  }
  return { resource: 'watchlist', action: 'delete', items: [], deletedCount: matchIds.length };
}

// ==================== BETS ====================

export interface BetRecord {
  id: number;
  recommendation_id: number | null;
  match_id: string;
  placed_at: string;
  market: string;
  selection: string;
  odds: number;
  stake: number;
  bookmaker: string;
  result: string;
  pnl: number;
  settled_at: string | null;
}

export interface BetStats {
  total: number;
  won: number;
  lost: number;
  pending: number;
  total_pnl: number;
  roi: number;
}

export async function fetchBets(config: AppConfig): Promise<BetRecord[]> {
  return pgFetch<BetRecord[]>(config, '/api/bets');
}

export async function fetchBetsByMatch(config: AppConfig, matchId: string): Promise<BetRecord[]> {
  return pgFetch<BetRecord[]>(config, `/api/bets/match/${encodeURIComponent(matchId)}`);
}

export async function fetchBetStats(config: AppConfig): Promise<BetStats> {
  return pgFetch<BetStats>(config, '/api/bets/stats');
}

export async function fetchBetStatsByMarket(
  config: AppConfig,
): Promise<Array<{ market: string } & BetStats>> {
  return pgFetch<Array<{ market: string } & BetStats>>(config, '/api/bets/stats/by-market');
}

export async function createBet(
  config: AppConfig,
  bet: Omit<BetRecord, 'id' | 'placed_at' | 'result' | 'pnl' | 'settled_at'>,
): Promise<BetRecord> {
  return pgPost<BetRecord>(config, '/api/bets', bet);
}

// ==================== MATCH SNAPSHOTS ====================

export interface MatchSnapshot {
  id: number;
  match_id: string;
  captured_at: string;
  minute: number;
  status: string;
  home_score: number;
  away_score: number;
  stats: Record<string, unknown>;
  events: unknown[];
  odds: Record<string, unknown>;
}

export async function fetchSnapshotsByMatch(
  config: AppConfig,
  matchId: string,
): Promise<MatchSnapshot[]> {
  return pgFetch<MatchSnapshot[]>(config, `/api/snapshots/match/${encodeURIComponent(matchId)}`);
}

export async function fetchLatestSnapshot(
  config: AppConfig,
  matchId: string,
): Promise<MatchSnapshot | null> {
  const result = await pgFetch<MatchSnapshot | { snapshot: null }>(
    config,
    `/api/snapshots/match/${encodeURIComponent(matchId)}/latest`,
  );
  if ('snapshot' in result && result.snapshot === null) return null;
  return result as MatchSnapshot;
}

// ==================== ODDS HISTORY ====================

export interface OddsMovement {
  id: number;
  match_id: string;
  captured_at: string;
  match_minute: number | null;
  market: string;
  bookmaker: string;
  line: number | null;
  price_1: number | null;
  price_2: number | null;
  price_x: number | null;
}

export async function fetchOddsHistory(
  config: AppConfig,
  matchId: string,
  market?: string,
): Promise<OddsMovement[]> {
  const q = market ? `?market=${encodeURIComponent(market)}` : '';
  return pgFetch<OddsMovement[]>(config, `/api/odds/match/${encodeURIComponent(matchId)}${q}`);
}

// ==================== AI PERFORMANCE ====================

export interface AiAccuracyStats {
  total: number;
  correct: number;
  incorrect: number;
  pending: number;
  accuracy: number;
}

export interface AiModelStats {
  model: string;
  total: number;
  correct: number;
  accuracy: number;
}

export async function fetchAiStats(config: AppConfig): Promise<AiAccuracyStats> {
  return pgFetch<AiAccuracyStats>(config, '/api/ai-performance/stats');
}

export async function fetchAiStatsByModel(config: AppConfig): Promise<AiModelStats[]> {
  return pgFetch<AiModelStats[]>(config, '/api/ai-performance/stats/by-model');
}
