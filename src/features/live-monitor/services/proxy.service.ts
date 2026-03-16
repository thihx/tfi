// ============================================================
// Proxy Service
// Routes external API calls through the TFI backend server.
// Football API, AI, and notifications all go through /api/proxy.
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

function apiUrl(config: AppConfig, path: string): string {
  return `${config.apiUrl}${path}`;
}

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`API error ${res.status}: ${text.substring(0, 300)}`);
  }
  return res.json();
}

// ==================== Football API Proxy ====================

export async function fetchLiveFixtures(
  config: AppConfig,
  matchIds: string[],
): Promise<FootballApiFixture[]> {
  return postJson<FootballApiFixture[]>(
    apiUrl(config, '/api/proxy/football/live-fixtures'),
    { matchIds },
  );
}

export async function fetchLiveOdds(
  config: AppConfig,
  matchId: string,
): Promise<FootballApiOddsResponse> {
  return postJson<FootballApiOddsResponse>(
    apiUrl(config, '/api/proxy/football/odds'),
    { matchId },
  );
}

// ==================== Watchlist Proxy ====================

export async function fetchWatchlistMatches(config: AppConfig): Promise<WatchlistMatch[]> {
  const res = await fetch(apiUrl(config, '/api/watchlist'), {
    headers: { Accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`Watchlist error ${res.status}`);
  return res.json();
}

// ==================== AI Analysis Proxy ====================

export async function runAiAnalysis(
  config: AppConfig,
  prompt: string,
  provider: 'gemini' | 'claude',
  model: string,
): Promise<string> {
  const result = await postJson<{ text: string }>(
    apiUrl(config, '/api/proxy/ai/analyze'),
    { prompt, provider, model },
  );
  return result.text;
}

// ==================== Notification Proxy ====================

export async function sendEmail(config: AppConfig, payload: EmailPayload): Promise<void> {
  await postJson<void>(
    apiUrl(config, '/api/proxy/notify/email'),
    payload,
  );
}

export async function sendTelegram(config: AppConfig, payload: TelegramPayload): Promise<void> {
  await postJson<void>(
    apiUrl(config, '/api/proxy/notify/telegram'),
    payload,
  );
}

// ==================== Recommendation Proxy ====================

export async function saveRecommendation(
  config: AppConfig,
  data: RecommendationData,
): Promise<void> {
  const res = await fetch(apiUrl(config, '/api/recommendations'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error(`Recommendation error ${res.status}`);
}
