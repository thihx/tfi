// ============================================================
// Football API Client — api-sports.io v3
// ============================================================

import { config } from '../config.js';

interface ApiFootballResponse<T> {
  get: string;
  parameters: Record<string, string>;
  errors: Record<string, string>;
  results: number;
  response: T[];
}

// ==================== Fixtures ====================

export interface ApiFixture {
  fixture: {
    id: number;
    referee: string | null;
    timezone: string;
    date: string;
    timestamp: number;
    periods: { first: number | null; second: number | null };
    venue: { id: number | null; name: string | null; city: string | null };
    status: { long: string; short: string; elapsed: number | null };
  };
  league: { id: number; name: string; country: string; logo: string; flag: string | null; season: number; round: string };
  teams: {
    home: { id: number; name: string; logo: string; winner: boolean | null };
    away: { id: number; name: string; logo: string; winner: boolean | null };
  };
  goals: { home: number | null; away: number | null };
  score: Record<string, { home: number | null; away: number | null }>;
}

// ==================== Predictions ====================

export interface ApiPrediction {
  predictions: {
    winner: { id: number; name: string; comment: string } | null;
    win_or_draw: boolean;
    under_over: string | null;
    goals: { home: string; away: string } | null;
    advice: string;
    percent: { home: string; draw: string; away: string } | null;
  };
  comparison: {
    form: { home: string; away: string } | null;
    att: { home: string; away: string } | null;
    def: { home: string; away: string } | null;
    goals: { home: string; away: string } | null;
    total: { home: string; away: string } | null;
  };
  // We ignore league, teams, h2h to keep it slim
}

// ==================== API Calls ====================

async function apiGet<T>(endpoint: string, params: Record<string, string> = {}): Promise<T[]> {
  if (!config.footballApiKey) throw new Error('FOOTBALL_API_KEY not configured');

  const url = new URL(config.footballApiBaseUrl + endpoint);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

  const res = await fetch(url.toString(), {
    headers: {
      'x-apisports-key': config.footballApiKey,
      Accept: 'application/json',
    },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Football API ${res.status}: ${text.substring(0, 300)}`);
  }

  const data: ApiFootballResponse<T> = await res.json();
  if (data.errors && Object.keys(data.errors).length > 0) {
    throw new Error(`Football API errors: ${JSON.stringify(data.errors)}`);
  }
  return data.response;
}

export async function fetchFixturesForDate(date: string): Promise<ApiFixture[]> {
  return apiGet<ApiFixture>('/fixtures', { date, timezone: config.timezone });
}

export async function fetchPrediction(fixtureId: string): Promise<ApiPrediction | null> {
  const results = await apiGet<ApiPrediction>('/predictions', { fixture: fixtureId });
  return results[0] ?? null;
}

// ==================== Helpers ====================

/** Build a slim prediction object (same format as Apps Script buildSlimPrediction_) */
export function buildSlimPrediction(item: ApiPrediction) {
  const pred = item.predictions;
  const comp = item.comparison;
  return {
    predictions: {
      winner: pred.winner ?? null,
      win_or_draw: pred.win_or_draw,
      under_over: pred.under_over,
      goals: pred.goals ?? null,
      advice: pred.advice,
      percent: pred.percent ?? null,
    },
    comparison: {
      form: comp.form ?? null,
      att: comp.att ?? null,
      def: comp.def ?? null,
      goals: comp.goals ?? null,
      total: comp.total ?? null,
    },
  };
}
