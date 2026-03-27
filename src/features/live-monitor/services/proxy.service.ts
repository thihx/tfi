// ============================================================
// Proxy Service
// Routes external API calls through the TFI backend server.
// Football API, AI, and notifications all go through /api/proxy.
// ============================================================

import type { AppConfig } from '@/types';
import { internalApiUrl } from '@/lib/internal-api';
import { getToken } from '@/lib/services/auth';
import type {
  FootballApiFixture,
  FootballApiOddsResponse,
  EmailPayload,
  TelegramPayload,
  WatchlistMatch,
  RecommendationData,
  PreviousRecommendation,
  MatchTimelineSnapshot,
} from '../types';

function apiUrl(config: AppConfig, path: string): string {
  return internalApiUrl(path, config);
}

function authHeaders(): Record<string, string> {
  const token = getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function postJson<T>(url: string, body: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...authHeaders() },
      body: JSON.stringify(body),
      credentials: 'include',
    });
  } catch (err) {
    throw new Error(`Network error calling ${url}: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`API error ${res.status} from ${url}: ${text.substring(0, 300)}`);
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
  homeTeam?: string,
  awayTeam?: string,
  kickoffTimestamp?: number,
  leagueName?: string,
  leagueCountry?: string,
  status?: string,
  matchMinute?: number,
): Promise<FootballApiOddsResponse> {
  return postJson<FootballApiOddsResponse>(
    apiUrl(config, '/api/proxy/football/odds'),
    { matchId, homeTeam, awayTeam, kickoffTimestamp, leagueName, leagueCountry, status, matchMinute },
  );
}

// ==================== Watchlist Proxy ====================

export async function fetchWatchlistMatches(config: AppConfig): Promise<WatchlistMatch[]> {
  const res = await fetch(apiUrl(config, '/api/me/watch-subscriptions'), {
    headers: { Accept: 'application/json', ...authHeaders() },
    credentials: 'include',
  });
  if (!res.ok) throw new Error(`Watchlist error ${res.status}`);
  return res.json();
}

// ==================== AI Analysis Proxy ====================

export async function runAiAnalysis(
  config: AppConfig,
  matchId: string,
  provider: 'gemini' | 'claude',
  model: string,
  forceAnalyze: boolean = false,
): Promise<string> {
  const result = await postJson<{ text: string }>(
    apiUrl(config, '/api/proxy/ai/analyze'),
    { matchId, provider, model, forceAnalyze },
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
): Promise<{ id: number }> {
  const res = await fetch(apiUrl(config, '/api/recommendations'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...authHeaders() },
    body: JSON.stringify(data),
    credentials: 'include',
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Recommendation error ${res.status}: ${body.substring(0, 300)}`);
  }
  return res.json();
}

// ==================== AI Context Proxy ====================

export async function fetchMatchRecommendations(
  config: AppConfig,
  matchId: string,
): Promise<PreviousRecommendation[]> {
  const res = await fetch(apiUrl(config, `/api/recommendations/match/${encodeURIComponent(matchId)}`), {
    headers: { Accept: 'application/json', ...authHeaders() },
    credentials: 'include',
  });
  if (!res.ok) return [];
  const rows: Array<{
    minute: number | null;
    selection: string;
    bet_market: string;
    confidence: number | null;
    odds: number | null;
    reasoning: string;
    result: string;
    timestamp: string;
  }> = await res.json();
  return rows.slice(0, 5).map((r) => ({
    minute: r.minute,
    selection: r.selection || '',
    bet_market: r.bet_market || '',
    confidence: r.confidence,
    odds: r.odds,
    reasoning: r.reasoning || '',
    result: r.result || '',
    timestamp: r.timestamp || '',
  }));
}

export async function fetchMatchSnapshots(
  config: AppConfig,
  matchId: string,
): Promise<MatchTimelineSnapshot[]> {
  const res = await fetch(apiUrl(config, `/api/snapshots/match/${encodeURIComponent(matchId)}`), {
    headers: { Accept: 'application/json', ...authHeaders() },
    credentials: 'include',
  });
  if (!res.ok) return [];
  const rows: Array<{
    minute: number;
    home_score: number;
    away_score: number;
    stats: Record<string, string> | null;
    status: string;
  }> = await res.json();
  // Keep last 10 snapshots for token budget
  return rows.slice(-10).map((r) => ({
    minute: r.minute,
    score: `${r.home_score ?? 0}-${r.away_score ?? 0}`,
    possession: r.stats?.possession || '-',
    shots: r.stats?.shots || '-',
    shots_on_target: r.stats?.shots_on_target || '-',
    corners: r.stats?.corners || '-',
    fouls: r.stats?.fouls || '-',
    yellow_cards: r.stats?.yellow_cards || '-',
    red_cards: r.stats?.red_cards || '-',
    goalkeeper_saves: r.stats?.goalkeeper_saves || '-',
    status: r.status || '',
  }));
}

// ==================== Data Tracking Proxy ====================

export async function saveMatchSnapshot(
  config: AppConfig,
  data: {
    match_id: string;
    minute: number;
    status?: string;
    home_score?: number;
    away_score?: number;
    stats?: Record<string, unknown>;
    events?: unknown[];
    odds?: Record<string, unknown>;
    source?: string;
  },
): Promise<void> {
  await postJson(apiUrl(config, '/api/snapshots'), data);
}

export async function saveOddsMovements(
  config: AppConfig,
  movements: Array<{
    match_id: string;
    match_minute?: number | null;
    market: string;
    bookmaker?: string;
    line?: number | null;
    price_1?: number | null;
    price_2?: number | null;
    price_x?: number | null;
  }>,
): Promise<void> {
  if (movements.length === 0) return;
  await postJson(apiUrl(config, '/api/odds/bulk'), movements);
}

export async function saveAiPerformance(
  config: AppConfig,
  data: {
    recommendation_id: number;
    match_id: string;
    ai_model?: string;
    prompt_version?: string;
    ai_confidence?: number | null;
    ai_should_push?: boolean;
    predicted_market?: string;
    predicted_selection?: string;
    predicted_odds?: number | null;
    match_minute?: number | null;
    match_score?: string;
    league?: string;
  },
): Promise<void> {
  await postJson(apiUrl(config, '/api/ai-performance'), data);
}

// ==================== Historical Performance Context (AI Feedback Loop) ====================

export interface HistoricalPerformanceContext {
  overall: { settled: number; correct: number; accuracy: number };
  byMarket: Array<{ market: string; settled: number; correct: number; accuracy: number }>;
  byConfidenceBand: Array<{ band: string; settled: number; correct: number; accuracy: number }>;
  byMinuteBand: Array<{ band: string; settled: number; correct: number; accuracy: number }>;
  byOddsRange: Array<{ range: string; settled: number; correct: number; accuracy: number }>;
  byLeague: Array<{ league: string; settled: number; correct: number; accuracy: number }>;
  generatedAt: string;
}

// Client-side cache: avoid redundant fetches during rapid pipeline runs within same session
let _perfCache: { data: HistoricalPerformanceContext; expiresAt: number } | null = null;
const PERF_CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes

/**
 * Fetch aggregated historical performance data for injection into the AI prompt.
 * Cached for 10 minutes — safe for a 90-min match with pipeline runs every 5 min.
 */
export async function fetchHistoricalPerformance(
  config: AppConfig,
): Promise<HistoricalPerformanceContext | null> {
  const now = Date.now();
  if (_perfCache && _perfCache.expiresAt > now) {
    return _perfCache.data;
  }
  try {
    const res = await fetch(apiUrl(config, '/api/ai-performance/prompt-context'), {
      headers: { Accept: 'application/json', ...authHeaders() },
      credentials: 'include',
    });
    if (!res.ok) return null;
    const data: HistoricalPerformanceContext = await res.json();
    _perfCache = { data, expiresAt: now + PERF_CACHE_TTL_MS };
    return data;
  } catch {
    return null;
  }
}

/** Clear the performance cache (useful for tests) */
export function clearPerformanceCache(): void {
  _perfCache = null;
}
