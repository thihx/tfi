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
  const data = await pgFetch<{ rows: Recommendation[]; total: number }>(config, '/api/recommendations?limit=5000');
  return data.rows;
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
