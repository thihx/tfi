import type { AppConfig, Match, WatchlistItem, Recommendation, ApprovedLeague, ApiResponse } from '@/types';

// ==================== BACKEND DETECTION ====================

function usePgBackend(config: AppConfig): boolean {
  return !!config.apiUrl;
}

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

// ==================== GOOGLE APPS SCRIPT (Legacy) ====================

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
  if (usePgBackend(config)) return pgFetch<Match[]>(config, '/api/matches');
  const result = await apiFetch<Match>(config, { resource: 'matches', action: 'getAll' });
  return result.items || [];
}

export async function fetchWatchlist(config: AppConfig): Promise<WatchlistItem[]> {
  if (usePgBackend(config)) return pgFetch<WatchlistItem[]>(config, '/api/watchlist');
  const result = await apiFetch<WatchlistItem>(config, { resource: 'watchlist', action: 'getAll' });
  return result.items || [];
}

export async function fetchRecommendations(config: AppConfig): Promise<Recommendation[]> {
  if (usePgBackend(config)) {
    const data = await pgFetch<{ rows: Recommendation[]; total: number }>(config, '/api/recommendations?limit=5000');
    return data.rows;
  }
  const result = await apiFetch<Recommendation>(config, { resource: 'recommendations', action: 'getAll' });
  return result.items || [];
}

export async function fetchApprovedLeagues(config: AppConfig): Promise<ApprovedLeague[]> {
  if (usePgBackend(config)) return pgFetch<ApprovedLeague[]>(config, '/api/leagues');
  const result = await apiFetch<ApprovedLeague>(config, { resource: 'approved_leagues', action: 'getAll' });
  return result.items || [];
}

export async function createWatchlistItems(
  config: AppConfig,
  items: Partial<WatchlistItem>[],
): Promise<ApiResponse<WatchlistItem>> {
  if (usePgBackend(config)) {
    const results: WatchlistItem[] = [];
    for (const item of items) {
      const created = await pgPost<WatchlistItem>(config, '/api/watchlist', item);
      results.push(created);
    }
    return { resource: 'watchlist', action: 'create', items: results, insertedCount: results.length };
  }
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
  if (usePgBackend(config)) {
    const results: WatchlistItem[] = [];
    for (const item of items) {
      if (!item.match_id) continue;
      const updated = await pgPut<WatchlistItem>(config, `/api/watchlist/${item.match_id}`, item);
      results.push(updated);
    }
    return { resource: 'watchlist', action: 'update', items: results, updatedCount: results.length };
  }
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
  if (usePgBackend(config)) {
    for (const id of matchIds) {
      await pgDelete<{ deleted: boolean }>(config, `/api/watchlist/${id}`);
    }
    return { resource: 'watchlist', action: 'delete', items: [], deletedCount: matchIds.length };
  }
  return apiPost<WatchlistItem>(config, {
    resource: 'watchlist',
    action: 'delete',
    ids: matchIds,
  });
}
