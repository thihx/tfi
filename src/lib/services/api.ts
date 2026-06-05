import type {
  AppConfig,
  Match,
  WatchlistItem,
  Recommendation,
  RecommendationDelivery,
  BankrollSnapshot,
  League,
  LeagueFixture,
  LeagueProfile,
  TopLeagueProfileCoverage,
  TeamProfile,
  TeamProfileData,
  ApiResponse,
} from '@/types';
import { internalApiUrl } from '@/lib/internal-api';

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

async function pgFetch<T>(config: AppConfig | string, path: string): Promise<T> {
  const response = await fetch(internalApiUrl(path, config), {
    method: 'GET',
    headers: { Accept: 'application/json', ...authHeader() },
    credentials: 'include',
    cache: 'no-store',
  });
  if (!response.ok) throw formatApiError(response.status, await response.text());
  return response.json();
}

async function pgPost<T>(config: AppConfig | string, path: string, body: unknown): Promise<T> {
  const response = await fetch(internalApiUrl(path, config), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...authHeader() },
    body: JSON.stringify(body),
    credentials: 'include',
  });
  if (!response.ok) throw formatApiError(response.status, await response.text());
  return response.json();
}

async function pgPatch<T>(config: AppConfig | string, path: string, body: unknown): Promise<T> {
  const response = await fetch(internalApiUrl(path, config), {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...authHeader() },
    body: JSON.stringify(body),
    credentials: 'include',
  });
  if (!response.ok) throw formatApiError(response.status, await response.text());
  return response.json();
}

async function pgPut<T>(config: AppConfig | string, path: string, body: unknown): Promise<T> {
  const response = await fetch(internalApiUrl(path, config), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...authHeader() },
    body: JSON.stringify(body),
    credentials: 'include',
  });
  if (!response.ok) throw formatApiError(response.status, await response.text());
  return response.json();
}

async function pgDelete<T>(config: AppConfig | string, path: string, body?: unknown): Promise<T> {
  const hasBody = body !== undefined;
  const response = await fetch(internalApiUrl(path, config), {
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

function normalizePositiveInteger(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isInteger(value) && value > 0) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    if (Number.isInteger(parsed) && parsed > 0) return parsed;
  }
  return undefined;
}

function normalizeWatchlistItem(item: WatchlistItem): WatchlistItem {
  const normalizedId = normalizePositiveInteger((item as WatchlistItem & { id?: unknown }).id);
  return normalizedId ? { ...item, id: normalizedId } : item;
}

// ==================== PUBLIC API ====================

export async function fetchMatches(config: AppConfig): Promise<Match[]> {
  return pgFetch<Match[]>(config, '/api/matches');
}

export async function fetchWatchlist(config: AppConfig): Promise<WatchlistItem[]> {
  const items = await pgFetch<WatchlistItem[]>(config, '/api/me/watch-subscriptions');
  return items.map(normalizeWatchlistItem);
}

export interface WatchConditionEvaluationResult {
  supported: boolean;
  matched: boolean;
  summary: string;
  notify_enabled: boolean;
  context_summary: {
    minute: number | null;
    home_goals: number;
    away_goals: number;
    data_source: string;
  };
}

export interface UserMatchAlertSettings {
  matchStartEnabled: boolean;
  manualMatchStartEnabled: boolean;
  favoriteTeamMatchStartEnabled: boolean;
  favoriteLeagueMatchStartEnabled: boolean;
  conditionAlertsEnabled: boolean;
  favoriteTeamConditionAlertsEnabled: boolean;
  favoriteLeagueConditionAlertsEnabled: boolean;
  kickoffLeadMinutes: number;
  defaultCooldownMinutes: number;
  channelPolicy: Record<string, unknown>;
}

export interface MatchAlertRule {
  id: number;
  userId: string;
  matchId: string | null;
  alertKind: 'match_start' | 'condition_signal';
  enabled: boolean;
  source: string;
  sourceRef: Record<string, unknown>;
  ruleJson: Record<string, unknown>;
  cooldownMinutes: number;
  oncePerMatch: boolean;
  channelPolicy: Record<string, unknown>;
  metadata: Record<string, unknown>;
}

export interface ConditionAlertPreset {
  id: string;
  label: string;
  labelVi: string;
  description: string;
  category: string;
  enabled: boolean;
  defaultCooldownMinutes: number;
  defaultOncePerMatch: boolean;
  sortOrder: number;
  ruleJson: Record<string, unknown>;
  source: 'system' | 'user';
}

export async function fetchMatchAlertSettings(config: AppConfig | string): Promise<UserMatchAlertSettings> {
  return pgFetch<UserMatchAlertSettings>(config, '/api/me/match-alert-settings');
}

export async function persistMatchAlertSettings(
  config: AppConfig | string,
  patch: Partial<UserMatchAlertSettings>,
): Promise<UserMatchAlertSettings> {
  return pgPut<UserMatchAlertSettings>(config, '/api/me/match-alert-settings', patch);
}

export async function fetchMatchAlertRules(
  config: AppConfig | string,
  options: { matchId?: string; alertKind?: MatchAlertRule['alertKind'] } = {},
): Promise<MatchAlertRule[]> {
  const qs = new URLSearchParams();
  if (options.matchId) qs.set('matchId', options.matchId);
  if (options.alertKind) qs.set('alertKind', options.alertKind);
  const suffix = qs.toString() ? `?${qs}` : '';
  return pgFetch<MatchAlertRule[]>(config, `/api/me/match-alert-rules${suffix}`);
}

export async function createMatchAlertRule(
  config: AppConfig | string,
  payload: {
    matchId: string;
    alertKind: MatchAlertRule['alertKind'];
    source?: string;
    presetId?: string;
    conditionText?: string;
    ruleJson?: Record<string, unknown>;
    cooldownMinutes?: number;
    oncePerMatch?: boolean;
    channelPolicy?: Record<string, unknown>;
    metadata?: Record<string, unknown>;
  },
): Promise<MatchAlertRule> {
  return pgPost<MatchAlertRule>(config, '/api/me/match-alert-rules', payload);
}

export async function deleteMatchAlertRule(config: AppConfig | string, ruleId: number): Promise<{ deleted: boolean }> {
  return pgDelete<{ deleted: boolean }>(config, `/api/me/match-alert-rules/${ruleId}`);
}

export async function fetchConditionAlertPresets(config: AppConfig | string): Promise<ConditionAlertPreset[]> {
  return pgFetch<ConditionAlertPreset[]>(config, '/api/me/match-alert-presets');
}

export async function persistConditionAlertPresets(
  config: AppConfig | string,
  presets: Array<Pick<ConditionAlertPreset, 'id' | 'enabled' | 'defaultCooldownMinutes' | 'ruleJson'>>,
): Promise<ConditionAlertPreset[]> {
  return pgPut<ConditionAlertPreset[]>(config, '/api/me/match-alert-presets', { presets });
}

export async function resetConditionAlertPresets(config: AppConfig | string): Promise<ConditionAlertPreset[]> {
  return pgPost<ConditionAlertPreset[]>(config, '/api/me/match-alert-presets/reset', {});
}

/** Preview condition evaluation against latest snapshot or match row (requires watch subscription). */
export async function evaluateWatchConditionPreview(
  config: AppConfig,
  payload: { condition_text: string; match_id: string },
): Promise<WatchConditionEvaluationResult> {
  return pgPost<WatchConditionEvaluationResult>(
    config,
    '/api/me/watch-subscriptions/evaluate-condition',
    payload,
  );
}

export async function fetchWatchlistItem(config: AppConfig, matchId: string): Promise<WatchlistItem | null> {
  try {
    const items = await fetchWatchlist(config);
    return items.find((item) => item.match_id === matchId) ?? null;
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

export interface ManualRecommendationSettlePayload {
  result: 'win' | 'loss' | 'push' | 'void' | 'half_win' | 'half_loss';
  pnl: number;
  actual_outcome?: string;
}

export type AdminUserRole = 'owner' | 'admin' | 'member';
export type AdminUserStatus = 'active' | 'disabled' | 'invited';

export interface AdminUserRecord {
  id: string;
  email: string;
  display_name: string;
  avatar_url: string;
  role: AdminUserRole;
  status: AdminUserStatus;
  created_at: string;
  updated_at: string;
}

export interface AdminUserUpdatePayload {
  role?: Extract<AdminUserRole, 'admin' | 'member'>;
  status?: Extract<AdminUserStatus, 'active' | 'disabled'>;
}

export type SubscriptionBillingInterval = 'manual' | 'month' | 'year';
export type SubscriptionStatus = 'trialing' | 'active' | 'past_due' | 'canceled' | 'expired' | 'paused';

export interface EntitlementCatalogEntry {
  key: string;
  label: string;
  description: string;
  category: 'ai' | 'watchlist' | 'notifications' | 'recommendations' | 'reports' | 'history';
  valueType: 'boolean' | 'number' | 'string_array';
  defaultValue: boolean | number | string[];
  enforced: boolean;
}

export interface SubscriptionPlanRecord {
  plan_code: string;
  display_name: string;
  description: string;
  billing_interval: SubscriptionBillingInterval;
  price_amount: string;
  currency: string;
  active: boolean;
  public: boolean;
  display_order: number;
  entitlements: Record<string, unknown>;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface UserSubscriptionRecord {
  id: number;
  user_id: string;
  plan_code: string;
  status: SubscriptionStatus;
  provider: string;
  provider_customer_id: string | null;
  provider_subscription_id: string | null;
  started_at: string;
  current_period_start: string | null;
  current_period_end: string | null;
  trial_ends_at: string | null;
  cancel_at_period_end: boolean;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface AdminSubscriptionUserRecord extends AdminUserRecord {
  subscription_plan_code: string | null;
  subscription_status: SubscriptionStatus | null;
  subscription_provider: string | null;
  subscription_current_period_end: string | null;
  subscription_cancel_at_period_end: boolean | null;
  subscription_updated_at: string | null;
}

export interface AdminSubscriptionPlanUpdatePayload {
  display_name?: string;
  description?: string;
  billing_interval?: SubscriptionBillingInterval;
  price_amount?: number;
  currency?: string;
  active?: boolean;
  public?: boolean;
  display_order?: number;
  entitlements?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

export interface AdminUserSubscriptionUpdatePayload {
  planCode: string;
  status: SubscriptionStatus;
  currentPeriodEnd?: string | null;
  cancelAtPeriodEnd?: boolean;
  metadata?: Record<string, unknown>;
}

export interface MeSubscriptionSnapshot {
  plan: SubscriptionPlanRecord;
  subscription: UserSubscriptionRecord | null;
  effectiveStatus: SubscriptionStatus | 'free_fallback';
  entitlements: Record<string, unknown>;
  usage: {
    manualAiDaily: {
      entitlementKey: string;
      periodKey: string;
      limit: number;
      used: number;
    };
  };
  catalog: EntitlementCatalogEntry[];
}

export interface FavoriteLeagueSelectionSnapshot {
  availableLeagues: League[];
  selectedLeagueIds: number[];
  favoriteLeaguesEnabled: boolean;
  favoriteLeagueLimit: number | null;
  watchlistActiveLimit: number | null;
  watchlistActiveCount: number;
}

export interface FavoriteLeagueApplyResult {
  error: string | null;
  limitExceeded: boolean;
  savedLeagueIds: number[];
  candidateMatches: number;
  alreadyWatched: number;
  newMatches: number;
  added: number;
  localDate: string;
  userTimeZone: string;
  currentWatchlistCount: number;
  watchlistActiveLimit: number | null;
  favoriteLeagueLimit: number | null;
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

export interface RecommendationListSummary {
  total: number;
  won: number;
  lost: number;
  push: number;
  voided: number;
  pending: number;
  review: number;
  pnl: number;
}

export interface RecommendationChartPoint {
  idx: number;
  cumulative: number;
}

function buildRecommendationQueryString(params: RecommendationQueryParams, keys?: Array<keyof RecommendationQueryParams>): string {
  const qs = new URLSearchParams();
  const entries: Array<[keyof RecommendationQueryParams, string | undefined]> = [
    ['limit', params.limit != null ? String(params.limit) : undefined],
    ['offset', params.offset != null ? String(params.offset) : undefined],
    ['result', params.result && params.result !== 'all' ? params.result : undefined],
    ['bet_type', params.bet_type && params.bet_type !== 'all' ? params.bet_type : undefined],
    ['search', params.search || undefined],
    ['league', params.league && params.league !== 'all' ? params.league : undefined],
    ['date_from', params.date_from || undefined],
    ['date_to', params.date_to || undefined],
    ['risk_level', params.risk_level && params.risk_level !== 'all' ? params.risk_level : undefined],
    ['sort_by', params.sort_by || undefined],
    ['sort_dir', params.sort_dir || undefined],
  ];
  for (const [key, value] of entries) {
    if (keys && !keys.includes(key)) continue;
    if (value) qs.set(key, value);
  }
  return qs.toString();
}

export interface PaginatedRecommendationDeliveries {
  rows: RecommendationDelivery[];
  total: number;
}

export interface RecommendationDeliveryQueryParams extends RecommendationQueryParams {
  matchId?: string;
  eligibilityStatus?: string;
  deliveryStatus?: string;
  deliveryKind?: 'actionable' | 'no_action' | 'all';
  includeHidden?: boolean;
  dismissed?: boolean;
}

export async function fetchRecommendationsPaginated(
  config: AppConfig,
  params: RecommendationQueryParams,
): Promise<PaginatedRecommendations> {
  const qs = buildRecommendationQueryString(params);
  return pgFetch<PaginatedRecommendations>(config, `/api/recommendations?${qs}`);
}

export async function fetchRecommendationsSummary(
  config: AppConfig,
  params: RecommendationQueryParams,
): Promise<RecommendationListSummary> {
  const qs = buildRecommendationQueryString(params, ['result', 'bet_type', 'search', 'league', 'date_from', 'date_to', 'risk_level']);
  return pgFetch<RecommendationListSummary>(config, `/api/recommendations/summary?${qs}`);
}

export async function fetchRecommendationsChartSeries(
  config: AppConfig,
  params: RecommendationQueryParams,
): Promise<RecommendationChartPoint[]> {
  const qs = buildRecommendationQueryString(params, ['result', 'bet_type', 'search', 'league', 'date_from', 'date_to', 'risk_level']);
  return pgFetch<RecommendationChartPoint[]>(config, `/api/recommendations/chart-series?${qs}`);
}

export async function fetchRecommendationDeliveriesPaginated(
  config: AppConfig,
  params: RecommendationDeliveryQueryParams,
): Promise<PaginatedRecommendationDeliveries> {
  const qs = new URLSearchParams(buildRecommendationQueryString(params));
  if (params.matchId) qs.set('matchId', params.matchId);
  if (params.eligibilityStatus && params.eligibilityStatus !== 'all') qs.set('eligibilityStatus', params.eligibilityStatus);
  if (params.deliveryStatus && params.deliveryStatus !== 'all') qs.set('deliveryStatus', params.deliveryStatus);
  if (params.deliveryKind && params.deliveryKind !== 'all') qs.set('delivery_kind', params.deliveryKind);
  if (typeof params.includeHidden === 'boolean') qs.set('includeHidden', String(params.includeHidden));
  if (typeof params.dismissed === 'boolean') qs.set('dismissed', String(params.dismissed));
  return pgFetch<PaginatedRecommendationDeliveries>(config, `/api/me/recommendation-deliveries?${qs.toString()}`);
}

export async function fetchRecommendationDeliveriesSummary(
  config: AppConfig,
  params: RecommendationDeliveryQueryParams,
): Promise<RecommendationListSummary> {
  const qs = new URLSearchParams(buildRecommendationQueryString(params, ['result', 'bet_type', 'search', 'league', 'date_from', 'date_to', 'risk_level']));
  if (params.deliveryKind && params.deliveryKind !== 'all') qs.set('delivery_kind', params.deliveryKind);
  return pgFetch<RecommendationListSummary>(config, `/api/me/recommendation-deliveries/summary?${qs}`);
}

export async function fetchRecommendationDeliveriesChartSeries(
  config: AppConfig,
  params: RecommendationDeliveryQueryParams,
): Promise<RecommendationChartPoint[]> {
  const qs = new URLSearchParams(buildRecommendationQueryString(params, ['result', 'bet_type', 'search', 'league', 'date_from', 'date_to', 'risk_level']));
  if (params.deliveryKind && params.deliveryKind !== 'all') qs.set('delivery_kind', params.deliveryKind);
  return pgFetch<RecommendationChartPoint[]>(config, `/api/me/recommendation-deliveries/chart-series?${qs}`);
}

export async function fetchMyBankroll(config: AppConfig): Promise<BankrollSnapshot> {
  return pgFetch<BankrollSnapshot>(config, '/api/me/bankroll');
}

export async function resetMyBankroll(
  config: AppConfig,
  payload: { balance: number; currency?: string; unitMultiplier?: number; note?: string },
): Promise<BankrollSnapshot> {
  return pgPut<BankrollSnapshot>(config, '/api/me/bankroll', payload);
}

export async function depositMyBankroll(
  config: AppConfig,
  payload: { amount: number; note?: string },
): Promise<BankrollSnapshot> {
  return pgPost<BankrollSnapshot>(config, '/api/me/bankroll/deposit', payload);
}

export async function withdrawMyBankroll(
  config: AppConfig,
  payload: { amount: number; note?: string },
): Promise<BankrollSnapshot> {
  return pgPost<BankrollSnapshot>(config, '/api/me/bankroll/withdraw', payload);
}

export async function settleRecommendationFinal(
  config: AppConfig,
  recommendationId: number,
  payload: ManualRecommendationSettlePayload,
): Promise<Recommendation> {
  return pgPut<Recommendation>(config, `/api/recommendations/${recommendationId}/settle`, payload);
}

export async function investInRecommendation(
  config: AppConfig,
  recommendationId: number,
  payload: {
    deliveryId?: number | null;
    odds?: number | string | null;
    stakePercent?: number | string | null;
    stakeAmount?: number | string | null;
    bookmaker?: string | null;
  },
): Promise<{ bet: BetRecord; bankroll: BankrollSnapshot }> {
  return pgPost<{ bet: BetRecord; bankroll: BankrollSnapshot }>(
    config,
    `/api/recommendations/${recommendationId}/invest`,
    payload,
  );
}

export interface RecommendationDeleteResponse {
  deletedRecommendationIds: number[];
  recommendationsDeleted: number;
  aiPerformanceDeleted: number;
  deliveriesDeleted: number;
  betsDeleted: number;
}

export async function deleteRecommendation(
  config: AppConfig,
  recommendationId: number,
): Promise<RecommendationDeleteResponse> {
  return pgDelete<RecommendationDeleteResponse>(config, `/api/recommendations/${recommendationId}`);
}

export async function deleteRecommendationsBulk(
  config: AppConfig,
  ids: number[],
): Promise<RecommendationDeleteResponse> {
  return pgDelete<RecommendationDeleteResponse>(config, '/api/recommendations/bulk', { ids });
}

export async function fetchAdminUsers(config: AppConfig | string): Promise<AdminUserRecord[]> {
  return pgFetch<AdminUserRecord[]>(config, '/api/settings/users');
}

export async function updateAdminUser(
  config: AppConfig | string,
  userId: string,
  payload: AdminUserUpdatePayload,
): Promise<AdminUserRecord> {
  return pgPatch<AdminUserRecord>(config, `/api/settings/users/${encodeURIComponent(userId)}`, payload);
}

export async function fetchEntitlementCatalog(config: AppConfig | string): Promise<{ catalog: EntitlementCatalogEntry[] }> {
  return pgFetch<{ catalog: EntitlementCatalogEntry[] }>(config, '/api/settings/subscription/catalog');
}

export async function fetchSubscriptionPlans(config: AppConfig | string): Promise<SubscriptionPlanRecord[]> {
  return pgFetch<SubscriptionPlanRecord[]>(config, '/api/settings/subscription/plans');
}

export async function updateSubscriptionPlan(
  config: AppConfig | string,
  planCode: string,
  payload: AdminSubscriptionPlanUpdatePayload,
): Promise<SubscriptionPlanRecord> {
  return pgPatch<SubscriptionPlanRecord>(config, `/api/settings/subscription/plans/${encodeURIComponent(planCode)}`, payload);
}

export async function fetchAdminUserSubscriptions(config: AppConfig | string): Promise<AdminSubscriptionUserRecord[]> {
  return pgFetch<AdminSubscriptionUserRecord[]>(config, '/api/settings/subscription/users');
}

export async function updateAdminUserSubscription(
  config: AppConfig | string,
  userId: string,
  payload: AdminUserSubscriptionUpdatePayload,
): Promise<UserSubscriptionRecord> {
  return pgPut<UserSubscriptionRecord>(config, `/api/settings/subscription/users/${encodeURIComponent(userId)}`, payload);
}

export async function fetchCurrentSubscription(config: AppConfig | string): Promise<MeSubscriptionSnapshot> {
  return pgFetch<MeSubscriptionSnapshot>(config, '/api/me/subscription');
}

export async function fetchFavoriteLeagueSelection(config: AppConfig | string): Promise<FavoriteLeagueSelectionSnapshot> {
  return pgFetch<FavoriteLeagueSelectionSnapshot>(config, '/api/me/watch-subscriptions/favorite-leagues');
}

export async function applyFavoriteLeaguesToWatchlist(
  config: AppConfig | string,
  leagueIds: number[],
): Promise<FavoriteLeagueApplyResult> {
  return pgPut<FavoriteLeagueApplyResult>(config, '/api/me/watch-subscriptions/favorite-leagues', { leagueIds });
}

export async function updateRecommendationDelivery(
  config: AppConfig,
  deliveryId: number,
  patch: { hidden?: boolean; dismissed?: boolean },
): Promise<{ updated: boolean }> {
  return pgPatch<{ updated: boolean }>(config, `/api/me/recommendation-deliveries/${deliveryId}`, patch);
}

export interface DashboardSummary {
  totalBets: number;
  wins: number;
  losses: number;
  pushes: number;
  halfWins: number;
  halfLosses: number;
  voids: number;
  directionalSettled: number;
  pushVoidSettled: number;
  pending: number;
  winRate: number;
  totalPnl: number;
  totalStaked: number;
  roi: number;
  streak: string;
  matchCount: number;
  watchlistCount: number;
  recCount: number;
  openExposureConcentration: ExposureSummary;
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

export async function fetchLeaguesInitData(config: AppConfig): Promise<{
  leagues: League[];
  favoriteTeamIds: string[];
  profiledTeamIds: string[];
}> {
  return pgFetch(config, '/api/leagues/init');
}

export async function fetchLeaguesProfileCoverage(config: AppConfig): Promise<TopLeagueProfileCoverage> {
  return pgFetch(config, '/api/leagues/profile-coverage');
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

export async function fetchLeaguesFromApi(config: AppConfig): Promise<{ fetched: number; upserted: number; mode: string }> {
  return pgPost<{ fetched: number; upserted: number; mode: string }>(config, '/api/leagues/fetch-from-api', {});
}

export async function toggleLeagueTopLeague(config: AppConfig, leagueId: number, topLeague: boolean): Promise<unknown> {
  return pgPut(config, `/api/leagues/${leagueId}/top-league`, { top_league: topLeague });
}

export async function bulkSetTopLeague(config: AppConfig, ids: number[], topLeague: boolean): Promise<{ updated: number }> {
  return pgPost<{ updated: number }>(config, '/api/leagues/bulk-top-league', { ids, top_league: topLeague });
}

export async function updateLeagueDisplayName(
  config: AppConfig,
  leagueId: number,
  displayName: string | null,
): Promise<{ league_id: number; display_name: string | null }> {
  return pgPut(config, `/api/leagues/${leagueId}/display-name`, { display_name: displayName });
}

export async function reorderLeaguesCatalog(config: AppConfig, orderedIds: number[]): Promise<{ updated: number }> {
  return pgPut(config, '/api/leagues/reorder', { ordered_ids: orderedIds });
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

export async function fetchAllTeamProfiles(config: AppConfig): Promise<(TeamProfile & { team_name: string; team_logo: string })[]> {
  return pgFetch(config, '/api/team-profiles');
}

export async function fetchTeamProfile(config: AppConfig, teamId: string): Promise<TeamProfile | null> {
  try {
    return await pgFetch<TeamProfile>(config, `/api/me/favorite-teams/${encodeURIComponent(teamId)}/profile`);
  } catch (err) {
    if (err instanceof ApiError && err.isNotFound) return null;
    throw err;
  }
}

export async function saveTeamProfile(
  config: AppConfig,
  teamId: string,
  payload: {
    profile: TeamProfileData;
    notes_en: string;
    notes_vi: string;
    overlay_metadata?: {
      source_mode?: 'default_neutral' | 'curated' | 'llm_assisted' | 'manual_override';
      source_confidence?: 'low' | 'medium' | 'high' | null;
      source_urls?: string[];
      source_season?: string | null;
    };
  },
): Promise<TeamProfile> {
  return pgPut<TeamProfile>(config, `/api/me/favorite-teams/${encodeURIComponent(teamId)}/profile`, payload);
}

export async function deleteTeamProfile(config: AppConfig, teamId: string): Promise<{ ok: boolean }> {
  return pgDelete<{ ok: boolean }>(config, `/api/me/favorite-teams/${encodeURIComponent(teamId)}/profile`);
}

export async function createWatchlistItems(
  config: AppConfig,
  items: Partial<WatchlistItem>[],
): Promise<ApiResponse<WatchlistItem>> {
  // async-parallel: run all creates concurrently instead of sequentially
  const results = await Promise.all(
    items.map((item) => pgPost<WatchlistItem>(config, '/api/me/watch-subscriptions', item)),
  );
  return { resource: 'watchlist', action: 'create', items: results.map(normalizeWatchlistItem), insertedCount: results.length };
}

export async function updateWatchlistItems(
  config: AppConfig,
  items: Partial<WatchlistItem>[],
): Promise<ApiResponse<WatchlistItem>> {
  const validItems = items.filter(
    (item): item is Partial<WatchlistItem> & { id: number | string; match_id: string } =>
      normalizePositiveInteger(item.id) !== undefined && !!item.match_id,
  );
  // async-parallel + PATCH for canonical subscription-scoped partial updates
  const results = await Promise.all(
    validItems.map((item) => {
      const normalizedId = normalizePositiveInteger(item.id)!;
      return pgPatch<WatchlistItem>(config, `/api/me/watch-subscriptions/${normalizedId}`, {
        ...item,
        id: normalizedId,
      });
    }),
  );
  return { resource: 'watchlist', action: 'update', items: results.map(normalizeWatchlistItem), updatedCount: results.length };
}

export async function deleteWatchlistItems(
  config: AppConfig,
  matchIds: string[],
): Promise<ApiResponse<WatchlistItem>> {
  const validIds = matchIds.filter(Boolean);
  // Delete by match_id — idempotent, no subscription ID lookup needed
  await Promise.all(
    validIds.map((matchId) => pgDelete<{ deleted: boolean }>(config, `/api/me/watch-subscriptions/by-match/${encodeURIComponent(matchId)}`)),
  );
  return { resource: 'watchlist', action: 'delete', items: [], deletedCount: validIds.length };
}

// ==================== BETS ====================

export interface BetRecord {
  id: number;
  user_id?: string | null;
  recommendation_id: number | null;
  delivery_id?: number | null;
  match_id: string;
  placed_at: string;
  market: string;
  bet_market?: string;
  selection: string;
  odds: number;
  stake: number;
  stake_amount?: number | null;
  stake_percent?: number | null;
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
  wins: number;
  losses: number;
  pushes: number;
  unsettled: number;
  total_pnl: number;
  win_rate: number;
  roi: number;
}

export interface BetMarketStats {
  market: string;
  total: number;
  wins: number;
  losses: number;
  pushes: number;
  unsettled: number;
  total_pnl: number;
  win_rate: number;
  roi: number;
}

export async function fetchBets(config: AppConfig): Promise<BetRecord[]> {
  const data = await pgFetch<{ rows: BetRecord[]; total: number } | BetRecord[]>(config, '/api/bets');
  const rows = Array.isArray(data) ? data : data.rows;
  return rows.map(normalizeBetRecord);
}

export async function fetchBetsByMatch(config: AppConfig, matchId: string): Promise<BetRecord[]> {
  const rows = await pgFetch<BetRecord[]>(config, `/api/bets/match/${encodeURIComponent(matchId)}`);
  return rows.map(normalizeBetRecord);
}

export async function fetchBetStats(config: AppConfig): Promise<BetStats> {
  return pgFetch<BetStats>(config, '/api/bets/stats');
}

export async function fetchBetStatsByMarket(
  config: AppConfig,
): Promise<BetMarketStats[]> {
  return pgFetch<BetMarketStats[]>(config, '/api/bets/stats/by-market');
}

export async function createBet(
  config: AppConfig,
  bet: Omit<BetRecord, 'id' | 'placed_at' | 'result' | 'pnl' | 'settled_at'>,
): Promise<BetRecord> {
  const response = await pgPost<BetRecord | { bet: BetRecord; bankroll?: BankrollSnapshot }>(config, '/api/bets', bet);
  return normalizeBetRecord('bet' in response ? response.bet : response);
}

function normalizeBetRecord(row: BetRecord): BetRecord {
  const stake = Number(row.stake ?? row.stake_amount ?? 0);
  return {
    ...row,
    market: row.market ?? row.bet_market ?? '',
    stake,
  };
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
  push: number;
  void: number;
  neutral: number;
  pending: number;
  pendingResult: number;
  reviewRequired: number;
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
  total: number; settled: number; directionalSettled: number; pushVoidSettled: number;
  wins: number; losses: number; pushes: number; halfWins: number; halfLosses: number; voids: number;
  pending: number; winRate: number; totalPnl: number;
  avgOdds: number; avgConfidence: number; roi: number;
  exposureConcentration: ExposureSummary;
  bestDay: { date: string; pnl: number } | null;
  worstDay: { date: string; pnl: number } | null;
}

export interface ExposureClusterRow {
  matchId: string;
  matchDisplay: string;
  thesisKey: string;
  label: string;
  count: number;
  settledCount: number;
  totalStake: number;
  totalPnl: number;
  latestMinute: number | null;
  canonicalMarkets: string[];
}

export interface ExposureSummary {
  stackedClusters: number;
  stackedRecommendations: number;
  stackedStake: number;
  maxClusterStake: number;
  topClusters: ExposureClusterRow[];
}

export interface MarketFamilyPerformanceRow {
  family: string;
  total: number;
  settled: number;
  pushVoid: number;
  wins: number;
  losses: number;
  winRate: number;
  totalStake: number;
  pnl: number;
  roi: number;
}

export interface LateEntryPerformanceRow {
  bucket: string;
  total: number;
  settled: number;
  pushVoid: number;
  wins: number;
  losses: number;
  winRate: number;
  totalStake: number;
  pnl: number;
  roi: number;
}

export interface LeagueReportRow {
  league: string; total: number; wins: number; losses: number; pushVoid: number;
  winRate: number; pnl: number; avgOdds: number; avgConfidence: number; roi: number;
}

export interface MarketReportRow {
  market: string; total: number; wins: number; losses: number; pushVoid: number;
  winRate: number; pnl: number; avgOdds: number; roi: number;
}

export interface TimeReportRow {
  period: string; periodStart: string; total: number; wins: number; losses: number; pushVoid: number;
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
  total: number; wins: number; losses: number; pushVoid: number; pnl: number;
}

export interface DayOfWeekRow {
  dayOfWeek: number; dayName: string; total: number; wins: number; losses: number; pushVoid: number;
  winRate: number; pnl: number;
}

export interface LeagueMarketRow {
  league: string; market: string; total: number; wins: number; losses: number; pushVoid: number;
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
  marketFamilies: MarketFamilyPerformanceRow[];
  lateEntries: LateEntryPerformanceRow[];
  sampleFloor: number;
  recentTrend: 'improving' | 'declining' | 'stable';
  recentWinRate: number;
  overallWinRate: number;
  streakInfo: { type: 'win' | 'loss'; count: number };
  valueFinds: number;
  safeBetAccuracy: number;
  modelPromptCohorts: Array<{ cohort: string; total: number; winRate: number; pnl: number; roi: number }>;
  prematchStrengthCohorts: Array<{ bucket: string; total: number; winRate: number; pnl: number; roi: number }>;
  profileCoverageCohorts: Array<{ bucket: string; total: number; winRate: number; pnl: number; roi: number }>;
  profileScopeCohorts: Array<{ bucket: string; total: number; winRate: number; pnl: number; roi: number }>;
  overlayCoverageCohorts: Array<{ bucket: string; total: number; winRate: number; pnl: number; roi: number }>;
  policyImpactCohorts: Array<{ bucket: string; total: number; winRate: number; pnl: number; roi: number }>;
  underBiasSummary: { total: number; underCount: number; nonUnderCount: number; underShare: number };
  underBiasMinuteBands: Array<{ bucket: string; total: number; underCount: number; underShare: number }>;
  underBiasScoreStates: Array<{ bucket: string; total: number; underCount: number; underShare: number }>;
  underBiasEvidenceModes: Array<{ bucket: string; total: number; underCount: number; underShare: number }>;
  underBiasPrematchStrengths: Array<{ bucket: string; total: number; underCount: number; underShare: number }>;
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

// ==================== FAVORITE TEAMS ====================

export interface LeagueTeam {
  team: { id: number; name: string; logo: string; country: string | null };
  rank: number | null;
}

export interface FavoriteTeam {
  team_id: string;
  team_name: string;
  team_logo: string;
  added_at: string;
}

export async function fetchLeagueTeams(config: AppConfig, leagueId: number): Promise<LeagueTeam[]> {
  return pgFetch<LeagueTeam[]>(config, `/api/proxy/football/league-teams?leagueId=${leagueId}`);
}

export async function fetchFavoriteTeams(config: AppConfig): Promise<FavoriteTeam[]> {
  return pgFetch<FavoriteTeam[]>(config, '/api/me/favorite-teams');
}

export async function addFavoriteTeam(config: AppConfig, team: { team_id: string; team_name: string; team_logo: string }): Promise<void> {
  await pgPost(config, '/api/me/favorite-teams', team);
}

export async function removeFavoriteTeam(config: AppConfig, teamId: string): Promise<void> {
  await pgDelete(config, `/api/me/favorite-teams/${encodeURIComponent(teamId)}`);
}
