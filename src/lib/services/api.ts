import type { AppConfig, Match, WatchlistItem, Recommendation, ApprovedLeague, ApiResponse } from '@/types';

// ==================== API SERVICE ====================

async function apiFetch<T>(config: AppConfig, params: Record<string, string>): Promise<ApiResponse<T>> {
  const url = new URL(config.appsScriptUrl);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  url.searchParams.set('apiKey', config.apiKey);

  const response = await fetch(url.toString(), {
    method: 'GET',
    headers: { Accept: 'application/json' },
    mode: 'cors',
    credentials: 'omit',
    redirect: 'follow',
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`HTTP ${response.status}: ${response.statusText} - ${errorText}`);
  }

  return response.json();
}

async function apiPost<T>(config: AppConfig, body: Record<string, unknown>): Promise<ApiResponse<T>> {
  const response = await fetch(config.appsScriptUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ ...body, apiKey: config.apiKey }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`HTTP ${response.status}: ${errorText.substring(0, 200)}`);
  }

  return response.json();
}

// ==================== PUBLIC API ====================

export async function fetchMatches(config: AppConfig): Promise<Match[]> {
  const result = await apiFetch<Match>(config, { resource: 'matches', action: 'getAll' });
  return result.items || [];
}

export async function fetchWatchlist(config: AppConfig): Promise<WatchlistItem[]> {
  const result = await apiFetch<WatchlistItem>(config, { resource: 'watchlist', action: 'getAll' });
  return result.items || [];
}

export async function fetchRecommendations(config: AppConfig): Promise<Recommendation[]> {
  const result = await apiFetch<Recommendation>(config, { resource: 'recommendations', action: 'getAll' });
  return result.items || [];
}

export async function fetchApprovedLeagues(config: AppConfig): Promise<ApprovedLeague[]> {
  const result = await apiFetch<ApprovedLeague>(config, { resource: 'approved_leagues', action: 'getAll' });
  return result.items || [];
}

export async function createWatchlistItems(
  config: AppConfig,
  items: Partial<WatchlistItem>[],
): Promise<ApiResponse<WatchlistItem>> {
  return apiPost<WatchlistItem>(config, {
    resource: 'watchlist',
    action: 'create',
    data: items,
  });
}

export async function updateWatchlistItems(
  config: AppConfig,
  items: Partial<WatchlistItem>[],
): Promise<ApiResponse<WatchlistItem>> {
  return apiPost<WatchlistItem>(config, {
    resource: 'watchlist',
    action: 'update',
    data: items,
  });
}

export async function deleteWatchlistItems(
  config: AppConfig,
  matchIds: string[],
): Promise<ApiResponse<WatchlistItem>> {
  return apiPost<WatchlistItem>(config, {
    resource: 'watchlist',
    action: 'delete',
    ids: matchIds,
  });
}
