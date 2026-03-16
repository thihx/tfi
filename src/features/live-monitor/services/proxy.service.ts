// ============================================================
// Proxy Service
// Routes external API calls through Google Apps Script (GAS)
// or the PG backend when config.apiUrl is set.
// Football API, AI, and notifications always go through GAS.
// ============================================================

import type { AppConfig } from '@/types';
import type {
  FootballApiFixture,
  FootballApiOddsResponse,
  EmailPayload,
  TelegramPayload,
  WatchlistMatch,
  RecommendationData,
} from '../types';

interface GasResponse<T = unknown> {
  success?: boolean;
  resource?: string;
  action?: string;
  items?: T[];
  data?: T;
  error?: string;
}

async function gasPost<T>(config: AppConfig, body: Record<string, unknown>): Promise<T> {
  const response = await fetch(config.appsScriptUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ ...body, apiKey: config.apiKey }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Proxy error ${response.status}: ${errorText.substring(0, 300)}`);
  }

  const result: GasResponse<T> = await response.json();
  if (result.error) {
    throw new Error(`GAS error: ${result.error}`);
  }

  return (result.data ?? result.items ?? result) as T;
}

async function gasGet<T>(config: AppConfig, params: Record<string, string>): Promise<T> {
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
    throw new Error(`Proxy error ${response.status}: ${errorText.substring(0, 300)}`);
  }

  const result: GasResponse<T> = await response.json();
  if (result.error) {
    throw new Error(`GAS error: ${result.error}`);
  }

  return (result.data ?? result.items ?? result) as T;
}

// ==================== Football API Proxy ====================

export async function fetchLiveFixtures(
  config: AppConfig,
  matchIds: string[],
): Promise<FootballApiFixture[]> {
  return gasPost<FootballApiFixture[]>(config, {
    resource: 'football_api',
    action: 'getLiveFixtures',
    data: { match_ids: matchIds },
  });
}

export async function fetchLiveOdds(
  config: AppConfig,
  matchId: string,
): Promise<FootballApiOddsResponse> {
  return gasPost<FootballApiOddsResponse>(config, {
    resource: 'football_api',
    action: 'getLiveOdds',
    data: { match_id: matchId },
  });
}

// ==================== Watchlist Proxy ====================

export async function fetchWatchlistMatches(config: AppConfig): Promise<WatchlistMatch[]> {
  if (config.apiUrl) {
    const res = await fetch(`${config.apiUrl}/api/watchlist`, {
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) throw new Error(`PG watchlist error ${res.status}`);
    return res.json();
  }
  return gasGet<WatchlistMatch[]>(config, {
    resource: 'watchlist',
    action: 'getAll',
  });
}

// ==================== AI Analysis Proxy ====================

export async function runAiAnalysis(
  config: AppConfig,
  prompt: string,
  provider: 'gemini' | 'claude',
  model: string,
): Promise<string> {
  return gasPost<string>(config, {
    resource: 'ai',
    action: 'analyze',
    data: { prompt, provider, model },
  });
}

// ==================== Notification Proxy ====================

export async function sendEmail(config: AppConfig, payload: EmailPayload): Promise<void> {
  await gasPost<void>(config, {
    resource: 'notification',
    action: 'sendEmail',
    data: payload,
  });
}

export async function sendTelegram(config: AppConfig, payload: TelegramPayload): Promise<void> {
  await gasPost<void>(config, {
    resource: 'notification',
    action: 'sendTelegram',
    data: payload,
  });
}

// ==================== Recommendation Proxy ====================

export async function saveRecommendation(
  config: AppConfig,
  data: RecommendationData,
): Promise<void> {
  if (config.apiUrl) {
    const res = await fetch(`${config.apiUrl}/api/recommendations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(data),
    });
    if (!res.ok) throw new Error(`PG recommendation error ${res.status}`);
    return;
  }
  await gasPost<void>(config, {
    resource: 'recommendations',
    action: 'create',
    data: [data],
  });
}
