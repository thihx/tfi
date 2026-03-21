import type { AppConfig, Match, WatchlistItem, Recommendation, League, LeagueFixture, LeagueProfile, ApiResponse } from '@/types';

// ==================== TYPED API ERROR ====================

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
  get isUnauthorized() { return this.status === 401; }
  get isNotFound() { return this.status === 404; }
  get isServerError() { return this.status >= 500; }
}

function formatApiError(status: number, text: string): ApiError {
  if (status === 401) {
    // Session expired or unauthorized — force refresh to show login screen.
    location.reload();
  }
  return new ApiError(status, `HTTP ${status}: ${text.substring(0, 200)}`);
}

// ==================== PG BACKEND (Fastify) ====================

function authHeader(): Record<string, string> {
  const token = localStorage.getItem('tfi_auth_token');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function pgFetch<T>(config: AppConfig, path: string): Promise<T> {
  const response = await fetch(`${config.apiUrl}${path}`, {
    method: 'GET',
    headers: { Accept: 'application/json', ...authHeader() },
    credentials: 'include',
  });
  if (!response.ok) throw formatApiError(response.status, await response.text());
  return response.json();
}

async function pgPost<T>(config: AppConfig, path: string, body: unknown): Promise<T> {
  const response = await fetch(`${config.apiUrl}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...authHeader() },
    body: JSON.stringify(body),
    credentials: 'include',
  });
  if (!response.ok) throw formatApiError(response.status, await response.text());
  return response.json();
}

async function pgPatch<T>(config: AppConfig, path: string, body: unknown): Promise<T> {
  const response = await fetch(`${config.apiUrl}${path}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...authHeader() },
    body: JSON.stringify(body),
    credentials: 'include',
  });
  if (!response.ok) throw formatApiError(response.status, await response.text());
  return response.json();
}

async function pgPut<T>(config: AppConfig, path: string, body: unknown): Promise<T> {
  const response = await fetch(`${config.apiUrl}${path}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...authHeader() },
    body: JSON.stringify(body),
    credentials: 'include',
  });
  if (!response.ok) throw formatApiError(response.status, await response.text());
  return response.json();
}

async function pgDelete<T>(config: AppConfig, path: string, body?: unknown): Promise<T> {
  const hasBody = body !== undefined;
  const response = await fetch(`${config.apiUrl}${path}`, {
    method: 'DELETE',
    headers: {
      Accept: 'application/json',
      ...authHeader(),
      ...(hasBody ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(hasBody ? { body: JSON.stringify(body) } : {}),
    credentials: 'include',
  });
  if (!response.ok) throw formatApiError(response.status, await response.text());
  return response.json();
}

// ==================== PUBLIC API ====================

export async function fetchMatches(config: AppConfig): Promise<Match[]> {
  return pgFetch<Match[]>(config, '/api/matches');
}

export async function fetchWatchlist(config: AppConfig): Promise<WatchlistItem[]> {
  return pgFetch<WatchlistItem[]>(config, '/api/watchlist');
}

export async function fetchWatchlistItem(config: AppConfig, matchId: string): Promise<WatchlistItem | null> {
  try {
    return await pgFetch<WatchlistItem>(config, `/api/watchlist/${encodeURIComponent(matchId)}`);
  } catch {
    return null;
  }
}

export async function fetchRecommendationsByMatch(
  config: AppConfig,
  matchId: string,
): Promise<Recommendation[]> {
  return pgFetch<Recommendation[]>(config, `/api/recommendations/match/${encodeURIComponent(matchId)}`);
}

export async function fetchRecommendations(config: AppConfig): Promise<Recommendation[]> {
  // Initial load: fetch first page only; RecommendationsTab handles full pagination
  const data = await pgFetch<{ rows: Recommendation[]; total: number }>(config, '/api/recommendations?limit=30');
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
  league?: string;
  date_from?: string;
  date_to?: string;
  risk_level?: string;
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
  if (params.league && params.league !== 'all') qs.set('league', params.league);
  if (params.date_from) qs.set('date_from', params.date_from);
  if (params.date_to) qs.set('date_to', params.date_to);
  if (params.risk_level && params.risk_level !== 'all') qs.set('risk_level', params.risk_level);
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

export async function fetchDistinctLeagues(config: AppConfig): Promise<string[]> {
  return pgFetch<string[]>(config, '/api/recommendations/leagues');
}

// ==================== Match Scout ====================

export interface MatchScoutData {
  fixture: {
    fixture: { id: number; referee: string | null; venue: { name: string | null; city: string | null }; status: { short: string; elapsed: number | null }; periods: { first: number | null; second: number | null } };
    league: { id: number; name: string; country: string; logo: string; round: string; season: number };
    teams: { home: { id: number; name: string; logo: string }; away: { id: number; name: string; logo: string } };
    goals: { home: number | null; away: number | null };
  } | null;
  prediction: {
    predictions: { winner: { name: string } | null; advice: string; percent: { home: string; draw: string; away: string } | null; under_over: string | null };
    comparison: { form: { home: string; away: string } | null; att: { home: string; away: string } | null; def: { home: string; away: string } | null };
    h2h?: Array<{ fixture: { date: string }; teams: { home: { name: string; winner: boolean | null }; away: { name: string; winner: boolean | null } }; goals: { home: number | null; away: number | null } }>;
    teams?: { home: { name: string; league?: { form?: string } }; away: { name: string; league?: { form?: string } } };
  } | null;
  events: Array<{ time: { elapsed: number; extra: number | null }; team: { name: string }; player: { name: string | null }; assist: { name: string | null }; type: string; detail: string }>;
  statistics: Array<{ team: { name: string }; statistics: Array<{ type: string; value: string | number | null }> }>;
  lineups: Array<{ team: { name: string; logo: string }; formation: string; coach: { name: string | null }; startXI: Array<{ player: { name: string; number: number; pos: string; grid: string | null } }>; substitutes: Array<{ player: { name: string; number: number; pos: string } }> }>;
  standings: Array<{ rank: number; team: { name: string; logo: string }; points: number; goalsDiff: number; form: string; all: { played: number; win: number; draw: number; lose: number; goals: { for: number; against: number } } }>;
}

export async function fetchMatchScout(
  config: AppConfig,
  fixtureId: string,
  opts: { leagueId?: number; season?: number; status?: string },
): Promise<MatchScoutData> {
  return pgPost<MatchScoutData>(config, '/api/proxy/football/scout', {
    fixtureId, leagueId: opts.leagueId, season: opts.season, status: opts.status,
  });
}

export async function fetchApprovedLeagues(config: AppConfig): Promise<League[]> {
  return pgFetch<League[]>(config, '/api/leagues');
}

export async function fetchActiveLeagues(config: AppConfig): Promise<League[]> {
  return pgFetch<League[]>(config, '/api/leagues/active');
}

export async function fetchLeagueFixtures(
  config: AppConfig,
  leagueId: number,
  season?: number,
  next = 10,
): Promise<LeagueFixture[]> {
  const params = new URLSearchParams({ leagueId: String(leagueId), next: String(next) });
  if (season) params.set('season', String(season));
  return pgFetch<LeagueFixture[]>(config, `/api/proxy/football/league-fixtures?${params}`);
}

export async function toggleLeagueActive(config: AppConfig, leagueId: number, active: boolean): Promise<unknown> {
  return pgPut(config, `/api/leagues/${leagueId}/active`, { active });
}

export async function bulkSetLeagueActive(config: AppConfig, ids: number[], active: boolean): Promise<{ updated: number }> {
  return pgPost<{ updated: number }>(config, '/api/leagues/bulk-active', { ids, active });
}

export async function fetchLeaguesFromApi(config: AppConfig): Promise<{ fetched: number; upserted: number }> {
  return pgPost<{ fetched: number; upserted: number }>(config, '/api/leagues/fetch-from-api', {});
}

export async function toggleLeagueTopLeague(config: AppConfig, leagueId: number, topLeague: boolean): Promise<unknown> {
  return pgPut(config, `/api/leagues/${leagueId}/top-league`, { top_league: topLeague });
}

export async function bulkSetTopLeague(config: AppConfig, ids: number[], topLeague: boolean): Promise<{ updated: number }> {
  return pgPost<{ updated: number }>(config, '/api/leagues/bulk-top-league', { ids, top_league: topLeague });
}

export async function fetchLeagueProfiles(config: AppConfig): Promise<LeagueProfile[]> {
  return pgFetch<LeagueProfile[]>(config, '/api/league-profiles');
}

export async function fetchLeagueProfile(config: AppConfig, leagueId: number): Promise<LeagueProfile | null> {
  try {
    return await pgFetch<LeagueProfile>(config, `/api/leagues/${leagueId}/profile`);
  } catch (err) {
    if (err instanceof ApiError && err.isNotFound) return null;
    throw err;
  }
}

export async function saveLeagueProfile(
  config: AppConfig,
  leagueId: number,
  profile: Omit<LeagueProfile, 'league_id' | 'created_at' | 'updated_at'>,
): Promise<LeagueProfile> {
  return pgPut<LeagueProfile>(config, `/api/leagues/${leagueId}/profile`, profile);
}

export async function deleteLeagueProfile(config: AppConfig, leagueId: number): Promise<{ league_id: number; deleted: boolean }> {
  return pgDelete<{ league_id: number; deleted: boolean }>(config, `/api/leagues/${leagueId}/profile`);
}

export async function createWatchlistItems(
  config: AppConfig,
  items: Partial<WatchlistItem>[],
): Promise<ApiResponse<WatchlistItem>> {
  // async-parallel: run all creates concurrently instead of sequentially
  const results = await Promise.all(
    items.map((item) => pgPost<WatchlistItem>(config, '/api/watchlist', item)),
  );
  return { resource: 'watchlist', action: 'create', items: results, insertedCount: results.length };
}

export async function updateWatchlistItems(
  config: AppConfig,
  items: Partial<WatchlistItem>[],
): Promise<ApiResponse<WatchlistItem>> {
  const validItems = items.filter((item): item is Partial<WatchlistItem> & { match_id: string } => !!item.match_id);
  // async-parallel + PATCH for partial updates
  const results = await Promise.all(
    validItems.map((item) => pgPatch<WatchlistItem>(config, `/api/watchlist/${item.match_id}`, item)),
  );
  return { resource: 'watchlist', action: 'update', items: results, updatedCount: results.length };
}

export async function deleteWatchlistItems(
  config: AppConfig,
  matchIds: string[],
): Promise<ApiResponse<WatchlistItem>> {
  // async-parallel: run all deletes concurrently
  await Promise.all(matchIds.map((id) => pgDelete<{ deleted: boolean }>(config, `/api/watchlist/${id}`)));
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
  const data = await pgFetch<{ rows: BetRecord[]; total: number } | BetRecord[]>(config, '/api/bets');
  return Array.isArray(data) ? data : data.rows;
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

// ==================== REPORTS ====================

export interface ReportPeriodFilter {
  dateFrom?: string;
  dateTo?: string;
  period?: 'today' | '7d' | '30d' | '90d' | 'this-week' | 'this-month' | 'all';
}

function buildReportQs(filter: ReportPeriodFilter): string {
  const qs = new URLSearchParams();
  if (filter.dateFrom) qs.set('dateFrom', filter.dateFrom);
  if (filter.dateTo) qs.set('dateTo', filter.dateTo);
  if (filter.period) qs.set('period', filter.period);
  const s = qs.toString();
  return s ? `?${s}` : '';
}

export interface OverviewReport {
  total: number; settled: number; wins: number; losses: number;
  pushes: number; pending: number; winRate: number; totalPnl: number;
  avgOdds: number; avgConfidence: number; roi: number;
  bestDay: { date: string; pnl: number } | null;
  worstDay: { date: string; pnl: number } | null;
}

export interface LeagueReportRow {
  league: string; total: number; wins: number; losses: number; pushes: number;
  winRate: number; pnl: number; avgOdds: number; avgConfidence: number; roi: number;
}

export interface MarketReportRow {
  market: string; total: number; wins: number; losses: number;
  winRate: number; pnl: number; avgOdds: number; roi: number;
}

export interface TimeReportRow {
  period: string; periodStart: string; total: number; wins: number; losses: number;
  winRate: number; pnl: number; cumPnl: number; avgOdds: number; roi: number;
}

export interface ConfidenceBandRow {
  band: string; range: string; total: number; wins: number; losses: number;
  winRate: number; expectedWinRate: number; pnl: number; avgOdds: number;
}

export interface OddsRangeRow {
  range: string; total: number; wins: number; losses: number;
  winRate: number; pnl: number; avgConfidence: number;
}

export interface MinuteBandRow {
  band: string; total: number; wins: number; losses: number;
  winRate: number; pnl: number; avgOdds: number;
}

export interface DailyPnlRow {
  date: string; dayOfWeek: number; dayName: string;
  total: number; wins: number; losses: number; pnl: number;
}

export interface DayOfWeekRow {
  dayOfWeek: number; dayName: string; total: number; wins: number; losses: number;
  winRate: number; pnl: number;
}

export interface LeagueMarketRow {
  league: string; market: string; total: number; wins: number; losses: number;
  winRate: number; pnl: number;
}

export interface AiInsightsData {
  strongLeagues: Array<{ league: string; winRate: number; pnl: number; total: number }>;
  weakLeagues: Array<{ league: string; winRate: number; pnl: number; total: number }>;
  strongMarkets: Array<{ market: string; winRate: number; pnl: number; total: number }>;
  weakMarkets: Array<{ market: string; winRate: number; pnl: number; total: number }>;
  bestTimeSlots: Array<{ band: string; winRate: number; pnl: number; total: number }>;
  worstTimeSlots: Array<{ band: string; winRate: number; pnl: number; total: number }>;
  overconfidentBands: Array<{ band: string; avgConfidence: number; actualWinRate: number; gap: number }>;
  recentTrend: 'improving' | 'declining' | 'stable';
  recentWinRate: number;
  overallWinRate: number;
  streakInfo: { type: 'win' | 'loss'; count: number };
  valueFinds: number;
  safeBetAccuracy: number;
}

export async function fetchOverviewReport(config: AppConfig, f: ReportPeriodFilter): Promise<OverviewReport> {
  return pgFetch<OverviewReport>(config, `/api/reports/overview${buildReportQs(f)}`);
}
export async function fetchLeagueReport(config: AppConfig, f: ReportPeriodFilter): Promise<LeagueReportRow[]> {
  return pgFetch<LeagueReportRow[]>(config, `/api/reports/by-league${buildReportQs(f)}`);
}
export async function fetchMarketReport(config: AppConfig, f: ReportPeriodFilter): Promise<MarketReportRow[]> {
  return pgFetch<MarketReportRow[]>(config, `/api/reports/by-market${buildReportQs(f)}`);
}
export async function fetchWeeklyReport(config: AppConfig, f: ReportPeriodFilter): Promise<TimeReportRow[]> {
  return pgFetch<TimeReportRow[]>(config, `/api/reports/weekly${buildReportQs(f)}`);
}
export async function fetchMonthlyReport(config: AppConfig, f: ReportPeriodFilter): Promise<TimeReportRow[]> {
  return pgFetch<TimeReportRow[]>(config, `/api/reports/monthly${buildReportQs(f)}`);
}
export async function fetchConfidenceReport(config: AppConfig, f: ReportPeriodFilter): Promise<ConfidenceBandRow[]> {
  return pgFetch<ConfidenceBandRow[]>(config, `/api/reports/confidence${buildReportQs(f)}`);
}
export async function fetchOddsRangeReport(config: AppConfig, f: ReportPeriodFilter): Promise<OddsRangeRow[]> {
  return pgFetch<OddsRangeRow[]>(config, `/api/reports/odds-range${buildReportQs(f)}`);
}
export async function fetchMinuteReport(config: AppConfig, f: ReportPeriodFilter): Promise<MinuteBandRow[]> {
  return pgFetch<MinuteBandRow[]>(config, `/api/reports/by-minute${buildReportQs(f)}`);
}
export async function fetchDailyPnlReport(config: AppConfig, f: ReportPeriodFilter): Promise<DailyPnlRow[]> {
  return pgFetch<DailyPnlRow[]>(config, `/api/reports/daily-pnl${buildReportQs(f)}`);
}
export async function fetchDayOfWeekReport(config: AppConfig, f: ReportPeriodFilter): Promise<DayOfWeekRow[]> {
  return pgFetch<DayOfWeekRow[]>(config, `/api/reports/day-of-week${buildReportQs(f)}`);
}
export async function fetchLeagueMarketReport(config: AppConfig, f: ReportPeriodFilter): Promise<LeagueMarketRow[]> {
  return pgFetch<LeagueMarketRow[]>(config, `/api/reports/league-market${buildReportQs(f)}`);
}
export async function fetchAiInsights(config: AppConfig, f: ReportPeriodFilter): Promise<AiInsightsData> {
  return pgFetch<AiInsightsData>(config, `/api/reports/ai-insights${buildReportQs(f)}`);
}
